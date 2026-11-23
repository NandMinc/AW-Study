// One class: its lecture times and term, "What was covered?" (with a prompt for the latest lecture
// when it hasn't been filled in), its lectures and their slides, its exams, and its slide decks.
// The class menu on the Classes page opens it at one part (`part`: scrolled to it, or the class
// editor for "details"), and a lecture's date button opens "What was covered?" for that date (`cover`),
// going back to the Classes page when it's saved or cancelled.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DECK_TITLE_MAX } from '../db/lectures';
import { deviceTimeZone, studyDay } from '../lib/studyDay';
import type { Exam, LectureWithSections, SlideDeck } from '../types/lecture';
import { describeScore } from '../quiz/pick';
import type { QuizAttempt } from '../types/quiz';
import { describeMeetings, formatDate, latestLecture, lectureMinutesOn, orderSections, relativeDay, slidesLabel, titleFromFileName } from './classes';
import { ClassEditor } from './ClassEditor';
import { ConfirmDialog } from './ConfirmDialog';
import { ExamEditor, KIND_NAMES } from './ExamEditor';
import { ExamStyleSection } from './ExamStyleSection';
import { LectureForm } from './LectureForm';
import { PdfProblem, readPdfFile } from './pdf-file';
import { go, href, type ClassPart } from './route';
import { DAY_START_HOUR } from './settings';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

type Deleting =
  | { kind: 'class' }
  | { kind: 'lecture'; item: LectureWithSections }
  | { kind: 'exam'; exam: Exam }
  | { kind: 'deck'; deck: SlideDeck };

