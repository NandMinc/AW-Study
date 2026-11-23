// The first run (#136, DESIGN "First run", steps 2-4): a short tour of the main ideas, then a Getting started
// checklist on Tasks that ticks itself from the data (a class, a lecture's slides, a first study session). Pure,
// with tests. Whether the tour was seen and whether the checklist was skipped are device settings, not the user's
// data (like the theme, src/ui/theme.ts): localStorage, outside the encrypted store, never synced.
import { APP_NAME } from '../brand';

/** How far along a new user is, from the store (src/ui/planning.ts). */
export interface StartProgress {
  classes: number;
  lectures: number;
  /** Any study session or quiz done, ever. */
  studied: boolean;
  /** Where "add what a lecture covered" goes: the first class without a lecture, else the first class. */
  courseId: string | null;
}

export type StepId = 'class' | 'lecture' | 'study';

export function startSteps(p: StartProgress): { id: StepId; done: boolean }[] {
  return [
    { id: 'class', done: p.classes > 0 },
    { id: 'lecture', done: p.lectures > 0 },
    { id: 'study', done: p.studied },
  ];
}

/** The checklist shows until every step is done, or it's skipped. */
export function showChecklist(p: StartProgress, skipped: boolean): boolean {
  return !skipped && startSteps(p).some((s) => !s.done);
}

/** The tour opens by itself once, for someone with no classes yet (not for someone whose classes came by sync or a backup). */
export function tourByItself(p: StartProgress, seen: boolean): boolean {
  return !seen && p.classes === 0;
}

/** The tour's cards: the main ideas, in the order they happen. */
export const TOUR: { title: string; text: string }[] = [
  {
    title: 'Your classes',
    text: `Tell ${APP_NAME} when each class meets: the days, the time and how long. Add exam dates too, and it gets you ready for them.`,
  },
  {
    title: 'After each lecture',
    text: `Add the lecture’s slides (a PDF) and the part it covered, like slides 21–30. ${APP_NAME} plans when to study them, and its AI writes quiz questions from them.`,
  },
  {
    title: 'Every day',
    text: 'Press Start on Tasks: study the slides, then take a short quiz. Your score decides when each part comes back: what you know well waits longer, what you don’t comes back sooner.',
  },
];

export const TOUR_SEEN_KEY = 'honed:tour-seen';
export const CHECKLIST_SKIPPED_KEY = 'honed:getting-started-skipped';

export function readFlag(storage: Pick<Storage, 'getItem'> | null, key: string): boolean {
  try {
    return storage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function setFlag(storage: Pick<Storage, 'setItem'> | null, key: string): void {
  try {
    storage?.setItem(key, '1');
  } catch {
    // Storage blocked (some private windows): it lasts until the page is closed
  }
}

/** localStorage, or null where it's blocked. */
export function deviceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
