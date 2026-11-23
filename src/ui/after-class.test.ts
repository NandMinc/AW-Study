// The after-class reminder's rules (#129). Times are passed in with their zone, never the machine's.
import { describe, expect, it } from 'vitest';
import type { Course, Meeting } from '../types/lecture';
import { laterToday, lecturesToRemind, putOff, REMIND_DAYS, reminderKey } from './after-class';

const ZONE = 'America/New_York';
// Wednesday Nov 18, 2026 in New York (UTC-5)
const at = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);
const MWF: Meeting[] = [1, 3, 5].map((day) => ({ day: day as Meeting['day'], start: '10:00', minutes: 50 }));

function course(over: Partial<Course> = {}): Course {
  return {
    id: 'bio',
    name: 'BIO 110',
    meetings: MWF,
    termStart: null,
    termEnd: null,
    createdAt: at('2026-11-01', '09:00').toISOString(),
    updatedAt: at('2026-11-01', '09:00').toISOString(),
    ...over,
  } as Course;
}
const dates = (c: Course, now: Date, filled: string[] = []) => lecturesToRemind(c, new Set(filled), now, ZONE).map((r) => r.date);

describe('lecturesToRemind', () => {
  it('only once a lecture has ended: not before, not during, from its end', () => {
    expect(dates(course(), at('2026-11-18', '09:59'))).not.toContain('2026-11-18');
    expect(dates(course(), at('2026-11-18', '10:49'))).not.toContain('2026-11-18'); // still on
    expect(dates(course(), at('2026-11-18', '10:50'))[0]).toBe('2026-11-18');
  });

  it('the last 7 days, newest first, less the ones filled in', () => {
    expect(REMIND_DAYS).toBe(7);
    expect(dates(course(), at('2026-11-18', '12:00'))).toEqual(['2026-11-18', '2026-11-16', '2026-11-13']); // Wed, Mon, last Fri
    expect(dates(course(), at('2026-11-18', '12:00'), ['2026-11-16'])).toEqual(['2026-11-18', '2026-11-13']);
    expect(dates(course(), at('2026-11-19', '12:00'))).toEqual(['2026-11-18', '2026-11-16', '2026-11-13']); // Thursday: nothing new
    expect(dates(course(), at('2026-11-20', '12:00'))).toEqual(['2026-11-20', '2026-11-18', '2026-11-16']); // Nov 13 is 7 days back
  });

  it('nothing from before the class was added: those are on the Classes page already', () => {
    const added = course({ createdAt: at('2026-11-18', '10:30').toISOString() }); // during Wednesday's lecture
    expect(dates(added, at('2026-11-18', '12:00'))).toEqual(['2026-11-18']); // it ended after
    const addedAfter = course({ createdAt: at('2026-11-18', '11:00').toISOString() });
    expect(dates(addedAfter, at('2026-11-18', '12:00'))).toEqual([]);
    expect(dates(addedAfter, at('2026-11-20', '12:00'))).toEqual(['2026-11-20']);
  });

  it('within the term only; nothing for a class without set times', () => {
    expect(dates(course({ termStart: '2026-11-16' }), at('2026-11-18', '12:00'))).toEqual(['2026-11-18', '2026-11-16']);
    expect(dates(course({ termEnd: '2026-11-16' }), at('2026-11-18', '12:00'))).toEqual(['2026-11-16', '2026-11-13']);
    expect(dates(course({ meetings: [] }), at('2026-11-18', '12:00'))).toEqual([]);
  });

  it('two lectures a day: the later one that has ended, with its length; one running past midnight ends the next day', () => {
    const twice = course({ meetings: [{ day: 3, start: '09:00', minutes: 50 }, { day: 3, start: '14:00', minutes: 80 }] });
    expect(lecturesToRemind(twice, new Set(), at('2026-11-18', '12:00'), ZONE)[0]).toMatchObject({ date: '2026-11-18', minutes: 50 });
    expect(lecturesToRemind(twice, new Set(), at('2026-11-18', '15:30'), ZONE)[0]).toMatchObject({ date: '2026-11-18', minutes: 80 });
    const late = course({ meetings: [{ day: 3, start: '23:30', minutes: 60 }] });
    expect(dates(late, at('2026-11-19', '00:20'))).toEqual([]);
    expect(dates(late, at('2026-11-19', '00:30'))).toEqual(['2026-11-18']);
  });

  it('in the class’s own time zone, whatever the time is in UTC', () => {
    // 10:50 in New York is 15:50 UTC: in Tokyo it's already Thursday, a day with no lecture
    expect(lecturesToRemind(course(), new Set(), at('2026-11-18', '10:50'), 'Asia/Tokyo').map((r) => r.date)).not.toContain('2026-11-19');
    expect(dates(course(), at('2026-11-18', '10:50'))[0]).toBe('2026-11-18');
  });
});

describe('Later', () => {
  function memory() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  }
  const r = (date: string) => ({ courseId: 'bio', courseName: 'BIO 110', date, minutes: 50 });

  it('puts reminders off for the rest of the day, adding up; a new day forgets them', () => {
    const storage = memory();
    putOff(storage, '2026-11-18', [r('2026-11-18')]);
    putOff(storage, '2026-11-18', [r('2026-11-16')]);
    expect(laterToday(storage, '2026-11-18')).toEqual(new Set([reminderKey(r('2026-11-18')), 'bio:2026-11-16']));
    expect(laterToday(storage, '2026-11-19')).toEqual(new Set());
    putOff(storage, '2026-11-19', [r('2026-11-18')]);
    expect(laterToday(storage, '2026-11-19')).toEqual(new Set(['bio:2026-11-18'])); // yesterday's list is gone
  });

  it('blocked or damaged storage means nothing is put off, and nothing breaks', () => {
    expect(laterToday(null, '2026-11-18')).toEqual(new Set());
    expect(laterToday({ getItem: () => 'not json' }, '2026-11-18')).toEqual(new Set());
    expect(laterToday({ getItem: () => JSON.stringify({ day: '2026-11-18', keys: [1, 'ok'] }) }, '2026-11-18')).toEqual(new Set(['ok']));
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => putOff(throwing, '2026-11-18', [r('2026-11-18')])).not.toThrow();
    expect(laterToday(throwing, '2026-11-18')).toEqual(new Set());
  });
});
