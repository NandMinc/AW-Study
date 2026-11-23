// The quiz side of the store (#40): question banks and quiz attempts. Every store test runs twice,
// before setup (plain records) and encrypted, like lectures.test.ts.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { QuestionInput, WrittenAnswer } from '../types/quiz';
import { questionKey } from './quiz';
import { openHonedDb, RECORD_STORES } from './schema';
import { openStudyStore, type StudyStore } from './store';
import { containsText, fakePdf, newDataKey, testKeyring } from './test-helpers';

const MARKER = 'QUIZ-MARKER-19';
const T1 = '2026-11-18T18:00:00.000Z';
const T2 = '2026-11-18T18:05:00.000Z';

let counter = 0;
let name: string;
let store: StudyStore;

const q = (n: number, page = 21, extra: Record<string, unknown> = {}): QuestionInput => ({
  page,
  question: `What does slide ${page} say about bond ${n}?`,
  options: [`Right ${n}`, `Wrong A ${n}`, `Wrong B ${n}`, `Wrong C ${n}`],
  answer: 0,
  explanation: `Slide ${page} says so.`,
  ...extra,
} as QuestionInput);

/** A class with one lecture of two sections: slides 21-30 and 31-35 of one deck. */
async function setting() {
  const course = await store.createCourse({ name: 'CHEM 101', meetings: [], termStart: null, termEnd: null });
  const deck = await store.addSlideDeck({ courseId: course.id, title: 'W4', fileName: 'w4.pdf', data: fakePdf(), pageTexts: Array(40).fill('t') });
  const { lecture, sections } = await store.recordLecture({
    courseId: course.id,
    date: '2026-11-18',
    minutes: 50,
    sections: [
      { deckId: deck.id, firstPage: 21, lastPage: 30 },
      { deckId: deck.id, firstPage: 31, lastPage: 35 },
    ],
  });
  const [a, b] = [...sections].sort((x, y) => x.firstPage - y.firstPage);
  return { course, deck, lecture, a: a!, b: b! };
}

describe('questionKey', () => {
  it('ignores case, spacing and end punctuation', () => {
    expect(questionKey('  What  is ATP? ')).toBe(questionKey('what is atp'));
    expect(questionKey('What is ATP?')).not.toBe(questionKey('What is ADP?'));
  });
});

