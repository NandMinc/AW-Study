// Test helper (not used by the app, so not in the build; it lives in src/ because the image build
// type-checks src/ without tests/). Makes small, valid PDF files for tests: landscape "slides"
// (720 × 540 points, 4:3, or another size such as a portrait LETTER page) with a title and a line of text on each, in Helvetica (one of PDF's
// standard fonts, not embedded). No real lecture slides are ever committed (CLAUDE.md).

export interface FixturePage {
  title: string;
  body?: string;
  /** Raw PDF drawing operators added to the page, e.g. lines for a graph (#157). */
  drawing?: string;
  /** A small grey checkerboard picture (an inline image) drawn in this box, in points (#157). */
  picture?: { x: number; y: number; width: number; height: number };
  /** Leave out the coloured bar every page otherwise has (#157: a blank page). */
  noBar?: boolean;
}

/** A line graph's axes and a zig-zag, in a box from (x, y), for a page's `drawing` (#157). */
export function graphDrawing(x: number, y: number, width: number, height: number): string {
  const pts = Array.from({ length: 8 }, (_, i) => `${x + 10 + (i * (width - 20)) / 7} ${y + 10 + ((i % 2 ? 0.8 : 0.3) * (height - 20))}`);
  return [
    `0 0 0 RG 1.5 w ${x} ${y + height} m ${x} ${y} l ${x + width} ${y} l S`,
    `0.8 0.1 0.1 RG 2 w ${pts[0]} m ${pts.slice(1).map((p) => `${p} l`).join(' ')} S`,
  ].join('\n');
}

/** A page's size in points: a 4:3 slide unless given. */
export interface PageSize {
  width: number;
  height: number;
}

/** US Letter, portrait: a Word document saved as PDF (#46). */
export const LETTER: PageSize = { width: 612, height: 792 };

/** A PDF with these pages, as bytes. */
export function makePdf(pages: FixturePage[], size: PageSize = { width: 720, height: 540 }): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body); // its object number: they start at 1

  const catalog = add(''); // filled in once the pages object exists
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const page of pages) {
    const top = size.height - 100;
    const lines = [`BT /F1 36 Tf 60 ${top} Td (${escape(page.title)}) Tj ET`];
    if (page.body) lines.push(`BT /F1 20 Tf 60 ${top - 60} Td (${escape(page.body)}) Tj ET`);
    if (!page.noBar) lines.push(`0.2 0.4 0.8 rg 60 100 ${size.width - 120} 12 re f`); // a coloured bar, so pages aren't blank
    if (page.drawing) lines.push(`q ${page.drawing} Q`);
    if (page.picture) {
      const { x, y, width, height } = page.picture;
      const cells = Array.from({ length: 64 }, (_, i) => ((i >> 3) + (i & 7)) % 2 ? '20' : 'C0').join('');
      lines.push(`q ${width} 0 0 ${height} ${x} ${y} cm BI /W 8 /H 8 /CS /G /BPC 8 /F /AHx ID ${cells}> EI Q`);
    }
    const stream = lines.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${size.width} ${size.height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out); // ASCII only, so characters and bytes line up
}

/** `count` numbered slides: "Slide 1" … with "Fixture text 1" … underneath. */
export function numberedSlides(count: number, size?: PageSize): Uint8Array {
  return makePdf(
    Array.from({ length: count }, (_, i) => ({ title: `Slide ${i + 1}`, body: `Fixture text ${i + 1}` })),
    size,
  );
}

function escape(text: string): string {
  if (/[^\x20-\x7e]/.test(text)) throw new Error('makePdf: ASCII text only');
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}
