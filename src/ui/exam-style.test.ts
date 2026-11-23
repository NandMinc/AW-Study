// The class page's Exam style logic (#122): guessing a document's kind, when the guide is out of date, gathering
// the texts it's made from, and making it, against a real store and the fake AI.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAiBackend } from '../ai/fake';
import { openStudyStore, type StudyStore } from '../db/store';
import { fakePdf } from '../db/test-helpers';
import type { ExamStyle } from '../types/style';
import { documentType, gatherStyleSources, guessKind, makeGuide, remakeOnPage, shouldRemake, staleness } from './exam-style';

describe('guessKind', () => {
  it.each([
    ['Midterm 2025.pdf', 'past-exam'],
    ['final-exam-solutions.pdf', 'past-exam'],
    ['MATH100 Course Outline.pdf', 'outline'],
    ['syllabus.txt', 'outline'],
    ['Assignment 3.pdf', 'practice'],
    ['practice problems.md', 'practice'],
    ['hw4.pdf', 'practice'],
    ['reading list.pdf', 'other'],
  ])('%s → %s', (name, kind) => expect(guessKind(name)).toBe(kind));
});

describe('documentType', () => {
  it('takes PDFs and plain text by type or name, and nothing else', () => {
    expect(documentType({ name: 'a.pdf', type: '' })).toBe('application/pdf');
    expect(documentType({ name: 'a', type: 'application/pdf' })).toBe('application/pdf');
    expect(documentType({ name: 'notes.md', type: '' })).toBe('text/plain');
    expect(documentType({ name: 'a.txt', type: 'text/plain' })).toBe('text/plain');
    expect(documentType({ name: 'outline.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBeNull();
    expect(documentType({ name: 'slides.pptx', type: '' })).toBeNull();
  });
});

describe('when the guide is out of date', () => {
  const made = (from: { lectureIds: string[]; materialIds: string[]; notesAt: string | null }, notesAt = from.notesAt): ExamStyle => ({
    courseId: 'c',
    notes: 'n',
    notesAt,
    updatedAt: 'x',
    guide: { tests: 't', levels: ['a', 'b', 'c'], shortShare: 0, madeAt: 'x', editedAt: null, from },
  });
  const empty: ExamStyle = { courseId: 'c', notes: '', notesAt: null, guide: null, updatedAt: null };

  it('with no guide: made once there’s something to make it from', () => {
    expect(staleness(empty, [], [])).toBeNull();
    expect(shouldRemake(empty, [], [], false)).toBe(false);
    expect(shouldRemake(empty, ['l1'], [], true)).toBe(true);
  });

  it('remade when a document is added or removed, or the notes changed', () => {
    const style = made({ lectureIds: ['l1'], materialIds: ['m1'], notesAt: 'T1' });
    expect(shouldRemake(style, ['l1'], [{ id: 'm1' }], true)).toBe(false);
    expect(shouldRemake(style, ['l1'], [{ id: 'm1' }, { id: 'm2' }], true)).toBe(true); // added
    expect(shouldRemake(style, ['l1'], [], true)).toBe(true); // removed
    expect(shouldRemake(made({ lectureIds: ['l1'], materialIds: ['m1'], notesAt: 'T1' }, 'T2'), ['l1'], [{ id: 'm1' }], true)).toBe(true);
  });

  it('on the class page: only after a document or the notes change, never for slides alone (opening sends nothing)', () => {
    expect(remakeOnPage(empty, [])).toBe(false); // a class with only slides
    expect(remakeOnPage({ ...empty, notes: 'Essays.', notesAt: 'T1' }, [])).toBe(true);
    expect(remakeOnPage(empty, [{ id: 'm1' }])).toBe(true);
    const style = made({ lectureIds: ['l1'], materialIds: ['m1'], notesAt: 'T1' });
    expect(remakeOnPage(style, [{ id: 'm1' }])).toBe(false); // however many lectures are new
    expect(remakeOnPage(style, [{ id: 'm1' }, { id: 'm2' }])).toBe(true);
    expect(remakeOnPage(made({ lectureIds: [], materialIds: ['m1'], notesAt: 'T1' }, 'T2'), [{ id: 'm1' }])).toBe(true);
  });

  it('remade once 2 lectures are new to it, not after 1', () => {
    const style = made({ lectureIds: ['l1'], materialIds: [], notesAt: null });
    expect(staleness(style, ['l1', 'l2'], [])!.unseenLectures).toBe(1);
    expect(shouldRemake(style, ['l1', 'l2'], [], true)).toBe(false);
    expect(shouldRemake(style, ['l1', 'l2', 'l3'], [], true)).toBe(true);
  });
});

describe('gathering and making the guide', () => {
  let store: StudyStore;
  let n = 0;
  beforeEach(async () => {
    store = await openStudyStore({ name: `exam-style-ui-${++n}` });
  });

  async function aClass() {
    const course = await store.createCourse({ name: 'HIST 200', meetings: [], termStart: null, termEnd: null });
    const deck = await store.addSlideDeck({ courseId: course.id, title: 'W1', fileName: 'w1.pdf', data: fakePdf(), pageTexts: ['Title', 'The treaty', 'Its failure', 'Thanks'] });
    const { lecture } = await store.recordLecture({ courseId: course.id, date: '2026-11-17', minutes: 50, sections: [{ deckId: deck.id, firstPage: 2, lastPage: 3 }] });
    return { course, deck, lecture };
  }

  it('sends the class name, the notes, each document’s text and each lecture’s covered slides; saves what it saw', async () => {
    const { course, lecture } = await aClass();
    const exam = await store.addMaterial({ courseId: course.id, title: 'Midterm', fileName: 'm.txt', kind: 'past-exam', type: 'text/plain', data: new TextEncoder().encode('Q1. Why did the treaty fail?'), pageTexts: [] });
    const notes = await store.setStyleNotes(course.id, 'Two essays.');
    const ai = new FakeAiBackend();
    const style = await makeGuide(store, ai, course.id);

    const call = ai.calls.find((c) => c.job === 'makeStyleGuide')!;
    expect(call.request).toMatchObject({
      className: 'HIST 200',
      notes: 'Two essays.',
      materials: [{ kind: 'past-exam', title: 'Midterm', text: 'Q1. Why did the treaty fail?' }],
      lectures: [{ date: '2026-11-17', text: 'The treaty\n\nIts failure' }], // only the slides it covered
      previous: null,
    });
    expect(style!.guide!.from).toEqual({ lectureIds: [lecture.id], materialIds: [exam.id], notesAt: notes.notesAt });
    expect(await store.getExamStyle(course.id)).toEqual(style);
    // Just made: nothing to remake
    expect(shouldRemake(style!, [lecture.id], [exam], true)).toBe(false);
  });

  it('a remake sends the guide as it stands, saying whether it was edited', async () => {
    const { course } = await aClass();
    const ai = new FakeAiBackend();
    const first = await makeGuide(store, ai, course.id);
    await store.editStyleGuide(course.id, { ...first!.guide!, tests: 'Mine.' });
    await makeGuide(store, ai, course.id);
    const remake = ai.calls.filter((c) => c.job === 'makeStyleGuide')[1]!;
    expect(remake.request).toMatchObject({ previous: { tests: 'Mine.', edited: true } });
  });

  it('nothing to make it from: no request, nothing saved', async () => {
    const course = await store.createCourse({ name: 'Empty', meetings: [], termStart: null, termEnd: null });
    const ai = new FakeAiBackend();
    expect(await makeGuide(store, ai, course.id)).toBeNull();
    expect(ai.calls).toEqual([]);
    expect((await store.getExamStyle(course.id)).guide).toBeNull();
  });

  it('a document whose text isn’t on this device is left out, and not counted as seen', async () => {
    const { course } = await aClass();
    const here = await store.addMaterial({ courseId: course.id, title: 'Outline', fileName: 'o.txt', kind: 'outline', type: 'text/plain', data: new TextEncoder().encode('Weeks 1-12'), pageTexts: [] });
    const elsewhere = await store.addMaterial({ courseId: course.id, title: 'Far', fileName: 'f.txt', kind: 'other', type: 'text/plain', data: new TextEncoder().encode('x'), pageTexts: [] });
    // As if it came from another device without its files: the record only
    const getText = store.getMaterialText.bind(store);
    store.getMaterialText = async (id) => (id === elsewhere.id ? Promise.reject(new Error('not here')) : getText(id));
    const { sources, from } = await gatherStyleSources(store, course.id);
    expect(sources.materials.map((m) => m.title)).toEqual(['Outline']);
    expect(from.materialIds).toEqual([here.id]);
  });

  it('an AI failure saves nothing', async () => {
    const { course } = await aClass();
    const ai = new FakeAiBackend();
    ai.failWith = 'signed-out';
    await expect(makeGuide(store, ai, course.id)).rejects.toMatchObject({ code: 'signed-out' });
    expect((await store.getExamStyle(course.id)).guide).toBeNull();
  });
});