describe.each(['before setup (plain)', 'encrypted'] as const)('quiz store, %s', (mode) => {
  beforeEach(async () => {
    name = `quiz-${++counter}`;
    store = await openStudyStore({ name });
    if (mode === 'encrypted') {
      const key = await newDataKey();
      await store.setUp(await testKeyring(key), key);
    }
  });
  afterEach(() => store.close());

  describe('question banks', () => {
    it('adds questions to a section, trimmed, and lists them oldest first', async () => {
      const { a, deck, course } = await setting();
      const made = await store.addQuestions(a.id, [q(1), { ...q(2, 30), question: '  Spaced out?  ' }]);
      expect(made[0]).toMatchObject({ sectionId: a.id, courseId: course.id, deckId: deck.id, page: 21, answer: 0 });
      expect(made[1]!.question).toBe('Spaced out?');
      expect((await store.listQuestions(a.id)).map((x) => x.id)).toEqual(made.map((x) => x.id));
      expect(await store.listQuestions('another-section')).toEqual([]);
    });

    it('refuses a malformed question, adding none of the batch', async () => {
      const { a } = await setting();
      const bad: [string, QuestionInput][] = [
        ['slide before the section', q(1, 20)],
        ['slide after the section', q(1, 31)],
        ['not a whole slide', q(1, 21.5)],
        ['empty question', q(1, 21, { question: '  ' })],
        ['three options', q(1, 21, { options: ['a', 'b', 'c'] as never })],
        ['an empty option', q(1, 21, { options: ['a', 'b', ' ', 'd'] })],
        ['two options the same', q(1, 21, { options: ['Same', 'same', 'c', 'd'] })],
        ['answer out of range', q(1, 21, { answer: 4 as never })],
        ['answer not a number', q(1, 21, { answer: '0' as never })],
        ['question too long', q(1, 21, { question: 'x'.repeat(1_001) })],
        ['option too long', q(1, 21, { options: ['x'.repeat(501), 'b', 'c', 'd'] })],
      ];
      for (const [label, input] of bad) {
        await expect(store.addQuestions(a.id, [q(99), input]), label).rejects.toMatchObject({ code: 'invalid' });
      }
      expect(await store.listQuestions(a.id)).toEqual([]);
      await expect(store.addQuestions(a.id, [])).rejects.toMatchObject({ code: 'invalid' });
      await expect(store.addQuestions('nope', [q(1)])).rejects.toMatchObject({ code: 'not-found' });
    });

    it('refuses repeats, within a batch or of the bank, ignoring case and punctuation', async () => {
      const { a, b } = await setting();
      await store.addQuestions(a.id, [q(1)]);
      await expect(store.addQuestions(a.id, [q(2), { ...q(3), question: q(1).question.toUpperCase() }])).rejects.toThrow(/already in this section/);
      await expect(store.addQuestions(a.id, [q(4), q(4)])).rejects.toThrow(/already in this section/);
      await store.addQuestions(b.id, [{ ...q(1), page: 31 }]); // another section may ask the same
      expect((await store.listQuestions(a.id)).length).toBe(1);
    });

    it('holds at most 100 a call and 500 a section', async () => {
      const { a } = await setting();
      const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => q(from + i));
      await expect(store.addQuestions(a.id, many(0, 101))).rejects.toThrow(/At most 100/);
      for (let i = 0; i < 5; i++) await store.addQuestions(a.id, many(i * 100, 100));
      await expect(store.addQuestions(a.id, many(1_000, 1))).rejects.toThrow(/at most 500/);
    }, 60_000);

    it('a bad question can be deleted', async () => {
      const { a } = await setting();
      const [first, second] = await store.addQuestions(a.id, [q(1), q(2)]);
      await store.deleteQuestion(first!.id);
      expect((await store.listQuestions(a.id)).map((x) => x.id)).toEqual([second!.id]);
      await expect(store.deleteQuestion(first!.id)).rejects.toMatchObject({ code: 'not-found' });
    });
  });

  describe('quiz attempts', () => {
    it('are marked by the store against the stored answers, and scored', async () => {
      const { a, course } = await setting();
      const [q1, q2, q3] = await store.addQuestions(a.id, [q(1), q(2, 22, { answer: 2 }), q(3)]);
      const attempt = await store.recordQuizAttempt({
        sectionId: a.id,
        startedAt: T1,
        finishedAt: T2,
        answers: [
          { questionId: q1!.id, chosen: 0, ms: 4_200.4 }, // right
          { questionId: q2!.id, chosen: 0, ms: 3_000 }, // wrong: the answer is 2
          { questionId: q3!.id, chosen: 0, ms: -5 },
        ],
      });
      expect(attempt).toMatchObject({ courseId: course.id, sectionId: a.id, right: 2, asked: 3, startedAt: T1, finishedAt: T2 });
      expect(attempt.score).toBeCloseTo(2 / 3);
      expect(attempt.answers.map((x) => [x.right, x.ms])).toEqual([
        [true, 4_200],
        [false, 3_000],
        [true, 0],
      ]);
      expect(await store.listQuizAttempts(a.id)).toEqual([attempt]);
    });

    it('ignore a "right" sent by the screen', async () => {
      const { a } = await setting();
      const [q1] = await store.addQuestions(a.id, [q(1)]);
      const attempt = await store.recordQuizAttempt({
        sectionId: a.id,
        startedAt: T1,
        finishedAt: T2,
        answers: [{ questionId: q1!.id, chosen: 3, ms: 1, right: true } as never],
      });
      expect(attempt).toMatchObject({ right: 0, score: 0 });
    });

    it('refuse answers to another section’s questions, repeats, bad choices or times, and empty quizzes', async () => {
      const { a, b } = await setting();
      const [q1] = await store.addQuestions(a.id, [q(1)]);
      const [other] = await store.addQuestions(b.id, [q(1, 31)]);
      const base = { sectionId: a.id, startedAt: T1, finishedAt: T2 };
      const cases: [string, Parameters<StudyStore['recordQuizAttempt']>[0]][] = [
        ['another section’s question', { ...base, answers: [{ questionId: other!.id, chosen: 0, ms: 1 }] }],
        ['a question twice', { ...base, answers: [{ questionId: q1!.id, chosen: 0, ms: 1 }, { questionId: q1!.id, chosen: 1, ms: 1 }] }],
        ['choice 4', { ...base, answers: [{ questionId: q1!.id, chosen: 4 as never, ms: 1 }] }],
        ['no answers', { ...base, answers: [] }],
        ['ends before it starts', { ...base, startedAt: T2, finishedAt: T1, answers: [{ questionId: q1!.id, chosen: 0, ms: 1 }] }],
        ['not a time', { ...base, startedAt: 'yesterday', answers: [{ questionId: q1!.id, chosen: 0, ms: 1 }] }],
      ];
      for (const [label, input] of cases) await expect(store.recordQuizAttempt(input), label).rejects.toMatchObject({ code: 'invalid' });
      await expect(store.recordQuizAttempt({ ...base, sectionId: 'nope', answers: [] })).rejects.toMatchObject({ code: 'not-found' });
      expect(await store.listQuizAttempts()).toEqual([]);
    });

    it('list newest first, for one section or all; a deleted question’s answers stay', async () => {
      const { a, b } = await setting();
      const [qa] = await store.addQuestions(a.id, [q(1)]);
      const [qb] = await store.addQuestions(b.id, [q(1, 31)]);
      const first = await store.recordQuizAttempt({ sectionId: a.id, startedAt: T1, finishedAt: T1, answers: [{ questionId: qa!.id, chosen: 0, ms: 1 }] });
      const second = await store.recordQuizAttempt({ sectionId: b.id, startedAt: T2, finishedAt: T2, answers: [{ questionId: qb!.id, chosen: 1, ms: 1 }] });
      expect((await store.listQuizAttempts()).map((x) => x.id)).toEqual([second.id, first.id]);
      expect((await store.listQuizAttempts(a.id)).map((x) => x.id)).toEqual([first.id]);
      await store.deleteQuestion(qa!.id);
      expect((await store.listQuizAttempts(a.id))[0]!.answers[0]!.questionId).toBe(qa!.id);
    });

    it('an ordinary quiz has no examId or written', async () => {
      const { a } = await setting();
      const [q1] = await store.addQuestions(a.id, [q(1)]);
      const attempt = await store.recordQuizAttempt({ sectionId: a.id, startedAt: T1, finishedAt: T2, answers: [{ questionId: q1!.id, chosen: 0, ms: 1 }] });
      expect(Object.keys(attempt)).not.toContain('examId');
      expect(Object.keys(attempt)).not.toContain('written');
    });
  });

  describe('exam practice (#87)', () => {
    const w = (extra: Partial<WrittenAnswer> = {}): WrittenAnswer => ({
      question: 'Why does slide 22 call the bond polar?',
      points: ['Different electronegativities', 'Electrons shared unequally', 'A partial charge on each atom'],
      page: 22,
      answer: 'Oxygen pulls the electrons harder.',
      mark: 2,
      feedback: 'Good; say what that does to the charges.',
      ms: 61_000,
      ...extra,
    });
    const exam = (courseId: string) => store.addExam({ courseId, title: 'Midterm 1', kind: 'midterm', date: '2026-12-01', lectureIds: null });

    it('scores a short answer as one question worth mark / points, rounded to 2 places', async () => {
      const { a, course } = await setting();
      const midterm = await exam(course.id);
      const [q1, q2] = await store.addQuestions(a.id, [q(1), q(2)]);
      const attempt = await store.recordQuizAttempt({
        sectionId: a.id,
        startedAt: T1,
        finishedAt: T2,
        examId: midterm.id,
        answers: [
          { questionId: q1!.id, chosen: 0, ms: 1 }, // right
          { questionId: q2!.id, chosen: 1, ms: 1 }, // wrong
        ],
        written: [w(), w({ question: 'Name the bond on slide 23.', page: 23, points: ['Covalent'], mark: 1 })],
      });
      // 1 + 2/3 + 1 = 2.666… → 2.67, of 4
      expect(attempt).toMatchObject({ examId: midterm.id, right: 2.67, asked: 4 });
      // Weighted by level (#120): the multiple choice is level 2 (old-style input), written answers level 3:
      // (2×1 + 2×0 + 3×2/3 + 3×1) ÷ (2 + 2 + 3 + 3) = 7 ÷ 10
      expect(attempt.score).toBeCloseTo(0.7);
      expect(attempt.written).toEqual([w(), w({ question: 'Name the bond on slide 23.', page: 23, points: ['Covalent'], mark: 1 })]);
      expect(await store.listQuizAttempts(a.id)).toEqual([attempt]);
    });

    it('can be only short answers (a section with no bank yet), trimmed', async () => {
      const { a, course } = await setting();
      const midterm = await exam(course.id);
      const attempt = await store.recordQuizAttempt({
        sectionId: a.id,
        startedAt: T1,
        finishedAt: T2,
        examId: midterm.id,
        answers: [],
        written: [w({ answer: '  ', mark: 0, question: '  Spaced?  ', ms: -3 })],
      });
      expect(attempt).toMatchObject({ right: 0, asked: 1, score: 0 });
      expect(attempt.written![0]).toMatchObject({ question: 'Spaced?', answer: '', ms: 0 });
    });

    it('refuses an exam that isn’t this class’s, and short answers out of shape', async () => {
      const { a, course } = await setting();
      const midterm = await exam(course.id);
      const other = await store.createCourse({ name: 'PHYS 150', meetings: [], termStart: null, termEnd: null });
      const theirs = await exam(other.id);
      const base = { sectionId: a.id, startedAt: T1, finishedAt: T2, answers: [], examId: midterm.id };
      const cases: [string, Parameters<StudyStore['recordQuizAttempt']>[0]][] = [
        ['another class’s exam', { ...base, examId: theirs.id, written: [w()] }],
        ['an exam that doesn’t exist', { ...base, examId: 'nope', written: [w()] }],
        ['no answers of either kind', { ...base, written: [] }],
        ['written not a list', { ...base, written: 'w' as never }],
        ['slide before the section', { ...base, written: [w({ page: 20 })] }],
        ['slide after the section', { ...base, written: [w({ page: 31 })] }],
        ['empty question', { ...base, written: [w({ question: ' ' })] }],
        ['question too long', { ...base, written: [w({ question: 'x'.repeat(1_001) })] }],
        ['no points', { ...base, written: [w({ points: [], mark: 0 })] }],
        ['seven points', { ...base, written: [w({ points: Array.from({ length: 7 }, (_, i) => `p${i}`) })] }],
        ['an empty point', { ...base, written: [w({ points: ['a', ' ', 'c'] })] }],
        ['answer too long', { ...base, written: [w({ answer: 'x'.repeat(4_001) })] }],
        ['feedback too long', { ...base, written: [w({ feedback: 'x'.repeat(401) })] }],
        ['mark above the points', { ...base, written: [w({ mark: 4 })] }],
        ['negative mark', { ...base, written: [w({ mark: -1 })] }],
        ['part of a mark', { ...base, written: [w({ mark: 1.5 })] }],
        ['21 short answers', { ...base, written: Array.from({ length: 21 }, (_, i) => w({ question: `Q${i}` })) }],
      ];
      for (const [label, input] of cases) await expect(store.recordQuizAttempt(input), label).rejects.toMatchObject({ code: 'invalid' });
      expect(await store.listQuizAttempts()).toEqual([]);
    });
  });

  describe('levels, forms and weighted scores (#120)', () => {
    const short = (n: number, extra: Record<string, unknown> = {}) =>
      ({ form: 'short', page: 22, question: `Why does bond ${n} form?`, points: ['atoms share electrons', 'to fill a shell'], ...extra }) as QuestionInput;

    it('stores each question’s form and level: multiple choice at level 2 unless given, short answers at 3', async () => {
      const { a } = await setting();
      const made = await store.addQuestions(a.id, [q(1), q(2, 21, { level: 1 }), q(3, 21, { form: 'choice', level: 3 }), short(4)]);
      expect(made.map((m) => [m.form, m.level])).toEqual([['choice', 2], ['choice', 1], ['choice', 3], ['short', 3]]);
      expect(made[3]).toMatchObject({ form: 'short', level: 3, points: ['atoms share electrons', 'to fill a shell'], explanation: '' });
      expect(made[3]).not.toHaveProperty('options');
      expect(await store.listQuestions(a.id)).toEqual(made);
    });

    for (const [name, bad] of [
      ['a short answer below level 3', short(1, { level: 2 })],
      ['a short answer with no points', short(1, { points: [] })],
      ['a short answer with 4 points', short(1, { points: ['a', 'b', 'c', 'd'] })],
      ['a level of 4', q(1, 21, { level: 4 })],
      ['another form', q(1, 21, { form: 'essay' })],
    ] as const) {
      it(`refuses ${name}`, async () => {
        const { a } = await setting();
        await expect(store.addQuestions(a.id, [bad])).rejects.toMatchObject({ code: 'invalid' });
        expect(await store.listQuestions(a.id)).toEqual([]);
      });
    }

    it('reads a question saved before #120 (no form, no level) as multiple choice at level 2', async () => {
      if (mode === 'encrypted') return; // the raw row is only writable as plain text
      const { a, course, deck } = await setting();
      const db = await openHonedDb(name);
      const old = { id: 'old-1', courseId: course.id, sectionId: a.id, deckId: deck.id, page: 21, question: 'Old?', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', createdAt: T1 };
      await db.put('questions', old as never);
      db.close();
      expect(await store.listQuestions(a.id)).toEqual([{ ...old, form: 'choice', level: 2 }]);
      // and an answer to it counts as level 2
      const attempt = await store.recordQuizAttempt({ sectionId: a.id, startedAt: T1, finishedAt: T2, answers: [{ questionId: 'old-1', chosen: 0, ms: 1 }] });
      expect(attempt.answers[0]).toMatchObject({ right: true, level: 2 });
    });

    it('weights the score by level, and keeps `right` as a plain count', async () => {
      const { a } = await setting();
      const [easy, hard] = await store.addQuestions(a.id, [q(1, 21, { level: 1 }), q(2, 21, { level: 3 })]);
      const attempt = await store.recordQuizAttempt({
        sectionId: a.id,
        startedAt: T1,
        finishedAt: T2,
        answers: [
          { questionId: easy!.id, chosen: 0, ms: 1 }, // right
          { questionId: hard!.id, chosen: 2, ms: 1 }, // wrong
        ],
      });
      expect(attempt.answers.map((x) => x.level)).toEqual([1, 3]);
      expect(attempt).toMatchObject({ right: 1, asked: 2 });
      expect(attempt.score).toBeCloseTo(1 / 4); // not 1/2
    });

    it('records short answers with their marks, out of their points, and counts them at level 3', async () => {
      const { a } = await setting();
      const [mc, sa] = await store.addQuestions(a.id, [q(1), short(2)]);
      const attempt = await store.recordQuizAttempt({
        sectionId: a.id,
        startedAt: T1,
        finishedAt: T2,
        answers: [{ questionId: mc!.id, chosen: 0, ms: 5 }],
        short: [{ questionId: sa!.id, typed: '  They share electrons.  ', mark: 1, feedback: 'Say why.', ms: 9 }],
      });
      expect(attempt.short).toEqual([{ questionId: sa!.id, typed: 'They share electrons.', mark: 1, outOf: 2, feedback: 'Say why.', ms: 9, level: 3 }]);
      expect(attempt).toMatchObject({ right: 1.5, asked: 2 });
      expect(attempt.score).toBeCloseTo((2 * 1 + 3 * 0.5) / 5);
      expect(await store.listQuizAttempts(a.id)).toEqual([attempt]);
    });

    it('a quiz of only short answers is fine; an ordinary quiz has no `short`', async () => {
      const { a } = await setting();
      const [mc, sa] = await store.addQuestions(a.id, [q(1), short(2)]);
      const only = await store.recordQuizAttempt({ sectionId: a.id, startedAt: T1, finishedAt: T2, answers: [], short: [{ questionId: sa!.id, typed: '', mark: 0, feedback: '', ms: 1 }] });
      expect(only).toMatchObject({ right: 0, asked: 1, score: 0 });
      const plain = await store.recordQuizAttempt({ sectionId: a.id, startedAt: T1, finishedAt: T2, answers: [{ questionId: mc!.id, chosen: 0, ms: 1 }] });
      expect(plain).not.toHaveProperty('short');
    });

    it('refuses short answers that don’t fit their question', async () => {
      const { a, b } = await setting();
      const [mc, sa] = await store.addQuestions(a.id, [q(1), short(2)]);
      const [elsewhere] = await store.addQuestions(b.id, [short(3, { page: 32 })]);
      const base = { sectionId: a.id, startedAt: T1, finishedAt: T2 };
      const one = (extra: Record<string, unknown>) => ({ questionId: sa!.id, typed: 'x', mark: 1, feedback: '', ms: 1, ...extra });
      for (const input of [
        { ...base, answers: [], short: [one({ questionId: mc!.id })] }, // a multiple-choice question
        { ...base, answers: [], short: [one({ questionId: elsewhere!.id })] }, // another section's
        { ...base, answers: [], short: [one({ mark: 3 })] }, // more than its 2 points
        { ...base, answers: [], short: [one({ mark: 0.5 })] }, // not a whole number
        { ...base, answers: [], short: [one({}), one({})] }, // answered twice
        { ...base, answers: [], short: [one({ typed: 'x'.repeat(1_001) })] }, // too long
        { ...base, answers: [{ questionId: sa!.id, chosen: 0, ms: 1 }] }, // a short question answered as multiple choice
      ]) {
        await expect(store.recordQuizAttempt(input as never)).rejects.toMatchObject({ code: 'invalid' });
      }
      expect(await store.listQuizAttempts(a.id)).toEqual([]);
    });
  });

  describe('deleting', () => {
    it('a lecture takes its sections’ questions and attempts with it, and nothing else', async () => {
      const { a, course, deck } = await setting();
      const [q1] = await store.addQuestions(a.id, [q(1)]);
      await store.recordQuizAttempt({ sectionId: a.id, startedAt: T1, finishedAt: T2, answers: [{ questionId: q1!.id, chosen: 0, ms: 1 }] });
      const other = await store.recordLecture({ courseId: course.id, date: '2026-11-20', minutes: 50, sections: [{ deckId: deck.id, firstPage: 36, lastPage: 40 }] });
      const [kept] = await store.addQuestions(other.sections[0]!.id, [q(1, 36)]);
      await store.deleteLecture(a.lectureId);
      const db = await openHonedDb(name);
      expect(await db.getAllKeys('questions')).toEqual([kept!.id]);
      expect(await db.count('quizAttempts')).toBe(0);
      db.close();
      const log = (await store.changesSince(0)).filter((c) => c.op === 'delete').map((c) => c.entity);
      expect(log).toEqual(expect.arrayContaining(['question', 'quizAttempt', 'section', 'lecture']));
    });

    it('a class takes all its questions and attempts', async () => {
      const { a, course } = await setting();
      const [q1] = await store.addQuestions(a.id, [q(1)]);
      await store.recordQuizAttempt({ sectionId: a.id, startedAt: T1, finishedAt: T2, answers: [{ questionId: q1!.id, chosen: 0, ms: 1 }] });
      await store.deleteCourse(course.id);
      const db = await openHonedDb(name);
      expect([await db.count('questions'), await db.count('quizAttempts')]).toEqual([0, 0]);
      db.close();
    });
  });

  it('refuses everything while locked', async () => {
    if (mode !== 'encrypted') return;
    const { a } = await setting();
    const [q1] = await store.addQuestions(a.id, [q(1)]);
    store.lock();
    for (const [label, call] of [
      ['listQuestions', () => store.listQuestions(a.id)],
      ['addQuestions', () => store.addQuestions(a.id, [q(2)])],
      ['deleteQuestion', () => store.deleteQuestion(q1!.id)],
      ['recordQuizAttempt', () => store.recordQuizAttempt({ sectionId: a.id, startedAt: T1, finishedAt: T2, answers: [{ questionId: q1!.id, chosen: 0, ms: 1 }] })],
      ['listQuizAttempts', () => store.listQuizAttempts()],
    ] as const) {
      await expect((call as () => Promise<unknown>)(), label).rejects.toMatchObject({ code: 'locked' });
    }
  });
});

