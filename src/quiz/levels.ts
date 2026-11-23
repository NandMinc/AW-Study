// Question levels in quizzes (#123, DESIGN "Exam style and question levels"): a section's stage from its quiz
// history, how many questions of each level a quiz asks in that stage (with the known stage's anchor), how long
// that takes, and how many of each level a section's bank should hold. Pure; the numbers are in RULES.levels.
import { RULES } from '../plan/rules';
import type { Level, QuizAttempt } from '../types/quiz';

export type Stage = 'new' | 'learning' | 'known' | 'exam';

/** Whole numbers in proportion to `weights` that add up to `total` (largest remainder; ties to the earlier). */
export function share(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

/** Whether an attempt missed any exam-style (level 3) question: one wrong, or a short answer below full marks. */
function missedExamStyle(a: QuizAttempt): boolean {
  return a.answers.some((x) => x.level === 3 && !x.right) || (a.short ?? []).some((s) => s.mark < s.outOf);
}

/**
 * A section's stage. `attempts`: its quiz attempts, any order. `firstWeek`: its first week isn't done yet.
 * `examSoon`: it's in the run-up of an exam that covers it (that wins over everything: practise the exam's way).
 */
export function sectionStage(attempts: readonly QuizAttempt[], { firstWeek = false, examSoon = false } = {}): Stage {
  if (examSoon) return 'exam';
  if (firstWeek) return 'new';
  const sorted = [...attempts].sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  const last = sorted.at(-1);
  if (!last || last.score < RULES.weakScore) return 'new';
  const { knownScore, knownQuizzes } = RULES.levels;
  const recent = sorted.slice(-knownQuizzes);
  if (recent.length === knownQuizzes && recent.every((a) => a.score >= knownScore) && !missedExamStyle(last)) return 'known';
  return 'learning';
}

/** How many questions of levels 1, 2 and 3 a quiz of `size` asks in `stage`. A known quiz has at least one level 3. */
export function levelCounts(size: number, stage: Stage): [number, number, number] {
  const counts = share(size, RULES.levels.stageShares[stage]) as [number, number, number];
  if (stage === 'known' && size > 0 && counts[2] === 0) {
    const from = counts[0] >= counts[1] ? 0 : 1; // the anchor takes the place of an easier one
    counts[from]--;
    counts[2] = 1;
  }
  return counts;
}

/** Seconds a quiz of `size` takes in `stage`, by its levels (RULES.levels.seconds). */
export function quizSeconds(size: number, stage: Stage): number {
  return levelCounts(size, stage).reduce((sum, n, i) => sum + n * RULES.levels.seconds[i]!, 0);
}

/** What a bank of `target` questions should hold: multiple choice at levels 1, 2 and 3, and short answers (level 3). */
export interface BankMix {
  choice: [number, number, number];
  short: number;
}

/**
 * A bank's mix by level (RULES.levels.bankShares); `shortShare` of its level 3 are short answers (the class's guide;
 * 0 without one, or while banks don't get short answers).
 */
export function bankMix(target: number, shortShare: number): BankMix {
  const [l1, l2, l3] = share(target, RULES.levels.bankShares);
  const short = RULES.levels.shortAnswers ? Math.round(l3! * Math.min(1, Math.max(0, shortShare))) : 0;
  return { choice: [l1!, l2!, l3! - short], short };
}

/** How many of each a bank still needs: its mix minus what it has (never below 0). `have`: the bank's questions. */
export function bankNeeds(mix: BankMix, have: readonly { form: 'choice' | 'short'; level: Level }[]): BankMix {
  const count = (form: 'choice' | 'short', level?: Level) => have.filter((q) => q.form === form && (level === undefined || q.level === level)).length;
  return {
    choice: [0, 1, 2].map((i) => Math.max(0, mix.choice[i]! - count('choice', (i + 1) as Level))) as [number, number, number],
    short: Math.max(0, mix.short - count('short')),
  };
}