export function ClassScreen({ courseId, part, cover }: { courseId: string; part?: ClassPart; cover?: string }) {
  const store = useStore();
  const { data, error, reload } = useLoad(async () => {
    const [course, lectures, decks, exams, attempts] = await Promise.all([
      store.getCourse(courseId),
      store.listLectures(courseId),
      store.listSlideDecks(courseId),
      store.listExams(courseId),
      store.listQuizAttempts(),
    ]);
    // Each section's latest quiz (attempts come newest first)
    const lastQuiz = new Map<string, QuizAttempt>();
    for (const a of attempts) if (a.courseId === courseId && !lastQuiz.has(a.sectionId)) lastQuiz.set(a.sectionId, a);
    return { course, lectures, decks, exams, lastQuiz };
  }, [store, courseId]);
  const [editingClass, setEditingClass] = useState(part === 'details');
  const [recording, setRecording] = useState<{ date: string; minutes: number | null } | null>(null);
  // Opened at a part or a date: once, when the class has loaded
  const opened = useRef(false);
  useEffect(() => {
    if (!data?.course || opened.current) return;
    opened.current = true;
    if (cover) setRecording({ date: cover, minutes: lectureMinutesOn(data.course.meetings, cover) });
    const heading = part && part !== 'details' ? document.getElementById(`class-${part}`) : null;
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }, [data, part, cover]);
  const [editingLecture, setEditingLecture] = useState<string | null>(null);
  const [exam, setExam] = useState<'new' | Exam | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.course) return <MissingClass />;
  const { course, lectures, decks, exams, lastQuiz } = data;
  const now = new Date();
  const today = studyDay(now, deviceTimeZone(), DAY_START_HOUR);
  const latest = latestLecture(course.meetings, now, deviceTimeZone());
  const missing = latest && !lectures.some((l) => l.lecture.date === latest.date) ? latest : null;
  const deckById = new Map(decks.map((d) => [d.id, d]));
  const thisYear = today.slice(0, 4);

  const startRecording = () => setRecording(latest ?? { date: today, minutes: course.meetings[0]?.minutes ?? null });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setUploading(true);
    try {
      const pdf = await readPdfFile(file);
      await store.addSlideDeck({ courseId, title: titleFromFileName(pdf.fileName), fileName: pdf.fileName, data: pdf.data, pageTexts: pdf.pageTexts });
      await reload();
    } catch (err) {
      setProblem(err instanceof PdfProblem ? err.message : messageOf(err));
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = async () => {
    const what = deleting!;
    setDeleting(null);
    setProblem(null);
    try {
      if (what.kind === 'class') {
        await store.deleteCourse(courseId);
        return go({ name: 'classes' });
      }
      if (what.kind === 'lecture') await store.deleteLecture(what.item.lecture.id);
      if (what.kind === 'exam') await store.deleteExam(what.exam.id);
      if (what.kind === 'deck') await store.deleteSlideDeck(what.deck.id);
    } catch (err) {
      setProblem(messageOf(err));
    }
    await reload();
  };

  return (
    <section>
      <p>
        <a className="back" href={href({ name: 'classes' })}>← Classes</a>
      </p>
      {editingClass ? (
        <ClassEditor
          course={course}
          onCancel={() => setEditingClass(false)}
          onSaved={async () => {
            setEditingClass(false);
            await reload();
          }}
        />
      ) : (
        <>
          <h2>{course.name}</h2>
          <p className="muted" data-testid="class-times">
            {describeMeetings(course.meetings)}
            {course.termStart && course.termEnd && (
              <>
                <br />
                Term {formatDate(course.termStart, thisYear)} to {formatDate(course.termEnd, thisYear)}
              </>
            )}
          </p>
          <div className="row">
            <button type="button" onClick={() => setEditingClass(true)}>
              Edit class
            </button>
            <button type="button" onClick={() => setDeleting({ kind: 'class' })}>
              Delete class
            </button>
          </div>
        </>
      )}

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}

      {recording ? (
        <LectureForm
          course={course}
          decks={decks}
          lectures={lectures}
          defaults={recording}
          onCancel={async () => {
            if (cover) return go({ name: 'classes' }); // back where the date button was
            setRecording(null);
            await reload(); // a PDF may have been stored before the lecture was refused
          }}
          onSaved={async () => {
            if (cover) return go({ name: 'classes' });
            setRecording(null);
            await reload();
          }}
        />
      ) : (
        <div className="stack">
          {missing && (
            <p className="prompt" data-testid="cover-prompt">
              {course.name} had a lecture {formatDate(missing.date, thisYear)} ({relativeDay(today, missing.date)}). What did it cover?
            </p>
          )}
          <button type="button" className="primary wide" onClick={startRecording}>
            What was covered?
          </button>
        </div>
      )}

      <h3 id="class-lectures" tabIndex={-1}>
        {lectures.length} lecture{lectures.length === 1 ? '' : 's'}
      </h3>
      {lectures.length === 0 && <p className="muted">None yet. After a lecture, say which slides it covered.</p>}
      <ul className="list" aria-label="Lectures">
        {lectures.map((item) => (
          <li key={item.lecture.id} className="item" data-testid="lecture-row">
            {editingLecture === item.lecture.id ? (
              <LectureEdit
                item={item}
                onDone={async () => {
                  setEditingLecture(null);
                  await reload();
                }}
              />
            ) : (
              <>
                <div className="item-main">
                  <strong>{formatDate(item.lecture.date, thisYear)}</strong> <span className="muted small">{item.lecture.minutes} min</span>
                  <ul className="sections">
                    {orderSections(item.sections, decks).map((s) => {
                      const deck = deckById.get(s.deckId);
                      return (
                        <li key={s.id}>
                          <a href={href({ name: 'slides', courseId, deckId: s.deckId, first: s.firstPage, last: s.lastPage })}>
                            {deck?.title ?? 'Slides'}, {slidesLabel(s.firstPage, s.lastPage)}
                          </a>{' '}
                          <span className="muted small">{s.schedule.budgetMinutes} min to study</span>{' '}
                          <a className="small" href={href({ name: 'quiz', courseId, sectionId: s.id })} aria-label={`Quiz on ${deck?.title ?? 'slides'}, ${slidesLabel(s.firstPage, s.lastPage)}`}>
                            Quiz
                          </a>
                          {lastQuiz.get(s.id) && (
                            <span className="muted small" data-testid="section-last-quiz">
                              {' '}
                              (last: {describeScore(lastQuiz.get(s.id)!.right, lastQuiz.get(s.id)!.asked)})
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="row">
                  <button type="button" onClick={() => setEditingLecture(item.lecture.id)} aria-label={`Edit lecture of ${formatDate(item.lecture.date)}`}>
                    Edit
                  </button>
                  <button type="button" onClick={() => setDeleting({ kind: 'lecture', item })} aria-label={`Delete lecture of ${formatDate(item.lecture.date)}`}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      <h3 id="class-exams" tabIndex={-1}>
        Exams
      </h3>
      {exams.length === 0 && exam === null && <p className="muted">No exams added. Adding them lets the planner get you ready in time.</p>}
      <ul className="list" aria-label="Exams">
        {exams.map((e) =>
          exam !== 'new' && exam?.id === e.id ? (
            <li key={e.id}>
              <ExamEditor courseId={courseId} exam={e} lectures={lectures} onCancel={() => setExam(null)} onSaved={async () => (setExam(null), await reload())} />
            </li>
          ) : (
            <li key={e.id} className="item" data-testid="exam-row">
              <div className="item-main">
                <strong>{e.title}</strong> <span className="muted small">{KIND_NAMES[e.kind]}</span>
                <br />
                {formatDate(e.date, thisYear)} <span className="muted small">({relativeDay(today, e.date)})</span>
                <br />
                <span className="muted small">
                  {e.lectureIds === null ? 'Covers every lecture up to it' : `Covers ${e.lectureIds.length} chosen lecture${e.lectureIds.length === 1 ? '' : 's'}`}
                </span>
              </div>
              <div className="row">
                <button type="button" onClick={() => setExam(e)} aria-label={`Edit ${e.title}`}>
                  Edit
                </button>
                <button type="button" onClick={() => setDeleting({ kind: 'exam', exam: e })} aria-label={`Delete ${e.title}`}>
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      {exam === 'new' ? (
        <ExamEditor courseId={courseId} lectures={lectures} onCancel={() => setExam(null)} onSaved={async () => (setExam(null), await reload())} />
      ) : (
        <button type="button" onClick={() => setExam('new')}>
          Add an exam
        </button>
      )}

      <h3 id="class-files" tabIndex={-1}>
        Slide decks
      </h3>
      {decks.length === 0 && <p className="muted">No slides yet. Upload them here, or when you say what a lecture covered.</p>}
      <ul className="list" aria-label="Slide decks">
        {decks.map((deck) =>
          renaming === deck.id ? (
            <li key={deck.id}>
              <RenameDeck deck={deck} onDone={async () => (setRenaming(null), await reload())} />
            </li>
          ) : (
            <li key={deck.id} className="item" data-testid="deck-row">
              <div className="item-main">
                <a href={href({ name: 'slides', courseId, deckId: deck.id })}>{deck.title}</a>{' '}
                <span className="muted small">
                  {deck.pageCount} slides · {megabytes(deck.byteSize)}
                </span>
              </div>
              <div className="row">
                <button type="button" onClick={() => setRenaming(deck.id)} aria-label={`Rename ${deck.title}`}>
                  Rename
                </button>
                <button type="button" onClick={() => setDeleting({ kind: 'deck', deck })} aria-label={`Delete ${deck.title}`}>
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      <label className="file">
        {uploading ? 'Adding the slides…' : 'Add slides (PDF)'}
        <input type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={(e) => void upload(e.target.files?.[0]).then(() => (e.target.value = ''))} />
      </label>

      <h3 id="class-style" tabIndex={-1}>
        Exam style
      </h3>
      <ExamStyleSection courseId={courseId} lectures={lectures.map((l) => l.lecture.id).join(' ')} />

      {deleting && (
        <ConfirmDialog
          title={deleteTitle(deleting, course.name)}
          message={deleteMessage(deleting)}
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </section>
  );
}

function deleteTitle(d: Deleting, className: string): string {
  switch (d.kind) {
    case 'class':
      return `Delete “${className}”?`;
    case 'lecture':
      return `Delete the lecture of ${formatDate(d.item.lecture.date)}?`;
    case 'exam':
      return `Delete “${d.exam.title}”?`;
    case 'deck':
      return `Delete “${d.deck.title}”?`;
  }
}

function deleteMessage(d: Deleting): string {
  switch (d.kind) {
    case 'class':
      return 'Its lectures, exams and slides will be deleted from this device. This can’t be undone.';
    case 'lecture':
      return 'Its slides stay; what it covered is forgotten, along with any study planned for it.';
    case 'exam':
      return 'This can’t be undone.';
    case 'deck':
      return 'The PDF will be deleted from this device. This can’t be undone.';
  }
}

function megabytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Changing a lecture's date or length (its slides stay; the study time is shared out again). */
function LectureEdit({ item, onDone }: { item: LectureWithSections; onDone: () => void }) {
  const store = useStore();
  const [date, setDate] = useState(item.lecture.date);
  const [minutes, setMinutes] = useState(String(item.lecture.minutes));
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await store.updateLecture(item.lecture.id, { date, minutes: Number(minutes) });
      onDone();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };
  return (
    <form className="stack" noValidate onSubmit={save} aria-label="Edit lecture">
      <div className="row">
        <label className="inline">
          Lecture date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="inline">
          Minutes
          <input type="number" inputMode="numeric" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
      </div>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="row end">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Save
        </button>
      </div>
    </form>
  );
}

function RenameDeck({ deck, onDone }: { deck: SlideDeck; onDone: () => void }) {
  const store = useStore();
  const [title, setTitle] = useState(deck.title);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await store.renameSlideDeck(deck.id, title);
      onDone();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };
  return (
    <form className="stack" onSubmit={save}>
      <label htmlFor={`rename-${deck.id}`}>New name for “{deck.title}”</label>
      <div className="row">
        <input id={`rename-${deck.id}`} value={title} maxLength={DECK_TITLE_MAX} autoFocus onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
      {problem && <p className="error">{problem}</p>}
    </form>
  );
}

export function MissingClass() {
  return (
    <section>
      <h2>Class not found</h2>
      <p className="muted">It may have been deleted.</p>
      <a className="back" href={href({ name: 'classes' })}>← Back to your classes</a>
    </section>
  );
}
