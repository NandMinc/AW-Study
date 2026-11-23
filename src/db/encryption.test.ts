// Encryption at rest (#16, docs/SECURITY.md): what's on disk, locking, the keyring rules, sealing
// what was written before setup, and the schema steps that dropped milestone 2's flashcards (#26).
// Uses the real crypto (with few PBKDF2 iterations).
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { newRecoveryKey, wrapWithPasskey, wrapWithPassphrase, wrapWithRecoveryKey } from '../lib/crypto';
import { CryptoError, type Keyring } from '../types/crypto';
import { DB_VERSION, openHonedDb, RECORD_STORES } from './schema';
import { openStudyStore, type StudyStore } from './store';
import { containsText, fakePdf, newDataKey, testKeyring } from './test-helpers';

const MARKER = 'SECRET-MARKER-42';
const T0 = new Date('2026-11-18T18:00:00Z');
let counter = 0;
const opened: StudyStore[] = [];
const freshName = () => `enc-${++counter}`;

async function open(name: string, deps = {}) {
  const store = await openStudyStore({ name, deps });
  opened.push(store);
  return store;
}

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

/** Some of everything, containing MARKER wherever a person can type (and inside the PDF). */
async function writeEverything(store: StudyStore) {
  const course = await store.createCourse({ name: `Class ${MARKER}`, meetings: [{ day: 1, start: '10:30', minutes: 50 }], termStart: null, termEnd: null });
  const deck = await store.addSlideDeck({
    courseId: course.id,
    title: `Deck ${MARKER}`,
    fileName: `${MARKER}.pdf`,
    data: fakePdf(MARKER),
    pageTexts: [`one ${MARKER}`, 'two'],
  });
  const lecture = await store.recordLecture({ courseId: course.id, date: '2026-11-16', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 2 }] });
  await store.addExam({ courseId: course.id, title: `Exam ${MARKER}`, kind: 'midterm', date: '2026-12-01', lectureIds: null });
  // Exam style (#120): a document (PDF and text), the notes and a guide
  const material = await store.addMaterial({
    courseId: course.id,
    title: `Outline ${MARKER}`,
    fileName: `${MARKER}.pdf`,
    kind: 'outline',
    type: 'application/pdf',
    data: fakePdf(MARKER),
    pageTexts: [`outline ${MARKER}`],
  });
  await store.addMaterial({ courseId: course.id, title: 'Notes', fileName: 'n.txt', kind: 'other', type: 'text/plain', data: new TextEncoder().encode(`text ${MARKER}`), pageTexts: [] });
  await store.setStyleNotes(course.id, `No proofs ${MARKER}`);
  await store.saveMadeGuide(course.id, { tests: `Tests ${MARKER}`, levels: [`one ${MARKER}`, 'two', 'three'], shortShare: 0.5 }, { lectureIds: [lecture.lecture.id], materialIds: [material.id], notesAt: null });
  return { course, deck, lecture, material };
}

/** Every row of every store, as stored. */
async function rawRows(name: string) {
  const db = await openHonedDb(name);
  const rows: Record<string, unknown[]> = {};
  for (const store of [...RECORD_STORES, 'meta'] as const) rows[store] = await db.getAll(store);
  db.close();
  return rows;
}

async function setUpNew(name: string) {
  const store = await open(name);
  const key = await newDataKey();
  await store.setUp(await testKeyring(key), key);
  return { store, key };
}

