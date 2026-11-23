// A class's Exam style (#122, DESIGN "Exam style and question levels"), on the class's page: its other documents
// (outlines, past exams, practice sets), the student's notes about the exam, and the exam style guide the AI keeps
// from them and the slides. The guide can be read, edited and remade. It's only ever made when the student acts:
// Write the guide or Remake, or a change to the documents or notes here (whose text this section says goes to the
// AI). Opening the page sends nothing (docs/SECURITY.md); it only says when the guide is out of date
// (src/quiz/guide.ts), and making questions brings it up to date then (#123, refreshGuide).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AiError } from '../ai/backend';
import { APP_NAME } from '../brand';
import { signInUrl } from '../ai/http';
import { MATERIAL_TITLE_MAX, NOTES_MAX } from '../db/style';
import { describeNeed, guideNeed, makeGuide } from '../quiz/guide';
import type { ClassMaterial, MaterialKind, StyleGuide, StyleGuideContent } from '../types/style';
import { useAi } from './ai-context';
import { titleFromFileName } from './classes';
import { ConfirmDialog } from './ConfirmDialog';
import { PdfProblem, readMaterialFile, type PickedMaterial } from './pdf-file';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

export const MATERIAL_KINDS: [MaterialKind, string][] = [
  ['past-exam', 'Past exam'],
  ['outline', 'Outline or syllabus'],
  ['practice', 'Practice set'],
  ['other', 'Other'],
];
const kindName = (kind: MaterialKind) => MATERIAL_KINDS.find(([k]) => k === kind)![1];
const LEVEL_NAMES = ['Level 1, recognise', 'Level 2, apply', 'Level 3, exam-style'];

type Problem = { message: string; signIn: boolean };

