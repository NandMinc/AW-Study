// The Tasks page (#/, the home page; docs/design/README.md "Tasks", #77): today's work by class, in
// the order the user drags them into, from src/plan/tasks.ts. A progress bar, Start (Play, in this
// order), and a row per class that opens to its lectures, each with its slides and its quiz. No times
// are shown (the daily minutes are in Settings). Nothing today: the penguin. A new user also gets the
// first-run tour and Getting started (#136). Exam practice (#87) is a
// row of its own above the classes, on the 2 days before an exam.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { APP_NAME } from '../brand';
import { daysBetween } from '../plan/planner';
import { STATUS_TEXT, type ClassTasks, type TaskItem } from '../plan/tasks';
import type { Exam } from '../types/lecture';
import { GettingStarted } from './GettingStarted';
import { Penguin } from './Penguin';
import { loadPlanning, type ItemPlace } from './planning';
import { href } from './route';
import { tickMemory } from './tick-memory';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

/** `tour`: opened at the first-run tour (#/tour, from Settings; #136). */
export function TasksScreen({ tour = false }: { tour?: boolean }) {
  const store = useStore();
  const { data, error } = useLoad(() => loadPlanning(store), [store]);
  const [order, setOrder] = useState<string[]>([]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const rows = useRef(new Map<string, HTMLLIElement>());
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const latest = useRef<string[]>([]); // the order as last set, for handlers bound before the re-render

  useEffect(() => {
    if (!data) return;
    latest.current = data.tasks.classes.map((c) => c.courseId);
    setOrder(latest.current);
  }, [data]);
  // Ticks done since this page was last shown draw themselves in (#153); worked out once per load
  const fresh = useMemo(() => (data ? tickMemory.fresh(data.today, doneIds(data)) : new Set<string>()), [data]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return null;
  const { tasks, place } = data;
  const byId = new Map(tasks.classes.map((c) => [c.courseId, c]));
  const classes = order.map((id) => byId.get(id)).filter((c): c is ClassTasks => c !== undefined);
  const courseNames = new Map(tasks.classes.map((c) => [c.courseId, place(c.items[0]!.item.sectionId)?.course.name]));

  const save = async (next: string[]) => {
    // The ones shown, in their new order, then any saved before that aren't on today's list
    const rest = data.classOrder.filter((id) => !next.includes(id));
    try {
      await store.saveStudySettings({ classOrder: [...next, ...rest] });
      setProblem(null);
      setSaved(`Order saved: ${next.map((id) => byId.get(id) && place(byId.get(id)!.items[0]!.item.sectionId)?.course.name).filter(Boolean).join(', ')}.`);
    } catch (err) {
      setProblem(`Couldn’t save the order: ${messageOf(err)}`);
    }
  };
  const move = (id: string, to: number) => {
    const now = latest.current;
    const from = now.indexOf(id);
    if (from === -1 || to === from || to < 0 || to >= now.length) return null;
    const next = [...now];
    next.splice(from, 1);
    next.splice(to, 0, id);
    latest.current = next;
    setOrder(next);
    return next;
  };

  // Dragging by the handle: rows swap as the finger passes their middle; saved when let go
  const onPointerDown = (id: string) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const others = latest.current.filter((id) => id !== d.id);
    const to = others.filter((id) => {
      const box = rows.current.get(id)?.getBoundingClientRect();
      return box !== undefined && box.top + box.height / 2 < e.clientY;
    }).length;
    if (move(d.id, to)) d.moved = true;
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) void save(latest.current);
  };
  const onKeyDown = (id: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = move(id, latest.current.indexOf(id) + step);
    if (next) void save(next);
  };
  const toggle = (id: string) =>
    setOpen((was) => {
      const now = new Set(was);
      if (!now.delete(id)) now.add(id);
      return now;
    });

  const left = classes.some((c) => c.status !== 'done');
  const practice = data.practice.length > 0 && (
    <ul className="task-practice" aria-label="Exam practice">
      {data.practice.map((p) => {
        const days = daysBetween(data.today, p.exam.date);
        return (
          <li key={p.exam.id} className="task-lecture" data-testid="task-practice">
            <a href={href({ name: 'practice', examId: p.exam.id })}>
              Practice for {p.course.name}’s {p.exam.title} ({days === 1 ? 'tomorrow' : `in ${days} days`})
            </a>
            {p.done && <Tick label="Practice done" fresh={fresh.has(`practice:${p.exam.id}`)} />}
          </li>
        );
      })}
    </ul>
  );
  return (
    <section className="tasks" aria-labelledby="tasks-title">
      <h2 id="tasks-title" className="page-title">
        Tasks
      </h2>
      <GettingStarted start={data.start} tour={tour} />
      {classes.length === 0 ? (
        <div className="tasks-empty">
          {practice}
          <Penguin />
          {data.hasLectures ? (
            <p data-testid="tasks-clear">Nothing to study today. Enjoy it!</p>
          ) : (
            <p className="muted" data-testid="tasks-empty">
              Nothing to study yet. Add your classes in <a href={href({ name: 'classes' })}>Classes</a>, and after each lecture tell {APP_NAME} what it
              covered.
            </p>
          )}
        </div>
      ) : (
        <>
          <progress className="tasks-progress" max={1} value={tasks.progress} aria-label="Today’s progress" data-testid="tasks-progress" />
          {left ? (
            <a className="button start" href={href({ name: 'play' })}>
              Start
            </a>
          ) : (
            <p className="tasks-done-note">All done for today.</p>
          )}
          {tasks.examsOver.length > 0 && (
            <p className="muted small" data-testid="exam-note">
              {examNote(tasks.examsOver, data.today, (id) => courseNames.get(id))}
            </p>
          )}
          <p className="visually-hidden" role="status" data-testid="order-saved">
            {saved}
          </p>
          {problem && (
            <p className="error" role="alert">
              {problem}
            </p>
          )}
          {practice}
          <ol className="task-classes" aria-label="Today’s classes">
            {classes.map((c) => {
              const name = place(c.items[0]!.item.sectionId)!.course.name;
              const isOpen = open.has(c.courseId);
              return (
                <li
                  key={c.courseId}
                  className="task-class"
                  data-testid="task-class"
                  ref={(el) => {
                    if (el) rows.current.set(c.courseId, el);
                    else rows.current.delete(c.courseId);
                  }}
                >
                  <div className="task-head">
                    <button
                      type="button"
                      className="drag-handle"
                      aria-label={`Move ${name} (hold and drag, or use the arrow keys)`}
                      onPointerDown={onPointerDown(c.courseId)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onKeyDown={onKeyDown(c.courseId)}
                    >
                      <svg viewBox="0 0 10 16" aria-hidden="true">
                        <circle cx="2.5" cy="3" r="1.6" />
                        <circle cx="7.5" cy="3" r="1.6" />
                        <circle cx="2.5" cy="8" r="1.6" />
                        <circle cx="7.5" cy="8" r="1.6" />
                        <circle cx="2.5" cy="13" r="1.6" />
                        <circle cx="7.5" cy="13" r="1.6" />
                      </svg>
                    </button>
                    <button type="button" className="task-toggle" aria-expanded={isOpen} onClick={() => toggle(c.courseId)}>
                      <span className="task-title">
                        <span className="task-name" data-testid="task-name">
                          {name}
                        </span>
                        <span className="chevron" aria-hidden="true">
                          ›
                        </span>
                      </span>
                      <span className="task-status" data-testid="task-status">
                        {c.status === 'done' ? <Tick label="Done" fresh={fresh.has(`class:${c.courseId}`)} /> : STATUS_TEXT[c.status]}
                      </span>
                    </button>
                  </div>
                  {isOpen && (
                    <ul className="task-lectures">
                      {c.items.map((t) => (
                        <LectureRow key={itemId(t)} task={t} place={place(t.item.sectionId)!} fresh={fresh.has(itemId(t))} />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

/** One lecture today: its name opens its slides, Quiz starts its quiz (a tick once done). */
function LectureRow({ task, place, fresh }: { task: TaskItem; place: ItemPlace; fresh: boolean }) {
  const { course, section, deck, lecture } = place;
  const slides = href({ name: 'slides', courseId: course.id, deckId: deck.id, first: section.firstPage, last: section.lastPage });
  return (
    <li className="task-lecture" data-testid="task-lecture">
      <a href={slides}>{lectureName(lecture.date)}</a>
      {task.done ? (
        <Tick label={task.item.kind === 'extra' ? 'Extra study done' : 'Quiz done'} fresh={fresh} />
      ) : task.item.kind === 'extra' ? (
        <span className="muted">Extra study</span>
      ) : (
        <a href={href({ name: 'quiz', courseId: course.id, sectionId: section.id })}>Quiz</a>
      )}
    </li>
  );
}

const itemId = (t: TaskItem) => `${t.item.kind}-${t.item.sectionId}`;

/** Every tick on the page today, by id: each lecture's item, each class, each exam's practice. */
function doneIds(data: { tasks: { classes: ClassTasks[] }; practice: { exam: Exam; done: boolean }[] }): string[] {
  return [
    ...data.tasks.classes.flatMap((c) => [...c.items.filter((t) => t.done).map(itemId), ...(c.status === 'done' ? [`class:${c.courseId}`] : [])]),
    ...data.practice.filter((p) => p.done).map((p) => `practice:${p.exam.id}`),
  ];
}

/** `fresh`: done since the page was last shown, so it draws itself in (#153). */
function Tick({ label, fresh = false }: { label: string; fresh?: boolean }) {
  return (
    <svg className={fresh ? 'tick tick-new' : 'tick'} viewBox="0 0 20 20" role="img" aria-label={label}>
      <path d="M4 10.5l4 4 8-9" pathLength={1} />
    </svg>
  );
}

/** "Nov 17 lecture". */
function lectureName(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return `${day} lecture`;
}

/** Why today is longer than the daily minutes (#86): "More than your daily time today, to get you ready for
 * BIO 110's Midterm 1 (in 4 days)." */
export function examNote(exams: Exam[], today: string, courseName: (id: string) => string | undefined): string {
  const each = exams.map((e) => {
    const days = daysBetween(today, e.date);
    const name = courseName(e.courseId);
    return `${name ? `${name}’s ` : ''}${e.title} (${days === 1 ? 'tomorrow' : `in ${days} days`})`;
  });
  return `More than your daily time today, to get you ready for ${each.join(' and ')}.`;
}
