// The exam style guide's upkeep (#122): when it's (re)made, what it's made from, against the real store
// (fake IndexedDB) and the fake AI, so nothing is sent.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAiBackend } from '../ai/fake';
import { openStudyStore, type StudyStore } from '../db/store';
import { fakePdf } from '../db/test-helpers';
import type { ExamStyle } from '../types/style';
import { describeNeed, gatherSources, GUIDE_UNSEEN_LECTURES, guideNeed, makeGuide, refreshGuide } from './guide';

let n = 0;
let store: StudyStore;
let ai: FakeAiBackend;
beforeEach(async () => {
  store = await openStudyStore({ name: `guide-${++n}` });
  ai = new FakeAiBackend();
});
afterEach(() => store.close());

const text = (s: string) => new TextEncoder().encode(s);

async function chem() {
  const course = await store.createCourse({ name: 'CHEM 101', meetings: [], termStart: null, termEnd: null });
  const deck = await store.addSlideDeck({ courseId: course.id, title: 'W4', fileName: 'w4.pdf', data: fakePdf(), pageTexts: Array.from({ length: 10 }, (_, i) => `Slide ${i + 1}`) });
  const lecture = (date: string, first: number, last: number) => store.recordLecture({ courseId: course.id, date, minutes: 50, sections: [{ deckId: deck.id, firstPage: first, lastPage: last }] });
  const material = (title: string, kind: 'past-exam' | 'outline', body: string) =>
    store.addMaterial({ courseId: course.id, title, fileName: `${title}.txt`, kind, type: 'text/plain', data: text(body), pageTexts: [body] });
  return { course, deck, lecture, material };
}

const styleWith = (over: Partial<ExamStyle> = {}): ExamStyle => ({ courseId: 'c', notes: '', notesAt: null, guide: null, updatedAt: null, ...over });
const made = (from: { lectureIds: string[]; materialIds: string[]; notesAt: string | null }): ExamStyle['guide'] => ({
  tests: 'T',
  levels: ['a', 'b', 'c'],
  shortShare: 0.3,
  madeAt: '2026-11-20T00:00:00.000Z',
  from,
  editedAt: null,
});

describe('guideNeed', () => {
  it('none to start with; the first one once there are lectures, documents or notes', () => {
    expect(guideNeed(styleWith(), [], [])).toEqual({ kind: 'none' });
    expect(guideNeed(styleWith(), ['l1'], []).kind).toBe('first');
    expect(guideNeed(styleWith(), [], ['m1']).kind).toBe('first');
    expect(guideNeed(styleWith({ notes: 'No proofs.' }), [], []).kind).toBe('first');
  });

  it('remade when a document is added or removed, or the notes change; after 2 lectures it hasn’t seen, not 1', () => {
    const from = { lectureIds: ['l1'], materialIds: ['m1'], notesAt: '2026-11-19T00:00:00.000Z' };
    const style = styleWith({ notesAt: from.notesAt, guide: made(from) });
    expect(guideNeed(style, ['l1'], ['m1'])).toEqual({ kind: 'none' });
    expect(guideNeed(style, ['l1'], ['m1', 'm2']).kind).toBe('materials');
    expect(guideNeed(style, ['l1'], []).kind).toBe('materials');
    expect(guideNeed(style, ['l1'], ['m2']).kind).toBe('materials'); // same count, another document
    expect(guideNeed({ ...style, notesAt: '2026-11-21T00:00:00.000Z' }, ['l1'], ['m1']).kind).toBe('notes');
    expect(guideNeed(style, ['l1', 'l2'], ['m1'])).toEqual({ kind: 'none' });
    expect(GUIDE_UNSEEN_LECTURES).toBe(2);
    expect(guideNeed(style, ['l1', 'l2', 'l3'], ['m1'])).toEqual({ kind: 'lectures', unseen: 2 });
    expect(guideNeed(style, ['l2'], ['m1'])).toEqual({ kind: 'none' }); // a deleted lecture isn't a reason
  });

  it('says why in words', () => {
    expect(describeNeed({ kind: 'lectures', unseen: 3 })).toBe('The guide hasn’t seen the last 3 lectures.');
    expect(describeNeed({ kind: 'none' })).toBe('');
  });
});

