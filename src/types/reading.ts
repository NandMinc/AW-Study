// The contract for what the AI read on a slide's pictures (#168, 5b; docs/DESIGN.md "Reading pictures and
// choosing models"). The store (src/db/readings.ts) keeps one reading per page of a deck: a newer reading of
// the same page replaces the older. Plain JSON, sealed like every record (only id, courseId and deckId stay
// readable). Change these only in their own small PR, announced in the task issues.

/** A diagram, chart, table, structure or photo on the page, as the AI described it. */
export interface ReadingFigure {
  /** Its caption or number ("Figure 2.4"), or a short name. */
  label: string;
  /** What it shows and means, in 1 to 4 sentences. */
  description: string;
}

/** What the page's pictures hold (helper/reading.mjs KINDS). */
export type ReadingKind = 'text' | 'diagram' | 'photo' | 'table' | 'chemistry' | 'graph' | 'maths' | 'circuit' | 'code';

export interface PageReading {
  /** pageReadingId(deckId, page): the same page always has the same id, on every device. */
  id: string;
  courseId: string; // the deck's class
  deckId: string;
  page: number; // from 1, within the deck
  /** The page's fingerprint when it was read (src/reading/sort.ts): a later page that differs was changed. */
  fingerprint: { text: string; look: string };
  /** Words in the page's pictures that aren't in its text, in reading order ('' for none). */
  pictureText: string;
  figures: ReadingFigure[];
  kinds: ReadingKind[];
  /** The pictures are only decoration: nothing to add. */
  decorativeOnly: boolean;
  /** The model whose reading this is (Sonnet's replaces Haiku's). */
  model: string;
  readAt: string; // ISO 8601, UTC
}

export type PageReadingInput = Omit<PageReading, 'id' | 'courseId' | 'readAt'>;

/**
 * The id a page's reading is stored under. Prefixed: sync finds a record's latest change by its id alone, so
 * ids must not collide with any other kind of record (the exam style learned this, #120).
 */
export const pageReadingId = (deckId: string, page: number) => `reading-${deckId}-${page}`;

/**
 * The store methods for readings. Part of StudyStore (src/db/store.ts), with its rules: 'locked' while
 * locked, 'invalid' (with a user-ready message) or 'not-found'. Deleting a deck or a class deletes its readings.
 */
export interface ReadingStore {
  /** A deck's readings, by page. */
  listPageReadings(deckId: string): Promise<PageReading[]>;
  /** One page's reading, or null if it hasn't been read. */
  getPageReading(deckId: string, page: number): Promise<PageReading | null>;
  /** Saves a page's reading, replacing any older one of that page. 'invalid' if malformed or the page isn't in the deck. */
  savePageReading(input: PageReadingInput): Promise<PageReading>;
}
