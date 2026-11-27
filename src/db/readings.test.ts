// What the AI read on a deck's pictures (#168, 5b): the store's rules, plain and encrypted, and on disk.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageReadingId, type PageReadingInput } from '../types/reading';
import { openHonedDb, RECORD_STORES } from './schema';
import { openStudyStore, type StudyStore } from './store';
import { ENTITY_STORE } from './sync';
import { containsText, fakePdf, newDataKey, testKeyring } from './test-helpers';

let counter = 0;
let name: string;
let store: StudyStore;
let now = Date.parse('2026-11-26T18:00:00.000Z');
const clock = () => new Date((now += 1000));
const hex = (c: string) => c.repeat(64);

async function deck(pages = 12) {
  const course = await store.createCourse({ name: 'CHEM 231', meetings: [], termStart: null, termEnd: null });
  const d = await store.addSlideDeck({ courseId: course.id, title: 'Chapter 2', fileName: 'ch2.pdf', data: fakePdf(), pageTexts: Array(pages).fill('t') });
  return { course, deck: d };
}

const input = (deckId: string, extra: Partial<PageReadingInput> = {}): PageReadingInput => ({
  deckId,
  page: 7,
  fingerprint: { text: hex('a'), look: hex('b') },
  pictureText: 'A fallacy is a defect in an argument.',
  figures: [{ label: 'Figure 2.4', description: 'Methanol: the C-O bond is polar.' }],
  kinds: ['text', 'chemistry'],
  decorativeOnly: false,
  model: 'claude-sonnet-5-5',
  ...extra,
});

describe.each(['before setup (plain)', 'encrypted'] as const)('page readings, %s', (mode) => {
  beforeEach(async () => {
    name = `readings-${++counter}`;
    store = await openStudyStore({ name, deps: { clock } });
    if (mode === 'encrypted') {
      const key = await newDataKey();
      await store.setUp(await testKeyring(key), key);
    }
  });
  afterEach(() => store.close());

  it('saves a page’s reading, gives it back, and lists a deck’s by page', async () => {
    const { course, deck: d } = await deck();
    expect(await store.getPageReading(d.id, 7)).toBeNull();
    const seven = await store.savePageReading(input(d.id));
    expect(seven).toMatchObject({ id: pageReadingId(d.id, 7), courseId: course.id, deckId: d.id, page: 7, model: 'claude-sonnet-5-5' });
    const two = await store.savePageReading(input(d.id, { page: 2, figures: [], kinds: ['text'] }));
    expect(await store.getPageReading(d.id, 7)).toEqual(seven);
    expect(await store.listPageReadings(d.id)).toEqual([two, seven]);
  });

  it('replaces the older reading of the same page', async () => {
    const { deck: d } = await deck();
    await store.savePageReading(input(d.id, { model: 'claude-haiku-5-5', figures: [] }));
    const newer = await store.savePageReading(input(d.id));
    expect(await store.listPageReadings(d.id)).toEqual([newer]);
  });

  it('keeps only its own fields, and each kind once', async () => {
    const { deck: d } = await deck();
    const r = await store.savePageReading({ ...input(d.id, { kinds: ['text', 'text', 'graph'] }), extra: 'no' } as PageReadingInput);
    expect(r.kinds).toEqual(['text', 'graph']);
    expect('extra' in r).toBe(false);
  });

  it.each<[string, (d: string) => PageReadingInput]>([
    ['a page not in the deck', (d) => input(d, { page: 13 })],
    ['page 0', (d) => input(d, { page: 0 })],
    ['no fingerprint', (d) => input(d, { fingerprint: { text: 'x', look: hex('b') } })],
    ['an unknown kind', (d) => input(d, { kinds: ['cartoon' as 'text'] })],
    ['a figure with no description', (d) => input(d, { figures: [{ label: 'Fig', description: ' ' }] })],
    ['too many figures', (d) => input(d, { figures: Array.from({ length: 31 }, () => ({ label: 'F', description: 'd' })) })],
    ['picture text too long', (d) => input(d, { pictureText: 'x'.repeat(20_001) })],
    ['no model', (d) => input(d, { model: '' })],
    ['decorativeOnly not a boolean', (d) => input(d, { decorativeOnly: 'no' as unknown as boolean })],
  ])('refuses %s', async (_what, make) => {
    const { deck: d } = await deck();
    await expect(store.savePageReading(make(d.id))).rejects.toMatchObject({ code: 'invalid' });
    expect(await store.listPageReadings(d.id)).toEqual([]);
  });

  it('refuses a deck that doesn’t exist', async () => {
    await expect(store.savePageReading(input('no-such-deck'))).rejects.toMatchObject({ code: 'not-found' });
  });

  it('deleting a deck or a class deletes their readings, and tells the other devices', async () => {
    const one = await deck();
    const two = await deck();
    await store.savePageReading(input(one.deck.id));
    await store.savePageReading(input(one.deck.id, { page: 3 }));
    const kept = await store.savePageReading(input(two.deck.id));
    await store.deleteSlideDeck(one.deck.id);
    expect(await store.listPageReadings(one.deck.id)).toEqual([]);
    expect(await store.listPageReadings(two.deck.id)).toEqual([kept]);
    await store.deleteCourse(two.course.id);
    store.close();
    const db = await openHonedDb(name);
    expect(await db.count('pageReadings')).toBe(0);
    const log = (await db.getAll('changes')).filter((c) => c.entity === 'pageReading');
    expect(log.map((c) => c.op)).toEqual(['put', 'put', 'put', 'delete', 'delete', 'delete']);
    db.close();
    store = await openStudyStore({ name });
  });

  it('is refused while locked', async () => {
    const { deck: d } = await deck();
    await store.savePageReading(input(d.id));
    if (mode === 'before setup (plain)') return;
    store.lock();
    await expect(store.listPageReadings(d.id)).rejects.toMatchObject({ code: 'locked' });
    await expect(store.getPageReading(d.id, 7)).rejects.toMatchObject({ code: 'locked' });
    await expect(store.savePageReading(input(d.id))).rejects.toMatchObject({ code: 'locked' });
  });
});

describe('page readings encrypted, on disk', () => {
  it('only id, courseId and deckId are readable, in the store and in the change log', async () => {
    name = `readings-${++counter}`;
    store = await openStudyStore({ name });
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    const { deck: d } = await deck();
    await store.savePageReading(input(d.id, { pictureText: 'leptokurtic tails', figures: [{ label: 'Figure 11', description: 'two histograms' }] }));
    store.close();
    const db = await openHonedDb(name);
    expect(Object.keys((await db.getAll('pageReadings'))[0] as object).sort()).toEqual(['courseId', 'deckId', 'enc', 'id']);
    for (const st of RECORD_STORES) {
      const rows = await db.getAll(st);
      expect(containsText(rows, 'leptokurtic'), st).toBe(false);
      expect(containsText(rows, 'histograms'), st).toBe(false);
      expect(containsText(rows, 'sonnet'), st).toBe(false);
    }
    db.close();
  });

  it('syncs like any other record', () => {
    expect(ENTITY_STORE.pageReading).toBe('pageReadings');
    expect(RECORD_STORES).toContain('pageReadings');
  });
});
