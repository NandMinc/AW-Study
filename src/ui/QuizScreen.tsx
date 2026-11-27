// A section's quiz (#40, DESIGN "Study sessions and quizzes"). Before the first quiz, the AI makes the
// section's question bank from its slide text ("Make questions"); after that, quizzes need no AI and
// work offline. One question at a time, the four options in a fresh order, instant feedback with the
// explanation and the slide it comes from (shown right here). The attempt is saved when the quiz ends.
// Loaded on demand with the viewer (PDF.js), like SlidesScreen.
import { useEffect, useRef, useState } from 'react';
import { SHORT_TYPED_MAX } from '../db/quiz';
import { AiError, type Grade } from '../ai/backend';
import { signInUrl } from '../ai/http';
import { bankTarget, fillBank, guideForQuestions, sectionSlides, type BankProgress } from '../quiz/bank';
import { sectionStage } from '../quiz/levels';
import { describeScore, isShortItem, QUIZ_SIZE, type PickedItem, type QuizItem, type ShortItem } from '../quiz/pick';
import { startQuiz, type StartedQuiz } from '../quiz/start';
import type { Course, Section, SlideDeck } from '../types/lecture';
import type { OptionIndex, Question, QuizAttempt } from '../types/quiz';
import { SlideViewer } from '../viewer/SlideViewer';
import { useAi } from './ai-context';
import { questionsBeingWritten } from '../reading/pending';
import { QuizWaitingNote } from './QuizWaiting';
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

