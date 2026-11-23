// Which screen to show, from the URL's hash: #/ (Tasks, the home page), #/classes, #/class/<id> (and
// #/class/<id>/<part>, the class's page opened at one part, from its menu on the Classes page, or
// #/class/<id>/cover/<date>, "What was covered?" for that lecture), #/class/<id>/slides/<deckId>
// (a deck in the viewer, optionally .../<first>-<last> for a section), #/class/<id>/quiz/<sectionId>,
// #/play (today's checklist, one item after another), #/practice/<examId> (today's exam practice, #87),
// #/settings.
// The hash keeps everything on one page (the service worker serves it offline) while the back
// button and reloads still work. No router library.
import { useEffect, useState } from 'react';

/** The parts of a class's page its menu opens (docs/design "Classes"). */
export const CLASS_PARTS = ['lectures', 'details', 'exams', 'files', 'style'] as const;
export type ClassPart = (typeof CLASS_PARTS)[number];

export type Route =
  | { name: 'tasks' }
  | { name: 'classes' }
  | { name: 'class'; courseId: string; part?: ClassPart; cover?: string }
  | { name: 'slides'; courseId: string; deckId: string; first?: number; last?: number }
  | { name: 'quiz'; courseId: string; sectionId: string; compare?: boolean }
  | { name: 'play' }
  | { name: 'practice'; examId: string }
  | { name: 'settings' }
  | { name: 'not-found' };

const ID = '([A-Za-z0-9-]{1,64})';
const PAGE = '([1-9][0-9]{0,3})';
const PATTERNS: [RegExp, (m: RegExpMatchArray) => Route | null][] = [
  [/^#?\/?$/, () => ({ name: 'tasks' })],
  [/^#\/classes$/, () => ({ name: 'classes' })],
  [new RegExp(`^#/class/${ID}$`), (m) => ({ name: 'class', courseId: m[1]! })],
  [new RegExp(`^#/class/${ID}/(${CLASS_PARTS.join('|')})$`), (m) => ({ name: 'class', courseId: m[1]!, part: m[2] as ClassPart })],
  [new RegExp(`^#/class/${ID}/cover/([0-9]{4}-[0-9]{2}-[0-9]{2})$`), (m) => (validDate(m[2]!) ? { name: 'class', courseId: m[1]!, cover: m[2]! } : null)],
  [new RegExp(`^#/class/${ID}/slides/${ID}$`), (m) => ({ name: 'slides', courseId: m[1]!, deckId: m[2]! })],
  [
    new RegExp(`^#/class/${ID}/slides/${ID}/${PAGE}-${PAGE}$`),
    (m) =>
      Number(m[3]) <= Number(m[4]) ? { name: 'slides', courseId: m[1]!, deckId: m[2]!, first: Number(m[3]), last: Number(m[4]) } : null,
  ],
  [new RegExp(`^#/class/${ID}/quiz/${ID}$`), (m) => ({ name: 'quiz', courseId: m[1]!, sectionId: m[2]! })],
  [new RegExp(`^#/class/${ID}/quiz/${ID}/compare$`), (m) => ({ name: 'quiz', courseId: m[1]!, sectionId: m[2]!, compare: true })],
  [/^#\/play$/, () => ({ name: 'play' })],
  [new RegExp(`^#/practice/${ID}$`), (m) => ({ name: 'practice', examId: m[1]! })],
  [/^#\/settings$/, () => ({ name: 'settings' })],
];

/** A real calendar date ("2026-02-30" isn't). */
function validDate(date: string): boolean {
  const d = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function parseRoute(hash: string): Route {
  for (const [pattern, make] of PATTERNS) {
    const m = hash.match(pattern);
    const route = m && make(m);
    if (route) return route;
  }
  return { name: 'not-found' };
}

export function href(route: Exclude<Route, { name: 'not-found' }>): string {
  switch (route.name) {
    case 'tasks':
      return '#/';
    case 'classes':
      return '#/classes';
    case 'class':
      if (route.cover) return `#/class/${route.courseId}/cover/${route.cover}`;
      return route.part ? `#/class/${route.courseId}/${route.part}` : `#/class/${route.courseId}`;
    case 'slides': {
      const deck = `#/class/${route.courseId}/slides/${route.deckId}`;
      return route.first && route.last ? `${deck}/${route.first}-${route.last}` : deck;
    }
    case 'quiz':
      return `#/class/${route.courseId}/quiz/${route.sectionId}${route.compare ? '/compare' : ''}`;
    case 'play':
      return '#/play';
    case 'practice':
      return `#/practice/${route.examId}`;
    case 'settings':
      return '#/settings';
  }
}

export function go(route: Exclude<Route, { name: 'not-found' }>): void {
  window.location.hash = href(route);
}

/** The current route, updated when the hash changes. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
