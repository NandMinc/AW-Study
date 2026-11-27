// The model test (#155): draws chosen PDF pages, sends each to several models with the reading prompt
// (reading.mjs), and saves the answers side by side with their real token counts and the API price
// Claude Code reports, plus report.html to compare them by eye.
//
//   node tools/read-pages/run.mjs --pdf <file.pdf> --pages 1,8,11-12 --out <folder outside the repo>
//        [--name fallacies] [--models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5] [--long-edge 1200]
//
// Runs Claude Code locked down the way the helper does (no tools, one turn, our own system prompt, no saved
// session), on the signed-in account of whoever runs it: it uses that person's Claude usage. The PDFs and
// the answers are other people's material, so --out must be outside the repo.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { needsStrongerModel, parseReading, readingPrompt, READING_SYSTEM } from './reading.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function options(argv) {
  const o = { models: 'claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5', 'long-edge': '1200' };
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`Bad argument: ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  for (const k of ['pdf', 'pages', 'out']) if (!o[k]) throw new Error(`--${k} is needed.`);
  const out = path.resolve(o.out);
  const rel = path.relative(repo, out);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('--out must be outside the repo (the answers are other people\'s material).');
  const pages = o.pages.split(',').flatMap((part) => {
    const [a, b = a] = part.split('-').map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a) throw new Error(`Bad page range: ${part}`);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
  const name = o.name ?? path.basename(o.pdf, '.pdf').replace(/[^\w-]+/g, '-').slice(0, 40);
  return { pdf: path.resolve(o.pdf), pages, out: path.join(out, name), name, models: o.models.split(','), longEdge: Number(o['long-edge']) };
}

// --- Drawing pages: PDF.js in Chromium, the page text joined the way the app does (src/viewer/pdf.ts textOf) ---

const PAGE_HTML = `<!doctype html><body style="margin:0;background:#fff"><canvas id=c></canvas><script type=module>
import * as pdfjs from '/pdfjs/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
const doc = await pdfjs.getDocument({ url: '/doc.pdf' }).promise;
window.pageCount = doc.numPages;
function textOf(items) {
  let text = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    text += item.str;
    text += item.hasEOL ? '\\n' : item.str && !item.str.endsWith(' ') ? ' ' : '';
  }
  return text.split('\\n').map((l) => l.replace(/[ \\t]+/g, ' ').trim()).filter((l) => l !== '').join('\\n');
}
window.draw = async (n, longEdge) => {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: longEdge / Math.max(base.width, base.height) });
  const c = document.getElementById('c');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvas: c, viewport: vp }).promise;
  return { width: c.width, height: c.height, text: textOf((await page.getTextContent()).items) };
};
window.ready = true;
</script>`;

async function drawPages(pdf, pages, longEdge, outDir) {
  const pdfjsBuild = path.join(repo, 'node_modules/pdfjs-dist/build');
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE_HTML);
      if (req.url === '/doc.pdf') return res.writeHead(200, { 'content-type': 'application/pdf' }).end(await readFile(pdf));
      if (req.url.startsWith('/pdfjs/')) return res.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(path.join(pdfjsBuild, path.basename(req.url))));
    } catch {}
    res.writeHead(404).end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 2000, height: 2000 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 120_000 });
    const count = await page.evaluate(() => window.pageCount);
    const drawn = [];
    for (const n of pages) {
      if (n > count) throw new Error(`The PDF has ${count} pages, not ${n}.`);
      const info = await page.evaluate(([n, e]) => window.draw(n, e), [n, longEdge]);
      const png = path.join(outDir, `p${n}.png`);
      await page.locator('#c').screenshot({ path: png });
      await writeFile(path.join(outDir, `p${n}.text.txt`), info.text);
      drawn.push({ page: n, png, ...info });
    }
    return drawn;
  } finally {
    await browser.close();
    server.close();
  }
}

// --- Asking a model, locked down like helper/claude.mjs ---

async function ask(model, pngPath, pageText) {
  const data = (await readFile(pngPath)).toString('base64');
  const cwd = await mkdtemp(path.join(tmpdir(), 'read-pages-'));
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--tools', '', '--disallowedTools', '*', '--strict-mcp-config', '--disable-slash-commands',
    '--no-session-persistence', '--max-turns', '1', '--model', model, '--system-prompt', READING_SYSTEM,
  ];
  const started = Date.now();
  try {
    const out = await new Promise((resolve, reject) => {
      const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill(), 300_000);
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(stdout) : reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 300)}`));
      });
      child.stdin.end(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
          { type: 'text', text: readingPrompt(pageText) },
        ] },
      }) + '\n');
    });
    const result = out.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m?.type === 'result');
    if (!result) throw new Error('No result from claude.');
    if (result.subtype !== 'success') throw new Error(`claude: ${result.subtype}`);
    const u = result.usage ?? {};
    return {
      raw: result.result,
      ms: Date.now() - started,
      usage: {
        input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        output: u.output_tokens ?? 0,
        thinking: u.output_tokens_details?.thinking_tokens ?? 0,
      },
      costUsd: result.total_cost_usd ?? null,
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function read(model, drawn) {
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await ask(model, drawn.png, drawn.text);
      try {
        return { model, page: drawn.page, attempt, ...r, answer: parseReading(r.raw) };
      } catch (e) {
        last = { model, page: drawn.page, attempt, ...r, error: e.message };
      }
    } catch (e) {
      last = { model, page: drawn.page, attempt, error: e.message };
    }
  }
  return last;
}

