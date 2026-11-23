// StudyStore: everything the screens read and write, and the lock side (the `Vault` shape the
// screens use, agreed in issue #16). The only code that touches the database.
//
// Encryption (docs/SECURITY.md, #16):
// - status 'new': no keyring yet. Records are stored plain, exactly as in milestone 2, until setUp,
//   which encrypts everything already there. (Once the setup screen gates the app, this mode isn't
//   used; it keeps old data and old builds working until then.)
// - status 'locked': set up, key not given yet. Everything except status/getKeyring/unlock refuses
//   with StoreError 'locked'.
// - status 'unlocked': every record written is sealed: index fields readable, the rest in `enc`.
//
// How writes work: encryption is async, and an IndexedDB transaction commits as soon as nothing is
// pending, so we never encrypt inside one. Each write reads (one transaction), decrypts, works out
// the change, encrypts, then writes (a second transaction). Writes run one at a time (Web Locks
// across tabs where available, a queue within this one), so nothing slips in between.
//
// The clock and ids come in as `deps` (the real ones by default), so tests can fix them. The
// classes, lectures and slides themselves are in lectures.ts.
import { decryptBytes, decryptRecord, encryptBytes, encryptRecord, recallKey, recordAad } from '../lib/crypto';
import type { EncryptedRecord, Keyring, KeyringEntry, RememberedKey, UnlockMethod } from '../types/crypto';
import type { LectureStore, Section } from '../types/lecture';
import type { AnnotationStore } from '../types/annotation';
import type { PlanStore } from '../types/plan';
import type { QuizStore } from '../types/quiz';
import type { ExamStyleStore } from '../types/style';
import { annotationMethods } from './annotations';
import { lectureMethods, type FileSource } from './lectures';
import { planMethods } from './plan';
import { quizMethods } from './quiz';
import { styleMethods } from './style';
import { syncMethods, type SyncState, type WireChange } from './sync';
import { DB_VERSION, openHonedDb, RECORD_STORES, type ChangeRecord, type HonedDb, type RecordStore } from './schema';

export type StoreStatus = 'new' | 'locked' | 'unlocked';

export interface StudyStore extends LectureStore, QuizStore, PlanStore, AnnotationStore, ExamStyleStore {
  deviceId(): string;

