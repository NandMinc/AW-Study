#!/usr/bin/env node
// How long the tests take, and where the time goes (#192). Runs a test command N times (default: `npm test`, 3
// times) and prints the median wall time, then the browser tests by device and by file, and the slowest tests,
// from Playwright's JSON report. Measure before and after a change to the tests or their setup; don't judge from
// one run, and keep the machine otherwise idle while it runs.
//
//   node tools/test-timing.mjs                    3 runs of npm test
//   node tools/test-timing.mjs --runs 5
//   node tools/test-timing.mjs -- npx playwright test --project=iphone     any other command
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const at = args.indexOf('--runs');
const runs = at === -1 ? 3 : Number(args[at + 1]);
const dash = args.indexOf('--');
const command = dash === -1 ? 'npm test' : args.slice(dash + 1).join(' ');
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs needs a whole number');

const dir = mkdtempSync(join(tmpdir(), 'test-timing-'));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
const s = (ms) => `${(ms / 1000).toFixed(1)} s`;

const walls = [];
const reports = [];
for (let i = 1; i <= runs; i++) {
  const json = join(dir, `run-${i}.json`);
  const start = performance.now();
  const run = spawnSync(command, { shell: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEST_TIMING_JSON: json } });
  const wall = performance.now() - start;
  if (run.status !== 0) {
    console.error(`Run ${i} failed (exit ${run.status}): its timing is not used.\n${run.stderr.toString().slice(-2000)}`);
    process.exitCode = 1;
    continue;
  }
  walls.push(wall);
  if (existsSync(json)) reports.push(JSON.parse(readFileSync(json, 'utf8')));
  console.log(`run ${i}: ${s(wall)}`);
}
if (walls.length === 0) process.exit(1);

console.log(`\n${command}: median ${s(median(walls))} over ${walls.length} run(s) (${walls.map(s).join(', ')})`);
if (reports.length === 0) process.exit();

// The browser tests: every passed result, from every run
const results = [];
const walk = (suite, file) => {
  for (const spec of suite.specs ?? [])
    for (const t of spec.tests)
      for (const r of t.results) if (r.status !== 'skipped') results.push({ file, title: spec.title, project: t.projectName, ms: r.duration });
  for (const child of suite.suites ?? []) walk(child, file);
};
for (const report of reports) for (const suite of report.suites) walk(suite, suite.file);
const per = (xs) => xs.reduce((n, x) => n + x.ms, 0) / reports.length; // per run

console.log(`Browser tests: median ${s(median(reports.map((r) => r.stats.duration)))} wall, ${reports[0].config.workers} at once`);
console.log('\nBy device (per run)        tests   total   average  slowest');
for (const project of [...new Set(results.map((r) => r.project))]) {
  const mine = results.filter((r) => r.project === project);
  const count = mine.length / reports.length;
  console.log(
    `  ${project.padEnd(24)} ${String(count).padStart(5)} ${s(per(mine)).padStart(8)} ${s(per(mine) / count).padStart(8)} ${s(Math.max(...mine.map((r) => r.ms))).padStart(8)}`,
  );
}
const files = new Map();
for (const r of results) files.set(r.file, [...(files.get(r.file) ?? []), r]);
console.log('\nBy file (per run, all devices)');
for (const [file, mine] of [...files].sort((a, b) => per(b[1]) - per(a[1])).slice(0, 10)) console.log(`  ${file.padEnd(28)} ${s(per(mine)).padStart(8)}`);
console.log('\nSlowest tests');
for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 5)) console.log(`  ${s(r.ms).padStart(7)} ${r.project.padEnd(8)} ${r.file}: ${r.title.slice(0, 60)}`);
rmSync(dir, { recursive: true, force: true });
