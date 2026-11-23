// Exam practice (#87, DESIGN "Tests and exam practice"): the pure parts of the practice screen. Which
// questions it asks, what goes to the AI to write and mark the short answers, and how the answers become
// one quiz attempt per section (src/types/quiz.ts, `examId` and `written`). The screen is
// src/ui/PracticeScreen.tsx; the planner decides when a practice is due (src/plan/planner.ts).
import type { SlideText, WrittenQuestion } from '../ai/backend';
import type { Section } from '../types/lecture';
import { isChoice, type OptionIndex, type Question, type QuizAttempt, type QuizAttemptInput, type WrittenAnswer } from '../types/quiz';
import { sectionSlides } from './bank';
import { pickQuiz, type QuizItem, type Random } from './pick';

/** Slides a `written` request may carry (the helper's LIMITS.pages). */
export const WRITTEN_PAGES_MAX = 60;

/** One section of a practice, with what's needed to ask about it. */
export interface PracticeSection {
  section: Section;
  pageTexts: string[];
  bank: Question[];
  attempts: QuizAttempt[];
}

export type PracticeQuestion =
  | { kind: 'choice'; sectionId: string; item: QuizItem }
  | { kind: 'written'; sectionId: string; question: WrittenQuestion };

export type PracticeAnswer =
  | { kind: 'choice'; sectionId: string; item: QuizItem; chosen: OptionIndex; ms: number }
  | { kind: 'written'; sectionId: string; question: WrittenQuestion; answer: string; ms: number };

/** The AI's mark for a short answer (by its place in the answers list). */
export interface Mark {
  mark: number;
  feedback: string;
}

/** The slides a section's short answers are written from: those with text, spread evenly when there are too many. */
export function writtenPages(s: Pick<PracticeSection, 'section' | 'pageTexts'>): SlideText[] {
  const slides = sectionSlides(s.section, s.pageTexts);
  if (slides.length <= WRITTEN_PAGES_MAX) return slides;
  return Array.from({ length: WRITTEN_PAGES_MAX }, (_, i) => slides[Math.floor((i * slides.length) / WRITTEN_PAGES_MAX)]!);
}

/** Multiple-choice questions in a section's bank (what a practice asks from it; short ones wait for #124). */
export const choiceCount = (s: Pick<PracticeSection, 'bank'>) => s.bank.filter(isChoice).length;

/** Whether a section has anything to ask: multiple choice in its bank, or text to write short answers from. */
export function canAsk(s: PracticeSection): boolean {
  return choiceCount(s) > 0 || writtenPages(s).length > 0;
}

/**
 * The practice's questions, section by section (in the order given): its multiple choice from the bank
 * (picked like a quiz: last time's wrong ones first), then its short answers.
 */
export function practiceQuestions(
  sections: PracticeSection[],
  written: ReadonlyMap<string, WrittenQuestion[]>,
  mcPerSection: number,
  random: Random = Math.random,
): PracticeQuestion[] {
  return sections.flatMap((s): PracticeQuestion[] => [
    ...pickQuiz(s.bank, s.attempts, mcPerSection, random).map((item) => ({ kind: 'choice' as const, sectionId: s.section.id, item })),
    ...(written.get(s.section.id) ?? []).map((question) => ({ kind: 'written' as const, sectionId: s.section.id, question })),
  ]);
}

/** What the grade job gets for a short answer: its slide and the slides either side, within the section. */
export function gradeSlides(s: Pick<PracticeSection, 'section' | 'pageTexts'>, page: number): SlideText[] {
  return sectionSlides(s.section, s.pageTexts).filter((slide) => Math.abs(slide.page - page) <= 1);
}

/** A blank answer needs no AI: it gets 0, and is never sent. */
export const isBlank = (answer: string) => answer.trim() === '';

/**
 * One attempt per section for the store (recordQuizAttempt). Short answers go in only when marked
 * (`marks[i]` for answer i): an unmarked one is left out, never given a mark. A section left with no
 * answers of either kind has no attempt.
 */
export function attemptInputs(
  examId: string,
  answers: PracticeAnswer[],
  marks: ReadonlyMap<number, Mark>,
  times: { startedAt: string; finishedAt: string },
): QuizAttemptInput[] {
  const bySection = new Map<string, QuizAttemptInput>();
  answers.forEach((a, i) => {
    let input = bySection.get(a.sectionId);
    if (!input) {
      input = { sectionId: a.sectionId, ...times, examId, answers: [], written: [] };
      bySection.set(a.sectionId, input);
    }
    if (a.kind === 'choice') {
      input.answers.push({ questionId: a.item.question.id, chosen: a.chosen, ms: a.ms });
      return;
    }
    const mark = marks.get(i);
    if (!mark) return;
    const written: WrittenAnswer = { question: a.question.question, points: a.question.points, page: a.question.page, answer: a.answer, mark: mark.mark, feedback: mark.feedback, ms: a.ms };
    input.written!.push(written);
  });
  return [...bySection.values()].filter((x) => x.answers.length + x.written!.length > 0);
}