describe('on disk', () => {
  it('nothing a person wrote appears anywhere in the database, in any store', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    await writeEverything(store);
    const rows = await rawRows(name);
    expect(rows.sections!.length).toBeGreaterThan(0);
    for (const [storeName, list] of Object.entries(rows)) {
      expect(containsText(list, MARKER), `plaintext found in ${storeName}`).toBe(false);
    }
  });

  it('keeps the change log’s readable fields exactly as SECURITY.md lists them', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    await writeEverything(store);
    const rows = await rawRows(name);
    expect(Object.keys(rows.changes![0] as object).sort()).toEqual(['at', 'enc', 'entity', 'entityId', 'id', 'op', 'seq']);
    // The lecture stores' readable fields are checked in lectures.test.ts
  });

  it('before setup, records are plain, and setUp seals all of them', async () => {
    const name = freshName();
    const store = await open(name);
    await writeEverything(store);
    expect(containsText((await rawRows(name)).courses, MARKER)).toBe(true); // plain before setup
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    const rows = await rawRows(name);
    for (const s of RECORD_STORES) {
      expect(rows[s]!.every((r) => 'enc' in (r as object)), `unsealed rows left in ${s}`).toBe(true);
      expect(containsText(rows[s], MARKER), `plaintext left in ${s}`).toBe(false);
    }
  });

  it('a record moved into another record’s place won’t decrypt', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    const input = { meetings: [], termStart: null, termEnd: null };
    const a = await store.createCourse({ ...input, name: 'a' });
    const b = await store.createCourse({ ...input, name: 'b' });
    const db = await openHonedDb(name);
    const rowA = (await db.get('courses', a.id)) as { enc: unknown };
    const rowB = (await db.get('courses', b.id)) as object;
    await db.put('courses', { ...rowB, enc: rowA.enc } as never); // b's place, a's ciphertext
    db.close();
    await expect(store.getCourse(b.id)).rejects.toBeInstanceOf(CryptoError);
    expect((await store.getCourse(a.id))!.name).toBe('a');
  });
});

