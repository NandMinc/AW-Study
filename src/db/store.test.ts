// StudyStore's own rules against an in-memory IndexedDB (fake-indexeddb), with a fixed clock and
// counting ids: the device id, the change log, and writes one at a time. The classes, lectures and
// slides themselves are tested in lectures.test.ts; encryption in encryption.test.ts.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CourseInput } from '../types/lecture';
import { openStudyStore, type StoreDeps, type StudyStore } from './store';
import { fakePdf, newDataKey, testKeyring } from './test-helpers';

const T0 = new Date('2026-11-18T18:00:00Z');
const course = (name: string): CourseInput => ({ name, meetings: [], termStart: null, termEnd: null });

let name: string;
let store: StudyStore;
let counter = 0;

function fakeDeps(): Partial<StoreDeps> {
  let id = 0;
  return { newId: () => `id-${++id}`, clock: () => T0 };
}

// Every test runs twice: before encryption is set up (plain records) and encrypted (sealed
// records). The store must behave the same either way.
describe.each(['before setup (plain)', 'encrypted'] as const)('store, %s', (mode) => {
  beforeEach(async () => {
    name = `test-${++counter}`; // a fresh database per test
    store = await openStudyStore({ name, deps: fakeDeps() });
    if (mode === 'encrypted') {
      const key = await newDataKey();
      await store.setUp(await testKeyring(key), key);
    }
  });

  afterEach(() => store.close());

  describe('device id', () => {
    it('is made once and kept when the database is opened again', async () => {
      const first = store.deviceId();
      store.close();
      store = await openStudyStore({ name, deps: { newId: () => 'a-different-id' } });
      expect(store.deviceId()).toBe(first);
    });
  });

  describe('change log', () => {
    it('records every write in order, with the device, the time and whole records for puts', async () => {
      const c = await store.createCourse(course('CHEM 101'));
      const deck = await store.addSlideDeck({ courseId: c.id, title: 'W1', fileName: 'w1.pdf', data: fakePdf(), pageTexts: ['a', 'b'] });
      const { lecture } = await store.recordLecture({ courseId: c.id, date: '2026-11-16', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 2 }] });
      await store.deleteLecture(lecture.id);
      const log = await store.changesSince(0);
      expect(log.map((e) => `${e.entity}:${e.op}`)).toEqual(['course:put', 'slideDeck:put', 'lecture:put', 'section:put', 'section:delete', 'lecture:delete']);
      expect(log.every((e) => e.deviceId === store.deviceId())).toBe(true);
      // The clock is frozen at T0: change times start there and still move forward, a millisecond each (#120),
      // so another device can always tell which of this device's changes came last
      expect(log.map((e) => Date.parse(e.at) - T0.getTime())).toEqual([0, 1, 2, 3, 4, 5]);
      expect(log[0]!.data).toEqual(c);
      expect(log.at(-1)!.data).toBeNull();
      expect(await store.latestChange()).toBe(log.at(-1)!.seq);
      expect((await store.changesSince(log[3]!.seq!)).map((e) => e.op)).toEqual(['delete', 'delete']);
    });

    it('a refused write leaves no trace', async () => {
      await expect(store.createCourse(course(' '))).rejects.toMatchObject({ code: 'invalid' });
      await expect(store.updateCourse('nope', course('x'))).rejects.toMatchObject({ code: 'not-found' });
      expect(await store.changesSince(0)).toEqual([]);
      expect(await store.latestChange()).toBe(0);
    });
  });

  describe('writes', () => {
    it('run one at a time: many at once all land, each logged once', async () => {
      const made = await Promise.all(Array.from({ length: 20 }, (_, i) => store.createCourse(course(`Class ${String(i).padStart(2, '0')}`))));
      expect(new Set(made.map((c) => c.id)).size).toBe(20);
      expect((await store.listCourses('2026-11-18')).map((c) => c.name)).toEqual(made.map((c) => c.name));
      const log = await store.changesSince(0);
      expect(log.map((e) => e.entityId)).toEqual(made.map((c) => c.id)); // in the order they were asked for
    });

    it('two edits of one class at once both apply, the later one last', async () => {
      const c = await store.createCourse(course('A'));
      await Promise.all([store.updateCourse(c.id, course('B')), store.updateCourse(c.id, course('C'))]);
      expect((await store.getCourse(c.id))!.name).toBe('C');
      expect((await store.changesSince(0)).filter((e) => e.op === 'put')).toHaveLength(3);
    });
  });
});
