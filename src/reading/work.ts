// AI work in the background, the device's side (#168, 5c; docs/DESIGN.md "From upload to quiz", docs/SECURITY.md
// "AI work in the background"). One round (WorkRunner calls it every few minutes while Honed is unlocked):
//   1. make sure the account has a results key (made here the first time, kept on the sync server);
//   2. file finished results: open each, save its readings as page readings, confirm it so the helper deletes it;
//   3. check the jobs this device sent: one the helper no longer knows (a restart) is sent again;
//   4. send the next section that needs it: a section the planner will want within WORK.aheadDays whose covered
//      pages have pictures not read yet. Only those pages go, each with its keyed fingerprint and a "needed by"
//      time (the start of that study day); the note saying which deck and pages it was is sealed with this
//      device's key, so the helper carries it back without reading it.
// Nothing happens on a device without an account (sync off): results come back through it.
import { CryptoError, type EncryptedRecord, type ResultsKey, type SealedResult } from '../types/crypto';
import type { Lecture, Section } from '../types/lecture';
import type { ReadingKind } from '../types/reading';
import { StoreError, type StudyStore } from '../db/store';
import type { WorkNote, WorkState } from '../db/work';
import { keyedFingerprint, openResult } from '../lib/results-key';
import { deviceTimeZone, studyDay } from '../lib/studyDay';
import { addDays, sectionItems, type PlanInput } from '../plan/planner';
import { DAY_START_HOUR } from '../ui/settings';
import { openPdf } from '../viewer/pdf';
import { drawPagePng, scanPages } from './scan';

export const WORK = {
  /** Sections the planner wants within this many days are read ahead. */
  aheadDays: 14,
  /** A section whose job failed isn't sent again for this long. */
  retryAfterMs: 86_400_000,
};

type Fetch = typeof fetch;

export interface WorkOptions {
  fetcher?: Fetch;
  now?: () => Date;
  timeZone?: string;
}

export interface WorkRound {
  filed: number; // results saved as page readings
  sent: string | null; // the section sent this round, if any
  problem: string | null;
}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (text: string) => {
  const t = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const json = { 'Content-Type': 'application/json' };

class WorkProblem extends Error {}

/** A sealed note as bytes: its version, the 12-byte IV, then the ciphertext. */
export function packNote(sealed: EncryptedRecord): string {
  const out = new Uint8Array(1 + 12 + sealed.ct.length);
  out[0] = sealed.v;
  out.set(sealed.iv, 1);
  out.set(sealed.ct, 13);
  return b64(out);
}

export function unpackNote(text: string): EncryptedRecord {
  const bytes = fromB64(text);
  if (bytes[0] !== 1 || bytes.length < 13 + 16) throw new Error('Not a sealed note.');
  return { v: 1, iv: bytes.slice(1, 13), ct: bytes.slice(13) };
}

/** The account id results are bound to: the same on every device of the account (a hash of its public key). */
export async function accountIdOf(publicKey: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', publicKey as Uint8Array<ArrayBuffer>)).slice(0, 32);
}

const keys = new WeakMap<StudyStore, ResultsKey>();

/** The account's results key, made and sent to the sync server the first time. */
export async function ensureResultsKey(store: StudyStore, fetcher: Fetch = fetch): Promise<ResultsKey> {
  const known = keys.get(store);
  if (known) return known;
  const fetchKey = async () => {
    const res = await fetcher('/api/results-key', { credentials: 'same-origin' });
    if (res.status === 404) return null;
    if (!res.ok) throw new WorkProblem('Couldn’t reach your account.');
    const body = (await res.json()) as { publicKey: string; sealed: { v: 1; iv: string; ct: string } };
    return { publicKey: fromB64(body.publicKey), sealed: { v: 1 as const, iv: fromB64(body.sealed.iv), ct: fromB64(body.sealed.ct) } };
  };
  const open = async (k: { publicKey: Uint8Array; sealed: EncryptedRecord }) => {
    try {
      return await store.openResultsKey(k.publicKey, k.sealed);
    } catch (err) {
      if (err instanceof CryptoError) throw new WorkProblem('Your account’s results key on the server isn’t yours: background AI work is off. Tell Nathan.');
      throw err;
    }
  };
  let found = await fetchKey();
  let key: ResultsKey;
  if (found) key = await open(found);
  else {
    const made = await store.makeResultsKey();
    const res = await fetcher('/api/results-key', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: json,
      body: JSON.stringify({ publicKey: b64(made.upload.publicKey), sealed: { v: 1, iv: b64(made.upload.sealed.iv), ct: b64(made.upload.sealed.ct) } }),
    });
    if (res.ok) key = made.key;
    else if (res.status === 422 && (found = await fetchKey())) key = await open(found); // another device made one first
    else throw new WorkProblem('Couldn’t save your results key.');
  }
  keys.set(store, key);
  return key;
}

