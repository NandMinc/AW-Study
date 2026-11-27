// What Explain this and Ask about this send (#175; DESIGN.md "Reading pictures and choosing models", build step 7):
// the slide and its neighbours with what the AI read on their pictures, and for a box, a picture of the box.
// A slide with pictures that hasn't been read yet is read now (Haiku, then Sonnet for hard content) and the reading
// saved, so the batch never reads it again (it skips pages whose reading has their fingerprint).
import type { AiBackend, SlideText } from '../ai/backend';
import type { StudyStore } from '../db/store';
import { openPdf, type OpenPdf } from '../viewer/pdf';
import { drawAreaPng, drawPagePng, scanPages, type AreaRect } from './scan';
import { textWithReading } from './work';

/** The AI's limit on a slide's text for Explain and Ask. */
const SLIDE_TEXT_MAX = 8_000;

export interface AiContext {
  slides: SlideText[];
  /** The boxed area as a PNG, for a box. */
  image?: Uint8Array;
}

export type PrepareAi = (page: number, area?: AreaRect, signal?: AbortSignal) => Promise<AiContext>;

/**
 * For one deck: the function the viewer calls before Explain or Ask. Opens the deck's PDF once, the first time it's
 * needed. A page that can't be read now (signed out, offline) is sent with its text alone: Explain still works.
 */
export function prepareAi(options: {
  store: Pick<StudyStore, 'getPageReading' | 'savePageReading'>;
  ai: Pick<AiBackend, 'readPage'>;
  deckId: string;
  pdf: Uint8Array;
  pageTexts: readonly string[];
}): PrepareAi & { close: () => Promise<void> } {
  const { store, ai, deckId, pageTexts } = options;
  let opened: Promise<OpenPdf> | null = null;
  const doc = () => (opened ??= openPdf(options.pdf));

  /** The page's reading: as saved, or read now if it has pictures and none is saved for this drawing of it. */
  async function readingOf(page: number, signal?: AbortSignal) {
    const { doc: pdf } = await doc();
    const [scan] = await scanPages(pdf, [page]);
    const saved = await store.getPageReading(deckId, page);
    if (saved && saved.fingerprint.text === scan!.fingerprint.text && saved.fingerprint.look === scan!.fingerprint.look) return saved;
    if (scan!.sort !== 'pictures') return undefined;
    try {
      const read = await ai.readPage({ text: scan!.text, image: await drawPagePng(pdf, page) }, signal);
      return await store.savePageReading({ deckId, page, fingerprint: scan!.fingerprint, ...read.reading, model: read.model });
    } catch {
      return undefined; // couldn't be read now: the text alone, and the batch reads it later
    }
  }

  const prepare = (async (page, area, signal) => {
    const neighbours = [page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageTexts.length);
    const slides: SlideText[] = [];
    for (const n of neighbours) {
      // Only the slide itself is read now; its neighbours go with a reading if they have one already
      const reading = n === page ? await readingOf(n, signal) : ((await store.getPageReading(deckId, n)) ?? undefined);
      const text = textWithReading(pageTexts[n - 1] ?? '', reading).slice(0, SLIDE_TEXT_MAX);
      if (n === page || text.trim()) slides.push({ page: n, text });
    }
    const image = area ? await drawAreaPng((await doc()).doc, page, area) : undefined;
    return { slides, ...(image && { image }) };
  }) as PrepareAi & { close: () => Promise<void> };
  prepare.close = async () => {
    if (opened) await (await opened).close();
    opened = null;
  };
  return prepare;
}
