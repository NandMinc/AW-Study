// Which questions a quiz asks (DESIGN, "Questions"): the ones you got wrong last time first, then
// ones never asked, then the rest, longest-ago first, so recently asked questions wait their turn.
// Each question's options are shown in a fresh order, so the right one isn't always in one place.
// Given the section's stage (#123), a quiz asks each level in that stage's shares (src/quiz/levels.ts), the same
// order within each level, a level short of questions being filled from the nearest ones; wrong-last-time first.
import { isChoice, type ChoiceQuestion, type Level, type OptionIndex, type Question, type QuizAttempt } from '../types/quiz';
import { levelCounts, type Stage } from './levels';

/** Questions in a quiz started by hand from a class (in Play, the planner sets the size). Nov 19: 10, was 5. */
export const QUIZ_SIZE = 10;

export interface QuizItem {
  question: ChoiceQuestion; // multiple choice only until short answers reach the quiz screen (#124)
  /** order[shown position] = the option's index as stored. */
  order: OptionIndex[];
}

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
 * A quiz of `size` from a section's bank. With `stage`, by level (#123); without (exam practice, and before #123),
 * in the order above whatever the level.
 */
export function pickQuiz(questions: Question[], attempts: QuizAttempt[], size = QUIZ_SIZE, random: Random = Math.random, stage?: Stage): QuizItem[] {
  // Each question's most recent answer: attempts come newest first
  const last = new Map<string, { right: boolean; at: string }>();
  for (const attempt of attempts) {
    for (const answer of attempt.answers) {
      if (!last.has(answer.questionId)) last.set(answer.questionId, { right: answer.right, at: attempt.finishedAt });
    }
  }
  const wrong: ChoiceQuestion[] = [];
  const fresh: ChoiceQuestion[] = [];
  const known: ChoiceQuestion[] = [];
  for (const q of questions.filter(isChoice)) {
    const seen = last.get(q.id);
    if (!seen) fresh.push(q);
    else if (!seen.right) wrong.push(q);
    else known.push(q);
  }
  const byOldest = (a: Question, b: Question) => last.get(a.id)!.at.localeCompare(last.get(b.id)!.at);
  const ranked = [...shuffle(wrong, random), ...shuffle(fresh, random), ...known.sort(byOldest)];
  const withOrder = (question: ChoiceQuestion) => ({ question, order: shuffle([0, 1, 2, 3] as OptionIndex[], random) });
  if (!stage) return ranked.slice(0, Math.max(0, size)).map(withOrder);

  // By level: each level's best-ranked questions, its count from the stage; a level short of questions borrows
  const levelOf = (q: ChoiceQuestion): Level => q.level ?? 2;
  const pools: Record<Level, ChoiceQuestion[]> = { 1: [], 2: [], 3: [] };
  for (const q of ranked) pools[levelOf(q)].push(q);
  const counts = levelCounts(Math.min(Math.max(0, size), ranked.length), stage);
  const picked: ChoiceQuestion[] = [];
  const short: Level[] = [];
  ([1, 2, 3] as Level[]).forEach((level) => {
    const take = pools[level].splice(0, counts[level - 1]!);
    picked.push(...take);
    for (let i = take.length; i < counts[level - 1]!; i++) short.push(level);
  });
  for (const level of short) {
    const from = NEAREST[level].find((l) => pools[l].length > 0);
    if (from) picked.push(pools[from].shift()!);
  }
  // Wrong last time first (DESIGN), then the rest in a fresh order
  const wasWrong = new Set(wrong.map((q) => q.id));
  return [...shuffle(picked.filter((q) => wasWrong.has(q.id)), random), ...shuffle(picked.filter((q) => !wasWrong.has(q.id)), random)].map(withOrder);
}

/** "4 of 5 right (80%)". */
export function describeScore(right: number, asked: number): string {
  // Exam practice's short answers count in parts (#87): show those to one place, "7.7 of 10"
  const shown = Number.isInteger(right) ? String(right) : (Math.round(right * 10) / 10).toString();
  return `${shown} of ${asked} right (${Math.round((100 * right) / Math.max(1, asked))}%)`;
}
