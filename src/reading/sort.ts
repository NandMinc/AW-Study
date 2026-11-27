// Sorting a page before anything is sent to the AI (#157; DESIGN.md "Reading pictures and choosing models",
// build step 2). Pure logic on a small greyscale drawing of the page and its text's boxes; the PDF.js part
// is ./scan.ts.
//
// A page is `pictures` (worth reading: pictures of text, diagrams, graphs, structures) when enough is drawn
// outside its text's boxes; `text` when nearly all of it is real text; `blank` when it has neither. Vector
// drawings count like images: the model test (#155) found graphs and tables drawn with lines, with no image
// in the PDF at all. Whatever is drawn in the same place on most of a deck's pages (a logo, a template bar,
// a header rule) is the template, and doesn't count.
//
// A page's fingerprint says "this is a page already read": exactly the same text and exactly the same
// drawing (at SORT.scanWidth, which is the same on every device). So a repeated slide, or the same file
// added twice, is read once. It's exact on purpose: on three real PDFs, the same page drawn 4% smaller
// moved further (up to 254 of 2,304 grid cells) than some different pages were apart, so no "nearly the
// same" rule is safe, and a wrong match would leave a page unread. A page that doesn't match (a re-exported
// PDF, another device drawing a pixel differently) is just read again, for a fraction of a cent.

/** A page drawn in grey: one byte a pixel, 0 black to 255 white, row by row. */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A box in pixels: x0, y0 inclusive, x1, y1 exclusive. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type PageSort = 'text' | 'pictures' | 'blank';

export const SORT = {
  /** Pages are drawn this many pixels wide to be sorted. */
  scanWidth: 300,
  /** A pixel darker than this counts as drawn. */
  inkLevel: 235,
  /** Text boxes grow by this many pixels each way (antialiasing, accents, underlines close to the text). */
  textPad: 2,
  /**
   * A page with more than this share of its pixels drawn outside text and template has pictures. Low on
   * purpose: pages of only text measure 0, while a sparse scatter plot or a few small formulas drawn as
   * pictures measure 0.3-0.5%. A frame or rule sent by mistake costs a cheap reading; a page missed loses
   * its content (calibrated on three real PDFs, #157).
   */
  pictureShare: 0.0015,
  /** A pixel drawn on at least this share of the sampled pages is template. */
  templateShare: 0.6,
  /** Template needs this many pages of the same size to tell from a page's own drawing. */
  templateMinPages: 4,
} as const;

/** RGBA pixels (as a canvas gives them) to grey, laid over white. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < data.length; i += 4, p++) {
    const a = rgba[i + 3]! / 255;
    const lum = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
    data[p] = Math.round(lum * a + 255 * (1 - a));
  }
  return { width, height, data };
}

/** A mask (1 = covered) of these boxes, each grown by `pad` pixels and clipped to the page. */
export function boxMask(width: number, height: number, boxes: readonly PixelBox[], pad = 0): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(Math.min(b.x0, b.x1)) - pad);
    const x1 = Math.min(width, Math.ceil(Math.max(b.x0, b.x1)) + pad);
    const y0 = Math.max(0, Math.floor(Math.min(b.y0, b.y1)) - pad);
    const y1 = Math.min(height, Math.ceil(Math.max(b.y0, b.y1)) + pad);
    for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + Math.max(x0, x1));
  }
  return mask;
}

/** The share of the page's pixels that are drawn and not covered by any of the masks. */
export function inkShare(gray: Gray, ...masks: (Uint8Array | null | undefined)[]): number {
  const { data } = gray;
  let ink = 0;
  outer: for (let p = 0; p < data.length; p++) {
    if (data[p]! >= SORT.inkLevel) continue;
    for (const m of masks) if (m && m[p]) continue outer;
    ink++;
  }
  return data.length ? ink / data.length : 0;
}

/**
 * The template of a deck: pixels drawn on at least SORT.templateShare of these pages. Null when there are
 * too few pages of one size to tell (then nothing counts as template). Pages of another size are left out.
 */
export function templateMask(pages: readonly Gray[]): Uint8Array | null {
  if (!pages.length) return null;
  const { width, height } = pages[0]!;
  const same = pages.filter((g) => g.width === width && g.height === height);
  if (same.length < SORT.templateMinPages) return null;
  const counts = new Uint16Array(width * height);
  for (const g of same) for (let p = 0; p < counts.length; p++) if (g.data[p]! < SORT.inkLevel) counts[p]!++;
  const need = Math.ceil(same.length * SORT.templateShare);
  const mask = new Uint8Array(counts.length);
  for (let p = 0; p < counts.length; p++) if (counts[p]! >= need) mask[p] = 1;
  return mask;
}

/** Text, pictures or blank, from the page's text and the share drawn outside its text and template. */
export function sortPage(text: string, inkOutsideText: number): PageSort {
  if (inkOutsideText > SORT.pictureShare) return 'pictures';
  return text.trim() ? 'text' : 'blank';
}

// --- Fingerprints ---

/** A page's fingerprint: SHA-256 of its text and of its drawing, in hex. Equal fingerprints, the same page. */
export interface Fingerprint {
  /** Of the normalised text. */
  text: string;
  /** Of the drawing: its width and height, then its grey pixels. */
  look: string;
}

/** Text as it's compared: runs of white space as one space, trimmed. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The page's fingerprint. */
export async function fingerprint(text: string, gray: Gray): Promise<Fingerprint> {
  const look = new Uint8Array(8 + gray.data.length);
  new DataView(look.buffer).setUint32(0, gray.width);
  new DataView(look.buffer).setUint32(4, gray.height);
  look.set(gray.data, 8);
  return { text: await sha256Hex(new TextEncoder().encode(normaliseText(text))), look: await sha256Hex(look) };
}

/** The same page: exactly the same text and drawing. */
export function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  return a.text === b.text && a.look === b.look;
}
