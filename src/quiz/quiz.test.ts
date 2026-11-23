import { describe, expect, it } from 'vitest';
import { AiError, type McQuestion } from '../ai/backend';
import { FakeAiBackend } from '../ai/fake';
import type { Question, QuestionInput, QuizAttempt } from '../types/quiz';
import { bankTarget, fillBank, planBank, questionsForPage, sectionSlides, SLIDES_PER_REQUEST } from './bank';
import { describeScore, pickQuiz } from './pick';

/** An ordinary slide: a heading and a few bullets, about 40 words. */
const slideText = (page: number) => `Slide ${page} ${Array.from({ length: 38 }, (_, i) => `point${i}`).join(' ')}`;
const slides = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ page: from + i, text: slideText(from + i) }));

describe('sectionSlides', () => {
  it('takes the section’s pages with text, numbered from 1, trimmed and capped', () => {
    const pages = ['one', '  ', 'three', 'x'.repeat(9_000), 'five'];
    expect(sectionSlides({ firstPage: 2, lastPage: 4 }, pages)).toEqual([
      { page: 3, text: 'three' },
      { page: 4, text: 'x'.repeat(8_000) },
    ]);
  });
});

describe('planBank', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const dense = (n: number, perPage: number, from = 1) => Array.from({ length: n }, (_, i) => ({ page: from + i, text: words(perPage) }));

  it('a page is worth one question per 100 words, at least 3 and at most 10; a short page just 1', () => {
    expect([20, 40, 260, 349, 350, 500, 1_000, 5_000].map((n) => questionsForPage(words(n)))).toEqual([3, 3, 3, 3, 4, 5, 10, 10]);
    // Title, divider, "Thank you", "Questions?": under 20 words
    for (const text of ['Unit 4: Fallacies PHIL 201 Dr. Smith Fall 2026', 'Thank you!', 'Questions?', words(19)]) {
      expect(questionsForPage(text), text).toBe(1);
    }
  });

  it('title and thank-you slides barely count, so a lecture’s questions go to its content', () => {
    const lecture = [{ page: 1, text: 'Unit 4: Fallacies' }, ...slides(8, 2), { page: 10, text: 'Thank you! Questions?' }];
    expect(bankTarget(lecture)).toBe(26); // 1 + 8 x 3 + 1
  });

  it('a bank is its pages’ worth, at least 10: slides as before, dense pages more', () => {
    expect(bankTarget([])).toBe(0);
    expect(bankTarget(slides(2))).toBe(10); // 2 short slides: 6, so the minimum
    expect(bankTarget(slides(10))).toBe(30); // short slides: 3 each, as before
    expect(bankTarget(dense(19, 500))).toBe(95); // a 19-page document of ~500 words a page: 5 each
    expect(bankTarget([...slides(2), ...dense(1, 1_200, 3)])).toBe(16); // 3 + 3 + 10
  });

  it('asks a few pages at a time, never over 30 questions a request, adding up exactly', () => {
    expect(planBank(slides(3), 0)).toEqual([{ pages: slides(3), count: 10 }]);
    const plan = planBank(slides(12), 0);
    expect(plan.map((r) => r.pages.length)).toEqual([SLIDES_PER_REQUEST, SLIDES_PER_REQUEST, 2]);
    expect(plan.map((r) => r.count)).toEqual([15, 15, 6]);
    // Dense pages: 10 each, so only 3 pages fit in a request's 30
    const heavy = planBank(dense(7, 1_500), 0);
    expect(heavy.map((r) => r.pages.length)).toEqual([3, 3, 1]);
    expect(heavy.map((r) => r.count)).toEqual([30, 30, 10]);
    for (const p of [planBank(dense(40, 700), 0), planBank(dense(19, 500), 0), planBank(slides(40), 0)]) {
      expect(p.every((r) => r.count <= 30 && r.pages.length <= SLIDES_PER_REQUEST)).toBe(true);
    }
    expect(planBank(dense(19, 500), 0).reduce((n, r) => n + r.count, 0)).toBe(95);
  });

  it('only tops up what’s missing, and asks nothing for a full bank or no text', () => {
    expect(planBank(slides(12), 30).map((r) => r.count)).toEqual([3, 2, 1]);
    expect(planBank(slides(12), 36)).toEqual([]);
    expect(planBank([], 0)).toEqual([]);
  });
});

