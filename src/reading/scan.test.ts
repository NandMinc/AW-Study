// Sorting real PDF pages (#157), on PDFs made in the test (src/viewer/test-pdf.ts). PDF.js draws in Node
// here, with @napi-rs/canvas.
import { fileURLToPath } from 'node:url';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { openPdf, setPdfAssetBase } from '../viewer/pdf';
import { graphDrawing, LETTER, makePdf, type FixturePage } from '../viewer/test-pdf';
import { scanPages, TEMPLATE_SAMPLE, templatePages } from './scan';
import { sameFingerprint } from './sort';

beforeAll(() => {
  GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
  setPdfAssetBase(fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url)));
});

async function scan(pages: FixturePage[], which?: number[], size = LETTER) {
  const { doc, close } = await openPdf(makePdf(pages, size));
  try {
    return await scanPages(doc, which ?? pages.map((_, i) => i + 1));
  } finally {
    await close();
  }
}

const words = (n: number) => ({ title: `Page ${n}`, body: `Some words on page ${n}, nothing else.` });

describe('scanPages', () => {
  it('sorts text, a vector graph, a picture and a blank page', async () => {
    // Five pages with the coloured bar: it's on every page, so it's template, not a picture.
    const scans = await scan([
      words(1),
      { ...words(2), drawing: graphDrawing(100, 300, 300, 200) },
      { ...words(3), picture: { x: 100, y: 300, width: 200, height: 150 } },
      words(4),
      words(5),
    ]);
    expect(scans.map((s) => s.sort)).toEqual(['text', 'pictures', 'pictures', 'text', 'text']);
    expect(scans[0]!.inkOutsideText).toBe(0);
    expect(scans[0]!.text).toBe('Page 1\nSome words on page 1, nothing else.');
    expect(scans[1]!.inkOutsideText).toBeGreaterThan(0.002);
  });

  it('calls a page with nothing on it blank', async () => {
    const scans = await scan([{ title: '', noBar: true }, words(2)]);
    expect(scans[0]!.sort).toBe('blank');
    expect(scans[0]!.inkOutsideText).toBe(0);
  });

  it('counts a deck’s repeated bar only when there are too few pages to call it template', async () => {
    expect((await scan([words(1), words(2)])).map((s) => s.sort)).toEqual(['pictures', 'pictures']);
    expect((await scan([words(1), words(2), words(3), words(4)])).map((s) => s.sort)).toEqual(['text', 'text', 'text', 'text']);
  });

  it('sorts a page the same whichever pages are asked for', async () => {
    // A 40-page deck with the same graph on pages 2-20: a run of covered pages with a graph each. The
    // template comes from a fixed spread of pages (5 of its 12 have the graph: not template), so asking
    // for all 19 graph pages at once mustn't turn their graph into template.
    const deck = Array.from({ length: 40 }, (_, i) => (i >= 1 && i <= 19 ? { ...words(i + 1), drawing: graphDrawing(100, 300, 300, 200) } : words(i + 1)));
    const run = await scan(deck, Array.from({ length: 19 }, (_, i) => i + 2));
    expect(run.every((s) => s.sort === 'pictures')).toBe(true);
    const alone = await scan(deck, [18]);
    expect(alone[0]).toEqual(run[16]);
  });

  it('counts a small drawing (a little graph, a formula drawn as a picture)', async () => {
    // Measured about 0.24%: real pages like this (a sparse scatter plot, a few formulas) measured 0.28-0.42%.
    const scans = await scan([words(1), { ...words(2), drawing: graphDrawing(100, 300, 100, 60) }, words(3), words(4)]);
    expect(scans[1]!.sort).toBe('pictures');
    expect(scans[1]!.inkOutsideText).toBeLessThan(0.004);
  });

  it('gives the same page the same fingerprint, and others different ones', async () => {
    const graph = { title: 'Results', drawing: graphDrawing(100, 300, 300, 200) };
    const scans = await scan([graph, words(2), graph, { title: 'Results', drawing: graphDrawing(100, 300, 300, 150) }, words(5)]);
    expect(sameFingerprint(scans[0]!.fingerprint, scans[2]!.fingerprint)).toBe(true);
    expect(sameFingerprint(scans[0]!.fingerprint, scans[3]!.fingerprint)).toBe(false); // same text, another graph
    expect(sameFingerprint(scans[0]!.fingerprint, scans[1]!.fingerprint)).toBe(false);
    const again = await scan([graph, words(2), graph, { title: 'Results', drawing: graphDrawing(100, 300, 300, 150) }, words(5)]);
    expect(again.map((s) => s.fingerprint)).toEqual(scans.map((s) => s.fingerprint));
  });

  it('works on landscape slides', async () => {
    const scans = await scan([words(1), { ...words(2), drawing: graphDrawing(300, 150, 300, 200) }, words(3), words(4)], undefined, { width: 720, height: 540 });
    expect(scans.map((s) => s.sort)).toEqual(['text', 'pictures', 'text', 'text']);
  });

  it('refuses pages that aren’t in the deck', async () => {
    await expect(scan([words(1)], [2])).rejects.toThrow(RangeError);
    await expect(scan([words(1)], [0])).rejects.toThrow(RangeError);
  });
});

describe('templatePages', () => {
  it('uses every page of a short deck, and a spread from first to last of a long one', () => {
    expect(templatePages(3)).toEqual([1, 2, 3]);
    expect(templatePages(TEMPLATE_SAMPLE)).toHaveLength(TEMPLATE_SAMPLE);
    const long = templatePages(467);
    expect(long).toHaveLength(TEMPLATE_SAMPLE);
    expect(long[0]).toBe(1);
    expect(long.at(-1)).toBe(467);
    expect(new Set(long).size).toBe(TEMPLATE_SAMPLE);
  });
});
