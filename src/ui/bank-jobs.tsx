// Making question banks in the background (Nathan's request, Nov 18): when "What was covered?" is saved
// with "Make quiz questions now" on, its sections join this queue, and the AI fills their banks one at
// a time (the helper runs one request per person at a time) while you go on using the app, so the quiz
// is ready the first time you want it. It lives with the app (App.tsx), not with a screen, so leaving
// the class page doesn't stop it. A lapsed sign-in pauses it with "Sign in for AI" and "Try again";
// locking the app stops it (nothing can be saved while locked). It isn't kept across a reload: a
// section left without questions can still be filled from its Quiz page.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AiError } from '../ai/backend';
import { signInUrl } from '../ai/http';
import type { StudyStore } from '../db/store';
import { fillBank, guideForQuestions, type BankProgress } from '../quiz/bank';
import { useAi } from './ai-context';
import { slidesLabel } from './classes';
import { messageOf } from './useLoad';

export interface Job {
  sectionId: string;
  label: string; // "Cells, slides 2–4"
}

export interface JobsState {
  waiting: Job[];
  current: (Job & { progress: BankProgress | null }) | null;
  done: { job: Job; added: number }[];
  problem: { message: string; signIn: boolean } | null;
}

interface BankJobs {
  state: JobsState;
  /** Queues these sections' banks (each once). */
  enqueue(jobs: Job[]): void;
  retry(): void;
  dismiss(): void;
  /** Stops and forgets everything (the app was locked). */
  stop(): void;
}

const Context = createContext<BankJobs | null>(null);

export function useBankJobs(): BankJobs {
  const jobs = useContext(Context);
  if (!jobs) throw new Error('useBankJobs() outside <BankJobsProvider>');
  return jobs;
}

/** A section's label for the status line. */
export function jobLabel(deckTitle: string, firstPage: number, lastPage: number): string {
  return `${deckTitle}, ${slidesLabel(firstPage, lastPage)}`;
}

/** The queue itself: plain state changed in one place, and a callback to redraw the status line. */
class Queue {
  state: JobsState = { waiting: [], current: null, done: [], problem: null };
  private running = false;
  private abort: AbortController | null = null;
  private generation = 0; // bumped by stop(), so a run that was stopped never writes again

  constructor(
    private readonly fill: (job: Job, signal: AbortSignal, onProgress: (p: BankProgress) => void) => Promise<number>,
    private readonly changed: () => void,
  ) {}

  private set(change: Partial<JobsState>) {
    this.state = { ...this.state, ...change };
    this.changed();
  }

  enqueue(jobs: Job[]) {
    const known = new Set([...this.state.waiting.map((j) => j.sectionId), this.state.current?.sectionId]);
    const fresh = jobs.filter((j) => !known.has(j.sectionId));
    if (fresh.length === 0) return;
    this.set({ waiting: [...this.state.waiting, ...fresh] });
    void this.work();
  }

  retry() {
    this.set({ problem: null });
    void this.work();
  }

  dismiss() {
    this.set({ done: [], problem: this.state.problem?.signIn ? this.state.problem : null });
  }

  stop() {
    this.generation++;
    this.abort?.abort();
    this.running = false;
    this.set({ waiting: [], current: null, done: [], problem: null });
  }

  private async work() {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    try {
      while (generation === this.generation && !this.state.problem?.signIn) {
        const [job, ...rest] = this.state.waiting;
        if (!job) break;
        this.set({ waiting: rest, current: { ...job, progress: null } });
        this.abort = new AbortController();
        try {
          const added = await this.fill(job, this.abort.signal, (progress) => {
            if (generation === this.generation && this.state.current?.sectionId === job.sectionId) {
              this.set({ current: { ...job, progress } });
            }
          });
          if (generation !== this.generation) return;
          this.set({ current: null, done: [...this.state.done, { job, added }] });
        } catch (err) {
          if (generation !== this.generation || (err instanceof AiError && err.code === 'cancelled')) return;
          const signIn = err instanceof AiError && err.code === 'signed-out';
          // Signed out: back to the front of the line, waiting for "Try again"; anything else: go on with the rest
          this.set({
            current: null,
            waiting: signIn ? [job, ...this.state.waiting] : this.state.waiting,
            problem: { message: `${job.label}: ${messageOf(err)}`, signIn },
          });
        }
      }
    } finally {
      if (generation === this.generation) {
        this.running = false;
        this.abort = null;
      }
    }
  }
}

export function BankJobsProvider({ store, children }: { store: StudyStore; children: ReactNode }) {
  const ai = useAi();
  const [, redraw] = useState(0);
  const queue = useRef<Queue | null>(null);
  queue.current ??= new Queue(
    async (job, signal, onProgress) => {
      const section = (await store.listSections()).find((s) => s.id === job.sectionId);
      if (!section) throw new Error('That lecture was deleted.');
      const pageTexts = await store.getSlideDeckPages(section.deckId);
      // The class's guide brought up to date first (#123; sends nothing when it's current), then the questions follow it
      const guide = await guideForQuestions(store, ai, section.courseId, signal);
      return fillBank({ ai, store, section, pageTexts, guide, signal, onProgress });
    },
    () => redraw((n) => n + 1),
  );
  const q = queue.current;
  useEffect(() => () => q.stop(), [q]);

  return (
    <Context
      value={{
        state: q.state,
        enqueue: (jobs) => q.enqueue(jobs),
        retry: () => q.retry(),
        dismiss: () => q.dismiss(),
        stop: () => q.stop(),
      }}
    >
      {children}
    </Context>
  );
}

/** The status line, on every screen while there's something to say. */
export function BankJobsStatus() {
  const { state, retry, dismiss } = useBankJobs();
  const { current, waiting, done, problem } = state;
  if (!current && waiting.length === 0 && done.length === 0 && !problem) return null;
  const made = done.reduce((n, d) => n + d.added, 0);
  return (
    <div className="bank-jobs" role="status" data-testid="bank-jobs">
      {current && (
        <p>
          Making quiz questions for {current.label}…
          {current.progress && current.progress.total > 0 && (
            <span className="muted">
              {' '}
              ({current.progress.done} of {current.progress.total} parts)
            </span>
          )}
          {waiting.length > 0 && <span className="muted"> · {waiting.length} more waiting</span>}
        </p>
      )}
      {!current && problem && (
        <div className="stack">
          <p className="error">{problem.message}</p>
          <div className="row">
            {problem.signIn && (
              <a className="button" href={signInUrl()} target="_blank" rel="noopener">
                Sign in for AI
              </a>
            )}
            {problem.signIn ? (
              <button type="button" onClick={retry}>
                Try again
              </button>
            ) : (
              <button type="button" onClick={dismiss}>
                OK
              </button>
            )}
          </div>
        </div>
      )}
      {!current && !problem && waiting.length === 0 && done.length > 0 && (
        <p>
          Quiz questions ready: {made} for {done.map((d) => d.job.label).join('; ')}.{' '}
          <button type="button" className="link" onClick={dismiss}>
            OK
          </button>
        </p>
      )}
    </div>
  );
}
