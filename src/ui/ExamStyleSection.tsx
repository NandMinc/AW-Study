// A class's Exam style (#122, DESIGN "Exam style and question levels"): its other documents (outline, past exams,
// practice), the student's notes about the exam, and the exam style guide the AI keeps from them and the slides.
// The guide is written or remade by itself only when the student changes a document or the notes (exam-style.ts
// remakeOnPage): opening a class never sends anything. New lectures are remade in before the next questions are
// made (#123), or by Remake. The student can read, edit and remake it.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AiError } from '../ai/backend';
import { signInUrl } from '../ai/http';
import { MATERIAL_TITLE_MAX, NOTES_MAX } from '../db/style';
import type { ClassMaterial, ExamStyle, MaterialKind, StyleGuideContent } from '../types/style';
import { useAi } from './ai-context';
import { deviceTimeZone, studyDay } from '../lib/studyDay';
import { formatDate } from './classes';
import { DAY_START_HOUR } from './settings';
import { ConfirmDialog } from './ConfirmDialog';
import { documentType, guessKind, KIND_NAMES, KIND_SHORT, KINDS, LEVEL_NAMES, lecturesWithText, makeGuide, remakeOnPage, staleness } from './exam-style';
import { PdfProblem, readPdfFile } from './pdf-file';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

type Problem = { message: string; signIn: boolean };

/**
 * `lectures`: the class's lecture ids as the page has them, so a lecture recorded on the same page (What was
 * covered?) reloads this part and the guide can notice its slides.
 */
