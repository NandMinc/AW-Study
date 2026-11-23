// Checking the AI's answers on the device before anything uses them (CLAUDE.md: four options, one
// right answer among them, a slide number). The helper checks too; this is the app not trusting
// anything it didn't make itself.
import type { StyleGuideContent } from '../types/style';
import { AiError, type Grade, type MadeQuestion, type McQuestion, type QuestionMix, type WrittenQuestion } from './backend';

/** Points a banked short question's full answer makes (src/types/quiz.ts ShortQuestion; the helper's LIMITS.shortPoints). */
const SHORT_POINTS = 3;

const unusable = (why: string) => new AiError('unavailable', `The AI’s answer wasn’t usable (${why}).`);

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}

/**
 * The questions that pass every check, in order; throws if none do or the reply isn't a list.
 * `pages` are the slide numbers that were sent: a question must come from one of them. Short answers
 * (#121) only as many as `mix` asked for (none without one); a multiple-choice question without a level
 * is level 2, as before #121.
 */
export function checkQuestions(reply: unknown, pages: readonly number[], count: number, mix?: QuestionMix): MadeQuestion[] {
  const list = (reply as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) throw unusable('no list of questions');
  const allowed = new Set(pages);
  const seen = new Set<string>();
  const good: MadeQuestion[] = [];
  let shortLeft = mix?.short ?? 0;
  for (const item of list) {
    const q = item as Record<string, unknown> | null;
    if (!q || typeof q !== 'object') continue;
    const question = text(q.question, 600);
    if (!question || seen.has(question.toLowerCase())) continue;
    if (!Number.isInteger(q.page) || !allowed.has(q.page as number)) continue;
    const page = q.page as number;
    const explanation = text(q.explanation, 600) ?? '';
    if (q.form === 'short') {
      if (shortLeft === 0) continue;
      if (!Array.isArray(q.points) || q.points.length < 1 || q.points.length > SHORT_POINTS) continue;
      const points = q.points.map((p) => text(p, 300));
      if (points.some((p) => p === null)) continue;
      shortLeft--;
      seen.add(question.toLowerCase());
      good.push({ form: 'short', level: 3, question, points: points as string[], page, explanation });
    } else {
      const level = q.level === undefined ? 2 : q.level;
      if (level !== 1 && level !== 2 && level !== 3) continue;
      if (!Array.isArray(q.options) || q.options.length !== 4) continue;
      const options = q.options.map((o) => text(o, 300));
      if (options.some((o) => o === null)) continue;
      if (new Set(options.map((o) => o!.toLowerCase())).size !== 4) continue;
      if (!Number.isInteger(q.answer) || (q.answer as number) < 0 || (q.answer as number) > 3) continue;
      seen.add(question.toLowerCase());
      good.push({ form: 'choice', level, question, options: options as McQuestion['options'], answer: q.answer as McQuestion['answer'], page, explanation });
    }
    if (good.length === count) break;
  }
  if (good.length === 0) throw unusable('no usable questions');
  return good;
}

/** Short-answer questions that pass every check, in order (#87): a question, 1-6 points, a slide that was sent. */
export function checkWritten(reply: unknown, pages: readonly number[], count: number): WrittenQuestion[] {
  const list = (reply as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) throw unusable('no list of questions');
  const allowed = new Set(pages);
  const seen = new Set<string>();
  const good: WrittenQuestion[] = [];
  for (const item of list) {
    const q = item as Partial<Record<keyof WrittenQuestion, unknown>> | null;
    if (!q || typeof q !== 'object') continue;
    const question = text(q.question, 600);
    if (!question || seen.has(question.toLowerCase())) continue;
    if (!Array.isArray(q.points) || q.points.length < 1 || q.points.length > 6) continue;
    const points = q.points.map((p) => text(p, 300));
    if (points.some((p) => p === null)) continue;
    if (typeof q.page !== 'number' || !allowed.has(q.page)) continue;
    seen.add(question.toLowerCase());
    good.push({ question, points: points as string[], page: q.page });
    if (good.length === count) break;
  }
  if (good.length === 0) throw unusable('no usable questions');
  return good;
}

export function checkGrade(reply: unknown, outOf: number): Grade {
  const r = reply as { mark?: unknown; feedback?: unknown } | null;
  const mark = r?.mark;
  if (!Number.isInteger(mark) || (mark as number) < 0 || (mark as number) > outOf) throw unusable('mark out of range');
  const feedback = text(r?.feedback, 400);
  if (!feedback) throw unusable('no feedback');
  return { mark: mark as number, outOf, feedback };
}

export function checkText(reply: unknown): string {
  const value = text((reply as { text?: unknown } | null)?.text, 4_000);
  if (!value) throw unusable('no text');
  return value;
}

/**
 * A quiz's marks (#121): exactly one per answer, each a whole number from 0 to its points, with feedback.
 * All or nothing: one unusable mark makes the whole reply unusable, so no mark is ever guessed.
 */
export function checkGradeMany(reply: unknown, outOf: readonly number[]): Grade[] {
  const list = (reply as { marks?: unknown } | null)?.marks;
  if (!Array.isArray(list) || list.length !== outOf.length) throw unusable('not one mark per answer');
  return list.map((m, i) => checkGrade(m, outOf[i]!));
}

/** An exam style guide (#121): what the exam tests, three level descriptions, and the short-answer share. */
export function checkStyle(reply: unknown): StyleGuideContent {
  const r = reply as { tests?: unknown; levels?: unknown; shortShare?: unknown } | null;
  const tests = text(r?.tests, 3_000);
  if (!tests) throw unusable('no description of the exam');
  if (!Array.isArray(r?.levels) || r.levels.length !== 3) throw unusable('not three levels');
  const levels = r.levels.map((l) => text(l, 600));
  if (levels.some((l) => l === null)) throw unusable('an empty level');
  const share = r.shortShare;
  if (typeof share !== 'number' || !(share >= 0 && share <= 1)) throw unusable('a short-answer share outside 0 to 1');
  return { tests, levels: levels as StyleGuideContent['levels'], shortShare: share };
}
