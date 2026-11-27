// The store's part in AI work done in the background (#168, 5c; docs/SECURITY.md "AI work in the background").
// The data key never leaves the store, so the work client asks the store to make or open the results key, and
// to seal and open a job's note (which deck and pages it was: the helper carries it back without reading it).
// The work state (which jobs this device sent) is this device's own, in `meta`: never synced, never in backups.
import { decryptRecord, encryptRecord } from '../lib/crypto';
import { newResultsKey, openResultsKey } from '../lib/results-key';
import type { EncryptedRecord, NewResultsKey, ResultsKey } from '../types/crypto';
import type { HonedDb } from './schema';
import { StoreError } from './store';

/** A job's note, as the device seals it: what the result is about. */
export interface WorkNote {
  deckId: string;
  sectionId: string;
  /** Each page sent, with its fingerprint then (src/reading/sort.ts). */
  pages: { page: number; text: string; look: string }[];
}

/** A job this device sent, until its result is filed. */
export interface SentWork {
  sectionId: string;
  deckId: string;
  pages: number[];
  sentAt: string;
  /** When the next study session using it starts (the job's deadline), for "ready by" messages (#177). */
  neededBy?: string | null;
  /** The helper gave up on it: not sent again until WORK.retryAfterMs has passed. */
  failedAt?: string;
}

/** This device's background work (meta `work`). */
export interface WorkState {
  sent: Record<string, SentWork>; // by job id
  /** Sections looked at with nothing to read: section id -> "deck:first-last" (a changed range looks again). */
  checked?: Record<string, string>;
  /** The last problem, for Settings (null when the last round went well). */
  problem: string | null;
  lastRound: string | null;
}

export const workNoteAad = (jobId: string) => `honed:v1:work-note:${jobId}`;

export interface WorkStore {
  /** Makes a new results key for the account (unlocked only). */
  makeResultsKey(): Promise<{ upload: NewResultsKey; key: ResultsKey }>;
  /** Opens the account's results key from the server's copy; refuses one that isn't the account's. */
  openResultsKey(publicKey: Uint8Array, sealed: EncryptedRecord): Promise<ResultsKey>;
  sealWorkNote(jobId: string, note: WorkNote): Promise<EncryptedRecord>;
  openWorkNote(jobId: string, sealed: EncryptedRecord): Promise<WorkNote>;
  getWorkState(): Promise<WorkState>;
  setWorkState(state: WorkState | null): Promise<void>;
}

export const EMPTY_WORK: WorkState = { sent: {}, problem: null, lastRound: null };

export function workMethods({ db, key }: { db: HonedDb; key: () => CryptoKey | null }): WorkStore {
  const requireKey = () => {
    const k = key();
    if (!k) throw new StoreError('locked', 'Unlock first.');
    return k;
  };
  return {
    makeResultsKey: async () => newResultsKey(requireKey()),
    openResultsKey: async (publicKey, sealed) => openResultsKey(requireKey(), publicKey, sealed),
    sealWorkNote: async (jobId, note) => encryptRecord(requireKey(), workNoteAad(jobId), note),
    openWorkNote: async (jobId, sealed) => decryptRecord<WorkNote>(requireKey(), workNoteAad(jobId), sealed),
    async getWorkState() {
      const value = (await db.get('meta', 'work'))?.value as WorkState | undefined;
      return value ? { ...EMPTY_WORK, ...value } : { ...EMPTY_WORK, sent: {} };
    },
    async setWorkState(state) {
      if (state === null) await db.delete('meta', 'work');
      else await db.put('meta', { key: 'work', value: state });
    },
  };
}