/** `lectureIds`: the class's lectures now (the class page reloads them), so a new one can bring a remake. */
export function ExamStyleSection({ courseId, lectureIds }: { courseId: string; lectureIds: string[] }) {
  const store = useStore();
  const ai = useAi();
  const { data, error, reload } = useLoad(async () => {
    const [style, materials] = await Promise.all([store.getExamStyle(courseId), store.listMaterials(courseId)]);
    return { style, materials };
  }, [store, courseId]);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<ClassMaterial | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const need = data
    ? guideNeed(
        data.style,
        lectureIds,
        data.materials.map((m) => m.id),
      )
    : null;

  /** `byHand`: pressed, so say so when there's nothing to make it from (after a change, it just waits). */
  const make = async (byHand: boolean) => {
    setProblem(null);
    setMaking(true);
    abort.current = new AbortController();
    try {
      const made = await makeGuide(store, ai, courseId, abort.current.signal);
      if (!made && byHand) setProblem({ message: 'There’s nothing to write a guide from yet: add slides with text, a document or your notes.', signIn: false });
    } catch (err) {
      if (!(err instanceof AiError && err.code === 'cancelled')) {
        setProblem({ message: messageOf(err), signIn: err instanceof AiError && err.code === 'signed-out' });
      }
    } finally {
      abort.current = null;
      setMaking(false);
      await reload();
    }
  };

  /** After the student changed the documents or notes: the guide is remade with them (one request). */
  const changed = async () => {
    await reload();
    void make(false);
  };

  if (error) return <p className="error">{error}</p>;
  if (!data || !need) return <p className="muted">Loading…</p>;
  const { style, materials } = data;

  const deleteMaterial = async () => {
    const m = deleting!;
    setDeleting(null);
    try {
      await store.deleteMaterial(m.id);
    } catch (err) {
      setProblem({ message: messageOf(err), signIn: false });
      return reload();
    }
    await changed();
  };

  return (
    <div className="stack exam-style" data-testid="exam-style">
      <p className="muted small">
        Past exams, the course outline and your notes help {APP_NAME}’s AI ask questions the way your exam will. They’re kept on this device like your
        slides, and their text goes to the AI only to write the guide below.
      </p>

      <h4>Documents</h4>
      {materials.length === 0 && <p className="muted">No documents yet: add a past exam or the course outline if you have them.</p>}
      <ul className="list" aria-label="Documents">
        {materials.map((m) => (
          <MaterialRow key={m.id} material={m} onChanged={reload} onDelete={() => setDeleting(m)} />
        ))}
      </ul>
      <AddMaterial courseId={courseId} onAdded={changed} />

      <h4>Your notes about the exam</h4>
      <Notes key={style.notesAt ?? 'none'} courseId={courseId} notes={style.notes} onSaved={changed} />

      <h4>Exam style guide</h4>
      {making ? (
        <p className="muted" role="status" data-testid="guide-making">
          {style.guide ? 'Updating the guide…' : 'Writing the guide…'}
        </p>
      ) : (
        need.kind !== 'none' &&
        style.guide && (
          <p className="muted small" data-testid="guide-stale">
            {describeNeed(need)}
          </p>
        )
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
              (opens a new tab: sign in with Google, close it, then press Remake).
            </p>
          )}
        </div>
      )}
      {style.guide && editing ? (
        <EditGuide
          guide={style.guide}
          onCancel={() => setEditing(false)}
          onSave={async (content) => {
            await store.editStyleGuide(courseId, content);
            setEditing(false);
            await reload();
          }}
        />
      ) : style.guide ? (
        <ShowGuide guide={style.guide} />
      ) : (
        !making && (
          <p className="muted" data-testid="guide-none">
            No guide yet. Write it once the class has slides with text, documents or notes.
          </p>
        )
      )}
      {!editing && !making && (
        <div className="row">
          {style.guide && (
            <button type="button" onClick={() => setEditing(true)}>
              Edit the guide
            </button>
          )}
          {(style.guide || need.kind !== 'none') && (
            <button type="button" onClick={() => void make(true)}>
              {style.guide ? 'Remake' : 'Write the guide'}
            </button>
          )}
        </div>
      )}
      {style.guide?.editedAt && !editing && <p className="muted small">You’ve edited this guide: remakes keep your changes.</p>}

      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.title}”?`}
          message="The document is removed from this class, and the guide is remade without it."
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void deleteMaterial()}
        />
      )}
    </div>
  );
}

function MaterialRow({ material: m, onChanged, onDelete }: { material: ClassMaterial; onChanged: () => Promise<void>; onDelete: () => void }) {
  const store = useStore();
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li>
        <MaterialForm
          label={`Edit ${m.title}`}
          title={m.title}
          kind={m.kind}
          saveLabel="Save"
          onCancel={() => setEditing(false)}
          onSave={async (title, kind) => {
            await store.updateMaterial(m.id, { title, kind });
            setEditing(false);
            await onChanged();
          }}
        />
      </li>
    );
  }
  return (
    <li className="item" data-testid="material-row">
      <div className="item-main">
        <span>{m.title}</span>{' '}
        <span className="muted small">
          {kindName(m.kind)} · {m.type === 'application/pdf' ? `${m.pageCount} page${m.pageCount === 1 ? '' : 's'}` : 'text'}
        </span>
      </div>
      <div className="row">
        <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${m.title}`}>
          Edit
        </button>
        <button type="button" onClick={onDelete} aria-label={`Delete ${m.title}`}>
          Delete
        </button>
      </div>
    </li>
  );
}