describe('fillBank', () => {
  /** A store that keeps questions in memory, with the real store's repeat rule. */
  function memoryStore() {
    const saved: QuestionInput[] = [];
    return {
      saved,
      listQuestions: async () => saved.map((q, i) => ({ ...q, id: `q${i}` }) as Question),
      addQuestions: async (_id: string, qs: QuestionInput[]) => {
        saved.push(...qs);
        return [] as Question[];
      },
    };
  }

  it('makes the bank request by request, telling the AI what it already has', async () => {
    const ai = new FakeAiBackend();
    const store = memoryStore();
    const progress: string[] = [];
    const added = await fillBank({
      ai,
      store,
      section: { id: 's', firstPage: 1, lastPage: 12 },
      pageTexts: slides(12).map((s) => s.text),
      onProgress: (p) => progress.push(`${p.done}/${p.total}:${p.added}`),
    });
    expect(added).toBe(36);
    expect(progress).toEqual(['0/3:0', '1/3:15', '2/3:30', '3/3:36']);
    expect(ai.calls.map((c) => (c.job === 'makeQuestions' ? c.request.avoid?.length : -1))).toEqual([0, 15, 30]);
  });

  it('drops repeats instead of refusing an answer, and keeps what was saved when the AI fails', async () => {
    const ai = new FakeAiBackend();
    const store = memoryStore();
    const real = ai.makeQuestions.bind(ai);
    let call = 0;
    ai.makeQuestions = async (request) => {
      if (++call === 2) throw new AiError('limit', 'Today’s limit.');
      const qs = await real(request);
      return [...qs, { ...qs[0]! } as McQuestion]; // the same question twice
    };
    const run = fillBank({ ai, store, section: { id: 's', firstPage: 1, lastPage: 12 }, pageTexts: slides(12).map((s) => s.text) });
    await expect(run).rejects.toMatchObject({ code: 'limit' });
    expect(store.saved).toHaveLength(15); // the first request's, without the repeat
  });
});

describe('pickQuiz', () => {
  const question = (id: string): Question => ({
    id,
    courseId: 'c',
    sectionId: 's',
    deckId: 'd',
    page: 1,
    question: id,
    options: ['a', 'b', 'c', 'd'],
    answer: 0,
    explanation: '',
    createdAt: '2026-11-18T00:00:00Z',
  });
  const attempt = (finishedAt: string, answers: [string, boolean][]): QuizAttempt => ({
    id: finishedAt,
    courseId: 'c',
    sectionId: 's',
    startedAt: finishedAt,
    finishedAt,
    answers: answers.map(([questionId, right]) => ({ questionId, chosen: 0, right, ms: 1 })),
    right: 0,
    asked: answers.length,
    score: 0,
    createdAt: finishedAt,
  });
  const noShuffle = () => 0.999; // leaves arrays in order

  it('asks last time’s wrong answers first, then new questions, then the longest-ago', () => {
    const bank = ['a', 'b', 'c', 'd', 'e', 'f'].map(question);
    const attempts = [
      attempt('2026-11-18T10:00:00Z', [['a', true], ['b', false]]), // newest
      attempt('2026-11-17T10:00:00Z', [['a', false], ['c', true], ['d', true]]),
      attempt('2026-11-16T10:00:00Z', [['d', true]]),
    ];
    // a: right last time (was wrong before); b: wrong; c, d: right on Nov 17; e, f: never asked
    expect(pickQuiz(bank, attempts, 6, noShuffle).map((i) => i.question.id)).toEqual(['b', 'e', 'f', 'c', 'd', 'a']);
    expect(pickQuiz(bank, attempts, 2, noShuffle).map((i) => i.question.id)).toEqual(['b', 'e']);
    expect(pickQuiz(bank.slice(0, 2), [], 5, noShuffle)).toHaveLength(2); // a small bank: all of it
  });

  it('a quiz started by hand asks 10 questions (Nov 19; was 5)', () => {
    const big = Array.from({ length: 14 }, (_, i) => question(`q${i}`));
    expect(pickQuiz(big, [])).toHaveLength(10);
  });

  it('shows each question’s options in a fresh order that still maps to the stored ones', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647);
    const items = pickQuiz(['a', 'b', 'c', 'd', 'e'].map(question), [], 5, random);
    for (const item of items) expect([...item.order].sort()).toEqual([0, 1, 2, 3]);
    expect(new Set(items.map((i) => i.order.join(''))).size).toBeGreaterThan(1);
  });

  it('describes a score', () => {
    expect(describeScore(4, 5)).toBe('4 of 5 right (80%)');
    expect(describeScore(2, 3)).toBe('2 of 3 right (67%)');
    // Exam practice: short answers count in parts
    expect(describeScore(7.67, 10)).toBe('7.7 of 10 right (77%)');
    expect(describeScore(2.5, 4)).toBe('2.5 of 4 right (63%)');
  });
});
