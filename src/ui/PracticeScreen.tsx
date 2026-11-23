// Exam practice (#87, DESIGN "Tests and exam practice"): on the 2 days before an exam, a mixed test across
// the sections it covers. The AI writes the short-answer questions when it starts (not banked); the
// multiple choice comes from each section's bank. Questions are answered without feedback, like an exam;
// at the end the AI marks the short answers, and one attempt per section is saved (src/quiz/practice.ts).
// A mark is never made up: if marking fails, the short answers that weren't marked are left out.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AiError, type WrittenQuestion } from '../ai/backend';
import { signInUrl } from '../ai/http';
import { daysBetween, type PracticeItem } from '../plan/planner';
import { describeScore } from '../quiz/pick';
import {
  attemptInputs,
  canAsk,
  gradeSlides,
  isBlank,
  practiceQuestions,
  writtenPages,
  type Mark,
  type PracticeAnswer,
  type PracticeQuestion,
  type PracticeSection,
} from '../quiz/practice';
import type { Course, Exam } from '../types/lecture';
import type { OptionIndex, QuizAttempt } from '../types/quiz';
import { useAi } from './ai-context';
import { MathText } from './MathText';
import { slidesLabel } from './classes';
import { loadPlanning, type ItemPlace } from './planning';
import { href } from './route';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

const LETTERS = ['A', 'B', 'C', 'D'];

interface Loaded {
  item: PracticeItem;
  done: boolean;
  exam: Exam;
  course: Course;
  today: string;
  sections: PracticeSection[];
  place: (sectionId: string) => ItemPlace | undefined;
}

type Problem = { message: string; signIn: boolean };
const problemOf = (err: unknown): Problem => ({ message: messageOf(err), signIn: err instanceof AiError && err.code === 'signed-out' });
const cancelled = (err: unknown) => err instanceof AiError && err.code === 'cancelled';

export default function PracticeScreen({ examId }: { examId: string }) {
  const store = useStore();
  const { data, error } = useLoad(async (): Promise<Loaded | null> => {
    const planning = await loadPlanning(store);
    const found = planning.practice.find((p) => p.item.examId === examId);
    if (!found) return null;
    const pages = new Map<string, string[]>();
    const sections: PracticeSection[] = [];
    for (const id of found.item.sectionIds) {
      const place = planning.place(id)!;
      if (!pages.has(place.deck.id)) pages.set(place.deck.id, await store.getSlideDeckPages(place.deck.id));
      const [bank, attempts] = await Promise.all([store.listQuestions(id), store.listQuizAttempts(id)]);
      const s: PracticeSection = { section: place.section, pageTexts: pages.get(place.deck.id)!, bank, attempts };
      if (canAsk(s)) sections.push(s);
    }
    return { ...found, today: planning.today, sections, place: planning.place };
  }, [store, examId]);
  const [test, setTest] = useState<{ questions: PracticeQuestion[]; startedAt: string } | null>(null);
  const [answers, setAnswers] = useState<PracticeAnswer[] | null>(null);

  if (error) return <p className="error">{error}</p>;
  if (data === undefined) return <p className="muted">Loading…</p>;
  const back = (
    <p>
      <a className="back" href={href({ name: 'tasks' })}>
        ← Tasks
      </a>
    </p>
  );
  if (data === null || data.sections.length === 0) {
    return (
      <section>
        {back}
        <h2>No practice today</h2>
        <p className="muted">{data === null ? 'Exam practice is on the 2 days before an exam.' : 'Its lectures have no questions or slide text to ask about yet.'}</p>
      </section>
    );
  }
  const days = daysBetween(data.today, data.exam.date);

  return (
    <section className="practice-screen">
      {back}
      <h2>
        Practice: {data.course.name} · {data.exam.title}{' '}
        <span className="muted small">· {days === 1 ? 'tomorrow' : `in ${days} days`}</span>
      </h2>
      {answers && test ? (
        <Finish loaded={data} answers={answers} startedAt={test.startedAt} />
      ) : test ? (
        <Test questions={test.questions} onFinish={setAnswers} />
      ) : (
        <Start loaded={data} onStart={(questions) => setTest({ questions, startedAt: new Date().toISOString() })} />
      )}
    </section>
  );
}

