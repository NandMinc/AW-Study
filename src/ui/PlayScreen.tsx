// Play (#47, DESIGN "Study sessions and quizzes"): runs through today's checklist in order. A study item
// is the section's slides with a quiet timer; at 80% of its time the quiz is offered, and "I'm ready"
// starts it at any point. A quiz item is just the quiz; extra study is the slides alone. Each session
// and quiz is saved as it ends; "Stop for now" leaves the rest on the list. Loaded on demand with the
// viewer (PDF.js).
import { useEffect, useRef, useState } from 'react';
import type { StudyStore } from '../db/store';
import { sectionStage, type Stage } from '../quiz/levels';
import { QUIZ_SIZE } from '../quiz/pick';
import { useAi } from './ai-context';
import type { PlanItem } from '../plan/planner';
import type { Question, QuizAttempt } from '../types/quiz';
import { DeckSlides } from './DeckSlides';
import { describeItem, loadPlanning, type ItemPlace } from './planning';
import { Quiz, Start, type Setting } from './QuizScreen';
import { startQuiz, type StartedQuiz } from '../quiz/start';
import { href } from './route';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

/** The quiz is offered at this share of a study session's time. */
const QUIZ_AT = 0.8;

export default function PlayScreen() {
  const store = useStore();
  // Today's list as it was when Play was pressed: it doesn't shift while you work through it
  const { data, error } = useLoad(() => loadPlanning(store), [store]);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(0);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Getting today ready…</p>;
  // The Tasks page's list, in its order, without what's done (#77)
  const tasks = data.tasks.classes.flatMap((c) => c.items).filter((t) => !t.done);
  const items = tasks.map((t) => t.item);

  if (index >= items.length) {
    return (
      <section className="stack" data-testid="play-done">
        <h2>{items.length === 0 ? 'Nothing to do right now' : 'Done for today'}</h2>
        {items.length > 0 && (
          <p>
            {finished} of {items.length} item{items.length === 1 ? '' : 's'} done. The planner has set when each comes back.
          </p>
        )}
        <a className="button primary" href={href({ name: 'tasks' })}>
          Home
        </a>
      </section>
    );
  }

  const item = items[index]!;
  const place = data.place(item.sectionId)!;
  const next = () => {
    setFinished((n) => n + 1);
    setIndex((i) => i + 1);
  };
  return (
    <section className="play">
      <div className="row play-bar">
        <span className="muted small" data-testid="play-position">
          {index + 1} of {items.length}
        </span>
        <a className="button" href={href({ name: 'tasks' })}>
          Stop for now
        </a>
      </div>
      <h2 className="play-title">{describeItem(item, place).title}</h2>
      <PlayItem
        key={`${index}-${item.kind}-${item.sectionId}`}
        item={item}
        read={tasks[index]!.studiedMinutes > 0}
        place={place}
        store={store}
        onDone={next}
        last={index === items.length - 1}
      />
    </section>
  );
}

/** One item: the session (study, extra) and/or the quiz (study, quiz). */
function PlayItem({
  item,
  read,
  place,
  store,
  onDone,
  last,
}: {
  item: PlanItem;
  /** Its slides were already read today (a session saved, no quiz yet): straight to the quiz. */
  read: boolean;
  place: ItemPlace;
  store: StudyStore;
  onDone: () => void;
  last: boolean;
}) {
  const [phase, setPhase] = useState<'study' | 'quiz'>(item.kind === 'quiz' || (item.kind === 'study' && read) ? 'quiz' : 'study');
  if (phase === 'study') {
    return <StudyTime item={item} place={place} store={store} onEnd={() => (item.kind === 'extra' ? onDone() : setPhase('quiz'))} />;
  }
  return <PlayQuiz place={place} size={'quizSize' in item ? item.quizSize : QUIZ_SIZE} stage={'stage' in item ? item.stage : undefined} onDone={onDone} last={last} />;
}