// --- The report ---

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function reportHtml(name, drawn, results, models) {
  const cell = (r) => {
    if (!r) return '<td></td>';
    const meta = `<p class=meta>${r.usage ? `${r.usage.input} in · ${r.usage.output} out (${r.usage.thinking} thinking) · ` : ''}${r.costUsd != null ? `$${r.costUsd.toFixed(4)} · ` : ''}${r.ms ? `${(r.ms / 1000).toFixed(1)} s` : ''}${r.attempt > 1 ? ' · retried' : ''}</p>`;
    if (r.error) return `<td>${meta}<p class=err>${esc(r.error)}</p><pre>${esc(r.raw)}</pre></td>`;
    const a = r.answer;
    return `<td>${meta}${a.unsure ? `<p class=unsure>Unsure: ${esc(a.unsureWhy)}</p>` : ''}<p class=meta>Kinds: ${esc(a.kinds.join(", ") || "none")}${needsStrongerModel(a) ? " · would go to a stronger model" : ""}</p>${a.decorativeOnly ? "<p><i>Decoration only</i></p>" : ""}${a.pictureText ? `<h4>Text in pictures</h4><pre>${esc(a.pictureText)}</pre>` : ''}${a.figures.map((f) => `<h4>${esc(f.label)}</h4><p>${esc(f.description)}</p>`).join('')}</td>`;
  };
  const rows = drawn.map((d) => `<tr><td class=pg><a href="p${d.page}.png"><img src="p${d.page}.png"></a><p>Page ${d.page} · ${d.width}×${d.height}px · ${d.text.length} characters of text</p></td>${models.map((m) => cell(results.find((r) => r.page === d.page && r.model === m))).join('')}</tr>`).join('');
  return `<!doctype html><meta charset=utf-8><title>Model test: ${esc(name)}</title><style>
body{font:14px system-ui;margin:16px}table{border-collapse:collapse;table-layout:fixed;width:100%}td,th{border:1px solid #ccc;padding:8px;vertical-align:top}
.pg{width:22%}img{width:100%}pre{white-space:pre-wrap;font:12px ui-monospace,monospace;background:#f6f6f6;padding:6px}
.meta{color:#666;font-size:12px}.unsure{background:#fff3cd;padding:4px}.err{color:#b00}h4{margin:8px 0 2px}</style>
<h1>Model test: ${esc(name)}</h1><table><tr><th>Page</th>${models.map((m) => `<th>${esc(m)}</th>`).join('')}</tr>${rows}</table>`;
}

// --- Main ---

const o = options(process.argv.slice(2));
await mkdir(o.out, { recursive: true });
console.log(`Drawing ${o.pages.length} pages of ${path.basename(o.pdf)} at ${o.longEdge}px on the long edge…`);
const drawn = await drawPages(o.pdf, o.pages, o.longEdge, o.out);
const jobs = drawn.flatMap((d) => o.models.map((m) => () => read(m, d)));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < jobs.length) {
    const r = await jobs[next++]();
    results.push(r);
    await writeFile(path.join(o.out, `p${r.page}.${r.model}.json`), JSON.stringify(r, null, 2));
    console.log(`page ${r.page} ${r.model}: ${r.error ? 'ERROR ' + r.error : `${r.usage.input} in, ${r.usage.output} out, ${r.answer.figures.length} figures, kinds [${r.answer.kinds}]${r.answer.unsure ? ', unsure' : ''}${needsStrongerModel(r.answer) ? ' -> stronger' : ''}`}`);
  }
}));
await writeFile(path.join(o.out, 'report.html'), reportHtml(o.name, drawn, results, o.models));
const summary = o.models.map((m) => {
  const rs = results.filter((r) => r.model === m && r.usage);
  const sum = (f) => rs.reduce((t, r) => t + f(r), 0);
  return { model: m, pages: rs.length, errors: results.filter((r) => r.model === m && r.error).length, unsure: rs.filter((r) => r.answer?.unsure).length, toStronger: rs.filter((r) => r.answer && needsStrongerModel(r.answer)).length, inputPerPage: Math.round(sum((r) => r.usage.input) / (rs.length || 1)), outputPerPage: Math.round(sum((r) => r.usage.output) / (rs.length || 1)), usdPerPage: +(sum((r) => r.costUsd ?? 0) / (rs.length || 1)).toFixed(5), secondsPerPage: +(sum((r) => r.ms) / 1000 / (rs.length || 1)).toFixed(1) };
});
await writeFile(path.join(o.out, 'summary.json'), JSON.stringify({ pdf: path.basename(o.pdf), pages: o.pages, longEdge: o.longEdge, summary }, null, 2));
console.table(summary);
console.log(`Report: ${path.join(o.out, 'report.html')}`);
