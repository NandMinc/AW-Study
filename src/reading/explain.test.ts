// What Explain and Ask send (#175, ./explain.ts): readings with the slides, a page read now, a box's picture.
import 'fake-indexeddb/auto';
import { fileURLToPath } from 'node:url';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeAiBackend } from '../ai/fake';
import type { StudyStore } from '../db/store';
import { openStudyStore } from '../db/store';
import { newDataKey, testKeyring } from '../db/test-helpers';
import { setPdfAssetBase } from '../viewer/pdf';
import { graphDrawing, LETTER, makePdf } from '../viewer/test-pdf';
import { prepareAi } from './explain';

beforeAll(() => {
  GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
  setPdfAssetBase(fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url)));
});

let counter = 0;
let store: StudyStore;
let ai: FakeAiBackend;
let deckId: string;
let prepare: ReturnType<typeof prepareAi>;
const pageTexts = ['Page 1\nWords.', 'Page 2\nA graph below.', 'Page 3\nMore words.', 'Page 4\nThe end.'];

beforeEach(async () => {
  store = await openStudyStore({ name: `explain-${++counter}` });
  const key = await newDataKey();
  await store.setUp(await testKeyring(key), key);
  const course = await store.createCourse({ name: 'STAT 255', meetings: [], termStart: null, termEnd: null });
  const pdf = makePdf(
    [1, 2, 3, 4].map((n) => ({ title: `Page ${n}`, body: pageTexts[n - 1]!.split('\n')[1], ...(n === 2 ? { drawing: graphDrawing(100, 300, 300, 200) } : {}) })),
    LETTER,
  );
  deckId = (await store.addSlideDeck({ courseId: course.id, title: 'Graphs', fileName: 'g.pdf', data: pdf, pageTexts })).id;
  ai = new FakeAiBackend();
  prepare = prepareAi({ store, ai, deckId, pdf, pageTexts });
});
afterEach(async () => {
  await prepare.close();
  store.close();
});

describe('prepareAi', () => {
  it('reads an unread picture page now, saves it, and sends the slides with it', async () => {
    const { slides, image } = await prepare(2);
    expect(ai.calls.map((c) => c.job)).toEqual(['readPage']);
    expect(image).toBeUndefined();
    expect(slides.map((s) => s.page)).toEqual([1, 2, 3]);
    expect(slides[1]!.text).toContain('A graph below.');
    expect(slides[1]!.text).toContain('[Figure 1] A fake figure.');
    expect(await store.getPageReading(deckId, 2)).toMatchObject({ model: 'claude-haiku-5-5', pictureText: 'Words from the picture.' });
    // Next time it's read already: not again
    await prepare(2);
    expect(ai.calls).toHaveLength(1);
  });

  it('reads nothing for a page of text, nor for neighbours (they go with a reading only if they have one)', async () => {
    await prepare(1);
    expect(ai.calls).toEqual([]);
    await prepare(2);
    const { slides } = await prepare(3);
    expect(ai.calls).toHaveLength(1); // page 2, when it was the slide asked about
    expect(slides.find((s) => s.page === 2)!.text).toContain('A fake figure.');
  });

  it('sends a box as a picture of its area', async () => {
    const { image } = await prepare(2, { x: 0.15, y: 0.3, w: 0.5, h: 0.3 });
    expect(Array.from(image!.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(image!.length).toBeGreaterThan(1000);
  });

  it('sends the text alone when the page can’t be read now', async () => {
    ai.failWith = 'signed-out';
    const { slides } = await prepare(2);
    expect(slides[1]!.text).toBe('Page 2\nA graph below.');
    expect(await store.getPageReading(deckId, 2)).toBeNull();
  });
});