describe('making the guide', () => {
  it('from the notes, the documents and each lecture’s slides; saved with what it saw', async () => {
    const { course, lecture, material } = await chem();
    const l1 = await lecture('2026-11-16', 2, 3);
    const exam = await material('Midterm 2025', 'past-exam', 'Q1. Explain why water is polar.');
    await store.setStyleNotes(course.id, 'No proofs.');

    const style = await makeGuide(store, ai, course.id);
    const call = ai.calls.find((c) => c.job === 'makeStyleGuide')!;
    expect(call.job === 'makeStyleGuide' && call.request).toEqual({
      className: 'CHEM 101',
      notes: 'No proofs.',
      materials: [{ kind: 'past-exam', title: 'Midterm 2025', text: 'Q1. Explain why water is polar.' }],
      lectures: [{ date: '2026-11-16', text: 'Slide 2\n\nSlide 3' }],
      previous: null,
    });
    expect(style!.guide!.tests).toContain('CHEM 101');
    expect(style!.guide!.from).toEqual({ lectureIds: [l1.lecture.id], materialIds: [exam.id], notesAt: style!.notesAt });
    expect(guideNeed(style!, [l1.lecture.id], [exam.id])).toEqual({ kind: 'none' });
  });

  it('a remake sends the guide as it stands, saying whether it was edited', async () => {
    const { course, lecture } = await chem();
    await lecture('2026-11-16', 1, 2);
    await makeGuide(store, ai, course.id);
    await store.editStyleGuide(course.id, { tests: 'My own words.', levels: ['a', 'b', 'c'], shortShare: 0.5 });
    await makeGuide(store, ai, course.id);
    const remake = ai.calls.filter((c) => c.job === 'makeStyleGuide').at(-1)!;
    expect(remake.job === 'makeStyleGuide' && remake.request.previous).toEqual({ tests: 'My own words.', levels: ['a', 'b', 'c'], shortShare: 0.5, edited: true });
  });

  it('nothing is sent when there’s no text to go on (a class with pictures only)', async () => {
    const course = await store.createCourse({ name: 'ART 100', meetings: [], termStart: null, termEnd: null });
    const deck = await store.addSlideDeck({ courseId: course.id, title: 'Paintings', fileName: 'p.pdf', data: fakePdf(), pageTexts: ['', ' '] });
    await store.recordLecture({ courseId: course.id, date: '2026-11-16', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 2 }] });
    expect(await makeGuide(store, ai, course.id)).toBeNull();
    expect(ai.calls).toEqual([]);
  });

  it('refreshGuide asks only when the guide needs it: once at first, again after 2 new lectures', async () => {
    const { course, lecture } = await chem();
    const sent = () => ai.calls.filter((c) => c.job === 'makeStyleGuide').length;
    await lecture('2026-11-16', 1, 2);
    await refreshGuide(store, ai, course.id);
    await refreshGuide(store, ai, course.id);
    expect(sent()).toBe(1);
    await lecture('2026-11-18', 3, 4);
    await refreshGuide(store, ai, course.id);
    expect(sent()).toBe(1); // one lecture it hasn't seen
    await lecture('2026-11-20', 5, 6);
    const style = await refreshGuide(store, ai, course.id);
    expect(sent()).toBe(2);
    expect(style.guide!.from.lectureIds).toHaveLength(3);
  });

  it('a document whose text can’t be read now is left out of the text, but counts as seen', async () => {
    const { course, lecture, material } = await chem();
    await lecture('2026-11-16', 1, 2);
    const doc = await material('Outline', 'outline', 'Weeks 1-12');
    const failing = { ...store, getMaterialText: async () => Promise.reject(new Error('offline')) } as unknown as StudyStore;
    const { sources, from } = await gatherSources(failing, course.id);
    expect(sources.materials).toEqual([{ kind: 'outline', title: 'Outline', pageTexts: [] }]);
    expect(from.materialIds).toEqual([doc.id]);
  });
});