/** Pick a file, then say what it is. */
function AddMaterial({ courseId, onAdded }: { courseId: string; onAdded: () => Promise<void> }) {
  const store = useStore();
  const [picked, setPicked] = useState<PickedMaterial | null>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setReading(true);
    try {
      setPicked(await readMaterialFile(file));
    } catch (err) {
      setProblem(err instanceof PdfProblem ? err.message : messageOf(err));
    } finally {
      setReading(false);
    }
  };

  if (picked) {
    return (
      <MaterialForm
        label="New document"
        title={titleFromFileName(picked.fileName.replace(/\.(txt|text|md)$/i, ''))}
        kind={null}
        saveLabel="Add document"
        onCancel={() => setPicked(null)}
        onSave={async (title, kind) => {
          await store.addMaterial({ courseId, title, kind, fileName: picked.fileName, type: picked.type, data: picked.data, pageTexts: picked.pageTexts });
          setPicked(null);
          await onAdded();
        }}
      />
    );
  }
  return (
    <div className="stack">
      <label className="file">
        {reading ? 'Reading the document…' : 'Add a document (PDF or text)'}
        <input
          type="file"
          accept="application/pdf,.pdf,text/plain,.txt,.md"
          disabled={reading}
          onChange={(e) => void pick(e.target.files?.[0]).then(() => (e.target.value = ''))}
        />
      </label>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

function MaterialForm({
  label,
  title: startTitle,
  kind: startKind,
  saveLabel,
  onCancel,
  onSave,
}: {
  label: string;
  title: string;
  kind: MaterialKind | null;
  saveLabel: string;
  onCancel: () => void;
  onSave: (title: string, kind: MaterialKind) => Promise<void>;
}) {
  const [title, setTitle] = useState(startTitle);
  const [kind, setKind] = useState<MaterialKind | null>(startKind);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind) return setProblem('Say what the document is.');
    if (!title.trim()) return setProblem('Give the document a title.');
    setSaving(true);
    try {
      await onSave(title.trim(), kind);
    } catch (err) {
      setProblem(messageOf(err));
      setSaving(false);
    }
  };

  return (
    <form className="editor stack" noValidate onSubmit={(e) => void save(e)} aria-label={label}>
      <div className="choices" role="group" aria-label="What it is">
        {MATERIAL_KINDS.map(([value, name]) => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>
            {name}
          </button>
        ))}
      </div>
      <label>
        Title
        <input value={title} maxLength={MATERIAL_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={saving}>
          {saveLabel}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Notes({ courseId, notes, onSaved }: { courseId: string; notes: string; onSaved: () => Promise<void> }) {
  const store = useStore();
  const [text, setText] = useState(notes);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = text.trim() !== notes;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    try {
      await store.setStyleNotes(courseId, text);
      await onSaved();
    } catch (err) {
      setProblem(messageOf(err));
    }
  };

  return (
    <form className="stack" noValidate onSubmit={(e) => void save(e)} aria-label="Your notes about the exam">
      <label className="stack">
        <span className="muted small">What you know about the exam, e.g. “no proofs, two essay questions, a formula sheet is given”.</span>
        <textarea rows={4} maxLength={NOTES_MAX} value={text} onChange={(e) => setText(e.target.value)} aria-label="Notes" />
      </label>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={!changed}>
          Save notes
        </button>
      </div>
    </form>
  );
}

function ShowGuide({ guide }: { guide: StyleGuide }) {
  return (
    <div className="stack guide" data-testid="guide">
      <p className="guide-tests" data-testid="guide-tests">
        {guide.tests}
      </p>
      <dl className="guide-levels">
        {guide.levels.map((l, i) => (
          <div key={i}>
            <dt>{LEVEL_NAMES[i]}</dt>
            <dd data-testid="guide-level">{l}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small" data-testid="guide-share">
        About {Math.round(guide.shortShare * 100)}% of exam-style questions are short answers.
      </p>
    </div>
  );
}

function EditGuide({ guide, onCancel, onSave }: { guide: StyleGuide; onCancel: () => void; onSave: (content: StyleGuideContent) => Promise<void> }) {
  const [tests, setTests] = useState(guide.tests);
  const [levels, setLevels] = useState<[string, string, string]>([...guide.levels] as [string, string, string]);
  const [share, setShare] = useState(String(Math.round(guide.shortShare * 100)));
  const [problem, setProblem] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const percent = Number(share);
    if (share.trim() === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) return setProblem('The share of short answers must be from 0 to 100%.');
    try {
      await onSave({ tests, levels, shortShare: percent / 100 });
    } catch (err) {
      setProblem(messageOf(err));
    }
  };

  return (
    <form className="editor stack" noValidate onSubmit={(e) => void save(e)} aria-label="Edit the guide">
      <label className="stack">
        What the exam tests
        <textarea rows={6} maxLength={3_000} value={tests} onChange={(e) => setTests(e.target.value)} />
      </label>
      {levels.map((l, i) => (
        <label key={i} className="stack">
          {LEVEL_NAMES[i]}
          <textarea rows={3} maxLength={600} value={l} onChange={(e) => setLevels((all) => all.map((x, j) => (j === i ? e.target.value : x)) as [string, string, string])} />
        </label>
      ))}
      <label>
        Short answers, % of exam-style questions
        <input inputMode="numeric" value={share} onChange={(e) => setShare(e.target.value)} />
      </label>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <div className="row">
        <button type="submit" className="primary">
          Save the guide
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
