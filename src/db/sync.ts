// The store's side of sync (#105, docs/SECURITY.md "Changes"): sealing this device's changes for the server,
// opening other devices' changes from it, applying them (the later change wins), and this device's sync
// state. The engine that talks to the server is src/sync/engine.ts; it never sees the data key.
//
// - A change goes to the server sealed again with additional data `honed:v1:sync:<change id>` and EVERYTHING
//   inside (entity, its id, put or delete, when, which device, the record): the local change rows can't go as
//   they are, because their additional data covers only the store and the id, not their readable fields.
//   The server keeps the readable copies as hints; opening a change refuses one whose hints disagree.
// - Applying a change writes the record sealed by this device (its readable fields worked out again, never
//   taken from the hints) and logs the change with its own id, device and time, so it's never sent back, a
//   second copy is skipped, and the latest change of each record can be found. The later `at` wins; the device
//   id breaks ties. Deletes are changes like any other, so a deleted record doesn't come back.
// - This device's clock for change times only moves forward past every change it has applied (`seenAt`), so an
//   edit made after seeing another device's edit wins over it even if this device's clock is a little behind.
import { decryptRecord, encryptRecord } from '../lib/crypto';
import type { EncryptedRecord } from '../types/crypto';
import { StoreError } from './store';
import type { ChangeRecord, HonedDb, RecordStore } from './schema';

type Row = Record<string, unknown>;

/** Where each change-log entity lives. */
export const ENTITY_STORE: Record<ChangeRecord['entity'], RecordStore> = {
  course: 'courses',
  exam: 'exams',
  slideDeck: 'slideDecks',
  lecture: 'lectures',
  section: 'sections',
  question: 'questions',
  quizAttempt: 'quizAttempts',
  studySession: 'studySessions',
  settings: 'settings',
  annotation: 'annotations',
  material: 'materials',
  examStyle: 'examStyles',
};
const ENTITIES = new Set(Object.keys(ENTITY_STORE));

/** This device's sync state, in its own `meta` (never in backups or synced). */
export interface SyncState {
  email: string; // the account it syncs with
  pulled: number; // the server's number of the last change applied here
  pushedSeq: number; // this device's change-log number up to which its own changes have been sent
  keyringVersion: number; // the server's keyring version this device last took or sent
  keyringSent: string; // the keyring as last taken or sent (JSON), to notice a change made here
  seenAt: number; // the latest change time applied from another device (ms), for the clock
  lastSyncAt: string | null;
  lastError: string | null;
}

/** A change as it travels: hints in the clear, everything sealed. */
export interface WireChange {
  id: string;
  entity: ChangeRecord['entity'];
  entityId: string;
  op: ChangeRecord['op'];
  at: string;
  sealed: EncryptedRecord;
}

export const syncAad = (changeId: string) => `honed:v1:sync:${changeId}`;

export interface SyncDeps {
  db: HonedDb;
  key: () => CryptoKey | null;
  device: string;
  seal: (name: RecordStore, plain: Row) => Promise<Row>;
  openAll: <T>(name: RecordStore, rows: unknown[]) => Promise<T[]>;
  exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  newId: () => string;
  changeAt: () => string;
  /** Called with the latest time applied, so the clock moves past it. */
  seen: (at: number) => void;
}

