// The after-class reminder (#129, DESIGN "After-class prompts"): when Honed opens after one of a class's
// lectures, a popup links to that lecture's "What was covered?". Asked when the app opens, not by push
// (Matt, Nov 22). Pure, with tests: which lectures to remind about, and what "Later" put off today.
//
// "Later" is a device setting, not the user's data (like the theme, src/ui/theme.ts): localStorage, outside
// the encrypted store, holding only class ids and dates for today.
import type { Course } from '../types/lecture';
import { addDays, localNow, weekday } from './classes';

/** Lectures older than this many days aren't reminded about (they stay as date buttons on the Classes page). */
export const REMIND_DAYS = 7;

export interface Reminder {
  courseId: string;
  courseName: string;
  date: string; // "YYYY-MM-DD", the lecture's day
  minutes: number;
}

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** A local date and time as minutes, to compare two moments in the same time zone. */
const stamp = (date: string, minutes: number) => Date.parse(`${date}T00:00:00Z`) / 60_000 + minutes;

/**
 * A class's lectures to remind about, newest first: in the last REMIND_DAYS days (today included), ended
 * (start + length) by `at`, ended after the class was added (its past lectures are on the Classes page
 * already), within its term, and not filled in (`filled`: dates with a lecture). One a day: the day's last
 * lecture that has ended, as "What was covered?" records one lecture a date.
 */
export function lecturesToRemind(
  course: Pick<Course, 'id' | 'name' | 'meetings' | 'termStart' | 'termEnd' | 'createdAt'>,
  filled: ReadonlySet<string>,
  at: Date,
  timeZone: string,
): Reminder[] {
  if (course.meetings.length === 0) return [];
  const now = localNow(at, timeZone);
  const nowStamp = stamp(now.date, toMinutes(now.time));
  const added = localNow(new Date(course.createdAt), timeZone);
  const addedStamp = stamp(added.date, toMinutes(added.time));
  const found: Reminder[] = [];
  for (let back = 0; back < REMIND_DAYS; back++) {
    const date = addDays(now.date, -back);
    if (filled.has(date)) continue;
    if ((course.termStart && date < course.termStart) || (course.termEnd && date > course.termEnd)) continue;
    const day = weekday(date);
    const ended = course.meetings
      .filter((m) => m.day === day)
      .map((m) => ({ minutes: m.minutes, end: stamp(date, toMinutes(m.start) + m.minutes) }))
      .filter((m) => m.end <= nowStamp && m.end > addedStamp)
      .sort((a, b) => b.end - a.end);
    if (ended[0]) found.push({ courseId: course.id, courseName: course.name, date, minutes: ended[0].minutes });
  }
  return found;
}

const KEY = 'honed:after-class-later';

/** A reminder's key in the "Later" list. */
export const reminderKey = (r: Pick<Reminder, 'courseId' | 'date'>) => `${r.courseId}:${r.date}`;

/** What "Later" put off today (`today`: the local date); anything saved on another day is forgotten. */
export function laterToday(storage: Pick<Storage, 'getItem'> | null, today: string): Set<string> {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null') as { day?: unknown; keys?: unknown } | null;
    if (!saved || saved.day !== today || !Array.isArray(saved.keys)) return new Set();
    return new Set(saved.keys.filter((k): k is string => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

/** Puts these reminders off until tomorrow (adding to what's already put off today). */
export function putOff(storage: Pick<Storage, 'getItem' | 'setItem'> | null, today: string, reminders: readonly Reminder[]): void {
  try {
    const keys = [...laterToday(storage, today), ...reminders.map(reminderKey)];
    storage?.setItem(KEY, JSON.stringify({ day: today, keys: [...new Set(keys)] }));
  } catch {
    // Storage blocked (some private windows): Later lasts until the page is closed
  }
}

/** localStorage, or null where it's blocked. */
export function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