describe('locking', () => {
  it('is new, then unlocked after setUp, locked when opened again, and unlocked by the right key', async () => {
    const name = freshName();
    const first = await open(name);
    expect(first.status()).toBe('new');
    expect(await first.getKeyring()).toBeNull();
    const key = await newDataKey();
    await first.setUp(await testKeyring(key), key);
    expect(first.status()).toBe('unlocked');
    const { course } = await writeEverything(first);
    first.close();

    const again = await open(name);
    expect(again.status()).toBe('locked');
    expect((await again.getKeyring())!.entries.map((e) => e.method).sort()).toEqual(['passphrase', 'recovery']);
    await again.unlock(key);
    expect(again.status()).toBe('unlocked');
    expect((await again.getCourse(course.id))!.name).toBe(`Class ${MARKER}`);
  });

  it('refuses everything while locked, with code "locked"', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    const { course, deck, lecture, material } = await writeEverything(store);
    const [exam] = await store.listExams(course.id);
    store.lock();
    expect(store.status()).toBe('locked');
    const courseInput = { name: 'x', meetings: [], termStart: null, termEnd: null };
    const examInput = { courseId: course.id, title: 'x', kind: 'test' as const, date: '2026-12-01', lectureIds: null };
    const calls: [string, () => Promise<unknown>][] = [
      ['listCourses', () => store.listCourses('2026-11-18')],
      ['getCourse', () => store.getCourse(course.id)],
      ['createCourse', () => store.createCourse(courseInput)],
      ['updateCourse', () => store.updateCourse(course.id, courseInput)],
      ['deleteCourse', () => store.deleteCourse(course.id)],
      ['listExams', () => store.listExams(course.id)],
      ['addExam', () => store.addExam(examInput)],
      ['updateExam', () => store.updateExam(exam!.id, examInput)],
      ['deleteExam', () => store.deleteExam(exam!.id)],
      ['listSlideDecks', () => store.listSlideDecks(course.id)],
      ['addSlideDeck', () => store.addSlideDeck({ courseId: course.id, title: 'x', fileName: 'x.pdf', data: fakePdf(), pageTexts: ['x'] })],
      ['renameSlideDeck', () => store.renameSlideDeck(deck.id, 'x')],
      ['deleteSlideDeck', () => store.deleteSlideDeck(deck.id)],
      ['getSlideDeckFile', () => store.getSlideDeckFile(deck.id)],
      ['getSlideDeckPages', () => store.getSlideDeckPages(deck.id)],
      ['listLectures', () => store.listLectures(course.id)],
      ['getLecture', () => store.getLecture(lecture.lecture.id)],
      ['recordLecture', () => store.recordLecture({ courseId: course.id, date: '2026-11-18', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 1 }] })],
      ['updateLecture', () => store.updateLecture(lecture.lecture.id, { date: '2026-11-18', minutes: 50 })],
      ['deleteLecture', () => store.deleteLecture(lecture.lecture.id)],
      ['listSections', () => store.listSections()],
      ['changesSince', () => store.changesSince(0)],
      ['exportSealed', () => store.exportSealed()],
      ['addKeyringEntry', async () => store.addKeyringEntry((await store.getKeyring())!.entries[0]!)],
      ['getExamStyle', () => store.getExamStyle(course.id)],
      ['setStyleNotes', () => store.setStyleNotes(course.id, 'x')],
      ['saveMadeGuide', () => store.saveMadeGuide(course.id, { tests: 'x', levels: ['a', 'b', 'c'], shortShare: 0 }, { lectureIds: [], materialIds: [], notesAt: null })],
      ['editStyleGuide', () => store.editStyleGuide(course.id, { tests: 'x', levels: ['a', 'b', 'c'], shortShare: 0 })],
      ['listMaterials', () => store.listMaterials(course.id)],
      ['addMaterial', () => store.addMaterial({ courseId: course.id, title: 'x', fileName: 'x.txt', kind: 'other', type: 'text/plain', data: new Uint8Array([120]), pageTexts: [] })],
      ['updateMaterial', () => store.updateMaterial(material.id, { title: 'x', kind: 'other' })],
      ['deleteMaterial', () => store.deleteMaterial(material.id)],
      ['getMaterialFile', () => store.getMaterialFile(material.id)],
      ['getMaterialText', () => store.getMaterialText(material.id)],
    ];
    for (const [label, call] of calls) {
      await expect(call(), label).rejects.toMatchObject({ code: 'locked' });
    }
    expect(await store.getKeyring()).not.toBeNull(); // still readable while locked
  });

  it('refuses a key that isn’t this store’s, and stays locked', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    store.lock();
    await expect(store.unlock(await newDataKey())).rejects.toMatchObject({ code: 'wrong-key' });
    expect(store.status()).toBe('locked');
  });

  it('can’t be set up twice, or unlocked before setup', async () => {
    const name = freshName();
    const store = await open(name);
    await expect(store.unlock(await newDataKey())).rejects.toMatchObject({ code: 'invalid' });
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    await expect(store.setUp(await testKeyring(key), key)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('the keyring', () => {
  const passkeyEntry = async (key: CryptoKey) =>
    wrapWithPasskey(key, { credentialId: new Uint8Array([1, 2]), prfSalt: new Uint8Array(32), prfOutput: new Uint8Array(32).fill(5), label: 'iPhone' });

  it('setUp needs a way to unlock and a recovery key', async () => {
    const key = await newDataKey();
    const noRecovery: Keyring = { v: 1, entries: [await wrapWithPassphrase(key, 'p', { iterations: 1000 })] };
    const noUnlock: Keyring = { v: 1, entries: [await wrapWithRecoveryKey(key, await newRecoveryKey())] };
    const store = await open(freshName());
    await expect(store.setUp(noRecovery, key)).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.setUp(noUnlock, key)).rejects.toMatchObject({ code: 'invalid' });
    expect(store.status()).toBe('new');
  });

  it('adds and removes entries, but never the last way in or the last recovery key', async () => {
    const { store, key } = await setUpNew(freshName());
    const ring = (await store.getKeyring())!;
    const passphrase = ring.entries.find((e) => e.method === 'passphrase')!;
    const recovery = ring.entries.find((e) => e.method === 'recovery')!;

    await expect(store.removeKeyringEntry(passphrase.id)).rejects.toMatchObject({ code: 'invalid' }); // last way in
    await expect(store.removeKeyringEntry(recovery.id)).rejects.toMatchObject({ code: 'invalid' }); // last recovery
    const passkey = await passkeyEntry(key);
    await store.addKeyringEntry(passkey);
    await store.removeKeyringEntry(passphrase.id); // fine now: the passkey still unlocks
    expect((await store.getKeyring())!.entries.map((e) => e.method).sort()).toEqual(['passkey', 'recovery']);
    await expect(store.removeKeyringEntry(passkey.id)).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.removeKeyringEntry('no-such-id')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('replaces every entry of a method in one go (change passphrase, new recovery key)', async () => {
    const { store, key } = await setUpNew(freshName());
    const newPassphrase = await wrapWithPassphrase(key, 'new one', { iterations: 1000 });
    await store.replaceKeyringEntries('passphrase', newPassphrase);
    const entries = (await store.getKeyring())!.entries;
    expect(entries.filter((e) => e.method === 'passphrase').map((e) => e.id)).toEqual([newPassphrase.id]);
    await expect(store.replaceKeyringEntries('recovery', newPassphrase)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('changing the keyring never rewrites a record', async () => {
    const name = freshName();
    const { store, key } = await setUpNew(name);
    await writeEverything(store);
    const before = await rawRows(name);
    await store.addKeyringEntry(await passkeyEntry(key));
    await store.replaceKeyringEntries('recovery', await wrapWithRecoveryKey(key, await newRecoveryKey()));
    const after = await rawRows(name);
    for (const s of RECORD_STORES) expect(after[s], s).toEqual(before[s]);
  });
});

describe('setUp and interrupted setUps', () => {
  it('seals what was written before setup, reporting progress, and everything reads back the same', async () => {
    const name = freshName();
    const store = await open(name);
    const { course } = await writeEverything(store);
    const lecturesBefore = await store.listLectures(course.id);
    const changesBefore = await store.changesSince(0);

    const progress: [number, number][] = [];
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key, (done, total) => progress.push([done, total]));
    const total = progress[0]![1];
    expect(total).toBeGreaterThan(0);
    expect(progress.at(-1)).toEqual([total, total]);
    expect(progress.map((p) => p[0])).toEqual([...progress.map((p) => p[0])].sort((a, b) => a - b)); // only goes up

    expect(await store.listLectures(course.id)).toEqual(lecturesBefore);
    expect(await store.changesSince(0)).toEqual(changesBefore);
    expect(containsText(await rawRows(name), MARKER)).toBe(false);
  });

  it('a setUp interrupted half-way is finished by the next unlock, losing nothing', async () => {
    const name = freshName();
    const store = await open(name, { migrationBatch: 1 });
    const { course, deck } = await writeEverything(store);
    const lecturesBefore = await store.listLectures(course.id);
    const pdfBefore = await store.getSlideDeckFile(deck.id);
    const key = await newDataKey();
    let calls = 0;
    const closedHalfWay = store.setUp(await testKeyring(key), key, () => {
      if (++calls === 3) throw new Error('the page was closed');
    });
    await expect(closedHalfWay).rejects.toThrow('the page was closed');
    const rows = await rawRows(name);
    const all = RECORD_STORES.flatMap((s) => rows[s]!);
    expect(all.some((r) => 'enc' in (r as object))).toBe(true); // some sealed...
    expect(all.some((r) => !('enc' in (r as object)))).toBe(true); // ...some not yet
    store.close();

    const again = await open(name);
    expect(again.status()).toBe('locked'); // set up, so it needs the key
    await again.unlock(key);
    expect(await again.listLectures(course.id)).toEqual(lecturesBefore);
    expect(await again.getSlideDeckFile(deck.id)).toEqual(pdfBefore);
    const after = await rawRows(name);
    for (const s of RECORD_STORES) expect(after[s]!.every((r) => 'enc' in (r as object)), s).toBe(true);
    expect(after.meta!.some((r) => (r as { key: string }).key === 'migration')).toBe(false);
  });
});

describe('milestone 2’s flashcards are dropped (schema step 4)', () => {
  /** Exactly what milestone 2's schema step 1 made. */
  const stepOne = (db: import('idb').IDBPDatabase) => {
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('decks', { keyPath: 'id' });
    db.createObjectStore('notes', { keyPath: 'id' }).createIndex('byDeck', 'deckId');
    const cards = db.createObjectStore('cards', { keyPath: 'id' });
    cards.createIndex('byDeck', 'deckId');
    cards.createIndex('byNote', 'noteId');
    const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
    reviews.createIndex('byCard', 'cardId');
    reviews.createIndex('byTime', 'reviewedAt');
    db.createObjectStore('changes', { keyPath: 'seq', autoIncrement: true });
  };
  const change = (entity: string, entityId: string) => ({ id: `ch-${entityId}`, deviceId: 'd', at: T0.toISOString(), entity, entityId, op: 'put', data: null });

  it('a version 1 database opens, without its card stores or their changes, and works', async () => {
    const name = freshName();
    const v1 = await openDB(name, 1, { upgrade: (db) => stepOne(db as never) });
    await v1.put('decks', { id: 'old-deck', name: 'Old', createdAt: T0.toISOString(), updatedAt: T0.toISOString() });
    await v1.put('changes', change('deck', 'old-deck'));
    await v1.put('meta', { key: 'deviceId', value: 'kept-device' });
    v1.close();

    const store = await open(name);
    expect(store.deviceId()).toBe('kept-device');
    expect(store.status()).toBe('new');
    expect(await store.changesSince(0)).toEqual([]);
    await writeEverything(store);
    const db = await openHonedDb(name);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([...RECORD_STORES, 'meta'].sort());
    db.close();
  });

  it('a version 3 database keeps its classes, sealed or not, and loses only the flashcards', async () => {
    // A version 3 database made by the app as it was before #26, with cards beside a class
    const name = freshName();
    const v3 = await openDB(name, 3, {
      upgrade(db) {
        stepOne(db as never);
        db.createObjectStore('courses', { keyPath: 'id' });
        for (const s of ['exams', 'slideDecks', 'lectures']) db.createObjectStore(s, { keyPath: 'id' }).createIndex('byCourse', 'courseId');
        db.createObjectStore('deckFiles', { keyPath: 'id' });
        db.createObjectStore('deckPages', { keyPath: 'id' });
        const sections = db.createObjectStore('sections', { keyPath: 'id' });
        sections.createIndex('byCourse', 'courseId');
        sections.createIndex('byLecture', 'lectureId');
        sections.createIndex('byDeck', 'deckId');
      },
    });
    const course = { id: 'c1', name: 'Kept', meetings: [], termStart: null, termEnd: null, createdAt: T0.toISOString(), updatedAt: T0.toISOString() };
    await v3.put('courses', course);
    await v3.put('cards', { id: 'card-1', deckId: 'd', noteId: 'n' });
    for (const row of [change('card', 'card-1'), change('course', 'c1'), change('review', 'r1'), change('note', 'n')]) await v3.put('changes', row);
    v3.close();

    const store = await open(name);
    expect(await store.getCourse('c1')).toEqual(course);
    expect((await store.changesSince(0)).map((c) => `${c.entity}:${c.entityId}`)).toEqual(['course:c1']);
    const db = await openHonedDb(name);
    for (const gone of ['decks', 'notes', 'cards', 'reviews']) expect(db.objectStoreNames.contains(gone as never), gone).toBe(false);
    db.close();
  });
});

describe('speed', () => {
  it('lists 2,000 encrypted sections (time printed for the PR)', async () => {
    const { store } = await setUpNew(freshName());
    const course = await store.createCourse({ name: 'Big', meetings: [], termStart: null, termEnd: null });
    const deck = await store.addSlideDeck({ courseId: course.id, title: 'Big', fileName: 'big.pdf', data: fakePdf(), pageTexts: Array(200).fill('p') });
    for (let i = 0; i < 200; i++) {
      const sections = Array.from({ length: 10 }, (_, j) => ({ deckId: deck.id, firstPage: (i % 20) * 10 + j + 1, lastPage: (i % 20) * 10 + j + 1 }));
      await store.recordLecture({ courseId: course.id, date: '2026-11-18', minutes: 50, sections });
    }
    let start = performance.now();
    const sections = await store.listSections();
    const sectionsMs = performance.now() - start;
    start = performance.now();
    const lectures = await store.listLectures(course.id);
    const lecturesMs = performance.now() - start;
    expect(sections).toHaveLength(2_000);
    expect(lectures).toHaveLength(200);
    console.log(`2,000 encrypted sections: listSections ${sectionsMs.toFixed(0)} ms, listLectures ${lecturesMs.toFixed(0)} ms (Node + fake-indexeddb)`);
  }, 120_000);
});