describe('encrypted, on disk', () => {
  it('no question, option, explanation, answer or short answer is readable, and only SECURITY.md’s fields are', async () => {
    name = `quiz-${++counter}`;
    store = await openStudyStore({ name });
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    const { a } = await setting();
    const [q1] = await store.addQuestions(a.id, [
      { page: 21, question: `Q ${MARKER}`, options: [`A ${MARKER}`, 'b', 'c', 'd'], answer: 0, explanation: `E ${MARKER}` },
    ]);
    const midterm = await store.addExam({ courseId: a.courseId, title: 'Midterm', kind: 'midterm', date: '2026-12-01', lectureIds: null });
    await store.recordQuizAttempt({
      sectionId: a.id,
      startedAt: T1,
      finishedAt: T2,
      examId: midterm.id,
      answers: [{ questionId: q1!.id, chosen: 0, ms: 1 }],
      written: [{ question: `WQ ${MARKER}`, points: [`P ${MARKER}`], page: 21, answer: `WA ${MARKER}`, mark: 1, feedback: `F ${MARKER}`, ms: 1 }],
    });
    store.close();
    const db = await openHonedDb(name);
    for (const s of [...RECORD_STORES, 'meta'] as const) expect(containsText(await db.getAll(s), MARKER), s).toBe(false);
    expect(Object.keys((await db.getAll('questions'))[0] as object).sort()).toEqual(['courseId', 'enc', 'id', 'sectionId']);
    expect(Object.keys((await db.getAll('quizAttempts'))[0] as object).sort()).toEqual(['courseId', 'enc', 'id', 'sectionId']);
    db.close();
  });
});