type ChoiceAnswered = { kind: 'choice'; item: QuizItem; shown: number; chosen: OptionIndex; right: boolean; ms: number };
/** A short answer (#124): kept as typed, marked by the AI with the others when the quiz ends. */
type ShortAnswered = { kind: 'short'; item: ShortItem; typed: string; ms: number };
type Answered = ChoiceAnswered | ShortAnswered;

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
  const ai = useAi();
  const [quiz, setQuiz] = useState<StartedQuiz | null>(null);

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
          note={quiz.note}
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
          onStart={async () => setQuiz(await startQuiz(ai, questions, attempts, QUIZ_SIZE, sectionStage(attempts)))}
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
  // Questions being written in the background (#177): say when they'll be ready rather than make them twice
  const { data: writingMap } = useLoad(() => questionsBeingWritten(store, [setting.section.id]), [store, setting.section.id, questions.length]);
  const writing = questions.length === 0 ? writingMap?.get(setting.section.id) : undefined;
  const studyHref = href({ name: 'slides', courseId: setting.course.id, deckId: setting.deck.id, first: setting.section.firstPage, last: setting.section.lastPage });

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
          Last quiz: {describeScore(last.right, last.asked, last.score)}
        </p>
      )}
      {writing && !progress ? (
        <QuizWaitingNote writing={writing} slides={slidesLabel(setting.section.firstPage, setting.section.lastPage)} studyHref={studyHref} />
      ) : progress ? (
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
  note = null,
  onAgain,
  doneLabel = 'Done',
  backLink = true,
}: {
  setting: Setting;
  items: PickedItem[];
  startedAt: string;
  /** Why this quiz has no short answers when its bank does (#124: the AI couldn't be reached to mark them). */
  note?: string | null;
  /** Done: the saved attempt, or null when nothing could be saved (only short answers, and marking failed). */
  onAgain: (attempt: QuizAttempt | null) => void;
  doneLabel?: string;
  /** "Back to <class>" beside Done (not in a study session, where Done goes on). */
  backLink?: boolean;
}) {
  const store = useStore();
  const ai = useAi();
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [typed, setTyped] = useState('');
  const [showSlide, setShowSlide] = useState(false);
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [saved, setSaved] = useState<QuizAttempt | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Short answers (#124): marked by the AI in one request at the end; `marks` in the order they were asked
  const [marks, setMarks] = useState<Grade[] | null>(null);
  const [marking, setMarking] = useState<{ state: 'running' } | { state: 'failed'; message: string; signIn: boolean } | null>(null);
  const [withoutShort, setWithoutShort] = useState(false);
  const shownAt = useRef(performance.now());
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const [done, setDone] = useState(false); // after "See your score", not as soon as the last answer is in

  const choicesOf = (all: Answered[]) => all.filter((a): a is ChoiceAnswered => a.kind === 'choice');
  const shortsOf = (all: Answered[]) => all.filter((a): a is ShortAnswered => a.kind === 'short');
  const choices = choicesOf(answered);
  const shorts = shortsOf(answered);

  // Both take the whole list: the last answer may have been added in the same click (a short answer's Next)
  const save = async (all: Answered[], shortMarks: Grade[] | null) => {
    const choices = choicesOf(all);
    const shorts = shortsOf(all);
    setProblem(null);
    try {
      setSaved(
        await store.recordQuizAttempt({
          sectionId: setting.section.id,
          startedAt,
          finishedAt: new Date().toISOString(),
          answers: choices.map((a) => ({ questionId: a.item.question.id, chosen: a.chosen, ms: a.ms })),
          ...(shortMarks && shorts.length > 0 && {
            short: shorts.map((a, i) => ({ questionId: a.item.question.id, typed: a.typed, mark: shortMarks[i]!.mark, feedback: shortMarks[i]!.feedback, ms: a.ms })),
          }),
        }),
      );
    } catch (err) {
      setProblem(messageOf(err));
    }
  };

  /** Marks the short answers (a blank one is 0 and never sent), then saves. */
  const markAndSave = async (all: Answered[]) => {
    const shorts = shortsOf(all);
    if (shorts.length === 0) return save(all, null);
    setMarking({ state: 'running' });
    abort.current = new AbortController();
    try {
      const sent = shorts.map((a, i) => ({ a, i })).filter(({ a }) => a.typed.trim() !== '');
      const pages = new Set(sent.flatMap(({ a }) => [a.item.question.page - 1, a.item.question.page, a.item.question.page + 1]));
      const grades = sent.length
        ? await ai.gradeMany(
            {
              slides: sectionSlides(setting.section, setting.pageTexts).filter((s) => pages.has(s.page)),
              items: sent.map(({ a }) => ({ question: a.item.question.question, points: a.item.question.points, answer: a.typed.trim(), page: a.item.question.page })),
            },
            abort.current.signal,
          )
        : [];
      const graded: Grade[] = shorts.map((a) => ({ mark: 0, outOf: a.item.question.points.length, feedback: 'No answer.' }));
      sent.forEach(({ i }, k) => (graded[i] = grades[k]!));
      setMarks(graded);
      setMarking(null);
      await save(all, graded);
    } catch (err) {
      if (err instanceof AiError && err.code === 'cancelled') return;
      setMarking({ state: 'failed', message: messageOf(err), signIn: err instanceof AiError && err.code === 'signed-out' });
    } finally {
      abort.current = null;
    }
  };

  if (done) {
    const missed = choices.filter((a) => !a.right);
    const failed = marking?.state === 'failed' ? marking : null;
    return (
      <div className="stack" data-testid="quiz-done">
        {saved ? (
          <p className="score" data-testid="quiz-score">
            {describeScore(saved.right, saved.asked, saved.score)}
          </p>
        ) : marking?.state === 'running' ? (
          <p className="muted" role="status">
            Marking your short answers…
          </p>
        ) : failed ? (
          <div className="stack">
            <p className="error" role="alert">
              Your short answers couldn’t be marked: {failed.message}
            </p>
            {failed.signIn && (
              <p className="muted">
                <a href={signInUrl()} target="_blank" rel="noopener">
                  Sign in for AI
                </a>{' '}
                (opens a new tab: sign in with Google, close it, then press Try marking again).
              </p>
            )}
            <div className="row">
              <button type="button" className="primary" onClick={() => void markAndSave(answered)}>
                Try marking again
              </button>
              {choices.length > 0 && (
                <button type="button" onClick={() => (setWithoutShort(true), setMarking(null), void save(answered, null))}>
                  Save without them
                </button>
              )}
            </div>
            <p className="muted small">
              {choices.length > 0
                ? 'Saved without them, the short answers don’t count. Your multiple-choice answers are kept either way.'
                : 'This quiz was only short answers, so there’s nothing to save without them.'}
            </p>
          </div>
        ) : problem ? (
          <>
            <p className="error" role="alert">
              Couldn’t save this quiz: {problem}
            </p>
            <button type="button" onClick={() => void save(answered, withoutShort ? null : marks)}>
              Try saving again
            </button>
          </>
        ) : (
          <p className="muted">Saving…</p>
        )}
        {marks && shorts.length > 0 && (
          <>
            <h3>Your short answers</h3>
            <ul className="list" data-testid="short-results">
              {shorts.map((a, i) => (
                <li key={a.item.question.id} className="item">
                  <div className="item-main stack">
                    <span>
                      <MathText text={a.item.question.question} />
                    </span>
                    <span className="small prewrap">{a.typed.trim() || 'No answer.'}</span>
                    <span className="small" data-testid="short-mark">
                      {marks[i]!.mark} of {marks[i]!.outOf}: {marks[i]!.feedback}
                    </span>
                    {marks[i]!.mark < marks[i]!.outOf && (
                      <span className="muted small">
                        A full answer says: {a.item.question.points.join('; ')}.{' '}
                        <a href={href({ name: 'slides', courseId: setting.course.id, deckId: setting.deck.id, first: a.item.question.page, last: a.item.question.page })}>
                          slide {a.item.question.page}
                        </a>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
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
          <button
            type="button"
            className="primary"
            onClick={() => onAgain(saved)}
            disabled={!saved && !(failed && choices.length === 0)}
          >
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
  const current = answered[index];
  const last = index + 1 >= items.length;

  const goOn = (all: Answered[]) => {
    setShowSlide(false);
    setTyped('');
    if (!last) {
      setIndex(index + 1);
      shownAt.current = performance.now();
    } else {
      setDone(true);
      void markAndSave(all);
    }
  };

  const openSlide = async () => {
    setShowSlide(true);
    if (!pdf) setPdf(await store.getSlideDeckFile(setting.deck.id));
  };

  const header = (
    <>
      {note && index === 0 && (
        <p className="muted small" data-testid="quiz-note">
          {note}
        </p>
      )}
      <p className="muted small" data-testid="quiz-position">
        Question {index + 1} of {items.length}
      </p>
    </>
  );

  if (isShortItem(item)) {
    const { question } = item;
    // Answered on Next: the answer is kept as typed, marked with the others at the end
    const next = () => {
      const all: Answered[] = [...answered, { kind: 'short', item, typed: typed.slice(0, SHORT_TYPED_MAX), ms: performance.now() - shownAt.current }];
      setAnswered(all);
      goOn(all);
    };
    return (
      <div className="stack quiz" data-testid="quiz-question">
        {header}
        <p className="question">
          <MathText text={question.question} />
        </p>
        <label htmlFor={`short-${question.id}`} className="muted small">
          Your answer: a sentence or two. It’s marked when the quiz ends.
        </label>
        <textarea id={`short-${question.id}`} rows={4} maxLength={SHORT_TYPED_MAX} value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
        <div className="row">
          <button type="button" className="primary" onClick={next}>
            {last ? 'See your score' : 'Next question'}
          </button>
        </div>
      </div>
    );
  }

  const { question } = item;
  const currentChoice = current?.kind === 'choice' ? current : undefined;
  const choose = (shown: number) => {
    if (current) return;
    const chosen = item.order[shown]!;
    setAnswered([...answered, { kind: 'choice', item, shown, chosen, right: chosen === question.answer, ms: performance.now() - shownAt.current }]);
  };

  return (
    <div className="stack quiz" data-testid="quiz-question">
      {header}
      <p className="question">
        <MathText text={question.question} />
      </p>
      <div className="options" role="group" aria-label="Answers">
        {item.order.map((stored, shown) => {
          const state = !currentChoice ? '' : stored === question.answer ? 'right' : shown === currentChoice.shown ? 'wrong' : 'other';
          return (
            <button key={stored} type="button" className={`option ${state}`} disabled={!!current} aria-pressed={currentChoice?.shown === shown} onClick={() => choose(shown)}>
              <span className="letter">{LETTERS[shown]}</span> <MathText text={question.options[stored]} />
            </button>
          );
        })}
      </div>
      {currentChoice && (
        <div className="stack feedback" role="status" data-testid="quiz-feedback">
          <p className={currentChoice.right ? 'verdict right' : 'verdict wrong'}>
            {currentChoice.right ? (
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
            <button type="button" className="primary" onClick={() => goOn(answered)} autoFocus>
              {last ? 'See your score' : 'Next question'}
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