/** The first day within WORK.aheadDays the planner will want this section (overdue counts as today), or null. */
export function neededOn(input: PlanInput, section: Section, lecture: Lecture): string | null {
  for (let d = 0; d <= WORK.aheadDays; d++) {
    const day = addDays(input.today, d);
    const { items } = sectionItems({ ...input, today: day }, section, lecture);
    if (items.length) return day;
  }
  return null;
}

/** When a study day starts, as an instant (DAY_START_HOUR on that date, on this device's clock). */
function dayStarts(day: string): string {
  return new Date(`${day}T${String(DAY_START_HOUR).padStart(2, '0')}:00:00`).toISOString();
}

async function planInput(store: StudyStore, today: string, timeZone: string): Promise<{ input: PlanInput; lectures: Map<string, Lecture> }> {
  const courses = await store.listCourses(today);
  const [perCourse, sections, attempts, sessions, settings] = await Promise.all([
    Promise.all(courses.map(async (c) => ({ lectures: await store.listLectures(c.id), exams: await store.listExams(c.id) }))),
    store.listSections(),
    store.listQuizAttempts(),
    store.listStudySessions(),
    store.getStudySettings(),
  ]);
  const lectureList = perCourse.flatMap((p) => p.lectures.map((l) => l.lecture));
  return {
    input: { today, dailyMinutes: settings.dailyMinutes, lectures: lectureList, sections, sessions, attempts, exams: perCourse.flatMap((p) => p.exams), timeZone, dayStartHour: DAY_START_HOUR },
    lectures: new Map(lectureList.map((l) => [l.id, l])),
  };
}

interface Result {
  id: string;
  accountId: string;
  sealed: { v: 1; epk: string; iv: string; ct: string };
}
interface ReadingOut {
  page: number;
  fp: string;
  model: string;
  reading: { pictureText: string; figures: { label: string; description: string }[]; kinds: ReadingKind[]; decorativeOnly: boolean };
}

/** Saves finished results as page readings and confirms them. Gives how many pages were filed. */
async function fileResults(store: StudyStore, key: ResultsKey, accountId: string, state: WorkState, fetcher: Fetch): Promise<number> {
  const res = await fetcher('/ai/results', { credentials: 'same-origin' });
  if (res.status === 401 || res.status === 403) throw new WorkProblem('Sign in for AI to get your slides read.');
  if (res.status === 501) throw new WorkProblem('Background AI work isn’t switched on.');
  if (!res.ok) throw new WorkProblem('Couldn’t reach the AI helper.');
  const { results } = (await res.json()) as { results: Result[] };
  let filed = 0;
  const done: string[] = [];
  for (const r of results) {
    if (r.accountId !== accountId) continue; // another account's (a test account on the same AI sign-in): not ours to touch
    const sealed: SealedResult = { v: 1, epk: fromB64(r.sealed.epk), iv: fromB64(r.sealed.iv), ct: fromB64(r.sealed.ct) };
    let out: { note: string | null; result: { readings?: ReadingOut[] } | null };
    let note: WorkNote;
    try {
      out = JSON.parse(new TextDecoder().decode(await openResult(key, accountId, r.id, sealed)));
      if (!out.note) throw new Error('no note');
      note = await store.openWorkNote(r.id, unpackNote(out.note));
    } catch {
      done.push(r.id); // can't be opened or filed: nothing to keep it for
      continue;
    }
    const fingerprints = new Map(note.pages.map((p) => [p.page, p]));
    let deckHere = true;
    for (const item of out.result?.readings ?? []) {
      const fp = fingerprints.get(item.page);
      if (!fp) continue;
      try {
        await store.savePageReading({
          deckId: note.deckId,
          page: item.page,
          fingerprint: { text: fp.text, look: fp.look },
          pictureText: item.reading.pictureText,
          figures: item.reading.figures,
          kinds: item.reading.kinds,
          decorativeOnly: item.reading.decorativeOnly,
          model: item.model,
        });
        filed++;
      } catch (err) {
        // No such deck here (yet): leave the result for a device that has it (sync may bring the deck later)
        if (err instanceof StoreError && err.code === 'not-found') deckHere = false;
        // A page no longer in the deck: nothing to file it under
      }
    }
    if (!deckHere) continue;
    done.push(r.id);
    delete state.sent[r.id];
  }
  if (done.length) {
    await fetcher('/ai/results/confirm', { method: 'POST', credentials: 'same-origin', headers: json, body: JSON.stringify({ ids: done }) });
  }
  return filed;
}