export function syncMethods({ db, key, device, seal, openAll, exclusive, newId, changeAt, seen }: SyncDeps) {
  const requireKey = () => {
    const k = key();
    if (!k) throw new StoreError('locked', 'Unlock first.');
    return k;
  };

  return {
    async getSyncState(): Promise<SyncState | null> {
      return ((await db.get('meta', 'sync'))?.value as SyncState | undefined) ?? null;
    },

    async setSyncState(state: SyncState | null): Promise<void> {
      if (state === null) {
        await db.delete('meta', 'sync');
        await db.delete('meta', 'syncFiles'); // sync off: on again, every deck's files are checked again
      } else await db.put('meta', { key: 'sync', value: state });
    },

    /** Decks whose files are here but not yet on the server (#108). */
    async filesToUpload(): Promise<string[]> {
      const up = new Set(((await db.get('meta', 'syncFiles'))?.value as string[] | undefined) ?? []);
      // Decks' files and class materials' files (#120) travel the same way, by their (unique) ids
      const ids = [...((await db.getAllKeys('deckFiles')) as string[]), ...((await db.getAllKeys('materialFiles')) as string[])];
      return ids.filter((id) => !up.has(id));
    },

    /** A deck's files as stored here, sealed (nothing is decrypted), to send as they are (#108). */
    async sealedDeckFiles(deckId: string): Promise<{ pdf: EncryptedRecord; pages: EncryptedRecord | null } | null> {
      requireKey();
      // A deck's, or else a class material's (#120): `pdf` is the file either way, `pages` its text
      const isDeck = (await db.get('deckFiles', deckId)) !== undefined;
      const pdf = (await db.get(isDeck ? 'deckFiles' : 'materialFiles', deckId)) as { enc?: EncryptedRecord } | undefined;
      if (!pdf?.enc) return null;
      const pages = (await db.get(isDeck ? 'deckPages' : 'materialPages', deckId)) as { enc?: EncryptedRecord } | undefined;
      return { pdf: pdf.enc, pages: pages?.enc ?? null };
    },

    /** Notes that a deck's files are on the server (sent from here, or fetched from there) (#108). */
    markFilesUp: (deckId: string) =>
      exclusive(async () => {
        const up = new Set(((await db.get('meta', 'syncFiles'))?.value as string[] | undefined) ?? []);
        up.add(deckId);
        await db.put('meta', { key: 'syncFiles', value: [...up] });
      }),

    /** This device's change-log rows after `seq` that it made itself (not ones applied from elsewhere). */
    async ownChangesSince(seq: number): Promise<ChangeRecord[]> {
      requireKey();
      const rows = await db.getAll('changes', IDBKeyRange.lowerBound(seq, true));
      return (await openAll<ChangeRecord>('changes', rows)).filter((c) => c.deviceId === device);
    },

    /** The newest change-log number (0 if none). */
    async latestSeq(): Promise<number> {
      const cursor = await db.transaction('changes').store.openCursor(null, 'prev');
      return (cursor?.key as number | undefined) ?? 0;
    },

    /** Every record now, as one `put` each (for the first device to sync: its state, not its history). */
    async snapshotChanges(): Promise<ChangeRecord[]> {
      requireKey();
      const out: ChangeRecord[] = [];
      for (const [entity, store] of Object.entries(ENTITY_STORE) as [ChangeRecord['entity'], RecordStore][]) {
        const records = await openAll<Row>(store, await db.getAll(store));
        for (const data of records) {
          out.push({ id: newId(), deviceId: device, at: changeAt(), entity, entityId: String(data.id), op: 'put', data: data as unknown as ChangeRecord['data'] });
        }
      }
      return out;
    },

    async sealForSync(changes: ChangeRecord[]): Promise<WireChange[]> {
      const k = requireKey();
      return Promise.all(
        changes.map(async (c) => {
          const { seq: _seq, ...whole } = c;
          return { id: c.id, entity: c.entity, entityId: c.entityId, op: c.op, at: c.at, sealed: await encryptRecord(k, syncAad(c.id), whole) };
        }),
      );
    },

    /** Opens changes from the server. Refuses (StoreError 'invalid') one that won't open or whose hints disagree. */
    async openFromSync(wire: WireChange[]): Promise<ChangeRecord[]> {
      const k = requireKey();
      return Promise.all(
        wire.map(async (w) => {
          let c: ChangeRecord;
          try {
            c = await decryptRecord<ChangeRecord>(k, syncAad(w.id), w.sealed);
          } catch {
            throw new StoreError('invalid', 'A change from the server can’t be opened with this key.');
          }
          const fine =
            c.id === w.id &&
            c.entity === w.entity &&
            c.entityId === w.entityId &&
            c.op === w.op &&
            c.at === w.at &&
            ENTITIES.has(c.entity) &&
            typeof c.deviceId === 'string' &&
            (c.op === 'delete' ? c.data === null : typeof c.data === 'object' && c.data !== null && (c.data as { id?: unknown }).id === c.entityId);
          if (!fine) throw new StoreError('invalid', 'A change from the server doesn’t match what it says it is.');
          return c;
        }),
      );
    },

    /** Applies other devices' changes, oldest first. Gives how many records changed here. */
    applyRemote: (changes: ChangeRecord[]) =>
      exclusive(async () => {
        requireKey();
        const latest = new Map<string, { at: string; deviceId: string }>();
        const have = new Set<string>();
        const ops: ({ kind: 'put'; store: RecordStore; row: Row } | { kind: 'delete'; store: RecordStore; id: string } | { kind: 'log'; row: Row })[] = [];
        let changed = 0;
        let newest = 0;
        for (const c of changes) {
          if (have.has(c.id) || (await db.getKeyFromIndex('changes', 'byId', c.id)) !== undefined) continue; // already here
          have.add(c.id);
          let current = latest.get(c.entityId);
          if (current === undefined) {
            const rows = await openAll<ChangeRecord>('changes', await db.getAllFromIndex('changes', 'byEntity', c.entityId));
            for (const r of rows) if (!current || later(r, current)) current = { at: r.at, deviceId: r.deviceId };
          }
          if (!current || later(c, current)) {
            latest.set(c.entityId, { at: c.at, deviceId: c.deviceId });
            const store = ENTITY_STORE[c.entity];
            if (c.op === 'put') ops.push({ kind: 'put', store, row: await seal(store, { ...(c.data as unknown as Row) }) });
            else {
              ops.push({ kind: 'delete', store, id: c.entityId });
              if (c.entity === 'slideDeck') {
                ops.push({ kind: 'delete', store: 'deckFiles', id: c.entityId }, { kind: 'delete', store: 'deckPages', id: c.entityId });
              }
              if (c.entity === 'material') {
                ops.push({ kind: 'delete', store: 'materialFiles', id: c.entityId }, { kind: 'delete', store: 'materialPages', id: c.entityId });
              }
            }
            changed++;
          }
          const { seq: _seq, ...logged } = c;
          ops.push({ kind: 'log', row: await seal('changes', logged) });
          newest = Math.max(newest, Date.parse(c.at));
        }
        if (ops.length === 0) return 0;
        const names = [...new Set(ops.map((o) => (o.kind === 'log' ? 'changes' : o.store)))] as RecordStore[];
        const tx = db.transaction(names, 'readwrite');
        for (const o of ops) {
          if (o.kind === 'put') await tx.objectStore(o.store).put(o.row as never);
          else if (o.kind === 'delete') await tx.objectStore(o.store).delete(o.id);
          else await tx.objectStore('changes').add(o.row as never);
        }
        await tx.done;
        if (newest) seen(newest);
        return changed;
      }),
  };
}

/** Whether change `a` is later than `b`: the later time, and the device id breaking ties. */
export function later(a: { at: string; deviceId: string }, b: { at: string; deviceId: string }): boolean {
  return a.at > b.at || (a.at === b.at && a.deviceId > b.deviceId);
}
