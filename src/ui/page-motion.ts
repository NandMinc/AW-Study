// Page transitions (#149): which way a new screen slides in, from where you were and where you're going.
// Between the three main pages, by the nav bar's order; deeper (a class, then what's inside it) comes from
// the right, back from the left; the same depth fades in. Pure: App.tsx keeps the last route and applies it.
import type { Route } from './route';

export type PageMotion = 'forward' | 'back' | 'fade';

const MAIN_ORDER = ['tasks', 'classes', 'settings'] as const;

/** One screen: a change of route within it (a class's part, a quiz's comparison) isn't a new page. */
export function pageKey(route: Route): string {
  switch (route.name) {
    case 'class':
      return route.cover ? `class:${route.courseId}:cover:${route.cover}` : `class:${route.courseId}`;
    case 'slides':
      return `slides:${route.deckId}`;
    case 'quiz':
      return `quiz:${route.sectionId}`;
    case 'practice':
      return `practice:${route.examId}`;
    default:
      return route.name;
  }
}

/** How far in a screen is: the main pages, a class, then what's opened from one. */
export function depth(route: Route): number {
  switch (route.name) {
    case 'tasks':
    case 'classes':
    case 'settings':
    case 'not-found':
      return 0;
    case 'class':
      return route.cover ? 2 : 1;
    default:
      return 2;
  }
}

/** How the screen for `to` comes in after `from`, or null when it's the same screen. */
export function pageMotion(from: Route, to: Route): PageMotion | null {
  if (pageKey(from) === pageKey(to)) return null;
  const a = MAIN_ORDER.indexOf(from.name as (typeof MAIN_ORDER)[number]);
  const b = MAIN_ORDER.indexOf(to.name as (typeof MAIN_ORDER)[number]);
  if (a >= 0 && b >= 0) return b > a ? 'forward' : 'back';
  const d = depth(to) - depth(from);
  return d > 0 ? 'forward' : d < 0 ? 'back' : 'fade';
}