/** Checks the jobs sent: forgets those done, failed (kept a day so they're not sent straight back) or unknown. */
async function checkSent(state: WorkState, now: Date, fetcher: Fetch) {
  for (const [id, sent] of Object.entries(state.sent)) {
    if (sent.failedAt) {
      if (now.getTime() - Date.parse(sent.failedAt) > WORK.retryAfterMs) delete state.sent[id];
      continue;
    }
    const res = await fetcher(`/ai/work/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    if (res.status === 404) delete state.sent[id]; // the helper restarted: it'll be sent again
    else if (res.ok) {
      const job = (await res.json()) as { state: string; fetched?: boolean };
      if (job.state === 'failed') state.sent[id] = { ...sent, failedAt: now.toISOString() };
      else if (job.state === 'done' && job.fetched) delete state.sent[id];
    }
  }
}

/** Sends the next section with pictures not read yet. Gives its id, or null if none needed sending. */
async function sendNext(store: StudyStore, key: ResultsKey, accountId: string, state: WorkState, now: Date, timeZone: string, fetcher: Fetch): Promise<string | null> {
  const today = studyDay(now, timeZone, DAY_START_HOUR);
  const { input, lectures } = await planInput(store, today, timeZone);
  const busy = new Set(Object.values(state.sent).map((s) => s.sectionId));
  const due = input.sections
    .map((section) => ({ section, on: lectures.has(section.lectureId) ? neededOn(input, section, lectures.get(section.lectureId)!) : null }))
    .filter((x): x is { section: Section; on: string } => x.on !== null && !busy.has(x.section.id))
    .sort((a, b) => a.on.localeCompare(b.on));
  for (const { section, on } of due) {
    const checkedAs = `${section.deckId}:${section.firstPage}-${section.lastPage}`;
    if (state.checked?.[section.id] === checkedAs) continue; // looked at already, nothing to read
    const { doc, close } = await openPdf(await store.getSlideDeckFile(section.deckId));
    try {
      const pages = Array.from({ length: section.lastPage - section.firstPage + 1 }, (_, i) => section.firstPage + i);
      const scans = await scanPages(doc, pages);
      const read = new Map((await store.listPageReadings(section.deckId)).map((r) => [r.page, r]));
      const todo = scans.filter((s) => {
        if (s.sort !== 'pictures') return false;
        const had = read.get(s.page);
        return !had || had.fingerprint.text !== s.fingerprint.text || had.fingerprint.look !== s.fingerprint.look;
      });
      if (!todo.length) {
        state.checked = { ...state.checked, [section.id]: checkedAs };
        continue;
      }
      const note: WorkNote = { deckId: section.deckId, sectionId: section.id, pages: todo.map((s) => ({ page: s.page, ...s.fingerprint })) };
      const id = `w-${(await sha256(JSON.stringify(note))).slice(0, 40)}`;
      const sealedNote = await store.sealWorkNote(id, note);
      const body = {
        id,
        accountId,
        publicKey: b64(key.publicKey),
        neededBy: dayStarts(on),
        note: packNote(sealedNote),
        pages: await Promise.all(
          todo.map(async (s) => ({ page: s.page, fp: await keyedFingerprint(key, s.fingerprint), text: s.text, image: b64(await drawPagePng(doc, s.page)) })),
        ),
      };
      const res = await fetcher('/ai/work', { method: 'POST', credentials: 'same-origin', headers: json, body: JSON.stringify(body) });
      if (res.status === 401 || res.status === 403) throw new WorkProblem('Sign in for AI to get your slides read.');
      if (res.status === 413) {
        state.sent[id] = { sectionId: section.id, deckId: section.deckId, pages: todo.map((s) => s.page), sentAt: now.toISOString(), failedAt: now.toISOString() };
        throw new WorkProblem('A section has more pictures than a day’s reading: split it into smaller sections.');
      }
      if (!res.ok) throw new WorkProblem('The AI helper couldn’t take the work right now.');
      state.sent[id] = { sectionId: section.id, deckId: section.deckId, pages: todo.map((s) => s.page), sentAt: now.toISOString() };
      return section.id;
    } finally {
      await close();
    }
  }
  return null;
}

/**
 * One round of background work. Null on a device without an account (sync off): nothing is sent. Problems are
 * kept in the work state (for Settings) and given back, never thrown.
 */
export async function workOnce(store: StudyStore, options: WorkOptions = {}): Promise<WorkRound | null> {
  const fetcher = options.fetcher ?? fetch;
  const now = (options.now ?? (() => new Date()))();
  const timeZone = options.timeZone ?? deviceTimeZone();
  if (!(await store.getSyncState())) return null;
  const state = await store.getWorkState();
  const round: WorkRound = { filed: 0, sent: null, problem: null };
  try {
    const key = await ensureResultsKey(store, fetcher);
    const accountId = await accountIdOf(key.publicKey);
    round.filed = await fileResults(store, key, accountId, state, fetcher);
    await checkSent(state, now, fetcher);
    round.sent = await sendNext(store, key, accountId, state, now, timeZone, fetcher);
  } catch (err) {
    if (!(err instanceof WorkProblem)) throw err;
    round.problem = err.message;
  } finally {
    await store.setWorkState({ ...state, problem: round.problem, lastRound: now.toISOString() });
  }
  return round;
}

/** For tests: forget the results keys opened so far. */
export function forgetResultsKeys(store: StudyStore) {
  keys.delete(store);
}
