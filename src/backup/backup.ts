// Making and opening backups. Making one copies the store's sealed records (no decryption at all);
// opening one unlocks its keyring, then decrypts every record once to prove the file is whole,
// before anything on this device is touched.
import type { SealedSnapshot, StudyStore } from '../db/store';
import { decryptBytes, recordAad } from '../lib/crypto';
import type { EncryptedRecord } from '../types/crypto';
import { BackupError, encodeBackup, type Backup } from './format';

/** What a backup holds, for "are you sure?" before restoring. Counts per store, change log left out. */
export interface BackupSummary {
  createdAt: string;
  counts: Record<string, number>;
}

/** The part of the store backups use. */
export type BackupStore = Pick<StudyStore, 'status' | 'exportSealed' | 'replaceFromBackup' | 'latestChange'>;

/** A backup of everything in the store now, as the file's text, and the change it goes up to. */
export async function makeBackup(store: BackupStore, now: Date): Promise<{ text: string; upTo: number }> {
  const upTo = await store.latestChange();
  const snapshot = await store.exportSealed();
  return { text: encodeBackup({ createdAt: now.toISOString(), snapshot }), upTo };
}

/** Stores left out of a backup's summary (they aren't things a person counts). */
const HIDDEN_FROM_COUNTS = new Set(['changes', 'deckFiles', 'deckPages', 'settings', 'materialFiles', 'materialPages', 'examStyles']);
/** Store names in people's words, for describeCounts. */
const COUNT_NAMES: Record<string, string> = { courses: 'classes', slideDecks: 'slide decks', quizAttempts: 'quizzes', studySessions: 'study sessions', materials: 'class documents' };

/**
 * Checks that `dataKey` opens every record in the backup (each with its own additional data, so a
 * record moved or swapped fails too). Throws BackupError 'damaged' if one doesn't.
 */
export async function openBackup(backup: Backup, dataKey: CryptoKey): Promise<BackupSummary> {
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(backup.snapshot.stores)) {
    for (const row of rows as { id: string; enc: EncryptedRecord }[]) {
      try {
        // Only that it decrypts (authentic, in its place): PDFs (deckFiles) are raw bytes, not JSON
        await decryptBytes(dataKey, recordAad(name, row.id), row.enc);
      } catch {
        throw new BackupError('damaged', 'That backup is damaged: part of it won’t decrypt.');
      }
    }
    // What a person would count: no change log, no PDF/page-text stores (they mirror the decks), no zeros
    if (!HIDDEN_FROM_COUNTS.has(name) && rows.length > 0) counts[COUNT_NAMES[name] ?? name] = rows.length;
  }
  return { createdAt: backup.createdAt, counts };
}

/** Replaces this device's data with the backup's (after openBackup said it's whole). */
export function restoreBackup(store: BackupStore, snapshot: SealedSnapshot, dataKey: CryptoKey): Promise<void> {
  return store.replaceFromBackup(snapshot, dataKey);
}

/** "3 decks, 12 notes, 20 cards, 41 reviews" from a summary. */
export function describeCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([name, n]) => `${n.toLocaleString('en')} ${n === 1 ? singular(name) : name}`);
  return parts.length ? parts.join(', ') : 'nothing yet';
}

function singular(name: string): string {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('zzes')) return name.slice(0, -3); // quizzes
  if (name.endsWith('sses') || name.endsWith('xes')) return name.slice(0, -2);
  return name.endsWith('s') ? name.slice(0, -1) : name;
}
