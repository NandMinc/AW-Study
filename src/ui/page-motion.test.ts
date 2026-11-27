import { describe, expect, it } from 'vitest';
import { pageKey, pageMotion } from './page-motion';
import type { Route } from './route';

const tasks: Route = { name: 'tasks' };
const classes: Route = { name: 'classes' };
const settings: Route = { name: 'settings' };
const course: Route = { name: 'class', courseId: 'c1' };
const exams: Route = { name: 'class', courseId: 'c1', part: 'exams' };
const cover: Route = { name: 'class', courseId: 'c1', cover: '2026-11-20' };
const slides: Route = { name: 'slides', courseId: 'c1', deckId: 'd1' };
const quiz: Route = { name: 'quiz', courseId: 'c1', sectionId: 's1' };

describe('pageMotion (#149)', () => {
  it('between the main pages, by the nav bar order', () => {
    expect(pageMotion(tasks, classes)).toBe('forward');
    expect(pageMotion(tasks, settings)).toBe('forward');
    expect(pageMotion(settings, classes)).toBe('back');
    expect(pageMotion(classes, tasks)).toBe('back');
  });

  it('deeper comes from the right, back from the left, the same depth fades', () => {
    expect(pageMotion(classes, course)).toBe('forward');
    expect(pageMotion(course, cover)).toBe('forward');
    expect(pageMotion(course, slides)).toBe('forward');
    expect(pageMotion(tasks, { name: 'play' })).toBe('forward');
    expect(pageMotion(slides, course)).toBe('back');
    expect(pageMotion(cover, classes)).toBe('back');
    expect(pageMotion(quiz, tasks)).toBe('back');
    expect(pageMotion(slides, quiz)).toBe('fade');
    expect(pageMotion(course, { name: 'class', courseId: 'c2' })).toBe('fade');
  });

  it('the same screen is no new page: a class part, a quiz comparison, a slide range', () => {
    expect(pageMotion(course, exams)).toBeNull();
    expect(pageMotion(quiz, { ...quiz, compare: true })).toBeNull();
    expect(pageMotion(slides, { ...slides, first: 2, last: 5 })).toBeNull();
    expect(pageMotion(tasks, { name: 'tasks', tour: true })).toBeNull();
    expect(pageKey(cover)).not.toBe(pageKey({ ...cover, cover: '2026-11-21' }));
  });
});
