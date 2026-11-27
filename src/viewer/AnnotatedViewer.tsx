// The slide viewer with notes and highlights (#56, milestone 7; docs/DESIGN.md "The slide viewer"):
// - select words on a slide, then pick a colour to highlight them;
// - Box: drag a box over any part of a slide (diagrams, images);
// - Pin a note: tap a point on the slide and write;
// - Explain this / Ask about this: the selection (or the box's words) and the slide with its
//   neighbours go to the AI through AiBackend; the answer can be kept as a note.
// Positions are fractions of the page (./geometry.ts), so marks line up at any zoom and screen size.
// The viewer knows nothing of storage: the screen hands it the deck's annotations and what to call to
// change them (src/ui/DeckSlides.tsx).
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AiError, type AiBackend, type SlideText } from '../ai/backend';
import { signInUrl } from '../ai/http';
import {
  ANNOTATION_COLOURS,
  type Annotation,
  type AnnotationChange,
  type AnnotationColour,
  type AnnotationInput,
  type PageRect,
} from '../types/annotation';
import { boxBetween, lineRects, percent, textInArea, toPagePoint, toPageRect } from './geometry';
import { SlideViewer, type SlideViewerProps } from './SlideViewer';
import './annotate.css';

/** The deck's annotations and how to change them. Each method resolves once `list` is up to date. */
export interface ViewerNotes {
  list: readonly Annotation[];
  add(input: Omit<AnnotationInput, 'deckId'>): Promise<unknown>;
  update(id: string, change: AnnotationChange): Promise<unknown>;
  remove(id: string): Promise<unknown>;
}

export interface AnnotatedViewerProps extends Omit<SlideViewerProps, 'overlay' | 'barExtra'> {
  notes: ViewerNotes;
  /** For Explain this and Ask about this; without it (or without pageTexts) they aren't offered. */
  ai?: Pick<AiBackend, 'explain' | 'ask'>;
  /** The deck's text, one string per page: the slides sent with Explain and Ask. */
  pageTexts?: readonly string[];
  /**
   * What Explain and Ask send (#175, src/reading/explain.ts): the slides with what the AI read on their pictures,
   * and for a box, a picture of it. Without it, the slides' text alone, and a box with no words can't be explained.
   */
  prepare?: (page: number, area?: PageRect, signal?: AbortSignal) => Promise<{ slides: SlideText[]; image?: Uint8Array }>;
}

type Tool = 'select' | 'area' | 'pin';

/** Something marked on the slide but not saved yet. */
interface Pending {
  page: number;
  kind: Annotation['kind'];
  rects: PageRect[];
  text: string; // the words selected, or the words inside a box (for the AI; not saved for a box)
}

interface AiJob {
  mode: 'explain' | 'ask';
  page: number;
  selection: string;
  /** Where Keep as note puts the answer: on this annotation, or a new one from `pending`. */
  annotationId?: string;
  /** A box: its area, sent as a picture (#175). */
  area?: PageRect;
  pending?: Pending;
  question: string;
  answer: string | null;
  busy: boolean;
  problem: string | null;
  signIn: boolean;
}

const COLOUR_NAMES: Record<AnnotationColour, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' };
const SELECTION_MAX = 2_000; // the helper's limit for a selection
const SLIDE_TEXT_MAX = 8_000; // and for a slide's text
const NOTE_MAX = 10_000;
const MIN_BOX = 0.01; // a box smaller than 1% of the page each way is a slip, not a box

