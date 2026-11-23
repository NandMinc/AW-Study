// The after-class reminder (#129): when Honed opens (or comes back into view) on one of its main pages, a popup
// lists the lectures that have ended since the class was added and aren't filled in yet, each linking to its
// "What was covered?". Later puts them off until tomorrow; following a link counts as seen for today too, so
// coming back without filling it in doesn't ask again. Never over a quiz, Play or the slides: App shows it on
// Tasks, Classes and Settings only. The rules are in ./after-class.ts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deviceTimeZone, studyDay } from '../lib/studyDay';
import { laterToday, lecturesToRemind, putOff, reminderKey, safeStorage, type Reminder } from './after-class';
import { formatDate, localNow } from './classes';
import type { MainPage } from './NavBar';
import { href } from './route';
import { DAY_START_HOUR } from './settings';
import { useStore } from './store-context';

/** At most this many lectures listed; the rest are on the Classes page. */
const LISTED = 4;

export function AfterClass({ page }: { page: MainPage }) {
  const store = useStore();
  const [shown, setShown] = useState<Reminder[] | null>(null);
  const [looks, setLooks] = useState(0); // bumped when the app comes back into view
  const first = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const onShow = () => document.visibilityState === 'visible' && setLooks((n) => n + 1);
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);

  // Looked for on arriving at a main page and on coming back into view: cheap, and what's put off stays off
  useEffect(() => {
    let current = true;
    const look = async () => {
      const now = new Date();
      const zone = deviceTimeZone();
      const later = laterToday(safeStorage(), localNow(now, zone).date);
      const courses = await store.listCourses(studyDay(now, zone, DAY_START_HOUR));
      const each = await Promise.all(
        courses.map(async (course) => {
          const lectures = await store.listLectures(course.id);
          return lecturesToRemind(course, new Set(lectures.map((l) => l.lecture.date)), now, zone);
        }),
      );
      const due = each
        .flat()
        .filter((r) => !later.has(reminderKey(r)))
        .sort((a, b) => b.date.localeCompare(a.date) || a.courseName.localeCompare(b.courseName));
      if (current) setShown(due.length > 0 ? due : null);
    };
    look().catch(() => {}); // a reminder is a nicety: if it can't be worked out, there's simply none
    return () => {
      current = false;
    };
  }, [store, page, looks]);

  const putAllOff = () => {
    if (shown) putOff(safeStorage(), localNow(new Date(), deviceTimeZone()).date, shown);
    setShown(null);
  };

  // Escape is Later. One listener for the popup's life, reading the latest putAllOff through a ref (PROGRESS,
  // Gotchas: a listener added again after each render leaves a gap where WebKit loses the key)
  const onEscape = useRef(putAllOff);
  useLayoutEffect(() => {
    onEscape.current = putAllOff;
  });
  // Before the popup is painted (useLayoutEffect), so a key pressed the moment it shows isn't missed
  const open = shown !== null;
  useLayoutEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!shown) return null;
  const one = shown.length === 1 ? shown[0]! : null;
  const more = shown.length - LISTED;

  return (
    <div className="dialog-backdrop" onClick={putAllOff}>
      <div
        className="dialog after-class"
        role="dialog"
        aria-modal="true"
        aria-labelledby="after-class-title"
        data-testid="after-class"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="after-class-title">{one ? `${one.courseName} had a lecture` : 'Lectures to fill in'}</h2>
        <p>
          {one
            ? `On ${formatDate(one.date)}. Add what it covered and its slides, so it’s planned for study.`
            : 'These classes have had lectures. Add what each covered and its slides, so they’re planned for study.'}
        </p>
        <ul className="list" aria-label="Lectures to fill in">
          {shown.slice(0, LISTED).map((r, i) => (
            <li key={reminderKey(r)} className="item" data-testid="after-class-lecture">
              <span className="item-main">
                {r.courseName} · {formatDate(r.date)}
              </span>
              <a
                ref={i === 0 ? first : undefined}
                href={href({ name: 'class', courseId: r.courseId, cover: r.date })}
                onClick={putAllOff}
                aria-label={`Add what ${r.courseName} covered on ${formatDate(r.date)}`}
              >
                Add what it covered
              </a>
            </li>
          ))}
        </ul>
        {more > 0 && (
          <p>
            <a href={href({ name: 'classes' })} onClick={putAllOff}>
              And {more} more on the Classes page
            </a>
          </p>
        )}
        <div className="row end">
          <button type="button" onClick={putAllOff}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