/** What the practice covers, then the AI writes its short answers (one request a section) and it starts. */
function Start({ loaded, onStart }: { loaded: Loaded; onStart: (questions: PracticeQuestion[]) => void }) {
  const ai = useAi();
  const { item, sections } = loaded;
  const [written, setWritten] = useState<ReadonlyMap<string, WrittenQuestion[]>>(new Map());
  const [writing, setWriting] = useState<number | null>(null); // sections written so far, while writing
  const [problem, setProblem] = useState<Problem | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const toWrite = sections.filter((s) => writtenPages(s).length > 0);
  const choices = sections.reduce((n, s) => n + Math.min(item.mcPerSection, s.bank.length), 0);
  const shorts = toWrite.length * item.writtenPerSection;

  const start = async () => {
    setProblem(null);
    abort.current = new AbortController();
    const have = new Map(written);
    setWriting(have.size);
    try {
      for (const s of toWrite) {
        if (have.has(s.section.id)) continue;
        const questions = await ai.makeWrittenQuestions({ pages: writtenPages(s), count: item.writtenPerSection }, abort.current.signal);
        have.set(s.section.id, questions);
        setWritten(new Map(have)); // kept, so Try again carries on from here
        setWriting(have.size);
      }
      onStart(practiceQuestions(sections, have, item.mcPerSection));
    } catch (err) {
      if (!cancelled(err)) setProblem(problemOf(err));
    } finally {
      abort.current = null;
      setWriting(null);
    }
  };

  return (
    <div className="stack">
      {loaded.done && <p className="muted">You’ve done this practice today. You can do it again; each one counts.</p>}
      <p data-testid="practice-size">
        {choices > 0 && `${choices} multiple-choice`}
        {choices > 0 && shorts > 0 && ' and '}
        {shorts > 0 && `${shorts} short-answer`} question{choices + shorts === 1 ? '' : 's'} on {sections.length} part
        {sections.length === 1 ? '' : 's'} of the exam, about {item.minutes} min. No answers are shown until the end, like the exam.
      </p>
      <ul className="list" aria-label="What it covers">
        {sections.map((s) => {
          const place = loaded.place(s.section.id)!;
          return (
            <li key={s.section.id} className="item" data-testid="practice-section">
              {place.deck.title}, {slidesLabel(s.section.firstPage, s.section.lastPage)}
            </li>
          );
        })}
      </ul>
      {shorts > 0 && <p className="muted small">The AI writes the short-answer questions from the slides now, and marks your answers at the end.</p>}
      {writing !== null ? (
        <div className="stack" role="status">
          <p>
            Writing the short-answer questions… <span className="muted">{writing} of {toWrite.length} parts done</span>
          </p>
          <button type="button" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="primary" onClick={() => void start()}>
            {problem ? 'Try again' : 'Start the practice'}
          </button>
          {problem && choices > 0 && (
            <button type="button" onClick={() => onStart(practiceQuestions(sections, new Map(), item.mcPerSection))}>
              Practise without short answers
            </button>
          )}
        </div>
      )}
      {problem && <ProblemNote problem={problem} what="the short-answer questions couldn’t be written" />}
    </div>
  );
}