  // --- The lock side (the screens' `Vault`, src/ui/vault.ts) ---
  status(): StoreStatus;
  /** Readable while locked (the unlock screen needs the passkey entries). Null before setup. */
  getKeyring(): Promise<Keyring | null>;
  /** Saves the first keyring, encrypts all existing data, and leaves the store unlocked. */
  setUp(keyring: Keyring, dataKey: CryptoKey, onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Checks the key against the one saved at setup ('wrong-key' if not), finishes an interrupted setUp. */
  unlock(dataKey: CryptoKey): Promise<void>;
  lock(): void;
  /**
   * This device's remembered unlock (#99, docs/SECURITY.md "Remembering a device"), readable while
   * locked so the app can open without asking. Null when this device doesn't remember. Never in
   * backups or the keyring.
   */
  getRemembered(): Promise<RememberedKey | null>;
  /** Remembers the unlock on this device (unlocked only: it's checked against the open key). */
  remember(remembered: RememberedKey): Promise<void>;
  /** Forgets this device's remembered unlock: the next open asks again. Works locked or unlocked. */
  forget(): Promise<void>;
  addKeyringEntry(entry: KeyringEntry): Promise<void>;
  removeKeyringEntry(id: string): Promise<void>;
  /** Removes every entry of `method` and adds `entry`, in one go (change passphrase, new recovery key). */
  replaceKeyringEntries(method: UnlockMethod, entry: KeyringEntry): Promise<void>;

  // --- Backups (#18, src/backup/): records travel exactly as stored, sealed ---
  /** Every record of every store as stored (sealed), the keyring and the key check. Unlocked only. */
  exportSealed(): Promise<SealedSnapshot>;
  /**
   * Replaces all records and the keyring with a backup's, in one transaction (all or nothing), and
   * leaves the store unlocked with `dataKey`. Refuses with 'wrong-key' if `dataKey` doesn't open the
   * backup, 'invalid' for a newer schema or a record that isn't sealed, and 'locked' while locked.
   */
  replaceFromBackup(snapshot: SealedSnapshot, dataKey: CryptoKey): Promise<void>;
  /** The newest change-log row's number (0 if none), so backups can tell whether anything changed. */
  latestChange(): Promise<number>;

  /** Change-log rows after `seq` (0 = all), oldest first. For v2's sync, and for tests. */
  changesSince(seq: number): Promise<ChangeRecord[]>;

  // --- Sync (#105, src/db/sync.ts, docs/SECURITY.md "Accounts and sync") ---
  getSyncState(): Promise<SyncState | null>;
  setSyncState(state: SyncState | null): Promise<void>;
  ownChangesSince(seq: number): Promise<ChangeRecord[]>;
  latestSeq(): Promise<number>;
  snapshotChanges(): Promise<ChangeRecord[]>;
  sealForSync(changes: ChangeRecord[]): Promise<WireChange[]>;
  openFromSync(wire: WireChange[]): Promise<ChangeRecord[]>;
  applyRemote(changes: ChangeRecord[]): Promise<number>;
  filesToUpload(): Promise<string[]>;
  sealedDeckFiles(deckId: string): Promise<{ pdf: EncryptedRecord; pages: EncryptedRecord | null } | null>;
  markFilesUp(deckId: string): Promise<void>;
  /** Where a deck's files come from when they aren't here (#108: the sync server), or null for nowhere. */
  setFileSource(source: FileSource | null): void;
  /** This device's key check (as stored; the account's must be the same). Null before setup. */
  getKeycheck(): Promise<EncryptedRecord | null>;
  /**
   * Takes the account's keyring (a newer version from the server). Only one for the same data key: the key
   * check must stay the same, and the keyring rule holds. Unlocked only.
   */
  adoptKeyring(keyring: Keyring): Promise<void>;
  /**
   * Joins the account on this device: replaces every record (if any) with nothing, and the keyring and key
   * check with the account's, unlocked with `dataKey` (checked against the key check). The engine then
   * downloads everything. Forgets a remembered unlock and the sync state.
   */
  joinAccount(keyring: Keyring, keycheck: EncryptedRecord, dataKey: CryptoKey): Promise<void>;
  close(): void;
}

/** A whole database as stored, for a backup (#18). Every record is sealed. */
export interface SealedSnapshot {
  schema: number; // DB_VERSION when it was taken
  keyring: Keyring;
  keycheck: EncryptedRecord;
  /** Every record store (RECORD_STORES), rows exactly as stored. */
  stores: Record<string, unknown[]>;
}

export type StoreErrorCode = 'not-found' | 'invalid' | 'locked' | 'wrong-key';

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export interface StoreDeps {
  /** Now, for createdAt/updatedAt and change-log times. */
  clock: () => Date;
  newId: () => string;
  /** Records encrypted per write during setUp's migration (smaller in tests). */
  migrationBatch: number;
}

const realDeps: StoreDeps = {
  clock: () => new Date(),
  newId: () => crypto.randomUUID(),
  migrationBatch: 200,
};

/** The fields each store keeps readable when sealed (docs/SECURITY.md, "What stays readable"). */
const READABLE: Record<RecordStore, readonly string[]> = {
  changes: ['seq', 'id', 'at', 'entity', 'entityId', 'op'],
  courses: ['id'],
  exams: ['id', 'courseId', 'date'],
  slideDecks: ['id', 'courseId'],
  deckFiles: ['id'], // sealed as raw bytes (encryptBytes), see seal()
  deckPages: ['id'],
  lectures: ['id', 'courseId', 'date'],
  sections: ['id', 'courseId', 'lectureId', 'deckId'], // + nextDue, copied from schedule
  questions: ['id', 'courseId', 'sectionId'],
  quizAttempts: ['id', 'courseId', 'sectionId'],
  studySessions: ['id', 'courseId', 'sectionId'],
  settings: ['id'],
  annotations: ['id', 'courseId', 'deckId'],
  materials: ['id', 'courseId'],
  materialFiles: ['id'], // raw bytes, like deckFiles
  materialPages: ['id'],
  examStyles: ['id'], // examStyleId(the class)
};
const KEYCHECK_AAD = 'honed:v1:meta:keycheck';

type Row = Record<string, unknown>;
const isSealed = (row: unknown): row is Row & { enc: EncryptedRecord } =>
  typeof row === 'object' && row !== null && 'enc' in row;

export async function openStudyStore(options: { name?: string; deps?: Partial<StoreDeps> } = {}): Promise<StudyStore> {
  const deps: StoreDeps = { ...realDeps, ...options.deps };
  const db = await openHonedDb(options.name);
  const device = await loadDeviceId(db, deps);
  const hasKeyring = (await db.get('meta', 'keyring')) !== undefined;
  return makeStore(db, device, deps, hasKeyring);
}

async function loadDeviceId(db: HonedDb, deps: StoreDeps): Promise<string> {
  const tx = db.transaction('meta', 'readwrite');
  const found = await tx.store.get('deviceId');
  if (found) {
    await tx.done;
    return found.value as string;
  }
  const value = deps.newId();
  await tx.store.put({ key: 'deviceId', value });
  await tx.done;
  return value;
}

/** Always a passphrase or passkey (to unlock), and always a recovery key (for when you can't). */
function checkKeyring(entries: KeyringEntry[]) {
  // Google unlock counts as a way to unlock (#101); the recovery key is always kept as the safety net
  if (!entries.some((e) => e.method === 'passphrase' || e.method === 'passkey' || e.method === 'google')) {
    throw new StoreError('invalid', 'Keep at least one passphrase, passkey or Google unlock, or you couldn’t unlock.');
  }
  if (!entries.some((e) => e.method === 'recovery')) {
    throw new StoreError('invalid', 'Keep a recovery key, or a forgotten passphrase would lose everything.');
  }
}

function makeStore(db: HonedDb, device: string, deps: StoreDeps, keyringSaved: boolean): StudyStore {
  let key: CryptoKey | null = null;
  let hasKeyring = keyringSaved;
  // Change times only move forward past the latest change applied from another device (#105): an edit
  // made after seeing another device's edit then wins over it, even with this device's clock a little behind.
  let seenAt = 0;
  // And past this device's own last change (#120): two edits of one record in the same millisecond had the same
  // time and device, so another device couldn't tell which came last and kept the first.
  let lastAt = 0;
  const changeAt = () => {
    const at = Math.max(deps.clock().getTime(), seenAt + 1, lastAt + 1);
    lastAt = at;
    return new Date(at).toISOString();
  };
  const loadSeenAt = async () => {
    seenAt = Math.max(seenAt, ((await db.get('meta', 'sync'))?.value as SyncState | undefined)?.seenAt ?? 0);
  };
  const status = (): StoreStatus => (!hasKeyring ? 'new' : key ? 'unlocked' : 'locked');

  const requireOpen = () => {
    if (status() === 'locked') throw new StoreError('locked', 'Unlock first.');
  };

  // --- One write at a time, across tabs where the browser has Web Locks ---
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = (): Promise<T> => {
      const locks = (globalThis.navigator as Navigator | undefined)?.locks;
      return locks ? (locks.request('honed-store', fn) as Promise<T>) : fn();
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };

  // --- Sealing and opening records ---

  /** The record as stored: sealed when unlocked, plain before setup ('new'). */
  const seal = async (name: RecordStore, plain: Row): Promise<Row> => {
    if (!key) {
      requireOpen();
      return plain;
    }
    if (name === 'deckFiles' || name === 'materialFiles') {
      // A PDF (or a material's file): encrypted as raw bytes, so the ciphertext is the file's size plus a 16-byte tag
      const aad = recordAad(name, String(plain.id));
      return { id: plain.id, enc: await encryptBytes(key, aad, plain.data as Uint8Array) };
    }
    const readable: Row = {};
    const secret: Row = {};
    for (const [field, value] of Object.entries(plain)) {
      if (READABLE[name].includes(field)) readable[field] = value;
      else secret[field] = value;
    }
    if (readable.seq === undefined) delete readable.seq; // a new change row: IndexedDB numbers it
    if (name === 'sections') {
      readable.nextDue = (plain.schedule as Section['schedule']).nextDue;
    }
    return { ...readable, enc: await encryptRecord(key, recordAad(name, String(plain.id)), secret) };
  };

  /** The plain record from what's stored. */
  const open = async <T>(name: RecordStore, stored: unknown): Promise<T> => {
    if (!isSealed(stored)) return stored as T; // plain: before setup, or not yet migrated
    if (!key) throw new StoreError('locked', 'Unlock first.');
    if (name === 'deckFiles' || name === 'materialFiles') {
      return { id: stored.id, data: await decryptBytes(key, recordAad(name, String(stored.id)), stored.enc) } as T;
    }
    const secret = await decryptRecord<Row>(key, recordAad(name, String(stored.id)), stored.enc);
    const readable: Row = {};
    for (const field of READABLE[name]) if (field in stored) readable[field] = stored[field];
    return { ...secret, ...readable } as T;
  };

  const openAll = <T>(name: RecordStore, rows: unknown[]) => Promise.all(rows.map((r) => open<T>(name, r)));

  /** A change-log row, sealed, ready to add in the caller's write transaction. */
  const change = (entity: ChangeRecord['entity'], op: ChangeRecord['op'], entityId: string, data: ChangeRecord['data']) =>
    seal('changes', { id: deps.newId(), deviceId: device, at: changeAt(), entity, entityId, op, data });

  // --- Migration: seal every plain record (setUp, and an interrupted setUp finished by unlock) ---

  const migrate = async (onProgress?: (done: number, total: number) => void) => {
    const plain: Partial<Record<RecordStore, Row[]>> = {};
    let total = 0;
    for (const name of RECORD_STORES) {
      const rows = ((await db.getAll(name)) as unknown[]).filter((r) => !isSealed(r)) as Row[];
      plain[name] = rows;
      total += rows.length;
    }
    let done = 0;
    onProgress?.(done, total);
    for (const name of RECORD_STORES) {
      const rows = plain[name]!;
      for (let i = 0; i < rows.length; i += deps.migrationBatch) {
        const sealed = await Promise.all(rows.slice(i, i + deps.migrationBatch).map((r) => seal(name, r)));
        const tx = db.transaction(name, 'readwrite');
        for (const row of sealed) await tx.store.put(row as never);
        await tx.done;
        done += sealed.length;
        onProgress?.(done, total);
      }
    }
    await db.delete('meta', 'migration');
  };

  const keyringChange = (edit: (entries: KeyringEntry[]) => KeyringEntry[]) =>
    exclusive(async () => {
      if (status() !== 'unlocked') throw new StoreError('locked', 'Unlock first.');
      const keyring = (await db.get('meta', 'keyring'))?.value as Keyring;
      const entries = edit(keyring.entries);
      checkKeyring(entries);
      await db.put('meta', { key: 'keyring', value: { v: 1, entries } satisfies Keyring });
    });

  // Sync (#105, src/db/sync.ts), and where missing slide files come from (#108)
  let fileSource: FileSource | null = null;
  const syncPart = syncMethods({
    db,
    key: () => key,
    device,
    seal,
    openAll,
    exclusive,
    newId: deps.newId,
    changeAt,
    seen: (at) => {
      seenAt = Math.max(seenAt, at);
      void db.get('meta', 'sync').then((row) => {
        const state = row?.value as SyncState | undefined;
        if (state && state.seenAt < seenAt) return db.put('meta', { key: 'sync', value: { ...state, seenAt } });
      });
    },
  });

  return {    // Classes, exams, slide decks, lectures and sections (#24): src/db/lectures.ts
    ...lectureMethods({
      db,
      clock: deps.clock,
      newId: deps.newId,
      seal,
      open,
      openAll,
      change,
      exclusive,
      requireOpen,
      fileSource: () => fileSource,
      filesHere: (deckId) => syncPart.markFilesUp(deckId),
    }),
    // Question banks and quiz attempts (#40): src/db/quiz.ts
    ...quizMethods({ db, clock: deps.clock, newId: deps.newId, seal, open, openAll, change, exclusive, requireOpen }),
    // Study sessions and settings (#47): src/db/plan.ts
    ...planMethods({ db, clock: deps.clock, newId: deps.newId, seal, open, openAll, change, exclusive, requireOpen }),
    // Notes and highlights on slides (#56): src/db/annotations.ts
    ...annotationMethods({ db, clock: deps.clock, newId: deps.newId, seal, open, openAll, change, exclusive, requireOpen }),
    // Class materials and exam styles (#120): src/db/style.ts
    ...styleMethods({
      db,
      clock: deps.clock,
      newId: deps.newId,
      seal,
      open,
      openAll,
      change,
      exclusive,
      requireOpen,
      fileSource: () => fileSource,
      filesHere: (id) => syncPart.markFilesUp(id),
    }),

    deviceId: () => device,
    status,

    async getKeyring() {
      return ((await db.get('meta', 'keyring'))?.value as Keyring | undefined) ?? null;
    },

    setUp: (keyring, dataKey, onProgress) =>
      exclusive(async () => {
        if (hasKeyring) throw new StoreError('invalid', 'Already set up.');
        if (keyring?.v !== 1) throw new StoreError('invalid', 'Bad keyring.');
        checkKeyring(keyring.entries);
        const keycheck = await encryptRecord(dataKey, KEYCHECK_AAD, 'ok');
        const tx = db.transaction('meta', 'readwrite');
        await tx.store.put({ key: 'keyring', value: keyring });
        await tx.store.put({ key: 'keycheck', value: keycheck });
        await tx.store.put({ key: 'migration', value: 'running' });
        await tx.done;
        hasKeyring = true;
        key = dataKey;
        await migrate(onProgress);
      }),

    unlock: (dataKey) =>
      exclusive(async () => {
        if (!hasKeyring) throw new StoreError('invalid', 'Not set up yet.');
        const keycheck = (await db.get('meta', 'keycheck'))?.value as EncryptedRecord;
        try {
          await decryptRecord(dataKey, KEYCHECK_AAD, keycheck);
        } catch {
          throw new StoreError('wrong-key', 'That key doesn’t open this device’s data.');
        }
        key = dataKey;
        await loadSeenAt();
        if ((await db.get('meta', 'migration')) !== undefined) await migrate();
      }),

    lock() {
      key = null;
    },

    async getRemembered() {
      return ((await db.get('meta', 'remembered'))?.value as RememberedKey | undefined) ?? null;
    },

    remember: (remembered) =>
      exclusive(async () => {
        if (status() !== 'unlocked') throw new StoreError('locked', 'Unlock first.');
        // Only ever a key that opens this device's data: it must unwrap and pass the key check
        const keycheck = (await db.get('meta', 'keycheck'))?.value as EncryptedRecord;
        try {
          await decryptRecord(await recallKey(remembered), KEYCHECK_AAD, keycheck);
        } catch {
          throw new StoreError('wrong-key', 'That remembered unlock doesn’t open this device’s data.');
        }
        await db.put('meta', { key: 'remembered', value: remembered });
      }),

    async forget() {
      await db.delete('meta', 'remembered');
    },

    addKeyringEntry: (entry) => keyringChange((entries) => [...entries, entry]),

    removeKeyringEntry: (id) =>
      keyringChange((entries) => {
        if (!entries.some((e) => e.id === id)) throw new StoreError('not-found', 'That way of unlocking is already gone.');
        return entries.filter((e) => e.id !== id);
      }),

    replaceKeyringEntries: (method, entry) =>
      keyringChange((entries) => {
        if (entry.method !== method) throw new StoreError('invalid', 'The new entry is a different kind.');
        return [...entries.filter((e) => e.method !== method), entry];
      }),

    exportSealed: () =>
      exclusive(async () => {
        if (status() !== 'unlocked') throw new StoreError('locked', 'Unlock first.');
        const tx = db.transaction(['meta', ...RECORD_STORES], 'readonly');
        const keyring = (await tx.objectStore('meta').get('keyring'))?.value as Keyring;
        const keycheck = (await tx.objectStore('meta').get('keycheck'))?.value as EncryptedRecord;
        const migrating = (await tx.objectStore('meta').get('migration')) !== undefined;
        const stores: Record<string, unknown[]> = {};
        for (const name of RECORD_STORES) stores[name] = await tx.objectStore(name).getAll();
        await tx.done;
        // Unlocked means setUp's sealing has finished, but never let a plain record into a backup
        if (migrating || Object.values(stores).some((rows) => rows.some((r) => !isSealed(r)))) {
          throw new StoreError('invalid', 'Some records aren’t encrypted yet. Lock, unlock and try again.');
        }
        return { schema: DB_VERSION, keyring, keycheck, stores };
      }),

    replaceFromBackup: (snapshot, dataKey) =>
      exclusive(async () => {
        if (status() === 'locked') throw new StoreError('locked', 'Unlock first.');
        if (!Number.isInteger(snapshot.schema) || snapshot.schema > DB_VERSION) {
          throw new StoreError('invalid', 'This backup was made by a newer version. Update the app first.');
        }
        if (snapshot.keyring?.v !== 1) throw new StoreError('invalid', 'Bad keyring.');
        checkKeyring(snapshot.keyring.entries);
        try {
          await decryptRecord(dataKey, KEYCHECK_AAD, snapshot.keycheck);
        } catch {
          throw new StoreError('wrong-key', 'That key doesn’t open this backup.');
        }
        const rows: Partial<Record<RecordStore, Row[]>> = {};
        for (const name of RECORD_STORES) {
          const list = snapshot.stores[name] ?? [];
          if (!Array.isArray(list) || !list.every((r) => isSealed(r) && typeof r.id === 'string')) {
            throw new StoreError('invalid', `The backup’s ${name} aren’t all encrypted records.`);
          }
          rows[name] = list as Row[];
        }
        // One transaction: if anything fails, this device's data is left exactly as it was
        const tx = db.transaction(['meta', ...RECORD_STORES], 'readwrite');
        for (const name of RECORD_STORES) {
          const target = tx.objectStore(name);
          await target.clear();
          for (const row of rows[name]!) await target.put(row as never);
        }
        const meta = tx.objectStore('meta');
        await meta.put({ key: 'keyring', value: snapshot.keyring });
        await meta.put({ key: 'keycheck', value: snapshot.keycheck });
        await meta.delete('migration');
        await meta.delete('remembered'); // it was for the old data key (#99)
        await meta.delete('sync'); // the data was replaced wholesale: syncing starts again (#105)
        await meta.delete('syncFiles');
        await tx.done;
        hasKeyring = true;
        key = dataKey;
      }),

    async latestChange() {
      const cursor = await db.transaction('changes').store.openCursor(null, 'prev');
      return cursor ? Number(cursor.key) : 0;
    },

    async changesSince(seq) {
      requireOpen();
      return openAll<ChangeRecord>('changes', await db.getAll('changes', IDBKeyRange.lowerBound(seq, true)));
    },

    // --- Sync (#105): src/db/sync.ts ---
    ...syncPart,

    setFileSource(source) {
      fileSource = source;
    },

    async getKeycheck() {
      return ((await db.get('meta', 'keycheck'))?.value as EncryptedRecord | undefined) ?? null;
    },

    adoptKeyring: (keyring) =>
      exclusive(async () => {
        if (status() !== 'unlocked' || !key) throw new StoreError('locked', 'Unlock first.');
        if (keyring?.v !== 1 || !Array.isArray(keyring.entries)) throw new StoreError('invalid', 'Bad keyring.');
        checkKeyring(keyring.entries);
        await db.put('meta', { key: 'keyring', value: keyring });
      }),

    joinAccount: (keyring, keycheck, dataKey) =>
      exclusive(async () => {
        if (keyring?.v !== 1 || !Array.isArray(keyring.entries)) throw new StoreError('invalid', 'Bad keyring.');
        checkKeyring(keyring.entries);
        try {
          await decryptRecord(dataKey, KEYCHECK_AAD, keycheck);
        } catch {
          throw new StoreError('wrong-key', 'That key doesn’t open the account’s data.');
        }
        const tx = db.transaction(['meta', ...RECORD_STORES], 'readwrite');
        for (const name of RECORD_STORES) await tx.objectStore(name).clear();
        const meta = tx.objectStore('meta');
        await meta.put({ key: 'keyring', value: keyring });
        await meta.put({ key: 'keycheck', value: keycheck });
        await meta.delete('migration');
        await meta.delete('remembered');
        await meta.delete('sync');
        await meta.delete('syncFiles');
        await tx.done;
        hasKeyring = true;
        key = dataKey;
        seenAt = 0;
      }),

    close() {
      key = null;
      db.close();
    },
  };
}
