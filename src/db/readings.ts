// The reading side of StudyStore (#168, 5b): what the AI read on a deck's pictures, one record per page.
// Built on the store's own helpers like annotations.ts: sealed per docs/SECURITY.md (only id, courseId and
// deckId stay readable), refused while locked, every write inside `exclusive()` and in the change log.
import type { SlideDeck } from '../types/lecture';
import { pageReadingId, type PageReading, type PageReadingInput, type ReadingKind, type ReadingStore } from '../types/reading';
import { writeRows, type StoreContext } from './lectures';
import { StoreError } from './store';

/** The same limits as the helper's check (helper/reading.mjs READING_LIMITS). */
export const READING_LIMITS = { pictureText: 20_000, figures: 30, label: 200, description: 2_000, model: 64 };
const KINDS: readonly ReadingKind[] = ['text', 'diagram', 'photo', 'table', 'chemistry', 'graph', 'maths', 'circuit', 'code'];
const HEX64 = /^[0-9a-f]{64}$/;

const invalid = (message: string) => new StoreError('invalid', message);

function text(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string') throw invalid(`${what} is text.`);
  if (value.length > max) throw invalid(`${what} is too long.`);
  return value;
}

/** Checks a reading and copies only its own fields, so nothing else rides along into the record. */
function checkReading(input: PageReadingInput): Omit<PageReadingInput, 'deckId' | 'page'> {
  const fp = input.fingerprint;
  if (!fp || !HEX64.test(String(fp.text)) || !HEX64.test(String(fp.look))) throw invalid('A reading needs the page’s fingerprint.');
  if (!Array.isArray(input.figures) || input.figures.length > READING_LIMITS.figures) throw invalid(`A page has at most ${READING_LIMITS.figures} figures.`);
  const figures = input.figures.map((f) => ({
    label: text(f?.label, 'A figure’s label', READING_LIMITS.label),
    description: text(f?.description, 'A figure’s description', READING_LIMITS.description),
  }));
  if (figures.some((f) => !f.description.trim())) throw invalid('A figure needs a description.');
  if (!Array.isArray(input.kinds) || !input.kinds.every((k) => KINDS.includes(k))) throw invalid('Unknown kind of picture content.');
  if (typeof input.decorativeOnly !== 'boolean') throw invalid('decorativeOnly is true or false.');
  const model = text(input.model, 'The model', READING_LIMITS.model);
  if (!model) throw invalid('Say which model read the page.');
  return {
    fingerprint: { text: fp.text, look: fp.look },
    pictureText: text(input.pictureText, 'The text in pictures', READING_LIMITS.pictureText),
    figures,
    kinds: [...new Set(input.kinds)],
    decorativeOnly: input.decorativeOnly,
    model,
  };
}

export function readingMethods(ctx: StoreContext): ReadingStore {
  const { db, open, openAll, seal, change, exclusive, requireOpen } = ctx;

  return {
    async listPageReadings(deckId) {
      requireOpen();
      const all = await openAll<PageReading>('pageReadings', await db.getAllFromIndex('pageReadings', 'byDeck', deckId));
      return all.sort((a, b) => a.page - b.page);
    },

    async getPageReading(deckId, page) {
      requireOpen();
      const row = await db.get('pageReadings', pageReadingId(deckId, page));
      return row ? open<PageReading>('pageReadings', row) : null;
    },

    savePageReading: (input) =>
      exclusive(async () => {
        requireOpen();
        const row = await db.get('slideDecks', input?.deckId);
        if (!row) throw new StoreError('not-found', 'That slide deck no longer exists.');
        const deck = await open<SlideDeck>('slideDecks', row);
        if (!Number.isInteger(input.page) || input.page < 1 || input.page > deck.pageCount) {
          throw invalid(`That slide isn’t in this deck (it has ${deck.pageCount}).`);
        }
        const reading: PageReading = {
          id: pageReadingId(deck.id, input.page),
          courseId: deck.courseId,
          deckId: deck.id,
          page: input.page,
          ...checkReading(input),
          readAt: ctx.clock().toISOString(),
        };
        const [sealed, log] = await Promise.all([seal('pageReadings', { ...reading }), change('pageReading', 'put', reading.id, reading)]);
        await writeRows(db, [{ store: 'pageReadings', row: sealed }], [], [log]);
        return reading;
      }),
  };
}
