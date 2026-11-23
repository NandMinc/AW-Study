// The first run on Tasks (#136): the Getting started checklist (a class, a lecture's slides, a first study
// session; each ticks itself from the data, and each not done links to where to do it), and the tour of the main
// ideas, which opens by itself once for someone with no classes, and again from Settings (#/tour). The rules are
// in ./getting-started.ts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { APP_NAME } from '../brand';
import {
  CHECKLIST_SKIPPED_KEY,
  deviceStorage,
  readFlag,
  setFlag,
  showChecklist,
  startSteps,
  TOUR,
  TOUR_SEEN_KEY,
  tourByItself,
  type StartProgress,
  type StepId,
} from './getting-started';
import { go, href } from './route';

/** `tour`: opened from Settings ("How Honed works", #/tour). */
export function GettingStarted({ start, tour = false }: { start: StartProgress; tour?: boolean }) {
  const [skipped, setSkipped] = useState(() => readFlag(deviceStorage(), CHECKLIST_SKIPPED_KEY));
  const [touring, setTouring] = useState(() => tour || tourByItself(start, readFlag(deviceStorage(), TOUR_SEEN_KEY)));
  useEffect(() => {
    if (tour) setTouring(true);
  }, [tour]);

  const closeTour = () => {
    setFlag(deviceStorage(), TOUR_SEEN_KEY);
    setTouring(false);
    if (tour) go({ name: 'tasks' });
  };

  return (
    <>
      {showChecklist(start, skipped) && (
        <section className="getting-started" aria-labelledby="getting-started-title" data-testid="getting-started">
          <h3 id="getting-started-title">Getting started</h3>
          <ol className="start-steps">
            {startSteps(start).map((s) => (
              <li key={s.id} className={s.done ? 'done' : ''} data-testid="start-step">
                <span className="start-mark">{s.done ? <Tick label="Done" /> : <span aria-hidden="true">·</span>}</span>
                <Step id={s.id} done={s.done} start={start} />
              </li>
            ))}
          </ol>
          <div className="row">
            <button type="button" className="link" onClick={() => setTouring(true)}>
              How {APP_NAME} works
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setFlag(deviceStorage(), CHECKLIST_SKIPPED_KEY);
                setSkipped(true);
              }}
            >
              Skip this
            </button>
          </div>
        </section>
      )}
      {touring && <Tour onClose={closeTour} />}
    </>
  );
}

function Step({ id, done, start }: { id: StepId; done: boolean; start: StartProgress }) {
  switch (id) {
    case 'class':
      return (
        <span className="start-text">
          Add your first class, with when it meets.{' '}
          {!done && <a href={href({ name: 'classes', adding: true })}>Add a class</a>}
        </span>
      );
    case 'lecture':
      return (
        <span className="start-text">
          After a lecture, add its slides and what it covered.{' '}
          {!done && start.courseId && <a href={href({ name: 'class', courseId: start.courseId })}>Add what a lecture covered</a>}
        </span>
      );
    case 'study':
      return (
        <span className="start-text">
          Do your first study session: it’s on this page from the day after the lecture. Press Start.
        </span>
      );
  }
}

/** The tour: three cards, Back and Next, Done on the last; Close, Escape or a tap outside closes it. */
function Tour({ onClose }: { onClose: () => void }) {
  const [card, setCard] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const last = card === TOUR.length - 1;

  // Escape closes. Added before the tour is painted, once, reading the latest onClose (PROGRESS, Gotchas: #129)
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => next.current?.focus(), [card]);

  const { title, text } = TOUR[card]!;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog tour"
        role="dialog"
        aria-modal="true"
        aria-label={`How ${APP_NAME} works`}
        data-testid="tour"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="muted small" data-testid="tour-position">
          {card + 1} of {TOUR.length}
        </p>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="row end">
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
          {card > 0 && (
            <button type="button" onClick={() => setCard(card - 1)}>
              Back
            </button>
          )}
          <button type="button" className="primary" ref={next} onClick={() => (last ? onClose() : setCard(card + 1))}>
            {last ? 'Let’s go' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tick({ label }: { label: string }) {
  return (
    <svg className="tick" viewBox="0 0 20 20" role="img" aria-label={label}>
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}
