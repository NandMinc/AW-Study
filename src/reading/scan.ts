// Sorting a deck's pages with PDF.js (#157): each page drawn small, its text's boxes found, and the
// pure rules in ./sort.ts applied. Works in the browser and in Node (tests: PDF.js draws with
// @napi-rs/canvas there). Nothing leaves the device.
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { textOf } from '../viewer/pdf';
import { boxMask, fingerprint, inkShare, sortPage, SORT, templateMask, toGray, type Fingerprint, type Gray, type PageSort, type PixelBox } from './sort';

/** What sorting found on a page. */
export interface PageScan {
  page: number;
  /** The page's text, as the app keeps it (textOf). */
  text: string;
  sort: PageSort;
  /** Share of the page drawn outside its text and the deck's template (what `sort` is decided on). */
  inkOutsideText: number;
  fingerprint: Fingerprint;
}

/** How many pages, spread over the deck, are drawn to find its template (besides the pages asked for). */
export const TEMPLATE_SAMPLE = 12;

interface CanvasAndContext {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}
interface CanvasFactory {
  create(width: number, height: number): CanvasAndContext;
  destroy(c: CanvasAndContext): void;
}

interface Drawn {
  gray: Gray;
  text: string;
  textBoxes: PixelBox[];
}

/** The pages a deck's template is found from: TEMPLATE_SAMPLE spread over the deck (all of a short one). */
export function templatePages(pageCount: number): number[] {
  if (pageCount <= TEMPLATE_SAMPLE) return Array.from({ length: pageCount }, (_, i) => i + 1);
  return Array.from({ length: TEMPLATE_SAMPLE }, (_, i) => 1 + Math.floor((i * (pageCount - 1)) / (TEMPLATE_SAMPLE - 1)));
}

/**
 * Sorts these pages of a deck (numbers from 1). The template comes from the same spread of pages
 * (templatePages) whichever pages are asked for, so a page always sorts the same way, and a deck's logo or
 * header bar doesn't make every page a picture page. `scanWidth` is for tests.
 */
export async function scanPages(doc: PDFDocumentProxy, pages: readonly number[], options: { scanWidth?: number } = {}): Promise<PageScan[]> {
  const scanWidth = options.scanWidth ?? SORT.scanWidth;
  for (const n of pages) if (!Number.isInteger(n) || n < 1 || n > doc.numPages) throw new RangeError(`No page ${n} in this deck.`);
  const sample = templatePages(doc.numPages);
  const drawn = new Map<number, Drawn>();
  for (const n of new Set([...sample, ...pages])) drawn.set(n, await drawPage(doc, n, scanWidth));

  const template = templateMask(sample.map((n) => drawn.get(n)!.gray));
  const scans: PageScan[] = [];
  for (const n of pages) {
    const d = drawn.get(n)!;
    const tpl = template && template.length === d.gray.data.length ? template : null;
    const inkOutsideText = inkShare(d.gray, boxMask(d.gray.width, d.gray.height, d.textBoxes, SORT.textPad), tpl);
    scans.push({ page: n, text: d.text, sort: sortPage(d.text, inkOutsideText), inkOutsideText, fingerprint: await fingerprint(d.text, d.gray) });
  }
  return scans;
}

async function drawPage(doc: PDFDocumentProxy, n: number, scanWidth: number): Promise<Drawn> {
  const page = await doc.getPage(n);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: scanWidth / base.width });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const factory = (doc as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const target = factory.create(width, height);
    try {
      await page.render({ canvas: target.canvas, canvasContext: target.context, viewport, background: 'white' }).promise;
      const gray = toGray(target.context.getImageData(0, 0, width, height).data, width, height);
      const items = (await page.getTextContent()).items;
      return { gray, text: textOf(items), textBoxes: textBoxes(page, items, viewport) };
    } finally {
      factory.destroy(target);
    }
  } finally {
    page.cleanup();
  }
}

