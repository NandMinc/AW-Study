// Starting a quiz (#124): checking the AI can mark short answers before any are asked, then picking. Kept out of
// the quiz screen so it's tested without the viewer.
import { AiError, type AiBackend } from '../ai/backend';
import type { Question, QuizAttempt } from '../types/quiz';
import type { Stage } from './levels';
import { hasShort, pickQuiz, type PickedItem } from './pick';

export interface StartedQuiz {
  items: PickedItem[];
  startedAt: string;
  note: string | null;
}

/** How long to wait for the AI helper before a quiz goes ahead with multiple choice only (#124). */
export const AI_CHECK_MS = 5_000;

/**
 * Picks a quiz (#124). When the bank has short-answer questions, first checks the AI helper can be reached to mark
 * them (its whoami: no AI used); if it can't (offline, signed out, slow), the quiz is multiple choice only and `note`
 * says why. A bank without short answers needs no check.
 */
export async function startQuiz(ai: AiBackend, questions: Question[], attempts: QuizAttempt[], size: number, stage: Stage): Promise<StartedQuiz> {
  let short = false;
  let note: string | null = null;
  if (hasShort(questions)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_CHECK_MS);
    try {
      await ai.status(controller.signal);
      short = true;
    } catch (err) {
      const why =
        err instanceof AiError && err.code === 'offline'
          ? 'you’re offline'
          : err instanceof AiError && err.code === 'signed-out'
            ? 'sign in for AI to get them'
            : 'the AI can’t be reached right now';
      note = `Short answers need the AI to mark them, so this quiz is multiple choice only (${why}).`;
    } finally {
      clearTimeout(timer);
    }
  }
  return { items: pickQuiz(questions, attempts, size, Math.random, stage, { short }), startedAt: new Date().toISOString(), note };
}
