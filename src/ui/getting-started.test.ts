// The first run's rules (#136): the checklist's steps, when it and the tour show, and the device flags.
import { describe, expect, it } from 'vitest';
import { CHECKLIST_SKIPPED_KEY, readFlag, setFlag, showChecklist, startSteps, TOUR, TOUR_SEEN_KEY, tourByItself, type StartProgress } from './getting-started';

const fresh: StartProgress = { classes: 0, lectures: 0, studied: false, courseId: null };

describe('Getting started', () => {
  it('ticks each step from the data', () => {
    expect(startSteps(fresh).map((s) => s.done)).toEqual([false, false, false]);
    expect(startSteps({ ...fresh, classes: 1, courseId: 'c' }).map((s) => s.done)).toEqual([true, false, false]);
    expect(startSteps({ classes: 2, lectures: 1, studied: false, courseId: 'c' }).map((s) => s.done)).toEqual([true, true, false]);
    expect(startSteps({ classes: 2, lectures: 1, studied: true, courseId: 'c' }).map((s) => s.id)).toEqual(['class', 'lecture', 'study']);
  });

  it('the checklist shows until everything is done, or it’s skipped', () => {
    expect(showChecklist(fresh, false)).toBe(true);
    expect(showChecklist({ classes: 1, lectures: 1, studied: false, courseId: 'c' }, false)).toBe(true);
    expect(showChecklist({ classes: 1, lectures: 1, studied: true, courseId: 'c' }, false)).toBe(false);
    expect(showChecklist(fresh, true)).toBe(false);
  });

  it('the tour opens by itself once, and only with no classes yet', () => {
    expect(tourByItself(fresh, false)).toBe(true);
    expect(tourByItself(fresh, true)).toBe(false);
    expect(tourByItself({ ...fresh, classes: 1, courseId: 'c' }, false)).toBe(false); // classes from a backup or another device
  });

  it('three cards, each with its words', () => {
    expect(TOUR.map((c) => c.title)).toEqual(['Your classes', 'After each lecture', 'Every day']);
    expect(TOUR.every((c) => c.text.length > 40)).toBe(true);
  });

  it('device flags: set, read, and harmless when storage is blocked', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(readFlag(storage, TOUR_SEEN_KEY)).toBe(false);
    setFlag(storage, TOUR_SEEN_KEY);
    expect(readFlag(storage, TOUR_SEEN_KEY)).toBe(true);
    expect(readFlag(storage, CHECKLIST_SKIPPED_KEY)).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readFlag(blocked, TOUR_SEEN_KEY)).toBe(false);
    expect(() => setFlag(blocked, TOUR_SEEN_KEY)).not.toThrow();
    expect(readFlag(null, TOUR_SEEN_KEY)).toBe(false);
  });
});
