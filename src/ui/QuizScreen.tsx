// A section's quiz (#40, DESIGN "Study sessions and quizzes"). Before the first quiz, the AI makes the
// section's question bank from its slide text ("Make questions"); after that, quizzes need no AI and
// work offline. One question at a time, the four options in a fresh order, instant feedback with the
// explanation and the slide it comes from (shown right here). The attempt is saved when the quiz ends.
// Loaded on demand with the viewer (PDF.js), like SlidesScreen.
import { useEffect, useRef, useState } from 'react';
import { AiError } from '../ai/backend';
import { signInUrl } from '../ai/http';
import { bankTarget, fillBank, guideForQuestions, sectionSlides, type BankProgress } from '../quiz/bank';
import { sectionStage } from '../quiz/levels';
import { describeScore, pickQuiz, QUIZ_SIZE, type QuizItem } from '../quiz/pick';
import type { Course, Section, SlideDeck } from '../types/lecture';
import type { OptionIndex, Question, QuizAttempt } from '../types/quiz';
import { SlideViewer } from '../viewer/SlideViewer';
import { useAi } from './ai-context';
import { MathText } from './MathText';
import { CompareModels } from './CompareModels';
import { slidesLabel } from './classes';
import { href } from './route';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

const LETTERS = ['A', 'B', 'C', 'D'];

export interface Setting {
  course: Course;
  section: Section;
  deck: SlideDeck;
  pageTexts: string[];
}

type Answered = { item: QuizItem; shown: number; chosen: OptionIndex; right: boolean; ms: number };

/** `compare`: opened from Settings' Compare models, with the comparison already showing. */
export default function QuizScreen({ courseId, sectionId, compare = false }: { courseId: string; sectionId: string; compare?: boolean }) {
  const store = useStore();
  const { data, error, reload } = useLoad(async () => {
    const [course, sections, decks] = await Promise.all([store.getCourse(courseId), store.listSections(courseId), store.listSlideDecks(courseId)]);
    const section = sections.find((s) => s.id === sectionId);
    const deck = section && decks.find((d) => d.id === section.deckId);
    if (!course || !section || !deck) return null;
    const [pageTexts, questions, attempts] = await Promise.all([
      store.getSlideDeckPages(deck.id),
      store.listQuestions(section.id),
      store.listQuizAttempts(section.id),
    ]);
    return { setting: { course, section, deck, pageTexts } satisfies Setting, questions, attempts };
  }, [store, courseId, sectionId]);
  const [quiz, setQuiz] = useState<{ items: QuizItem[]; startedAt: string } | null>(null);

  if (error) return <p className="error">{error}</p>;
  if (data === undefined) return <p className="muted">Loading…</p>;
  if (data === null) {
    return (
      <section>
        <h2>Quiz not found</h2>
        <p className="muted">That lecture may have been deleted.</p>
        <a className="back" href={href({ name: 'class', courseId })}>← Back</a>
      </section>
    );
  }
  const { setting, questions, attempts } = data;
  const { course, section, deck } = setting;

  return (
    <section className="quiz-screen">
      <p>
        <a className="back" href={href({ name: 'class', courseId })}>← {course.name}</a>
      </p>
      <h2>
        Quiz: {deck.title} <span className="muted small">· {slidesLabel(section.firstPage, section.lastPage)}</span>
      </h2>
      {quiz ? (
        <Quiz
          key={quiz.startedAt}
          setting={setting}
          items={quiz.items}
          startedAt={quiz.startedAt}
          onAgain={async () => {
            setQuiz(null);
            await reload();
          }}
        />
      ) : (
        <Start
          setting={setting}
          questions={questions}
          attempts={attempts}
          onStart={() => setQuiz({ items: pickQuiz(questions, attempts, QUIZ_SIZE, Math.random, sectionStage(attempts)), startedAt: new Date().toISOString() })}
          onBankChanged={reload}
          comparing={compare}
        />
      )}
    </section>
  );
}

