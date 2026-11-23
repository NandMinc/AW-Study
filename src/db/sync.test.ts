// The store's side of sync (#105): two stores play two devices of one account. Changes go A → B sealed for
// sync, are opened and applied; the later change wins; deletes stay deleted; a change arrives once; hints
// that disagree are refused; the clock moves past what was applied; joining replaces this device's data.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openStudyStore, type StudyStore } from './store';
import { later } from './sync';
import type { Meeting } from '../types/lecture';
import { fakePdf, newDataKey, testKeyring } from './test-helpers';

let counter = 0;
const opened: StudyStore[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});

/** A device whose clock reads `clock.now` (settable). */
async function device(clock: { now: Date }) {
  let n = 0;
  const name = `sync-${++counter}`;
  const store = await openStudyStore({ name, deps: { clock: () => clock.now, newId: () => `${name}-id-${++n}` } });
  opened.push(store);
  return store;
}

/** Device A set up, device B joined to the same account (A's keyring and key check). */
async function pair() {
  const clockA = { now: new Date('2026-11-20T18:00:00Z') };
  const clockB = { now: new Date('2026-11-20T18:00:00Z') };
  const a = await device(clockA);
  const key = await newDataKey();
  await a.setUp(await testKeyring(key), key);
  const b = await device(clockB);
  await b.joinAccount((await a.getKeyring())!, (await a.getKeycheck())!, key);
  return { a, b, key, clockA, clockB };
}

/** Sends everything `from` made itself since `after` to `to`, as the engine does. Gives `from`'s latest seq. */
async function send(from: StudyStore, to: StudyStore, after = 0) {
  const own = await from.ownChangesSince(after);
  const wire = await from.sealForSync(own);
  const applied = await to.applyRemote(await to.openFromSync(wire));
  return { seq: await from.latestSeq(), applied, sent: own.length };
}

const meeting: Meeting[] = [{ day: 1, start: '10:30', minutes: 50 }];

