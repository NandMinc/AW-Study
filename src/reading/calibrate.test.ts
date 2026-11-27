// Calibration on real PDFs (#157), skipped unless SORT_PDFS names some. Real PDFs are never committed: point it
// at files on your own disk. Prints each page's sort, checks drawing twice changes nothing, and lists pages
// sharing a fingerprint (they should be truly identical).
//   SORT_PDFS="a.pdf;b.pdf" npx vitest run src/reading/calibrate.test.ts --silent=false
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, it } from 'vitest';
import { openPdf, setPdfAssetBase } from '../viewer/pdf';
import { scanPages, type PageScan } from './scan';

const files = (process.env.SORT_PDFS ?? '').split(';').filter(Boolean);

beforeAll(() => {
  GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
  setPdfAssetBase(fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url)));
});

it.skipIf(!files.length)('prints each page’s sort and the pages that share a fingerprint', async () => {
  const all: { file: string; a: PageScan; b: PageScan }[] = [];
  for (const file of files) {
    const { doc, close } = await openPdf(new Uint8Array(readFileSync(file)));
    try {
      const pages = Array.from({ length: doc.numPages }, (_, i) => i + 1);
      const a = await scanPages(doc, pages);
      const b = await scanPages(doc, pages);
      const changed = a.filter((s, i) => s.fingerprint.look !== b[i]!.fingerprint.look || s.sort !== b[i]!.sort);
      console.log(`\n${file}: drawn twice, ${changed.length} pages changed fingerprint or sort`);
      console.log(a.map((s) => `p${s.page} ${s.sort} ${(s.inkOutsideText * 100).toFixed(2)}%`).join(" | "));
      a.forEach((s) => all.push({ file, a: s, b: s }));
    } finally {
      await close();
    }
  }
  const groups = new Map<string, string[]>();
  for (const x of all) {
    const k = x.a.fingerprint.text + x.a.fingerprint.look;
    groups.set(k, [...(groups.get(k) ?? []), `${x.file.split(/[\\/]/).pop()} p${x.a.page} (${x.a.sort}, ${x.a.text.slice(0, 40).replace(/\n/g, ' ')})`]);
  }
  for (const g of groups.values()) if (g.length > 1) console.log("Same fingerprint: " + g.join("; "));
}, 900_000);