/** Before a quiz: the bank, the last score, Start, and making (more) questions with AI. */
export function Start({
  setting,
  questions,
  attempts,
  size: wanted = QUIZ_SIZE,
  compare = true,
  comparing: startComparing = false,
  onStart,
  onBankChanged,
}: {
  setting: Setting;
  questions: Question[];
  attempts: QuizAttempt[];
  /** Questions the quiz asks (the planner's size in a study session). */
  size?: number;
  /** Offer "Compare models" (not in a study session). */
  compare?: boolean;
  /** Open with "Compare models" already showing (from Settings). */
  comparing?: boolean;
  onStart: () => void;
  onBankChanged: () => Promise<void>;
}) {
  const ai = useAi();
  const store = useStore();
  const slides = sectionSlides(setting.section, setting.pageTexts);
  const target = bankTarget(slides);
  const [progress, setProgress] = useState<BankProgress | null>(null);
  const [problem, setProblem] = useState<{ message: string; signIn: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const make = async () => {
    setProblem(null);
    abort.current = new AbortController();
    setProgress({ done: 0, total: 0, added: 0 });
    try {
      // The class's guide brought up to date first (#123; sends nothing when it's current), then the questions follow it
      const guide = await guideForQuestions(store, ai, setting.course.id, abort.current.signal);
      await fillBank({ ai, store, section: setting.section, pageTexts: setting.pageTexts, guide, onProgress: setProgress, signal: abort.current.signal });
    } catch (err) {
      if (!(err instanceof AiError && err.code === 'cancelled')) {
        setProblem({ message: messageOf(err), signIn: err instanceof AiError && err.code === 'signed-out' });
      }
    } finally {
      abort.current = null;
      setProgress(null);
      await onBankChanged();
    }
  };

  const [comparing, setComparing] = useState(startComparing && compare && slides.length > 0);
  const last = attempts[0];
  const size = Math.min(wanted, questions.length);

  return (
    <div className="stack">
      {slides.length === 0 ? (
        <p className="muted">These slides have no text to make questions from (they may be pictures only).</p>
      ) : (
        <p data-testid="bank-size">
          {questions.length === 0
            ? `No questions yet. Honed’s AI makes about ${target} from the text of these ${slides.length} ${slides.length === 1 ? 'page' : 'pages'} (more for pages with more text); it takes a minute or two, once.`
            : `${questions.length} question${questions.length === 1 ? '' : 's'} in this section’s bank.`}
        </p>
      )}
      {last && (
        <p className="muted" data-testid="last-score">
          Last quiz: {describeScore(last.right, last.asked)}
        </p>
      )}
      {progress ? (
        <div className="stack" role="status">
          <p>
            Making questions…{' '}
            {progress.total > 0 && (
              <span className="muted">
                {progress.done} of {progress.total} parts done, {progress.added} questions so far
              </span>
            )}
          </p>
          <button type="button" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        </div>
      ) : (
        <div className="row">
          {questions.length > 0 && (
            <button type="button" className="primary" onClick={onStart}>
              Start the quiz ({size} question{size === 1 ? '' : 's'})
            </button>
          )}
          {slides.length > 0 && questions.length < target && (
            <button type="button" className={questions.length === 0 ? 'primary' : ''} onClick={() => void make()}>
              {questions.length === 0 ? 'Make questions' : 'Make more questions'}
            </button>
          )}
        </div>
      )}
      {problem && (
        <div className="stack">
          <p className="error" role="alert">
            {problem.message}
          </p>
          {problem.signIn && (
            <p className="muted">
              <a href={signInUrl()} target="_blank" rel="noopener">
                Sign in for AI
              </a>{' '}
              (opens a new tab: sign in with Google, close it, then press Make questions again).
            </p>
          )}
        </div>
      )}
      {questions.length > 0 && <p className="muted small">Quizzes don’t use AI: they work offline and send nothing.</p>}
      {compare && slides.length > 0 && !progress && !comparing && (
        <p className="small">
          <button type="button" className="link" onClick={() => setComparing(true)}>
            Compare models
          </button>{' '}
          <span className="muted">(see what Haiku, Sonnet and Opus write from these slides)</span>
        </p>
      )}
      {comparing && <CompareModels setting={setting} bank={questions} onAdded={() => void onBankChanged()} onClose={() => setComparing(false)} />}
    </div>
  );
}

/** The quiz itself, one question at a time; saves the attempt at the end. */
export function Quiz({
  setting,
  items,
  startedAt,
  onAgain,
  doneLabel = 'Done',
  backLink = true,
}: {
  setting: Setting;
  items: QuizItem[];
  startedAt: string;
  onAgain: (attempt: QuizAttempt) => void;
  doneLabel?: string;
  /** "Back to <class>" beside Done (not in a study session, where Done goes on). */
  backLink?: boolean;
}) {
  const store = useStore();
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [showSlide, setShowSlide] = useState(false);
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [saved, setSaved] = useState<QuizAttempt | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shownAt = useRef(performance.now());
  const [done, setDone] = useState(false); // after "See your score", not as soon as the last answer is in

  const save = async (all: Answered[]) => {
    setProblem(null);
    try {
      setSaved(
        await store.recordQuizAttempt({
          sectionId: setting.section.id,
          startedAt,
          finishedAt: new Date().toISOString(),
          answers: all.map((a) => ({ questionId: a.item.question.id, chosen: a.chosen, ms: a.ms })),
        }),
      );
    } catch (err) {
      setProblem(messageOf(err));
    }
  };

  if (done) {
    const missed = answered.filter((a) => !a.right);
    return (
      <div className="stack" data-testid="quiz-done">
        {saved ? (
          <p className="score" data-testid="quiz-score">
            {describeScore(saved.right, saved.asked)}
          </p>
        ) : problem ? (
          <>
            <p className="error" role="alert">
              Couldn’t save this quiz: {problem}
            </p>
            <button type="button" onClick={() => void save(answered)}>
              Try saving again
            </button>
          </>
        ) : (
          <p className="muted">Saving…</p>
        )}
        {missed.length > 0 && (
          <>
            <h3>To look at again</h3>
            <ul className="list">
              {missed.map((a) => (
                <li key={a.item.question.id} className="item">
                  <div className="item-main">
                    <span>
                      <MathText text={a.item.question.question} />
                    </span>
                    <span className="small">
                      Answer: <MathText text={a.item.question.options[a.item.question.answer]} />{' '}
                      <a href={href({ name: 'slides', courseId: setting.course.id, deckId: setting.deck.id, first: a.item.question.page, last: a.item.question.page })}>
                        slide {a.item.question.page}
                      </a>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="row">
          <button type="button" className="primary" onClick={() => saved && onAgain(saved)} disabled={!saved}>
            {doneLabel}
          </button>
          {backLink && (
            <a className="button" href={href({ name: 'class', courseId: setting.course.id })}>
              Back to {setting.course.name}
            </a>
          )}
        </div>
      </div>
    );
  }

  const item = items[index]!;
  const { question } = item;
  const current = answered[index];

  const choose = (shown: number) => {
    if (current) return;
    const chosen = item.order[shown]!;
    const next = [...answered, { item, shown, chosen, right: chosen === question.answer, ms: performance.now() - shownAt.current }];
    setAnswered(next);
  };

  const goOn = () => {
    setShowSlide(false);
    if (index + 1 < items.length) {
      setIndex(index + 1);
      shownAt.current = performance.now();
    } else {
      setDone(true);
      void save(answered);
    }
  };

  const openSlide = async () => {
    setShowSlide(true);
    if (!pdf) setPdf(await store.getSlideDeckFile(setting.deck.id));
  };

  return (
    <div className="stack quiz" data-testid="quiz-question">
      <p className="muted small" data-testid="quiz-position">
        Question {index + 1} of {items.length}
      </p>
      <p className="question">
        <MathText text={question.question} />
      </p>
      <div className="options" role="group" aria-label="Answers">
        {item.order.map((stored, shown) => {
          const state = !current ? '' : stored === question.answer ? 'right' : shown === current.shown ? 'wrong' : 'other';
          return (
            <button key={stored} type="button" className={`option ${state}`} disabled={!!current} aria-pressed={current?.shown === shown} onClick={() => choose(shown)}>
              <span className="letter">{LETTERS[shown]}</span> <MathText text={question.options[stored]} />
            </button>
          );
        })}
      </div>
      {current && (
        <div className="stack feedback" role="status" data-testid="quiz-feedback">
          <p className={current.right ? 'verdict right' : 'verdict wrong'}>
            {current.right ? (
              'Right.'
            ) : (
              <>
                Not quite. The answer is {LETTERS[item.order.indexOf(question.answer)]}: <MathText text={question.options[question.answer]} />.
              </>
            )}
          </p>
          {question.explanation && (
            <p>
              <MathText text={question.explanation} />
            </p>
          )}
          <div className="row">
            <button type="button" className="primary" onClick={goOn} autoFocus>
              {index + 1 < items.length ? 'Next question' : 'See your score'}
            </button>
            {!showSlide && (
              <button type="button" onClick={() => void openSlide()}>
                Show slide {question.page}
              </button>
            )}
          </div>
          {showSlide && (
            <div className="quiz-slide">
              {pdf ? <SlideViewer pdf={pdf} page={question.page} range={{ first: question.page, last: question.page }} /> : <p className="muted">Opening the slide…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