describe('sync between two devices of an account', () => {
  it('a class made on A appears on B; B’s rename comes back to A; nothing goes back where it came from', async () => {
    const { a, b, clockB } = await pair();
    const course = await a.createCourse({ name: 'Biology', meetings: meeting, termStart: null, termEnd: null });
    const first = await send(a, b);
    expect(first.applied).toBe(1);
    expect((await b.listCourses('2026-11-20')).map((c) => c.name)).toEqual(['Biology']);

    clockB.now = new Date('2026-11-20T18:05:00Z');
    await b.updateCourse(course.id, { name: 'Biology 110', meetings: meeting, termStart: null, termEnd: null });
    // B's own changes don't include what it applied from A
    expect((await b.ownChangesSince(0)).map((c) => c.op + ' ' + c.entity)).toEqual(['put course']);
    await send(b, a);
    expect((await a.listCourses('2026-11-20')).map((c) => c.name)).toEqual(['Biology 110']);
    // A's own changes still only its first one
    expect(await a.ownChangesSince(first.seq)).toEqual([]);
  });

  it('the later change wins, whichever arrives first; the device id breaks a tie', async () => {
    const { a, b, clockA, clockB } = await pair();
    const course = await a.createCourse({ name: 'Physics', meetings: meeting, termStart: null, termEnd: null });
    const sent = await send(a, b);
    // Both rename while apart: B later
    clockA.now = new Date('2026-11-20T19:00:00Z');
    await a.updateCourse(course.id, { name: 'Physics (A)', meetings: meeting, termStart: null, termEnd: null });
    clockB.now = new Date('2026-11-20T19:10:00Z');
    await b.updateCourse(course.id, { name: 'Physics (B)', meetings: meeting, termStart: null, termEnd: null });
    // A hears from B: B's is later, it wins on A
    await send(b, a);
    expect((await a.listCourses('2026-11-20'))[0]!.name).toBe('Physics (B)');
    // B hears from A's older rename: B keeps its own
    await send(a, b, sent.seq);
    expect((await b.listCourses('2026-11-20'))[0]!.name).toBe('Physics (B)');

    expect(later({ at: '2026-11-20T19:00:00.000Z', deviceId: 'b' }, { at: '2026-11-20T19:00:00.000Z', deviceId: 'a' })).toBe(true);
    expect(later({ at: '2026-11-20T19:00:00.000Z', deviceId: 'a' }, { at: '2026-11-20T19:00:00.000Z', deviceId: 'b' })).toBe(false);
  });

  it('a delete stays deleted: an older edit arriving later doesn’t bring the record back', async () => {
    const { a, b, clockA, clockB } = await pair();
    const course = await a.createCourse({ name: 'History', meetings: meeting, termStart: null, termEnd: null });
    const sent = await send(a, b);
    clockA.now = new Date('2026-11-20T19:00:00Z');
    await a.updateCourse(course.id, { name: 'History 2', meetings: meeting, termStart: null, termEnd: null }); // older
    clockB.now = new Date('2026-11-20T19:30:00Z');
    await b.deleteCourse(course.id); // newer
    await send(a, b, sent.seq);
    expect(await b.listCourses('2026-11-20')).toEqual([]);
    await send(b, a);
    expect(await a.listCourses('2026-11-20')).toEqual([]);
  });

  it('a change arriving twice is applied once', async () => {
    const { a, b } = await pair();
    await a.createCourse({ name: 'Art', meetings: meeting, termStart: null, termEnd: null });
    expect((await send(a, b)).applied).toBe(1);
    expect((await send(a, b)).applied).toBe(0);
    const logged = await b.changesSince(0);
    expect(logged.filter((c) => c.entity === 'course')).toHaveLength(1);
  });

  it('refuses a change whose hints disagree with what’s sealed, or that another key sealed', async () => {
    const { a, b } = await pair();
    await a.createCourse({ name: 'Maths', meetings: meeting, termStart: null, termEnd: null });
    const [wire] = await a.sealForSync(await a.ownChangesSince(0));
    await expect(b.openFromSync([{ ...wire!, op: 'delete' }])).rejects.toMatchObject({ code: 'invalid' });
    await expect(b.openFromSync([{ ...wire!, entityId: 'someone-else' }])).rejects.toMatchObject({ code: 'invalid' });
    await expect(b.openFromSync([{ ...wire!, id: 'another-id' }])).rejects.toMatchObject({ code: 'invalid' }); // its additional data names its id

    const stranger = await device({ now: new Date('2026-11-20T18:00:00Z') });
    const otherKey = await newDataKey();
    await stranger.setUp(await testKeyring(otherKey), otherKey);
    await expect(stranger.openFromSync([wire!])).rejects.toMatchObject({ code: 'invalid' });
  });

  it('after applying a change from the future, this device’s next change is later still', async () => {
    const { a, b, clockA, clockB } = await pair();
    const course = await a.createCourse({ name: 'Music', meetings: meeting, termStart: null, termEnd: null });
    await send(a, b);
    clockA.now = new Date('2026-11-20T20:00:00Z'); // A's clock runs ahead
    await a.updateCourse(course.id, { name: 'Music (A)', meetings: meeting, termStart: null, termEnd: null });
    const sent = await send(a, b);
    expect(sent.applied).toBe(1); // the rename (the first change was already there)
    clockB.now = new Date('2026-11-20T19:00:00Z'); // B's clock is behind, but B edits after seeing A's edit
    await b.updateCourse(course.id, { name: 'Music (B, later)', meetings: meeting, termStart: null, termEnd: null });
    const bOwn = await b.ownChangesSince(0);
    expect(bOwn.at(-1)!.at > '2026-11-20T20:00:00.000Z').toBe(true);
    await send(b, a);
    expect((await a.listCourses('2026-11-20'))[0]!.name).toBe('Music (B, later)');
  });

  it('a deck arrives without its PDF (and says so); deleted elsewhere, its PDF goes too', async () => {
    const { a, b } = await pair();
    const course = await a.createCourse({ name: 'Physics', meetings: meeting, termStart: null, termEnd: null });
    const deck = await a.addSlideDeck({ courseId: course.id, title: 'Week 1', fileName: 'w1.pdf', data: fakePdf('w1'), pageTexts: ['one'] });
    await send(a, b);
    expect((await b.listSlideDecks(course.id)).map((d) => d.title)).toEqual(['Week 1']);
    await expect(b.getSlideDeckFile(deck.id)).rejects.toThrow(/added on another device/);
    await expect(b.getSlideDeckPages(deck.id)).rejects.toThrow(/added on another device/);

    const before = await b.latestSeq();
    await b.deleteSlideDeck(deck.id);
    await send(b, a, before);
    expect(await a.listSlideDecks(course.id)).toEqual([]);
    await expect(a.getSlideDeckFile(deck.id)).rejects.toThrow(/no longer exists/);
  });

  it('two edits of one record in the same millisecond reach the other device in order (#120)', async () => {
    const { a, b } = await pair(); // both clocks stand still
    const course = await a.createCourse({ name: 'One', meetings: meeting, termStart: null, termEnd: null });
    await a.updateCourse(course.id, { name: 'Two', meetings: meeting, termStart: null, termEnd: null });
    await a.updateCourse(course.id, { name: 'Three', meetings: meeting, termStart: null, termEnd: null });
    await send(a, b);
    expect((await b.getCourse(course.id))!.name).toBe('Three');
  });

  it('a class’s exam style and the class itself are separate records: neither’s change hides the other’s (#120)', async () => {
    const { a, b, clockA, clockB } = await pair();
    const course = await a.createCourse({ name: 'History', meetings: meeting, termStart: null, termEnd: null });
    await send(a, b);
    // A writes the notes; a moment later B renames the class; then each hears from the other
    clockA.now = new Date('2026-11-20T18:01:00Z');
    const beforeA = await a.latestSeq();
    await a.setStyleNotes(course.id, 'Two essays.');
    clockB.now = new Date('2026-11-20T18:02:00Z');
    const beforeB = await b.latestSeq();
    await b.updateCourse(course.id, { name: 'History 2', meetings: meeting, termStart: null, termEnd: null });
    await send(b, a, beforeB);
    await send(a, b, beforeA);
    for (const d of [a, b]) {
      expect((await d.getCourse(course.id))!.name).toBe('History 2');
      expect((await d.getExamStyle(course.id)).notes).toBe('Two essays.');
    }
  });

  it('a class’s materials and exam style sync like decks (#120): records go, files wait, deletes take files', async () => {
    const { a, b } = await pair();
    const course = await a.createCourse({ name: 'History', meetings: meeting, termStart: null, termEnd: null });
    const material = await a.addMaterial({ courseId: course.id, title: 'Outline', fileName: 'o.pdf', kind: 'outline', type: 'application/pdf', data: fakePdf('o'), pageTexts: ['one'] });
    await a.setStyleNotes(course.id, 'Two essays.');
    await a.saveMadeGuide(course.id, { tests: 'Essays on causes.', levels: ['Who?', 'Why then?', 'Explain why.'], shortShare: 0.8 }, { lectureIds: [], materialIds: [material.id], notesAt: null });
    // Its file is one of the files to upload, sealed as it's stored
    expect(await a.filesToUpload()).toContain(material.id);
    expect((await a.sealedDeckFiles(material.id))?.pages).not.toBeNull();

    await send(a, b);
    expect((await b.listMaterials(course.id)).map((m) => m.title)).toEqual(['Outline']);
    expect(await b.getExamStyle(course.id)).toEqual(await a.getExamStyle(course.id));
    await expect(b.getMaterialFile(material.id)).rejects.toThrow(/added on another device/);

    const before = await b.latestSeq();
    await b.deleteMaterial(material.id);
    await send(b, a, before);
    expect(await a.listMaterials(course.id)).toEqual([]);
    await expect(a.getMaterialFile(material.id)).rejects.toThrow(/no longer exists/);
    await expect(a.getMaterialText(material.id)).rejects.toThrow(/no longer exists/);
    expect(await a.filesToUpload()).not.toContain(material.id);
  });

  it('the first device sends its state as one put per record', async () => {
    const { a } = await pair();
    const course = await a.createCourse({ name: 'Chemistry', meetings: meeting, termStart: null, termEnd: null });
    await a.updateCourse(course.id, { name: 'Chemistry 2', meetings: meeting, termStart: null, termEnd: null });
    await a.addExam({ courseId: course.id, title: 'Midterm', kind: 'midterm', date: '2026-12-01', lectureIds: null });
    const snap = await a.snapshotChanges();
    expect(snap.map((c) => `${c.op} ${c.entity}`).sort()).toEqual(['put course', 'put exam']);
    expect(snap.find((c) => c.entity === 'course')!.data).toMatchObject({ name: 'Chemistry 2' });
  });
});

