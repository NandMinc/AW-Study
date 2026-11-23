import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from './route';

describe('parseRoute', () => {
  it('reads every screen', () => {
    expect(parseRoute('')).toEqual({ name: 'tasks' });
    expect(parseRoute('#/')).toEqual({ name: 'tasks' });
    expect(parseRoute('#/classes')).toEqual({ name: 'classes' });
    expect(parseRoute('#/class/abc-123')).toEqual({ name: 'class', courseId: 'abc-123' });
    expect(parseRoute('#/class/c1/exams')).toEqual({ name: 'class', courseId: 'c1', part: 'exams' });
    expect(parseRoute('#/class/c1/details')).toEqual({ name: 'class', courseId: 'c1', part: 'details' });
    expect(parseRoute('#/class/c1/cover/2026-11-15')).toEqual({ name: 'class', courseId: 'c1', cover: '2026-11-15' });
    expect(parseRoute('#/class/c1/slides/abc-123')).toEqual({ name: 'slides', courseId: 'c1', deckId: 'abc-123' });
    expect(parseRoute('#/class/c1/slides/abc-123/21-30')).toEqual({ name: 'slides', courseId: 'c1', deckId: 'abc-123', first: 21, last: 30 });
    expect(parseRoute('#/class/c1/slides/abc-123/4-4')).toEqual({ name: 'slides', courseId: 'c1', deckId: 'abc-123', first: 4, last: 4 });
    expect(parseRoute('#/class/c1/quiz/s-1')).toEqual({ name: 'quiz', courseId: 'c1', sectionId: 's-1' });
    expect(parseRoute('#/class/c1/quiz/s-1/compare')).toEqual({ name: 'quiz', courseId: 'c1', sectionId: 's-1', compare: true });
    expect(parseRoute('#/play')).toEqual({ name: 'play' });
    expect(parseRoute('#/practice/e-1')).toEqual({ name: 'practice', examId: 'e-1' });
    expect(parseRoute('#/practice/')).toEqual({ name: 'not-found' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
  });

  it('treats anything else as not found, including the old flashcard addresses', () => {
    for (const hash of [
      '#/class/',
      '#/class/a/b',
      '#/class/c1/slides/a/0-3',
      '#/class/c1/slides/a/5-3',
      '#/class/c1/slides/a/3',
      '#/class/c1/slides/a/1-99999',
      '#/slides/abc',
      '#/class/c1/quiz/',
      '#/class/c1/quiz/s1/2',
      '#/class/c1/quiz/s1/compare/x',
      '#/cards',
      '#/cards/deck/abc',
      '#/deck/abc',
      '#/review/abc',
      '#/settings/x',
      '#/classes/',
      '#/class/c1/grades',
      '#/class/c1/cover/2026-02-30',
      '#/class/c1/cover/2026-11-5',
      '#/class/c1/cover/',
      '#/classes/x',
      '#/class/<script>',
      `#/class/${'x'.repeat(65)}`,
    ]) {
      expect(parseRoute(hash), hash).toEqual({ name: 'not-found' });
    }
  });

  it('round-trips with href', () => {
    const routes: Exclude<Route, { name: 'not-found' }>[] = [
      { name: 'tasks' },
      { name: 'classes' },
      { name: 'class', courseId: 'c1' },
      { name: 'class', courseId: 'c1', part: 'lectures' },
      { name: 'class', courseId: 'c1', part: 'files' },
      { name: 'class', courseId: 'c1', part: 'style' },
      { name: 'class', courseId: 'c1', cover: '2026-11-15' },
      { name: 'slides', courseId: 'c1', deckId: 'd1' },
      { name: 'slides', courseId: 'c1', deckId: 'd1', first: 2, last: 4 },
      { name: 'quiz', courseId: 'c1', sectionId: 's1' },
      { name: 'quiz', courseId: 'c1', sectionId: 's1', compare: true },
      { name: 'play' },
      { name: 'practice', examId: 'e1' },
      { name: 'settings' },
    ];
    for (const route of routes) expect(parseRoute(href(route))).toEqual(route);
  });
});