/** The questions, one at a time, with no feedback until the end. */
function Test({ questions, onFinish }: { questions: PracticeQuestion[]; onFinish: (answers: PracticeAnswer[]) => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<PracticeAnswer[]>([]);
  const [chosen, setChosen] = useState<OptionIndex | null>(null);
  const [text, setText] = useState('');
  const shownAt = useRef(performance.now());
  const q = questions[index]!;
  const last = index + 1 === questions.length;

  const next = () => {
    const ms = performance.now() - shownAt.current;
    const answer: PracticeAnswer =
      q.kind === 'choice' ? { kind: 'choice', sectionId: q.sectionId, item: q.item, chosen: chosen!, ms } : { kind: 'written', sectionId: q.sectionId, question: q.question, answer: text, ms };
    const all = [...answers, answer];
    if (last) return onFinish(all);
    setAnswers(all);
    setChosen(null);
    setText('');
    setIndex(index + 1);
    shownAt.current = performance.now();
  };

  return (
    <div className="stack quiz" data-testid="practice-question">
      <p className="muted small" data-testid="practice-position">
        Question {index + 1} of {questions.length}
      </p>
      <p className="question">
        <MathText text={q.kind === 'choice' ? q.item.question.question : q.question.question} />
      </p>
      {q.kind === 'choice' ? (
        <div className="options" role="group" aria-label="Answers">
          {q.item.order.map((stored, shown) => (
            <button key={stored} type="button" className={`option${chosen === stored ? ' chosen' : ''}`} aria-pressed={chosen === stored} onClick={() => setChosen(stored)}>
              <span className="letter">{LETTERS[shown]}</span> <MathText text={q.item.question.options[stored]} />
            </button>
          ))}
        </div>
      ) : (
        <label className="stack">
          <span className="muted small">Your answer (a few sentences)</span>
          <textarea key={index} rows={5} maxLength={4_000} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={next} disabled={q.kind === 'choice' && chosen === null}>
          {last ? 'Finish and mark' : 'Next question'}
        </button>
      </div>
    </div>
  );
}

/** Marks the short answers with the AI, saves one attempt per section, and shows how it went. */
function Finish({ loaded, answers, startedAt }: { loaded: Loaded; answers: PracticeAnswer[]; startedAt: string }) {
  const ai = useAi();
  const store = useStore();
  const finishedAt = useMemo(() => new Date().toISOString(), []);
  const [marks, setMarks] = useState<ReadonlyMap<number, Mark>>(new Map());
  const [step, setStep] = useState<'marking' | 'mark-failed' | 'saving' | 'save-failed' | 'saved'>('marking');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [skipped, setSkipped] = useState(0); // short answers left unmarked
  const saved = useRef(new Map<string, QuizAttempt>()); // by section, so a retry saves only the rest
  const abort = useRef<AbortController | null>(null);
  const bySection = useMemo(() => new Map(loaded.sections.map((s) => [s.section.id, s])), [loaded.sections]);
  const writtenCount = answers.filter((a) => a.kind === 'written').length;

  const save = async (final: ReadonlyMap<number, Mark>) => {
    setStep('saving');
    setProblem(null);
    try {
      for (const input of attemptInputs(loaded.exam.id, answers, final, { startedAt, finishedAt })) {
        if (!saved.current.has(input.sectionId)) saved.current.set(input.sectionId, await store.recordQuizAttempt(input));
      }
      setStep('saved');
    } catch (err) {
      setProblem({ message: messageOf(err), signIn: false });
      setStep('save-failed');
    }
  };

  const mark = async () => {
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    // Let a cancel in the same moment land first (React's StrictMode mounts, unmounts and mounts again
    // at once in development): a cancelled run stops before it asks or saves anything
    await Promise.resolve();
    if (controller.signal.aborted) return;
    setStep('marking');
    setProblem(null);
    const have = new Map(marks);
    try {
      for (const [i, a] of answers.entries()) {
        if (a.kind !== 'written' || have.has(i)) continue;
        if (isBlank(a.answer)) {
          have.set(i, { mark: 0, feedback: 'No answer was given.' });
        } else {
          const slides = gradeSlides(bySection.get(a.sectionId)!, a.question.page);
          const grade = await ai.gradeAnswer({ question: a.question.question, points: a.question.points, answer: a.answer, slides }, controller.signal);
          have.set(i, { mark: grade.mark, feedback: grade.feedback });
        }
        setMarks(new Map(have));
      }
      if (controller.signal.aborted) return;
      await save(have);
    } catch (err) {
      if (cancelled(err) || controller.signal.aborted) return;
      setProblem(problemOf(err));
      setStep('mark-failed');
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  // Marking starts on arrival; leaving the page stops it
  useEffect(() => {
    void mark();
    return () => abort.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival

  if (step === 'marking' || step === 'saving') {
    const marked = [...marks.keys()].length;
    return (
      <p className="muted" role="status">
        {step === 'marking' ? `Marking your short answers… ${marked} of ${writtenCount}` : 'Saving…'}
      </p>
    );
  }
  if (step === 'mark-failed') {
    const unmarked = writtenCount - marks.size;
    return (
      <div className="stack" data-testid="practice-mark-failed">
        <ProblemNote problem={problem!} what={`${unmarked} short answer${unmarked === 1 ? '' : 's'} couldn’t be marked`} />
        <div className="row">
          <button type="button" className="primary" onClick={() => void mark()}>
            Try marking again
          </button>
          <button
            type="button"
            onClick={() => {
              setSkipped(unmarked);
              void save(marks);
            }}
          >
            Save without them
          </button>
        </div>
        <p className="muted small">Saved without them, the short answers that weren’t marked don’t count. Your multiple-choice answers are kept either way.</p>
      </div>
    );
  }
  if (step === 'save-failed') {
    return (
      <div className="stack">
        <p className="error" role="alert">
          Couldn’t save this practice: {problem?.message}
        </p>
        <button type="button" className="primary" onClick={() => void save(marks)}>
          Try saving again
        </button>
      </div>
    );
  }

  const attempts = [...saved.current.values()];
  const right = Math.round(attempts.reduce((n, a) => n + a.right, 0) * 100) / 100;
  const asked = attempts.reduce((n, a) => n + a.asked, 0);
  return (
    <div className="stack" data-testid="practice-done">
      {asked > 0 ? (
        <p className="score" data-testid="practice-score">
          {describeScore(right, asked)}
        </p>
      ) : (
        <p className="muted" data-testid="practice-score">
          Nothing could be marked, so nothing was saved.
        </p>
      )}
      {skipped > 0 && (
        <p className="muted small" data-testid="practice-skipped">
          {skipped} short answer{skipped === 1 ? ' wasn’t' : 's weren’t'} marked, so {skipped === 1 ? 'it doesn’t' : 'they don’t'} count.
        </p>
      )}
      <ol className="list practice-review" aria-label="Your answers">
        {answers.map((a, i) => (
          <li key={i} className="item" data-testid="practice-review">
            <Review answer={a} mark={marks.get(i)} />
          </li>
        ))}
      </ol>
      <div className="row">
        <a className="button primary" href={href({ name: 'tasks' })}>
          Done
        </a>
      </div>
    </div>
  );
}

function Review({ answer: a, mark }: { answer: PracticeAnswer; mark: Mark | undefined }) {
  if (a.kind === 'choice') {
    const { question } = a.item;
    const right = a.chosen === question.answer;
    return (
      <div className="item-main">
        <span>
          <MathText text={question.question} />
        </span>
        <span className={`small verdict ${right ? 'right' : 'wrong'}`}>
          {right ? 'Right: ' : 'Not quite. The answer: '}
          <MathText text={question.options[question.answer]} />
        </span>
      </div>
    );
  }
  return (
    <div className="item-main">
      <span>
        <MathText text={a.question.question} />
      </span>
      <span className="small" data-testid="practice-mark">
        {mark ? `${mark.mark} of ${a.question.points.length} points. ${mark.feedback}` : 'Not marked.'}
      </span>
      <span className="small muted">
        A full answer: <MathText text={a.question.points.join('; ')} />
      </span>
    </div>
  );
}

function ProblemNote({ problem, what }: { problem: Problem; what: string }) {
  return (
    <div className="stack">
      <p className="error" role="alert">
        {problem.message} ({what})
      </p>
      {problem.signIn && (
        <p className="muted">
          <a href={signInUrl()} target="_blank" rel="noopener">
            Sign in for AI
          </a>{' '}
          (opens a new tab: sign in with Google, close it, then try again).
        </p>
      )}
    </div>
  );
}
