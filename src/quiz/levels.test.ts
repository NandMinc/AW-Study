// Question levels in quizzes (#123): a section's stage, each stage's level counts (with the known stage's anchor),
// time by level, a bank's mix, and picking a quiz by level.
import { describe, expect, it } from 'vitest';
import { RULES } from '../plan/rules';
import type { ChoiceQuestion, Level, QuizAttempt } from '../types/quiz';
import { bankMix, bankNeeds, levelCounts, quizSeconds, sectionStage } from './levels';
import { pickQuiz } from './pick';

let n = 0;
/** An attempt with this score; `missedHard`: one exam-style question wrong in it. */
const attempt = (score: number, { missedHard = false, day = ++n } = {}): QuizAttempt => ({
  id: `a${day}`,
  courseId: 'c',
  sectionId: 's',
  startedAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`,
  finishedAt: `2026-11-${String(day).padStart(2, '0')}T10:05:00Z`,
  answers: [
    { questionId: 'q1', chosen: 0, right: true, ms: 1, level: 1 },
    { questionId: 'q3', chosen: missedHard ? 1 : 0, right: !missedHard, ms: 1, level: 3 },
  ],
  right: 1,
  asked: 2,
  score,
  createdAt: `2026-11-${String(day).padStart(2, '0')}T10:05:00Z`,
});

describe('sectionStage', () => {
  it('new with no quiz yet, in the first week, or after a weak score', () => {
    expect(sectionStage([])).toBe('new');
    expect(sectionStage([attempt(1, { day: 1 }), attempt(1, { day: 2 })], { firstWeek: true })).toBe('new');
    expect(sectionStage([attempt(1, { day: 1 }), attempt(0.6, { day: 2 })])).toBe('new');
  });

  it('known after two quizzes at 90% or more, learning otherwise', () => {
    expect(sectionStage([attempt(0.95, { day: 1 })])).toBe('learning'); // one isn't enough
    expect(sectionStage([attempt(0.8, { day: 1 }), attempt(0.95, { day: 2 })])).toBe('learning');
    expect(sectionStage([attempt(0.9, { day: 1 }), attempt(0.95, { day: 2 })])).toBe('known');
    // Order doesn't matter: the latest two count
    expect(sectionStage([attempt(0.95, { day: 3 }), attempt(0.5, { day: 1 }), attempt(0.9, { day: 2 })])).toBe('known');
  });

  it('a missed exam-style question (the anchor) drops a known section back to learning', () => {
    expect(sectionStage([attempt(0.95, { day: 1 }), attempt(0.92, { day: 2, missedHard: true })])).toBe('learning');
    const shortMissed = { ...attempt(0.95, { day: 2 }), short: [{ questionId: 's', typed: 'x', mark: 1, outOf: 2, feedback: '', ms: 1, level: 3 as const }] };
    expect(sectionStage([attempt(0.95, { day: 1 }), shortMissed])).toBe('learning');
  });

  it('an exam soon wins over everything', () => {
    expect(sectionStage([attempt(0.95, { day: 1 }), attempt(0.95, { day: 2 })], { examSoon: true })).toBe('exam');
    expect(sectionStage([], { firstWeek: true, examSoon: true })).toBe('exam');
  });
});

describe('levelCounts and time', () => {
  it('shares each stage’s quiz by level, adding up to its size', () => {
    expect(levelCounts(10, 'new')).toEqual([2, 3, 5]);
    expect(levelCounts(10, 'learning')).toEqual([3, 5, 2]);
    expect(levelCounts(10, 'known')).toEqual([6, 3, 1]);
    expect(levelCounts(10, 'exam')).toEqual([2, 3, 5]);
    for (const stage of ['new', 'learning', 'known', 'exam'] as const) {
      for (const size of [0, 1, 3, 5, 8, 15]) expect(levelCounts(size, stage).reduce((a, b) => a + b, 0)).toBe(size);
    }
  });

  it('a known quiz always has one exam-style question, even a quiz of 3 (the anchor)', () => {
    expect(levelCounts(3, 'known')).toEqual([1, 1, 1]); // shares alone would give [2, 1, 0]
    expect(levelCounts(1, 'known')).toEqual([0, 0, 1]);
    expect(levelCounts(3, 'learning')[2]).toBe(1);
  });

  it('a known quiz of 3 takes about 3 minutes, a new one of 10 about 13 (DESIGN)', () => {
    const [s1, s2, s3] = RULES.levels.seconds;
    expect(quizSeconds(3, 'known')).toBe(s1! + s2! + s3!);
    expect(Math.ceil(quizSeconds(3, 'known') / 60)).toBe(4); // 185 s
    expect(quizSeconds(10, 'new')).toBe(2 * s1! + 3 * s2! + 5 * s3!); // 775 s
    expect(Math.round(quizSeconds(10, 'new') / 60)).toBe(13);
  });
});

describe('bankMix and bankNeeds', () => {
  it('a bank holds its target in the bank shares, the guide’s share of level 3 as short answers (#124)', () => {
    expect(bankMix(36, 0.8)).toEqual({ choice: [9, 13, 3], short: 11 }); // 14 level 3: 11 short, 3 multiple choice
    expect(bankMix(36, 0)).toEqual({ choice: [9, 13, 14], short: 0 }); // no guide, or a class that asks none
    expect(bankMix(10, 0.5)).toEqual({ choice: [3, 3, 2], short: 2 });
  });

  it('needs only what each level is missing, never below 0', () => {
    const have = [...Array(20)].map(() => ({ form: 'choice' as const, level: 2 as Level }));
    expect(bankNeeds(bankMix(36, 0), have)).toEqual({ choice: [9, 0, 14], short: 0 });
  });
});

describe('pickQuiz by stage', () => {
  const q = (id: string, level: Level): ChoiceQuestion => ({
    id,
    courseId: 'c',
    sectionId: 's',
    deckId: 'd',
    page: 1,
    question: id,
    form: 'choice',
    level,
    options: ['a', 'b', 'c', 'd'],
    answer: 0,
    explanation: '',
    createdAt: '2026-11-18T00:00:00Z',
  });
  const bank = (l1: number, l2: number, l3: number) => [
    ...[...Array(l1)].map((_, i) => q(`e${i}`, 1)),
    ...[...Array(l2)].map((_, i) => q(`m${i}`, 2)),
    ...[...Array(l3)].map((_, i) => q(`h${i}`, 3)),
  ];
  const levels = (items: { question: { level: Level } }[]) => [1, 2, 3].map((l) => items.filter((i) => i.question.level === l).length);

  it('asks each level in the stage’s shares', () => {
    expect(levels(pickQuiz(bank(10, 10, 10), [], 10, Math.random, 'new'))).toEqual([2, 3, 5]);
    expect(levels(pickQuiz(bank(10, 10, 10), [], 10, Math.random, 'known'))).toEqual([6, 3, 1]);
    expect(levels(pickQuiz(bank(10, 10, 10), [], 3, Math.random, 'known'))).toEqual([1, 1, 1]); // with its anchor
  });

  it('a level short of questions borrows from the nearest, so the quiz keeps its size', () => {
    expect(levels(pickQuiz(bank(10, 10, 1), [], 10, Math.random, 'new'))).toEqual([2, 7, 1]); // 4 level 3 missing → level 2
    expect(levels(pickQuiz(bank(0, 20, 0), [], 10, Math.random, 'known'))).toEqual([0, 10, 0]); // an older, all-level-2 bank
    expect(pickQuiz(bank(1, 1, 1), [], 10, Math.random, 'new')).toHaveLength(3); // never more than the bank
  });

  it('within a level, last time’s wrong answers come first, and they lead the quiz', () => {
    const questions = bank(5, 5, 5);
    const wrongOnce: QuizAttempt = { ...attempt(0.5), answers: [{ questionId: 'h4', chosen: 1, right: false, ms: 1, level: 3 }] };
    const picked = pickQuiz(questions, [wrongOnce], 3, () => 0.999, 'known'); // one level 3: the one missed
    expect(picked[0]!.question.id).toBe('h4');
    expect(levels(picked)).toEqual([1, 1, 1]);
  });

  it('without a stage, it picks as before, whatever the level (exam practice)', () => {
    const questions = bank(0, 0, 10);
    expect(pickQuiz(questions, [], 5, () => 0.999)).toHaveLength(5);
    expect(levels(pickQuiz(questions, [], 5, () => 0.999))).toEqual([0, 0, 5]);
  });
});
