// Which questions a quiz asks (DESIGN, "Questions"): the ones you got wrong last time first, then
// ones never asked, then the rest, longest-ago first, so recently asked questions wait their turn.
// Each question's options are shown in a fresh order, so the right one isn't always in one place.
// Given the section's stage (#123), a quiz asks each level in that stage's shares (src/quiz/levels.ts), the same
// order within each level, a level short of questions being filled from the nearest ones; wrong-last-time first.
// Short answers (#124): with `short`, a stage's level-3 share is drawn from both the multiple-choice and the
// short-answer questions of the bank; without, multiple choice only (offline, or exam practice).
import { isChoice, type ChoiceQuestion, type Level, type OptionIndex, type Question, type QuizAttempt, type ShortQuestion } from '../types/quiz';
import { levelCounts, type Stage } from './levels';

/** Questions in a quiz started by hand from a class (in Play, the planner sets the size). Nov 19: 10, was 5. */
export const QUIZ_SIZE = 10;

/** A multiple-choice question as a quiz asks it. */
export interface QuizItem {
  question: ChoiceQuestion;
  /** order[shown position] = the option's index as stored. */
  order: OptionIndex[];
}

/** A short-answer question as a quiz asks it (#124): typed, marked by the AI at the end. */
export interface ShortItem {
  question: ShortQuestion;
}

export type PickedItem = QuizItem | ShortItem;
export const isShortItem = (item: PickedItem): item is ShortItem => item.question.form === 'short';

/** A random number in [0, 1): Math.random, or a fixed sequence in tests. */
export type Random = () => number;

function shuffle<T>(items: T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Where a level short of questions borrows from: the nearest levels first. */
const NEAREST: Record<Level, Level[]> = { 1: [2, 3], 2: [1, 3], 3: [2, 1] };

/**
 * A quiz of `size` from a section's bank. With `stage`, by level (#123), and with `short` its level 3 may be short
 * answers (#124); without a stage (exam practice, and before #123), multiple choice in the order above whatever the
 * level.
 */
export function pickQuiz(questions: Question[], attempts: QuizAttempt[], size?: number, random?: Random): QuizItem[];
export function pickQuiz(questions: Question[], attempts: QuizAttempt[], size: number, random: Random, stage: Stage, options?: { short?: boolean }): PickedItem[];
export function pickQuiz(
  questions: Question[],
  attempts: QuizAttempt[],
  size = QUIZ_SIZE,
  random: Random = Math.random,
  stage?: Stage,
  options: { short?: boolean } = {},
): PickedItem[] {
  // Each question's most recent answer: attempts come newest first. A short answer counts as right at full marks.
  const last = new Map<string, { right: boolean; at: string }>();
  for (const attempt of attempts) {
    for (const answer of attempt.answers) {
      if (!last.has(answer.questionId)) last.set(answer.questionId, { right: answer.right, at: attempt.finishedAt });
    }
    for (const answer of attempt.short ?? []) {
      if (!last.has(answer.questionId)) last.set(answer.questionId, { right: answer.mark === answer.outOf, at: attempt.finishedAt });
    }
  }
  const askable = (q: Question) => isChoice(q) || (!!stage && !!options.short && q.form === 'short');
  const wrong: Question[] = [];
  const fresh: Question[] = [];
  const known: Question[] = [];
  for (const q of questions.filter(askable)) {
    const seen = last.get(q.id);
    if (!seen) fresh.push(q);
    else if (!seen.right) wrong.push(q);
    else known.push(q);
  }
  const byOldest = (a: Question, b: Question) => last.get(a.id)!.at.localeCompare(last.get(b.id)!.at);
  const ranked = [...shuffle(wrong, random), ...shuffle(fresh, random), ...known.sort(byOldest)];
  const asItem = (question: Question): PickedItem =>
    question.form === 'short' ? { question } : { question: question as ChoiceQuestion, order: shuffle([0, 1, 2, 3] as OptionIndex[], random) };
  if (!stage) return ranked.slice(0, Math.max(0, size)).map(asItem);

  // By level: each level's best-ranked questions, its count from the stage; a level short of questions borrows
  const levelOf = (q: Question): Level => q.level ?? 2;
  const pools: Record<Level, Question[]> = { 1: [], 2: [], 3: [] };
  for (const q of ranked) pools[levelOf(q)].push(q);
  const counts = levelCounts(Math.min(Math.max(0, size), ranked.length), stage);
  const picked: Question[] = [];
  const missing: Level[] = [];
  ([1, 2, 3] as Level[]).forEach((level) => {
    const take = pools[level].splice(0, counts[level - 1]!);
    picked.push(...take);
    for (let i = take.length; i < counts[level - 1]!; i++) missing.push(level);
  });
  for (const level of missing) {
    const from = NEAREST[level].find((l) => pools[l].length > 0);
    if (from) picked.push(pools[from].shift()!);
  }
  // Wrong last time first (DESIGN), then the rest in a fresh order
  const wasWrong = new Set(wrong.map((q) => q.id));
  return [...shuffle(picked.filter((q) => wasWrong.has(q.id)), random), ...shuffle(picked.filter((q) => !wasWrong.has(q.id)), random)].map(asItem);
}

/** Whether a bank has short-answer questions a quiz could ask (so it's worth checking the AI can mark them). */
export const hasShort = (questions: Question[]) => questions.some((q) => q.form === 'short');

/** "4 of 5 right (80%)". */
export function describeScore(right: number, asked: number, score?: number): string {
  // Exam practice's short answers count in parts (#87): show those to one place, "7.7 of 10"
  const shown = Number.isInteger(right) ? String(right) : (Math.round(right * 10) / 10).toString();
  // The percentage is the attempt's own score when given: weighted by level since #120 (DESIGN), the one that moves
  // the schedule; "7 of 10 right" stays a plain count
  const percent = score ?? right / Math.max(1, asked);
  return `${shown} of ${asked} right (${Math.round(100 * percent)}%)`;
}