export function AnnotatedViewer({ notes, ai, pageTexts, prepare, page: wanted = 1, onPageChange, ...viewer }: AnnotatedViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(wanted);
  const [tool, setTool] = useState<Tool>('select');
  const [pending, setPending] = useState<Pending | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [job, setJob] = useState<AiJob | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => globalThis.matchMedia?.('(min-width: 900px)').matches ?? true);
  const abortRef = useRef<AbortController | null>(null);
  // While a press is selecting words, opening the panel waits for it to end: on a wide screen the
  // panel takes width from the slide, and redrawing the slide would drop the selection mid-drag
  const pressing = useRef(false);
  const openOnRelease = useRef(false);
  const canAsk = !!ai && !!pageTexts && pageTexts.length > 0;
  /** A box can be explained from its picture even with no words in it (#175). */
  const canPicture = canAsk && !!prepare;

  useEffect(() => setCurrent(wanted), [wanted]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const changePage = (page: number) => {
    setCurrent(page);
    setPending(null);
    setActiveId(null);
    setTool('select');
    onPageChange?.(page);
  };

  // Words selected on the slide become a pending highlight. A collapsed selection (a tap on a button
  // in the panel, on some browsers) keeps the last one; a new press on the slide clears it.
  useEffect(() => {
    const onSelection = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const pageBox = pageElement(rootRef.current);
      const anchor = selection.anchorNode;
      if (!pageBox || !anchor || !pageBox.querySelector('.textLayer')?.contains(anchor)) return;
      const text = selection.toString().replace(/\s+/g, ' ').trim();
      const box = pageBox.getBoundingClientRect();
      const rects = lineRects(
        Array.from(selection.getRangeAt(0).getClientRects())
          .map((r) => toPageRect(r, box))
          .filter((r): r is PageRect => r !== null),
      );
      if (!text || rects.length === 0) return;
      const page = Number(pageBox.dataset.rendered);
      if (!Number.isInteger(page) || page < 1) return;
      setPending({ page, kind: 'text', rects, text });
      if (pressing.current) openOnRelease.current = true;
      else setPanelOpen(true);
    };
    const onRelease = () => {
      pressing.current = false;
      if (openOnRelease.current) {
        openOnRelease.current = false;
        setPanelOpen(true);
      }
    };
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('pointerup', onRelease);
    document.addEventListener('pointercancel', onRelease);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('pointerup', onRelease);
      document.removeEventListener('pointercancel', onRelease);
    };
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await action();
      return true;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const save = async (colour: AnnotationColour, note = '') => {
    if (!pending) return;
    const { page, kind, rects, text } = pending;
    const ok = await run(() => notes.add({ page, kind, rects, text: kind === 'text' ? text : '', colour, note }));
    if (ok) {
      setPending(null);
      document.getSelection()?.removeAllRanges();
    }
  };

  const slidesAround = (page: number): SlideText[] =>
    [page - 1, page, page + 1]
      .filter((n) => n >= 1 && n <= (pageTexts?.length ?? 0))
      .map((n) => ({ page: n, text: (pageTexts![n - 1] ?? '').slice(0, SLIDE_TEXT_MAX) }))
      .filter((s) => s.page === page || s.text.trim() !== '');

  const startJob = (mode: AiJob['mode'], from: { page: number; selection: string; annotationId?: string; pending?: Pending; area?: PageRect }) => {
    abortRef.current?.abort();
    const next: AiJob = { mode, ...from, selection: from.selection.slice(0, SELECTION_MAX), question: '', answer: null, busy: false, problem: null, signIn: false };
    setJob(next);
    setPanelOpen(true);
    if (mode === 'explain') void ask(next);
  };

  const ask = async (target: AiJob) => {
    if (!ai) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setJob({ ...target, busy: true, problem: null, signIn: false, answer: null });
    try {
      const { slides, image } = prepare ? await prepare(target.page, target.area, controller.signal) : { slides: slidesAround(target.page), image: undefined };
      const picture = image ? { image } : {};
      const answer =
        target.mode === 'explain'
          ? await ai.explain({ selection: target.selection, slides, ...picture }, controller.signal)
          : await ai.ask({ question: target.question.trim(), selection: target.selection, slides, ...picture }, controller.signal);
      if (!controller.signal.aborted) setJob({ ...target, busy: false, answer });
    } catch (err) {
      if (controller.signal.aborted || (err instanceof AiError && err.code === 'cancelled')) return;
      setJob({ ...target, busy: false, problem: err instanceof Error ? err.message : String(err), signIn: err instanceof AiError && err.code === 'signed-out' });
    }
  };

  const closeJob = () => {
    abortRef.current?.abort();
    setJob(null);
  };

  const keepAsNote = async (target: AiJob) => {
    if (!target.answer) return;
    const kept = target.mode === 'ask' ? `${target.question.trim()}\n${target.answer}` : target.answer;
    let ok: boolean;
    if (target.annotationId) {
      const old = notes.list.find((a) => a.id === target.annotationId);
      const note = (old?.note ? `${old.note}\n\n${kept}` : kept).slice(0, NOTE_MAX);
      ok = await run(() => notes.update(target.annotationId!, { note }));
    } else if (target.pending) {
      const { page, kind, rects, text } = target.pending;
      ok = await run(() => notes.add({ page, kind, rects, text: kind === 'text' ? text : '', colour: 'yellow', note: kept.slice(0, NOTE_MAX) }));
      if (ok) setPending((p) => (p === target.pending ? null : p));
    } else {
      // A question about the whole slide: pinned at its top left corner
      ok = await run(() =>
        notes.add({ page: target.page, kind: 'note', rects: [{ x: 0.02, y: 0.02, w: 0, h: 0 }], text: '', colour: 'yellow', note: kept.slice(0, NOTE_MAX) }),
      );
    }
    if (ok) setJob((j) => (j === target ? null : j)); // another question may have started meanwhile
  };

  const onPage = notes.list.filter((a) => a.page === current);

  /** Box and Pin work on the slide: bring it into view (on phones the panel is under it). */
  const pickTool = (next: Tool) => {
    setTool((t) => (t === next ? 'select' : next));
    rootRef.current?.querySelector('.sv-stage')?.scrollIntoView?.({ block: 'nearest' });
  };

  const overlay = useCallback(
    (page: number) => (
      <NotesLayer
        page={page}
        tool={tool}
        annotations={notes.list.filter((a) => a.page === page)}
        pending={pending?.page === page ? pending : null}
        activeId={activeId}
        onPick={(id) => {
          setActiveId(id);
          setPanelOpen(true);
        }}
        onMarked={(marked) => {
          setPending(marked);
          setTool('select');
          setPanelOpen(true);
        }}
      />
    ),
    [tool, notes.list, pending, activeId],
  );

  return (
    <div
      ref={rootRef}
      className={`annotated ${panelOpen ? 'with-panel' : ''}`}
      onPointerDown={(e) => {
        if (!(e.target as Element).closest?.('.sv-stage')) return;
        pressing.current = true;
        // A new press on the slide starts a new selection: forget the last one
        if (tool === 'select' && pending?.kind === 'text') setPending(null);
      }}
    >
      <div className="av-main">
        <SlideViewer
          {...viewer}
          page={wanted}
          onPageChange={changePage}
          overlay={overlay}
          barExtra={
            <button type="button" className="av-notes-toggle" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
              Notes{onPage.length > 0 ? ` (${onPage.length})` : ''}
            </button>
          }
        />
      </div>

      {panelOpen && (
        <aside className="ann-panel" aria-label="Notes and highlights">
          <div className="ann-tools" role="toolbar" aria-label="Note tools">
            <button type="button" aria-pressed={tool === 'area'} onClick={() => pickTool('area')}>
              Box
            </button>
            <button type="button" aria-pressed={tool === 'pin'} onClick={() => pickTool('pin')}>
              Pin a note
            </button>
            {canAsk && (
              <button type="button" onClick={() => startJob('ask', { page: current, selection: '' })}>
                Ask about this slide
              </button>
            )}
          </div>
          <p className="muted small" data-testid="tool-hint">
            {tool === 'area'
              ? 'Drag a box over part of the slide.'
              : tool === 'pin'
                ? 'Tap the slide where the note goes.'
                : 'Select words on the slide to highlight them.'}
          </p>

          {pending && (
            <PendingCard
              pending={pending}
              canAsk={canAsk}
              onSave={save}
              canPicture={canPicture}
              onExplain={() => startJob('explain', { page: pending.page, selection: pending.text, pending, ...(pending.kind === 'area' && { area: pending.rects[0] }) })}
              onAsk={() => startJob('ask', { page: pending.page, selection: pending.text, pending, ...(pending.kind === 'area' && { area: pending.rects[0] }) })}
              onCancel={() => {
                setPending(null);
                document.getSelection()?.removeAllRanges();
              }}
            />
          )}

          {job && (
            <AiCard
              job={job}
              onQuestion={(question) => setJob({ ...job, question })}
              onAsk={() => void ask(job)}
              onKeep={() => void keepAsNote(job)}
              onClose={closeJob}
            />
          )}

          {problem && (
            <p className="error" role="alert">
              {problem}
            </p>
          )}

          <h3 className="ann-heading">On slide {current}</h3>
          {onPage.length === 0 ? (
            <p className="muted small">No notes or highlights on this slide yet.</p>
          ) : (
            <ul className="ann-list" aria-label={`Notes and highlights on slide ${current}`}>
              {onPage.map((a) => (
                <AnnotationItem
                  key={a.id}
                  annotation={a}
                  active={a.id === activeId}
                  canAsk={canAsk}
                  onActivate={() => setActiveId(a.id)}
                  onChange={(change) => run(() => notes.update(a.id, change))}
                  onDelete={() => run(() => notes.remove(a.id))}
                  canPicture={canPicture}
                  onExplain={(selection) => startJob('explain', { page: a.page, selection, annotationId: a.id, ...(a.kind === 'area' && { area: a.rects[0] }) })}
                  onAsk={(selection) => startJob('ask', { page: a.page, selection, annotationId: a.id, ...(a.kind === 'area' && { area: a.rects[0] }) })}
                  wordsOf={() => wordsOf(a, rootRef.current)}
                />
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}

// --- On the slide ---

function NotesLayer({
  page,
  tool,
  annotations,
  pending,
  activeId,
  onPick,
  onMarked,
}: {
  page: number;
  tool: Tool;
  annotations: Annotation[];
  pending: Pending | null;
  activeId: string | null;
  onPick: (id: string) => void;
  onMarked: (pending: Pending) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);

  const at = (e: ReactPointerEvent) => {
    const box = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  };

  // While a tool is on, the layer takes presses itself: no swipe, no text selection
  const handlers =
    tool === 'select'
      ? {}
      : {
          onPointerDown(e: ReactPointerEvent) {
            e.stopPropagation();
            e.preventDefault();
            layerRef.current?.setPointerCapture?.(e.pointerId);
            if (tool === 'area') setDrag({ from: at(e), to: at(e) });
          },
          onPointerMove(e: ReactPointerEvent) {
            e.stopPropagation();
            if (drag) setDrag({ ...drag, to: at(e) });
          },
          onPointerUp(e: ReactPointerEvent) {
            e.stopPropagation();
            const pageBox = layerRef.current!.getBoundingClientRect();
            if (tool === 'pin') {
              const point = toPagePoint(e.clientX, e.clientY, pageBox);
              if (point) onMarked({ page, kind: 'note', rects: [point], text: '' });
              return;
            }
            if (!drag) return;
            const rect = boxBetween(drag.from, at(e));
            setDrag(null);
            if (rect.w < MIN_BOX || rect.h < MIN_BOX) return;
            onMarked({ page, kind: 'area', rects: [rect], text: textInArea(rect, textPieces(layerRef.current!.parentElement)) });
          },
          onPointerCancel(e: ReactPointerEvent) {
            e.stopPropagation();
            setDrag(null);
          },
        };

  return (
    <div ref={layerRef} className={`ann-layer tool-${tool}`} data-testid="notes-layer" {...handlers}>
      {annotations.map((a) =>
        a.kind === 'note' ? (
          <button
            key={a.id}
            type="button"
            className={`ann-pin c-${a.colour} ${a.id === activeId ? 'active' : ''}`}
            style={{ left: percent(a.rects[0]!.x), top: percent(a.rects[0]!.y) }}
            aria-label={`Note: ${a.note.slice(0, 60)}`}
            data-testid="pin"
            onClick={() => onPick(a.id)}
          />
        ) : (
          a.rects.map((r, i) => (
            <div
              key={`${a.id}-${i}`}
              className={`ann-mark ${a.kind} c-${a.colour} ${a.id === activeId ? 'active' : ''}`}
              style={{ left: percent(r.x), top: percent(r.y), width: percent(r.w), height: percent(r.h) }}
              data-testid="mark"
            />
          ))
        ),
      )}
      {pending &&
        pending.rects.map((r, i) =>
          pending.kind === 'note' ? (
            <span key={`p${i}`} className="ann-pin pending" style={{ left: percent(r.x), top: percent(r.y) }} />
          ) : (
            <div
              key={`p${i}`}
              className="ann-mark pending"
              style={{ left: percent(r.x), top: percent(r.y), width: percent(r.w), height: percent(r.h) }}
              data-testid="pending-mark"
            />
          ),
        )}
      {drag &&
        (() => {
          const r = boxBetween(drag.from, drag.to);
          return <div className="ann-mark pending" style={{ left: percent(r.x), top: percent(r.y), width: percent(r.w), height: percent(r.h) }} />;
        })()}
    </div>
  );
}

// --- In the panel ---

function ColourButtons({ label, current, onPick }: { label: (name: string) => string; current?: AnnotationColour; onPick: (c: AnnotationColour) => void }) {
  return (
    <span className="ann-colours">
      {ANNOTATION_COLOURS.map((c) => (
        <button
          key={c}
          type="button"
          className={`ann-swatch c-${c}`}
          aria-label={label(COLOUR_NAMES[c])}
          aria-pressed={current === undefined ? undefined : current === c}
          // Keep the selection on the slide while a colour is picked
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        />
      ))}
    </span>
  );
}

function PendingCard({
  pending,
  canAsk,
  canPicture,
  onSave,
  onExplain,
  onAsk,
  onCancel,
}: {
  pending: Pending;
  canAsk: boolean;
  canPicture: boolean;
  onSave: (colour: AnnotationColour, note?: string) => Promise<void>;
  onExplain: () => void;
  onAsk: () => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [colour, setColour] = useState<AnnotationColour>('yellow');

  if (pending.kind === 'note') {
    return (
      <form
        className="ann-card"
        aria-label="New note"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(colour, note);
        }}
      >
        <label htmlFor="new-note">Note on slide {pending.page}</label>
        <textarea id="new-note" value={note} maxLength={NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} autoFocus />
        <ColourButtons label={(n) => `Colour ${n}`} current={colour} onPick={setColour} />
        <div className="row">
          <button type="submit" className="primary" disabled={!note.trim()}>
            Save note
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const tooLong = pending.text.length > 5_000;
  return (
    <div className="ann-card" role="group" aria-label={pending.kind === 'text' ? 'Selected words' : 'New box'}>
      <p className="ann-quote">
        {pending.kind === 'text' ? `“${excerpt(pending.text)}”` : pending.text ? `Box: “${excerpt(pending.text)}”` : `A box on slide ${pending.page}`}
      </p>
      {tooLong ? (
        <p className="error">That’s a lot to highlight at once: select less.</p>
      ) : (
        <div className="ann-row">
          <span className="small">Highlight:</span>
          <ColourButtons label={(n) => `Highlight ${n.toLowerCase()}`} onPick={(c) => void onSave(c)} />
        </div>
      )}
      <div className="row">
        {canAsk && (pending.text || (pending.kind === 'area' && canPicture)) && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onExplain}>
            Explain this
          </button>
        )}
        {canAsk && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onAsk}>
            Ask about this
          </button>
        )}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AiCard({
  job,
  onQuestion,
  onAsk,
  onKeep,
  onClose,
}: {
  job: AiJob;
  onQuestion: (q: string) => void;
  onAsk: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  return (
    <section className="ann-card ann-ai" aria-label={job.mode === 'explain' ? 'Explanation' : 'Question for the AI'} aria-busy={job.busy}>
      <h3 className="ann-heading">{job.mode === 'explain' ? 'Explain this' : job.selection || job.area ? 'Ask about this' : `Ask about slide ${job.page}`}</h3>
      {job.selection && <p className="ann-quote">“{excerpt(job.selection)}”</p>}
      {job.mode === 'ask' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (job.question.trim()) onAsk();
          }}
        >
          <label htmlFor="ai-question">Your question</label>
          <textarea id="ai-question" rows={2} maxLength={1_000} value={job.question} onChange={(e) => onQuestion(e.target.value)} autoFocus />
          <button type="submit" disabled={job.busy || !job.question.trim()}>
            Ask
          </button>
        </form>
      )}
      {job.busy && (
        <p className="muted" role="status">
          Thinking…
        </p>
      )}
      {job.problem && (
        <p className="error" role="alert">
          {job.problem}{' '}
          {job.signIn && (
            <a href={signInUrl()} target="_blank" rel="noopener">
              Sign in for AI
            </a>
          )}
        </p>
      )}
      {job.answer && (
        <p className="ann-answer" data-testid="ai-answer">
          {job.answer}
        </p>
      )}
      <div className="row">
        {job.answer && (
          <button type="button" className="primary" onClick={onKeep}>
            Keep as note
          </button>
        )}
        <button type="button" onClick={onClose}>
          {job.busy ? 'Cancel' : 'Close'}
        </button>
      </div>
    </section>
  );
}

function AnnotationItem({
  annotation: a,
  active,
  canAsk,
  canPicture,
  onActivate,
  onChange,
  onDelete,
  onExplain,
  onAsk,
  wordsOf,
}: {
  annotation: Annotation;
  active: boolean;
  canAsk: boolean;
  /** A box can be explained from its picture (#175), words or not. */
  canPicture: boolean;
  onActivate: () => void;
  onChange: (change: AnnotationChange) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onExplain: (selection: string) => void;
  onAsk: (selection: string) => void;
  wordsOf: () => string;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(a.note);
  const [confirming, setConfirming] = useState(false);
  const label = a.kind === 'text' ? `“${excerpt(a.text)}”` : a.kind === 'area' ? 'Box' : 'Note';

  return (
    <li className={`ann-item c-${a.colour} ${active ? 'active' : ''}`} data-testid="annotation" onFocus={onActivate} onClick={onActivate}>
      <p className="ann-quote">{label}</p>
      {editing ? (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onChange({ note })) setEditing(false);
          }}
        >
          <label htmlFor={`note-${a.id}`}>Note</label>
          <textarea id={`note-${a.id}`} rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <div className="row">
            <button type="submit" className="primary">
              Save note
            </button>
            <button
              type="button"
              onClick={() => {
                setNote(a.note);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        a.note && <p className="ann-note">{a.note}</p>
      )}
      <ColourButtons label={(n) => `Colour ${n}`} current={a.colour} onPick={(colour) => void onChange({ colour })} />
      <div className="row ann-actions">
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setNote(a.note);
              setEditing(true);
            }}
          >
            {a.note ? 'Edit note' : 'Add a note'}
          </button>
        )}
        {canAsk && a.kind !== 'note' && (
          <button type="button" onClick={() => onExplain(wordsOf())} disabled={!wordsOf() && !(a.kind === 'area' && canPicture)}>
            Explain this
          </button>
        )}
        {canAsk && (
          <button type="button" onClick={() => onAsk(wordsOf())}>
            Ask about this
          </button>
        )}
        {confirming ? (
          <>
            <button type="button" className="danger" onClick={() => void onDelete()}>
              Delete for good
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

// --- Helpers ---

/** The slide's page box (PDF.js draws it; data-rendered holds its page number once drawn). */
function pageElement(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('.sv-page') ?? null;
}

/** The text layer's pieces of text with their positions on the page. */
function textPieces(pageBox: HTMLElement | null): { rect: PageRect; text: string }[] {
  if (!pageBox) return [];
  const box = pageBox.getBoundingClientRect();
  return Array.from(pageBox.querySelectorAll<HTMLElement>('.textLayer span'))
    .filter((span) => span.children.length === 0)
    .map((span) => ({ rect: toPageRect(span.getBoundingClientRect(), box), text: span.textContent ?? '' }))
    .filter((p): p is { rect: PageRect; text: string } => p.rect !== null);
}

/** What an annotation is about, for the AI: its words, or the words inside its box. */
function wordsOf(a: Annotation, root: HTMLElement | null): string {
  if (a.kind === 'text') return a.text;
  if (a.kind === 'area') return textInArea(a.rects[0]!, textPieces(pageElement(root)));
  return a.note;
}

function excerpt(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
