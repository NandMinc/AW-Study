// The Classes page (#/classes, one of the three main pages; docs/design "Classes"): a heading for each
// class with its menu (ClassMenu), and under it a round button for each lecture that hasn't been
// filled in yet, by date, which opens "What was covered?" for it. A round + adds a class. Everything
// else about a class is on its own page (ClassScreen), which the heading opens.
import { useState } from 'react';
import { deviceTimeZone, studyDay } from '../lib/studyDay';
import type { CourseSummary } from '../types/lecture';
import { formatDate, shortDate, unfilledLectures } from './classes';
import { ClassEditor } from './ClassEditor';
import { ClassMenu } from './ClassMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { go, href } from './route';
import { DAY_START_HOUR } from './settings';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

interface ClassData {
  course: CourseSummary;
  toFill: { date: string; minutes: number }[];
}

/** `adding`: opened at adding a class (#/classes/new, from Getting started, #136). */
export function ClassesScreen({ adding: startAdding = false }: { adding?: boolean }) {
  const store = useStore();
  const now = new Date();
  const zone = deviceTimeZone();
  const today = studyDay(now, zone, DAY_START_HOUR);
  const { data, error, reload } = useLoad(async (): Promise<ClassData[]> => {
    const courses = await store.listCourses(today);
    return Promise.all(
      courses.map(async (course) => {
        const lectures = await store.listLectures(course.id);
        const filled = new Set(lectures.map((l) => l.lecture.date));
        return { course, toFill: unfilledLectures(course, filled, now, zone) };
      }),
    );
  }, [store, today]);
  const [adding, setAdding] = useState(startAdding);
  const [deleting, setDeleting] = useState<CourseSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const thisYear = today.slice(0, 4);

  const confirmDelete = async () => {
    const course = deleting!;
    setDeleting(null);
    setProblem(null);
    try {
      await store.deleteCourse(course.id);
    } catch (err) {
      setProblem(messageOf(err));
    }
    await reload();
  };

  return (
    <section aria-labelledby="classes-title">
      <h2 id="classes-title" className="page-title">
        Classes
      </h2>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}

      {data.length === 0 && !adding && (
        <p className="muted">No classes yet. Add each class you’re taking, with its lecture times, so Honed can plan your study around them.</p>
      )}
      <ul className="class-list" aria-label="Your classes">
        {data.map(({ course, toFill }) => (
          <li key={course.id} className="class-block" data-testid="class-row">
            <div className="class-head">
              <h3 className="class-name">
                <a href={href({ name: 'class', courseId: course.id })}>{course.name}</a>
              </h3>
              <ClassMenu courseId={course.id} name={course.name} onDelete={() => setDeleting(course)} />
            </div>
            {toFill.length > 0 && (
              <ul className="date-buttons" aria-label={`Lectures to fill in for ${course.name}`}>
                {toFill.map(({ date }) => (
                  <li key={date}>
                    <a
                      className="date-button"
                      href={href({ name: 'class', courseId: course.id, cover: date })}
                      aria-label={`${course.name}, ${formatDate(date, thisYear)}: what was covered?`}
                    >
                      {shortDate(date)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <ClassEditor onCancel={() => (setAdding(false), startAdding && go({ name: 'classes' }))} onSaved={(course) => go({ name: 'class', courseId: course.id })} />
      ) : (
        <div className="add-class">
          <button type="button" className={data.length === 0 ? 'round primary' : 'round'} aria-label="Add a class" onClick={() => setAdding(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M10.5 4h3v6.5H20v3h-6.5V20h-3v-6.5H4v-3h6.5Z" />
            </svg>
          </button>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          message="Its lectures, exams and slides will be deleted from this device. This can’t be undone."
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </section>
  );
}
