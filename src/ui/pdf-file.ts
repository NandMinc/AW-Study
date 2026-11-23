// Reading a PDF the user picked: its bytes and the text of each page (which gives the page count),
// ready for addSlideDeck. PDF.js is loaded only when a PDF is first opened, so the app's first
// screen doesn't wait for it.
import { MAX_PDF_BYTES, MAX_PDF_PAGES } from '../db/lectures';
import { MAX_MATERIAL_PAGES, MAX_MATERIAL_PDF_BYTES, MAX_MATERIAL_TEXT_BYTES } from '../db/style';
import type { MaterialType } from '../types/style';

export interface PickedPdf {
  fileName: string;
  data: Uint8Array;
  pageTexts: string[];
}

export class PdfProblem extends Error {}

export async function readPdfFile(file: File): Promise<PickedPdf> {
  if (file.size === 0) throw new PdfProblem('That file is empty.');
  if (file.size > MAX_PDF_BYTES) throw new PdfProblem('That PDF is over 100 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(data.subarray(0, 5)).startsWith('%PDF-')) {
    throw new PdfProblem('That file isn’t a PDF. Save the slides as a PDF first (in PowerPoint: File › Save As › PDF).');
  }
  const { extractPageText } = await import('../viewer/pdf');
  let pageTexts: string[];
  try {
    pageTexts = await extractPageText(data);
  } catch {
    throw new PdfProblem('That PDF couldn’t be opened. It may be damaged, or protected with a password.');
  }
  if (pageTexts.length === 0) throw new PdfProblem('That PDF has no pages.');
  if (pageTexts.length > MAX_PDF_PAGES) throw new PdfProblem(`PDFs can have at most ${MAX_PDF_PAGES} pages.`);
  return { fileName: file.name, data, pageTexts };
}

/** A class document the user picked (#122): a PDF read like slides, or a plain text file (one page). */
export interface PickedMaterial {
  fileName: string;
  type: MaterialType;
  data: Uint8Array;
  pageTexts: string[];
}

const TEXT_NAME = /\.(txt|text|md)$/i;

export async function readMaterialFile(file: File): Promise<PickedMaterial> {
  if (file.size === 0) throw new PdfProblem('That file is empty.');
  if (file.type.startsWith('text/') || TEXT_NAME.test(file.name)) {
    if (file.size > MAX_MATERIAL_TEXT_BYTES) throw new PdfProblem('That text file is over 5 MB.');
    const data = new Uint8Array(await file.arrayBuffer());
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      throw new PdfProblem('That file isn’t plain text. Save it as a PDF or a .txt file first.');
    }
    return { fileName: file.name, type: 'text/plain', data, pageTexts: [text] };
  }
  if (file.size > MAX_MATERIAL_PDF_BYTES) throw new PdfProblem('That PDF is over 100 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(data.subarray(0, 5)).startsWith('%PDF-')) {
    throw new PdfProblem('Only PDFs and plain text files can be added for now. Save it as a PDF first.');
  }
  const { extractPageText } = await import('../viewer/pdf');
  let pageTexts: string[];
  try {
    pageTexts = await extractPageText(data);
  } catch {
    throw new PdfProblem('That PDF couldn’t be opened. It may be damaged, or protected with a password.');
  }
  if (pageTexts.length === 0) throw new PdfProblem('That PDF has no pages.');
  if (pageTexts.length > MAX_MATERIAL_PAGES) throw new PdfProblem(`Documents can have at most ${MAX_MATERIAL_PAGES} pages.`);
  return { fileName: file.name, type: 'application/pdf', data, pageTexts };
}
