// Short answers in quizzes (#124): picking them into the exam-style share, and checking the AI can mark them before a
// quiz that would ask them starts.
import { describe, expect, it } from 'vitest';
import { FakeAiBackend } from '../ai/fake';
import type { ChoiceQuestion, Level, Question, QuizAttempt, ShortQuestion } from '../types/quiz';
import { isShortItem, pickQuiz } from './pick';
import { startQuiz } from './start';

const base = { courseId: 'c', sectionId: 's', deckId: 'd', page: 1, explanation: '', createdAt: '2026-11-18T00:00:00Z' };
const mc = (id: string, level: Level): ChoiceQuestion => ({ ...base, id, question: id, form: 'choice', level, options: ['a', 'b', 'c', 'd'], answer: 0 });
const sa = (id: string): ShortQuestion => ({ ...base, id, question: id, form: 'short', level: 3, points: ['p1', 'p2'] });
/** 10 multiple choice at levels 1 and 2, `l3` at level 3, and `shorts` short answers. */
const bank = (shorts: number, l3 = 10): Question[] => [
  ...[1, 2].flatMap((l) => [...Array(10)].map((_, i) => mc(`m${l}-${i}`, l as Level))),
  ...[...Array(l3)].map((_, i) => mc(`m3-${i}`, 3)),
  ...[...Array(shorts)].map((_, i) => sa(`s${i}`)),
];
const kinds = (items: { question: Question }[]) => items.map((i) => i.question.form);

describe('pickQuiz with short answers', () => {
  it('draws the exam-style share from multiple choice and short answers alike, only when asked to', () => {
    const questions = [...[...Array(5)].map((_, i) => mc(`m3-${i}`, 3)), ...[...Array(5)].map((_, i) => sa(`s${i}`))];
    const withShort = pickQuiz(questions, [], 10, () => 0.999, 'new', { short: true });
    expect(kinds(withShort).filter((k) => k === 'short').length).toBeGreaterThan(0); // all 10 asked: 5 level 3 and 5 borrowed from it
    expect(pickQuiz(questions, [], 10, () => 0.999, 'new').every((i) => !isShortItem(i))).toBe(true); // not asked: none
    expect(pickQuiz(questions, [], 10, () => 0.999).every((i) => !isShortItem(i))).toBe(true); // no stage (exam practice): none
  });

  it('a short answer below full marks last time counts as wrong: it comes first', () => {
    const questions = [mc('m3-0', 3), mc('m3-1', 3), sa('s0')];
    const lastTime: QuizAttempt = {
      id: 'a',
      courseId: 'c',
      sectionId: 's',
      startedAt: '2026-11-20T10:00:00Z',
      finishedAt: '2026-11-20T10:05:00Z',
      answers: [
        { questionId: 'm3-0', chosen: 0, right: true, ms: 1, level: 3 },
        { questionId: 'm3-1', chosen: 0, right: true, ms: 1, level: 3 },
      ],
      short: [{ questionId: 's0', typed: 'x', mark: 1, outOf: 2, feedback: '', ms: 1, level: 3 }],
      right: 2.5,
      asked: 3,
      score: 0.83,
      createdAt: '2026-11-20T10:05:00Z',
    };
    expect(pickQuiz(questions, [lastTime], 1, () => 0.999, 'known', { short: true })[0]!.question.id).toBe('s0');
  });
});

describe('startQuiz', () => {
  it('with short answers in the bank and the AI there: asks them, no note', async () => {
    const ai = new FakeAiBackend();
    const quiz = await startQuiz(ai, bank(10, 0), [], 10, 'new'); // level 3 only short answers: never down to chance
    expect(ai.calls.map((c) => c.job)).toEqual(['status']);
    expect(kinds(quiz.items)).toContain('short');
    expect(quiz.note).toBeNull();
  });

  it('the AI can’t be reached: multiple choice only, and the note says why', async () => {
    for (const [code, why] of [
      ['offline', 'you’re offline'],
      ['signed-out', 'sign in for AI'],
      ['unavailable', 'can’t be reached'],
    ] as const) {
      const ai = new FakeAiBackend();
      ai.failWith = code;
      const quiz = await startQuiz(ai, bank(10), [], 10, 'new');
      expect(kinds(quiz.items)).not.toContain('short');
      expect(quiz.items).toHaveLength(10);
      expect(quiz.note).toContain('multiple choice only');
      expect(quiz.note).toContain(why);
    }
  });

  it('a bank without short answers sends nothing at all', async () => {
    const ai = new FakeAiBackend();
    const quiz = await startQuiz(ai, bank(0), [], 10, 'new');
    expect(ai.calls).toEqual([]);
    expect(quiz.note).toBeNull();
    expect(quiz.items).toHaveLength(10);
  });
});