/** Each text item's box on the drawn page, including room for descenders, at any rotation. */
function textBoxes(_page: PDFPageProxy, items: readonly unknown[], viewport: ReturnType<PDFPageProxy['getViewport']>): PixelBox[] {
  const boxes: PixelBox[] = [];
  for (const raw of items) {
    const item = raw as Partial<TextItem>;
    if (typeof item.str !== 'string' || !item.str.trim() || !item.transform) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const size = Math.hypot(c!, d!) || Math.hypot(a!, b!);
    const along = Math.hypot(a!, b!) || 1;
    const ux = a! / along, uy = b! / along; // along the text
    const vx = -uy, vy = ux; // up from the baseline
    const w = item.width ?? 0;
    const h = item.height || size;
    const corners = [
      [e! - 0.25 * h * vx, f! - 0.25 * h * vy],
      [e! + w * ux - 0.25 * h * vx, f! + w * uy - 0.25 * h * vy],
      [e! + h * vx, f! + h * vy],
      [e! + w * ux + h * vx, f! + w * uy + h * vy],
    ].map(([x, y]) => viewport.convertToViewportPoint(x!, y!) as number[]);
    const xs = corners.map((p) => p[0]!), ys = corners.map((p) => p[1]!);
    boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
  }
  return boxes;
}

/** Pages are sent to be read this many pixels on their long edge (the model test, #155: readable, ~1,950 tokens). */
export const READ_LONG_EDGE = 1200;

/** A page drawn as a PNG for the AI to read (#168): READ_LONG_EDGE pixels on its long edge, on white. */
export async function drawPagePng(doc: PDFDocumentProxy, n: number, longEdge = READ_LONG_EDGE): Promise<Uint8Array> {
  if (!Number.isInteger(n) || n < 1 || n > doc.numPages) throw new RangeError(`No page ${n} in this deck.`);
  const page = await doc.getPage(n);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: longEdge / Math.max(base.width, base.height) });
    const factory = (doc as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const target = factory.create(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
    try {
      await page.render({ canvas: target.canvas, canvasContext: target.context, viewport, background: 'white' }).promise;
      return await toPng(target.canvas);
    } finally {
      factory.destroy(target);
    }
  } finally {
    page.cleanup();
  }
}

/** A canvas as PNG bytes: the browser's toBlob, or @napi-rs/canvas's toBuffer in Node (tests). */
async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const node = canvas as unknown as { toBuffer?: (type: string) => Uint8Array };
  if (typeof node.toBuffer === 'function') return new Uint8Array(node.toBuffer('image/png'));
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('This browser couldn’t draw the page as a picture.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** A box on a page (fractions of the page, from its top left), as in src/types/annotation.ts. */
export interface AreaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A box's area of a page as a PNG (#175): what the student boxed, for Explain and Ask. Drawn so the box is about
 * `longEdge` pixels on its long edge (sharp enough to read small print), at most 4 times the page's size.
 */
export async function drawAreaPng(doc: PDFDocumentProxy, n: number, area: AreaRect, longEdge = 1000): Promise<Uint8Array> {
  if (!Number.isInteger(n) || n < 1 || n > doc.numPages) throw new RangeError(`No page ${n} in this deck.`);
  const page = await doc.getPage(n);
  try {
    const base = page.getViewport({ scale: 1 });
    const boxW = Math.max(area.w * base.width, 1);
    const boxH = Math.max(area.h * base.height, 1);
    const scale = Math.min(4, longEdge / Math.max(boxW, boxH));
    const viewport = page.getViewport({ scale });
    const factory = (doc as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const full = factory.create(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
    const cut = factory.create(Math.max(1, Math.round(boxW * scale)), Math.max(1, Math.round(boxH * scale)));
    try {
      await page.render({ canvas: full.canvas, canvasContext: full.context, viewport, background: 'white' }).promise;
      cut.context.drawImage(full.canvas, -Math.round(area.x * viewport.width), -Math.round(area.y * viewport.height));
      return await toPng(cut.canvas);
    } finally {
      factory.destroy(full);
      factory.destroy(cut);
    }
  } finally {
    page.cleanup();
  }
}