describe('joining and the keyring', () => {
  it('joining needs the account’s key, and replaces whatever this device had', async () => {
    const { a, key } = await pair();
    const c = await device({ now: new Date('2026-11-20T18:00:00Z') });
    const ownKey = await newDataKey();
    await c.setUp(await testKeyring(ownKey), ownKey);
    await c.createCourse({ name: 'Mine only', meetings: meeting, termStart: null, termEnd: null });
    await expect(c.joinAccount((await a.getKeyring())!, (await a.getKeycheck())!, ownKey)).rejects.toMatchObject({ code: 'wrong-key' });
    expect(await c.listCourses('2026-11-20')).toHaveLength(1); // untouched
    await c.joinAccount((await a.getKeyring())!, (await a.getKeycheck())!, key);
    expect(await c.listCourses('2026-11-20')).toEqual([]);
    expect(c.status()).toBe('unlocked');
    expect(await c.getKeycheck()).toEqual(await a.getKeycheck());
  });

  it('adopts the account’s newer keyring, keeping the keyring rule', async () => {
    const { a, b } = await pair();
    const ring = (await a.getKeyring())!;
    const recoveryOnly = { v: 1 as const, entries: ring.entries.filter((e) => e.method === 'recovery') };
    await expect(b.adoptKeyring(recoveryOnly)).rejects.toMatchObject({ code: 'invalid' });
    await b.adoptKeyring(ring);
    expect(await b.getKeyring()).toEqual(ring);
  });

  it('sync state lives in this device’s meta, never in a backup, and a restore clears it', async () => {
    const { a, key } = await pair();
    const state = { email: 'n@example.com', pulled: 4, pushedSeq: 2, keyringVersion: 1, keyringSent: '{}', seenAt: 0, lastSyncAt: null, lastError: null };
    await a.setSyncState(state);
    expect(await a.getSyncState()).toEqual(state);
    const snapshot = await a.exportSealed();
    expect(JSON.stringify(snapshot)).not.toContain('keyringSent');
    await a.replaceFromBackup(snapshot, key);
    expect(await a.getSyncState()).toBeNull();
  });
});