export function ExamStyleSection({ courseId, lectures }: { courseId: string; lectures: string }) {
  const store = useStore();
  const ai = useAi();
  const { data, error, reload } = useLoad(async () => {
    const [style, materials, lectureIds] = await Promise.all([store.getExamStyle(courseId), store.listMaterials(courseId), lecturesWithText(store, courseId)]);
    return { style, materials, lectureIds };
  }, [store, courseId, lectures]);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ClassMaterial | null>(null);
  const [editingGuide, setEditingGuide] = useState(false);
  const running = useRef<AbortController | null>(null);
  // Remade by itself at most once per change: a failed attempt isn't retried in a loop
  const tried = useRef<string | null>(null);

  useEffect(() => () => running.current?.abort(), []);

  const remake = async () => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setMaking(true);
    setProblem(null);
    try {
      await makeGuide(store, ai, courseId, controller.signal);
    } catch (err) {
      if (!(err instanceof AiError && err.code === 'cancelled')) {
        setProblem({ message: messageOf(err), signIn: err instanceof AiError && err.code === 'signed-out' });
      }
    } finally {
      if (running.current === controller) {
        running.current = null;
        setMaking(false);
      }
      await reload();
    }
  };

  // A document or the notes changed since the guide was made (or none yet, and there are some)
  useEffect(() => {
    if (!data || making || editingGuide) return;
    if (!remakeOnPage(data.style, data.materials)) return;
    const key = JSON.stringify([data.style.notesAt, data.materials.map((m) => m.id)]);
    if (tried.current === key) return;
    tried.current = key;
    void remake();
  }, [data, making, editingGuide]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { style, materials, lectureIds } = data;

  const add = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    const type = documentType(file);
    if (!type) {
      setProblem({ message: 'Only PDFs and plain text files (.txt, .md) can be added for now. Save it as a PDF first.', signIn: false });
      return;
    }
    setAdding(true);
    try {
      let data: Uint8Array;
      let pageTexts: string[] = [];
      if (type === 'application/pdf') {
        const pdf = await readPdfFile(file);
        data = pdf.data;
        pageTexts = pdf.pageTexts;
      } else {
        data = new Uint8Array(await file.arrayBuffer());
      }
      await store.addMaterial({ courseId, title: '', fileName: file.name, kind: guessKind(file.name), type, data, pageTexts });
      await reload();
    } catch (err) {
      setProblem({ message: err instanceof PdfProblem ? err.message : messageOf(err), signIn: false });
    } finally {
      setAdding(false);
    }
  };

  const confirmDelete = async () => {
    const m = deleting!;
    setDeleting(null);
    try {
      await store.deleteMaterial(m.id);
    } catch (err) {
      setProblem({ message: messageOf(err), signIn: false });
    }
    await reload();
  };

  const stale = staleness(style, lectureIds, materials);

  return (
    <div className="stack" data-testid="exam-style">
      <p className="muted">
        Honed’s AI reads this class’s slides, the documents below and your notes, works out what the exam is likely to ask, and writes your quiz
        questions that way.
      </p>

      <h4>Documents</h4>
      {materials.length === 0 && <p className="muted">None yet. A course outline or a past exam helps the most.</p>}
      <ul className="list" aria-label="Documents">
        {materials.map((m) =>
          changing === m.id ? (
            <li key={m.id}>
              <ChangeMaterial material={m} onDone={async () => (setChanging(null), await reload())} />
            </li>
          ) : (
            <li key={m.id} className="item" data-testid="material-row">
              <div className="item-main">
                {m.title} <span className="muted small">{KIND_NAMES[m.kind]}</span>
              </div>
              <div className="row">
                <button type="button" onClick={() => setChanging(m.id)} aria-label={`Change ${m.title}`}>
                  Change
                </button>
                <button type="button" onClick={() => setDeleting(m)} aria-label={`Delete ${m.title}`}>
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      <label className="file">
        {adding ? 'Adding the document…' : 'Add a document (PDF or text)'}
        <input
          type="file"
          accept="application/pdf,.pdf,text/plain,.txt,.md,text/markdown"
          disabled={adding}
          onChange={(e) => void add(e.target.files?.[0]).then(() => (e.target.value = ''))}
        />
      </label>

      <Notes courseId={courseId} style={style} onSaved={reload} />

      <h4>The exam style guide</h4>
      {making && (
        <p className="muted" role="status">
          {style.guide ? 'Updating the guide…' : 'Writing the guide…'}
        </p>
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
              (opens a new tab: sign in with Google, close it, then press Remake the guide).
            </p>
          )}
        </div>
      )}
      {!style.guide && !making && (
        <p className="muted">No guide yet. It’s written when you add a document or notes, before this class’s questions are made, or with the button below.</p>
      )}
      {style.guide && editingGuide && (
        <GuideEditor
          courseId={courseId}
          guide={style.guide}
          onDone={async () => {
            setEditingGuide(false);
            await reload();
          }}
        />
      )}
      {style.guide && !editingGuide && (
        <div className="stack" data-testid="guide">
          <h5>What the exam tests</h5>
          <p className="prewrap">{style.guide.tests}</p>
          <h5>Question levels in this class</h5>
          <ol className="levels">
            {style.guide.levels.map((text, i) => (
              <li key={i}>
                <strong>{LEVEL_NAMES[i]}:</strong> {text}
              </li>
            ))}
          </ol>
          <p className="muted small">
            About {Math.round(style.guide.shortShare * 100)}% of exam-style questions are short answers. Made {formatDate(studyDay(new Date(style.guide.madeAt), deviceTimeZone(), DAY_START_HOUR))} from{' '}
            {plural(style.guide.from.lectureIds.length, 'lecture')} and {plural(style.guide.from.materialIds.length, 'document')}
            {style.guide.editedAt ? '; your edits are kept when it’s remade' : ''}.
            {stale && stale.unseenLectures > 0 ? ` ${plural(stale.unseenLectures, 'newer lecture')} not in it yet.` : ''}
          </p>
        </div>
      )}
      <div className="row">
        {style.guide && !editingGuide && (
          <button type="button" disabled={making} onClick={() => setEditingGuide(true)}>
            Edit the guide
          </button>
        )}
        {!editingGuide && (
          <button type="button" disabled={making} onClick={() => void remake()}>
            {style.guide ? 'Remake the guide' : 'Write the guide'}
          </button>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.title}”?`}
          message="The document will be deleted from this device, and the guide remade without it. This can’t be undone."
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function KindChoice({ kind, onChange }: { kind: MaterialKind; onChange: (k: MaterialKind) => void }) {
  return (
    <div className="segmented" role="group" aria-label="What it is">
      {KINDS.map((k) => (
        <button key={k} type="button" aria-pressed={kind === k} aria-label={KIND_NAMES[k]} onClick={() => onChange(k)}>
          {KIND_SHORT[k]}
        </button>
      ))}
    </div>
  );
}

function ChangeMaterial({ material, onDone }: { material: ClassMaterial; onDone: () => void }) {
  const store = useStore();
  const [title, setTitle] = useState(material.title);
  const [kind, setKind] = useState(material.kind);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await store.updateMaterial(material.id, { title, kind });
      onDone();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };
  return (
    <form className="stack" noValidate onSubmit={save} aria-label={`Change ${material.title}`}>
      <label htmlFor={`material-${material.id}`}>Name</label>
      <input id={`material-${material.id}`} value={title} maxLength={MATERIAL_TITLE_MAX} autoFocus onChange={(e) => setTitle(e.target.value)} />
      <KindChoice kind={kind} onChange={setKind} />
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

function Notes({ courseId, style, onSaved }: { courseId: string; style: ExamStyle; onSaved: () => Promise<void> }) {
  const store = useStore();
  const [text, setText] = useState(style.notes);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = text.trim() !== style.notes;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    try {
      await store.setStyleNotes(courseId, text);
      setSaved(true);
      await onSaved();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };
  return (
    <form className="stack" noValidate onSubmit={save} aria-label="Your notes about the exam">
      <h4 id={`notes-title-${courseId}`}>Your notes about the exam</h4>
      <textarea
        id={`notes-${courseId}`}
        aria-labelledby={`notes-title-${courseId}`}
        rows={4}
        maxLength={NOTES_MAX}
        value={text}
        placeholder="e.g. No proofs. Two essay questions. A formula sheet is given."
        onChange={(e) => (setText(e.target.value), setSaved(false))}
      />
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="row end">
        {saved && !changed && <span className="muted small">Saved</span>}
        <button type="submit" className="primary" disabled={!changed}>
          Save notes
        </button>
      </div>
    </form>
  );
}

function GuideEditor({ courseId, guide, onDone }: { courseId: string; guide: StyleGuideContent; onDone: () => void }) {
  const store = useStore();
  const [tests, setTests] = useState(guide.tests);
  const [levels, setLevels] = useState<string[]>([...guide.levels]);
  const [share, setShare] = useState(String(Math.round(guide.shortShare * 100)));
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const percent = Number(share);
    if (share.trim() === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      setProblem('The share of short answers is a number from 0 to 100.');
      return;
    }
    try {
      await store.editStyleGuide(courseId, { tests, levels: levels as StyleGuideContent['levels'], shortShare: percent / 100 });
      onDone();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };
  return (
    <form className="stack" noValidate onSubmit={save} aria-label="Edit the guide">
      <label htmlFor={`tests-${courseId}`}>What the exam tests</label>
      <textarea id={`tests-${courseId}`} rows={6} maxLength={3_000} value={tests} onChange={(e) => setTests(e.target.value)} />
      {LEVEL_NAMES.map((name, i) => (
        <div className="stack" key={name}>
          <label htmlFor={`level-${i}-${courseId}`}>
            Level {i + 1}, {name}
          </label>
          <textarea
            id={`level-${i}-${courseId}`}
            rows={2}
            maxLength={600}
            value={levels[i]}
            onChange={(e) => setLevels((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
          />
        </div>
      ))}
      <label className="inline">
        Short answers (% of exam-style questions)
        <input type="number" inputMode="numeric" min={0} max={100} value={share} onChange={(e) => setShare(e.target.value)} />
      </label>
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
          Save the guide
        </button>
      </div>
    </form>
  );
}
