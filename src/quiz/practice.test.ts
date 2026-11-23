// Exam practice's pure parts (#87): which questions, what goes to the AI, and the attempts saved.
import { describe, expect, it } from 'vitest';
import type { WrittenQuestion } from '../ai/backend';
import type { Section } from '../types/lecture';
import type { Question } from '../types/quiz';
import { attemptInputs, canAsk, gradeSlides, isBlank, practiceQuestions, writtenPages, WRITTEN_PAGES_MAX, type PracticeAnswer, type PracticeSection } from './practice';

const T = { startedAt: '2026-12-08T18:00:00.000Z', finishedAt: '2026-12-08T18:20:00.000Z' };

function section(id: string, firstPage: number, lastPage: number): Section {
  return {
    id,
    courseId: 'c',
    lectureId: `l-${id}`,
    deckId: 'd',
    firstPage,
    lastPage,
    schedule: { budgetMinutes: 50, studiedMinutes: 0, nextDue: null, extraMinutes: 0 },
    createdAt: T.startedAt,
    updatedAt: T.startedAt,
  };
}
function question(id: string, sectionId: string, page: number): Question {
  return { id, courseId: 'c', sectionId, deckId: 'd', page, question: `Q ${id}?`, options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', createdAt: T.startedAt };
}
const texts = (n: number) => Array.from({ length: n }, (_, i) => `Slide ${i + 1} text`);
const wq = (page: number, points = ['one', 'two']): WrittenQuestion => ({ question: `Explain slide ${page}.`, points, page });
const fixed = () => 0.5;

function practiceSection(id: string, first: number, last: number, bank: Question[] = [], pageTexts = texts(40)): PracticeSection {
  return { section: section(id, first, last), pageTexts, bank, attempts: [] };
}

describe('what a practice asks', () => {
  it('each section in turn: its multiple choice from the bank, then its short answers', () => {
    const a = practiceSection('a', 1, 5, [question('a1', 'a', 1), question('a2', 'a', 2), question('a3', 'a', 3)]);
    const b = practiceSection('b', 6, 10, [question('b1', 'b', 6)]);
    const written = new Map([
      ['a', [wq(2)]],
      ['b', [wq(7)]],
    ]);
    const asked = practiceQuestions([a, b], written, 2, fixed);
    expect(asked.map((q) => [q.kind, q.sectionId])).toEqual([
      ['choice', 'a'],
      ['choice', 'a'],
      ['written', 'a'],
      ['choice', 'b'], // the bank has only one
      ['written', 'b'],
    ]);
  });

  it('a section with no bank yet still gets its short answers; with neither, nothing to ask', () => {
    const fresh = practiceSection('a', 1, 5);
    expect(practiceQuestions([fresh], new Map([['a', [wq(1)]]]), 2, fixed).map((q) => q.kind)).toEqual(['written']);
    expect(canAsk(fresh)).toBe(true);
    expect(canAsk(practiceSection('p', 1, 3, [], ['', ' ', '']))).toBe(false); // pictures only, no bank
    expect(canAsk(practiceSection('p', 1, 3, [question('q', 'p', 1)], ['', '', '']))).toBe(true);
  });

  it('short answers are written from the section’s slides with text, at most 60, spread evenly', () => {
    const pageTexts = texts(10);
    pageTexts[2] = '  ';
    expect(writtenPages(practiceSection('a', 2, 5, [], pageTexts)).map((p) => p.page)).toEqual([2, 4, 5]);
    const long = writtenPages(practiceSection('a', 1, 150, [], texts(150)));
    expect(long).toHaveLength(WRITTEN_PAGES_MAX);
    expect([long[0]!.page, long[1]!.page, long.at(-1)!.page]).toEqual([1, 3, 148]);
  });

  it('marking sends the answer’s slide and the ones either side, within the section', () => {
    const s = practiceSection('a', 4, 8);
    expect(gradeSlides(s, 6).map((p) => p.page)).toEqual([5, 6, 7]);
    expect(gradeSlides(s, 4).map((p) => p.page)).toEqual([4, 5]); // slide 3 is another section's
    expect(isBlank('  \n ')).toBe(true);
    expect(isBlank(' x ')).toBe(false);
  });
});

describe('what a practice saves', () => {
  const a1 = question('a1', 'a', 1);
  const b1 = question('b1', 'b', 6);
  const answers: PracticeAnswer[] = [
    { kind: 'choice', sectionId: 'a', item: { question: a1, order: [2, 0, 1, 3] }, chosen: 0, ms: 4_000 },
    { kind: 'written', sectionId: 'a', question: wq(2), answer: 'Because of the bonds.', ms: 60_000 },
    { kind: 'choice', sectionId: 'b', item: { question: b1, order: [0, 1, 2, 3] }, chosen: 3, ms: 5_000 },
    { kind: 'written', sectionId: 'b', question: wq(7, ['one']), answer: 'No idea', ms: 30_000 },
  ];

  it('one attempt per section, for the exam, with the stored option chosen and each short answer’s mark', () => {
    const marks = new Map([
      [1, { mark: 1, feedback: 'Half there.' }],
      [3, { mark: 0, feedback: 'Not this one.' }],
    ]);
    expect(attemptInputs('e1', answers, marks, T)).toEqual([
      {
        sectionId: 'a',
        ...T,
        examId: 'e1',
        answers: [{ questionId: 'a1', chosen: 0, ms: 4_000 }],
        written: [{ question: 'Explain slide 2.', points: ['one', 'two'], page: 2, answer: 'Because of the bonds.', mark: 1, feedback: 'Half there.', ms: 60_000 }],
      },
      {
        sectionId: 'b',
        ...T,
        examId: 'e1',
        answers: [{ questionId: 'b1', chosen: 3, ms: 5_000 }],
        written: [{ question: 'Explain slide 7.', points: ['one'], page: 7, answer: 'No idea', mark: 0, feedback: 'Not this one.', ms: 30_000 }],
      },
    ]);
  });

  it('an unmarked short answer is left out, never given a mark; a section left with nothing has no attempt', () => {
    const onlyWritten: PracticeAnswer[] = [{ kind: 'written', sectionId: 'c', question: wq(9), answer: 'Something', ms: 1 }];
    const saved = attemptInputs('e1', [...answers, ...onlyWritten], new Map([[1, { mark: 2, feedback: 'Good.' }]]), T);
    expect(saved.map((x) => [x.sectionId, x.answers.length, x.written!.map((w) => w.mark)])).toEqual([
      ['a', 1, [2]],
      ['b', 1, []],
    ]);
    expect(attemptInputs('e1', onlyWritten, new Map(), T)).toEqual([]);
  });
});