function StudyTime({ item, place, store, onEnd }: { item: PlanItem; place: ItemPlace; store: StudyStore; onEnd: () => void }) {
  const { data: pdf, error } = useLoad(() => store.getSlideDeckFile(place.deck.id), [store, place.deck.id]);
  const startedAt = useRef(new Date());
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState(place.section.firstPage);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const total = item.minutes * 60_000;
  const spent = Math.max(0, now - startedAt.current.getTime());
  const left = Math.max(0, total - spent);
  const offerQuiz = item.kind === 'study' && spent >= QUIZ_AT * total;
  const timeUp = spent >= total;

  const end = async () => {
    setSaving(true);
    setProblem(null);
    try {
      const finishedAt = new Date();
      await store.recordStudySession({
        sectionId: place.section.id,
        kind: item.kind === 'extra' ? 'extra' : 'first-week',
        step: item.kind === 'study' ? item.step : null,
        startedAt: startedAt.current.toISOString(),
        finishedAt: finishedAt.toISOString(),
        minutes: Math.min(600, Math.round((finishedAt.getTime() - startedAt.current.getTime()) / 60_000)),
      });
      onEnd();
    } catch (err) {
      setProblem(messageOf(err));
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <span className="timer" role="timer" aria-label="Study time left" data-testid="study-timer">
          {formatClock(left)} left
        </span>
        <button type="button" className={offerQuiz || timeUp ? 'primary' : ''} onClick={() => void end()} disabled={saving}>
          {item.kind === 'extra' ? 'Done studying' : 'I’m ready for the quiz'}
        </button>
      </div>
      {(offerQuiz || (item.kind === 'extra' && timeUp)) && (
        <p className="prompt" role="status" data-testid="study-prompt">
          {item.kind === 'extra' ? 'That’s the extra time done. Keep going, or finish when you like.' : 'Time for the quiz, when you’re ready. Or take a few more minutes.'}
        </p>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="session-frame">
        {pdf ? (
          <DeckSlides deckId={place.deck.id} pdf={pdf} page={page} range={{ first: place.section.firstPage, last: place.section.lastPage }} onPageChange={setPage} />
        ) : (
          <p className="muted">Opening the slides…</p>
        )}
      </div>
    </div>
  );
}

/** `stage` (#123): the planner's, so the quiz asks that stage's levels; without one, worked out from the section's quizzes. */
function PlayQuiz({ place, size, stage, onDone, last }: { place: ItemPlace; size: number; stage?: Stage; onDone: () => void; last: boolean }) {
  const store = useStore();
  const { data, error, reload } = useLoad(async () => {
    const [pageTexts, questions, attempts] = await Promise.all([
      store.getSlideDeckPages(place.deck.id),
      store.listQuestions(place.section.id),
      store.listQuizAttempts(place.section.id),
    ]);
    return { setting: { course: place.course, section: place.section, deck: place.deck, pageTexts } satisfies Setting, questions, attempts };
  }, [store, place.section.id]);
  const ai = useAi();
  const [quiz, setQuiz] = useState<StartedQuiz | null>(null);
  const begin = async (questions: Question[], attempts: QuizAttempt[]) => setQuiz(await startQuiz(ai, questions, attempts, size, stage ?? sectionStage(attempts)));

  // Straight into the quiz when the bank has questions
  useEffect(() => {
    if (data && !quiz && data.questions.length > 0) void begin(data.questions, data.attempts);
  }, [data]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Getting the quiz ready…</p>;
  if (quiz) {
    return <Quiz setting={data.setting} items={quiz.items} startedAt={quiz.startedAt} note={quiz.note} onAgain={onDone} doneLabel={last ? 'Finish' : 'Next'} backLink={false} />;
  }
  return (
    <div className="stack">
      <p>These slides have no quiz questions yet: make them now (it uses AI), or skip the quiz this time.</p>
      <Start setting={data.setting} questions={data.questions} attempts={data.attempts} size={size} compare={false} onStart={() => void begin(data.questions, data.attempts)} onBankChanged={reload} />
      <button type="button" onClick={onDone}>
        Skip the quiz
      </button>
    </div>
  );
}

function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1_000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
