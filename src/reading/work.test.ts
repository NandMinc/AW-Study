// AI work in the background, end to end (#168, 5c): the app's real store and PDFs made in the test, the helper's
// real queue (helper/queue.mjs) and seal behind a fake fetch, a fake reading round. Nothing leaves the test.
import 'fake-indexeddb/auto';
import { fileURLToPath } from 'node:url';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error: the helper is plain JavaScript
import { createQueue, validateWork, WorkError } from '../../helper/queue.mjs';
import type { StudyStore } from '../db/store';
import { openStudyStore } from '../db/store';
import type { SyncState } from '../db/sync';
import { newDataKey, testKeyring } from '../db/test-helpers';
import { setPdfAssetBase } from '../viewer/pdf';
import { graphDrawing, LETTER, makePdf } from '../viewer/test-pdf';
import { accountIdOf, forgetResultsKeys, unpackNote, workOnce } from './work';

const HOUR = 3_600_000;
const NOW = new Date('2026-11-26T15:00:00Z');
const TZ = 'America/Vancouver';

beforeAll(() => {
  GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
  setPdfAssetBase(fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url)));
});

let counter = 0;
let clock: Date;
let store: StudyStore;

/** The sync server's results key and the AI helper's queue, behind one fake fetch. */
function servers() {
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  let resultsKey: unknown = null;
  let aiSignedIn = true;
  type Plan = { questions: { requests: { pages: number[]; count: number; mix: { choice: number[]; short: number } }[] } } | null;
  const read = {
    name: 'read',
    run: async ({ pages, plan }: { pages: { page: number; fp: string; image: Uint8Array | null }[]; plan: Plan }) => ({
      [plan ? 'carry' : 'output']: {
        readings: pages
          .filter((p) => p.image)
          .map((p) => ({ page: p.page, fp: p.fp, model: 'claude-sonnet-5-5', reading: { pictureText: '', figures: [{ label: 'Graph', description: 'A zig-zag line.' }], kinds: ['graph'], decorativeOnly: false } })),
      },
      ...(plan ? {} : { done: true }),
    }),
  };
  // Writes what the plan asks for: per group, its count at the levels its mix says, on its first page
  let n = 0;
  const write = {
    name: 'questions',
    run: async ({ carry, plan }: { carry: { readings: unknown[] }; plan: Plan }) => ({
      done: true,
      output: {
        readings: carry.readings,
        questions: plan!.questions.requests.flatMap((r) => [
          ...[1, 2, 3].flatMap((level) =>
            Array.from({ length: r.mix.choice[level - 1]! }, () => ({ form: 'choice', level, question: `Which value is shown ${++n}?`, options: ['a', 'b', 'c', 'd'], answer: 1, page: r.pages[0], explanation: 'b.' })),
          ),
          ...Array.from({ length: r.mix.short }, () => ({ form: 'short', level: 3, question: `Explain trend ${++n}.`, points: ['it rises'], page: r.pages[0], explanation: 'It rises.' })),
        ]),
      },
    }),
  };
  const makeQueue = () => createQueue({ rounds: [read, write], delayMs: HOUR, marginMs: 2 * HOUR, dailyPages: 100, now: () => clock });
  const s = {
    calls,
    queue: makeQueue(),
    signOutOfAi: () => (aiSignedIn = false),
    restart: () => (s.queue = makeQueue()),
    swapKey: (k: unknown) => (resultsKey = k),
    key: () => resultsKey,
    fetcher: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ method, url, body });
      const answer = (status: number, value: unknown = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
      if (url === '/api/results-key') {
        if (method === 'GET') return resultsKey ? answer(200, resultsKey) : answer(404, { none: true });
        if (!resultsKey) {
          resultsKey = body;
          return answer(200, { saved: true });
        }
        return JSON.stringify(resultsKey) === JSON.stringify(body) ? answer(200, { saved: true }) : answer(422, { differentKey: true });
      }
      if (url.startsWith('/ai/') && !aiSignedIn) return answer(401, { error: 'Sign in.' });
      if (url === '/ai/work' && method === 'POST') {
        try {
          return answer(202, s.queue.submit('me', validateWork(body)));
        } catch (err) {
          if (err instanceof WorkError) return answer((err as { status: number }).status, { error: (err as Error).message });
          throw err;
        }
      }
      const job = url.match(/^\/ai\/work\/([\w-]+)$/);
      if (job && method === 'GET') {
        const state = s.queue.get('me', job[1]);
        return state ? answer(200, state) : answer(404, { unknown: true });
      }
      if (url === '/ai/results') {
        const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
        return answer(200, {
          results: s.queue.resultsFor('me').map((r: { id: string; accountId: string; sealed: { epk: Uint8Array; iv: Uint8Array; ct: Uint8Array } }) => ({
            ...r,
            sealed: { v: 1, epk: b64(r.sealed.epk), iv: b64(r.sealed.iv), ct: b64(r.sealed.ct) },
          })),
        });
      }
      if (url === '/ai/results/confirm') return answer(200, { deleted: s.queue.confirm('me', (body as { ids: string[] }).ids) });
      return answer(404);
    }) as typeof fetch,
  };
  return s;
}

/** An encrypted store with an account, a class and a 5-page deck whose page 2 has a graph, covered by a lecture today. */
async function setUp(dataKey?: CryptoKey, pictureOnly = false) {
  store = await openStudyStore({ name: `work-${++counter}`, deps: { clock: () => clock } });
  const key = dataKey ?? (await newDataKey());
  await store.setUp(await testKeyring(key), key);
  await store.setSyncState({ email: 'nathan@example.com', pulled: 0, pushedSeq: 0, keyringVersion: 1, keyringSent: '', seenAt: 0 } as SyncState);
  const course = await store.createCourse({ name: 'STAT 255', meetings: [], termStart: null, termEnd: null });
  // Page 2 has a graph; with `pictureOnly` it has nothing else (no text at all, like a scanned page)
  const pages = [1, 2, 3, 4, 5].map((n) =>
    n === 2 && pictureOnly
      ? { title: '', noBar: true, drawing: graphDrawing(100, 300, 300, 200) }
      : { title: `Page ${n}`, body: `Words on page ${n}.`, ...(n === 2 ? { drawing: graphDrawing(100, 300, 300, 200) } : {}) },
  );
  const pdf = makePdf(pages, LETTER);
  const pageTexts = pages.map((p) => [p.title, 'body' in p ? p.body : ''].filter(Boolean).join('\n'));
  const deck = await store.addSlideDeck({ courseId: course.id, title: 'Distributions', fileName: 'dist.pdf', data: pdf, pageTexts });
  const lecture = await store.recordLecture({ courseId: course.id, date: '2026-11-26', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 4 }] });
  return { key, deck, section: lecture.sections[0]! };
}

beforeEach(() => {
  clock = new Date(NOW);
});
afterEach(() => {
  forgetResultsKeys(store);
  store.close();
});

describe('background work, end to end', () => {
  it('sends nothing on a device without an account', async () => {
    store = await openStudyStore({ name: `work-${++counter}` });
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    const s = servers();
    expect(await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ })).toBeNull();
    expect(s.calls).toEqual([]);
  });

  it('sends an upcoming section: pictures only of unread pages, text and a plan for its bank; files what comes back', async () => {
    const { deck, section } = await setUp();
    const s = servers();
    const first = await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    expect(first).toEqual({ filed: 0, questions: 0, sent: section.id, problem: null });
    // The results key was made and saved once
    expect(s.calls.filter((c) => c.url === '/api/results-key' && c.method === 'PUT')).toHaveLength(1);
    const job = s.calls.find((c) => c.url === '/ai/work')!.body as {
      id: string;
      accountId: string;
      neededBy: string;
      note: string;
      pages: { page: number; fp: string; text: string; image: string | null }[];
      questions: { requests: { pages: number[]; count: number; mix: { choice: number[]; short: number } }[]; avoid: string[] };
    };
    // Every covered page goes for the bank (page 5 isn't covered); only page 2, with a graph, goes as a picture
    expect(job.pages.map((p) => p.page)).toEqual([1, 2, 3, 4]);
    expect(job.pages.map((p) => p.image !== null)).toEqual([false, true, false, false]);
    expect(job.pages[1]!.image!.length).toBeGreaterThan(1000);
    expect(job.pages[0]!.text).toContain('Words on page 1.');
    // The bank's plan: the app's planBank, at least MIN_BANK questions over the covered pages
    const asked = job.questions.requests.reduce((t, r) => t + r.count, 0);
    expect(asked).toBeGreaterThanOrEqual(10);
    expect(job.questions.requests.flatMap((r) => r.pages).sort()).toEqual([1, 2, 3, 4]);
    expect(job.questions.avoid).toEqual([]);
    // The planner first wants the section tomorrow (day 1 of its first week), from the study day's start
    expect(job.neededBy).toBe(new Date('2026-11-27T04:00:00').toISOString());
    // The note is sealed: no deck id or page in it, for the helper
    expect(job.note).not.toContain(deck.id);
    expect(JSON.stringify(job)).not.toContain(deck.id);
    expect(unpackNote(job.note).iv).toHaveLength(12);

    // Reading in one batch, the questions in the next; then the device files both and confirms
    clock = new Date(NOW.getTime() + HOUR);
    await s.queue.tick();
    clock = new Date(NOW.getTime() + 2 * HOUR);
    await s.queue.tick();
    const second = await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    expect(second).toMatchObject({ filed: 1, questions: asked, problem: null });
    const banked = await store.listQuestions(section.id);
    expect(banked).toHaveLength(asked);
    expect(new Set(banked.map((q) => q.page))).toEqual(new Set(job.questions.requests.map((r) => r.pages[0])));
    const [reading] = await store.listPageReadings(deck.id);
    expect(reading).toMatchObject({ page: 2, model: 'claude-sonnet-5-5', kinds: ['graph'], figures: [{ label: 'Graph', description: 'A zig-zag line.' }] });
    expect(reading!.fingerprint.text).toMatch(/^[0-9a-f]{64}$/);
    // The helper only ever saw the keyed fingerprint, never the plain one (it could look a textbook page up)
    const sentText = JSON.stringify(job);
    expect(sentText).not.toContain(reading!.fingerprint.text);
    expect(sentText).not.toContain(reading!.fingerprint.look);
    expect(s.queue.resultsFor('me')).toEqual([]);
    expect((await store.getWorkState()).sent).toEqual({});

    // Nothing more to send: the pictures are read and the bank is full
    const third = await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    expect(third!.sent).toBeNull();
    expect(s.calls.filter((c) => c.url === '/ai/work')).toHaveLength(1);
  });

  it('sends a job again when the helper restarted and forgot it', async () => {
    const { section } = await setUp();
    const s = servers();
    await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    s.restart();
    const again = await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    expect(again!.sent).toBe(section.id);
    expect(s.calls.filter((c) => c.url === '/ai/work')).toHaveLength(2);
    expect(Object.keys((await store.getWorkState()).sent)).toHaveLength(1);
  });

  it('says so when not signed in for AI, and sends nothing', async () => {
    await setUp();
    const s = servers();
    s.signOutOfAi();
    const round = await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    expect(round!.problem).toMatch(/Sign in for AI/);
    expect((await store.getWorkState()).problem).toMatch(/Sign in for AI/);
    expect(s.calls.filter((c) => c.url === '/ai/work')).toEqual([]);
  });

  it('refuses a results key on the server that isn’t the account’s', async () => {
    await setUp();
    const s = servers();
    // Someone swapped in a key made with another data key
    const other = await openStudyStore({ name: `work-${++counter}` });
    const otherKey = await newDataKey();
    await other.setUp(await testKeyring(otherKey), otherKey);
    const made = await other.makeResultsKey();
    const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
    s.swapKey({ publicKey: b64(made.upload.publicKey), sealed: { v: 1, iv: b64(made.upload.sealed.iv), ct: b64(made.upload.sealed.ct) } });
    other.close();
    const round = await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    expect(round!.problem).toMatch(/isn’t yours/);
    expect(s.calls.filter((c) => c.url === '/ai/work')).toEqual([]);
  });

  it('leaves a result for another device when this one doesn’t have the deck', async () => {
    const dataKey = await newDataKey();
    await setUp(dataKey);
    const s = servers();
    await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    for (const h of [1, 2]) {
      clock = new Date(NOW.getTime() + h * HOUR);
      await s.queue.tick();
    }
    // Another device of the account, same data key, but without the class and its deck yet
    const pc = store;
    forgetResultsKeys(pc);
    store = await openStudyStore({ name: `work-${++counter}`, deps: { clock: () => clock } });
    await store.setUp(await testKeyring(dataKey), dataKey);
    await store.setSyncState({ email: 'nathan@example.com', pulled: 0, pushedSeq: 0, keyringVersion: 1, keyringSent: '', seenAt: 0 } as SyncState);
    const phone = await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    expect(phone).toMatchObject({ filed: 0, problem: null });
    expect(s.queue.resultsFor('me')).toHaveLength(1); // still there
    forgetResultsKeys(store);
    store.close();
    store = pc;
    expect(await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ })).toMatchObject({ filed: 1 });
    expect(s.queue.resultsFor('me')).toEqual([]);
  });

  it('leaves another account’s results alone (two accounts on one AI sign-in)', async () => {
    await setUp();
    const s = servers();
    await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    for (const h of [1, 2]) {
      clock = new Date(NOW.getTime() + h * HOUR);
      await s.queue.tick();
    }
    // The same AI sign-in, but another Honed account (another results key) on another device
    const mine = store;
    forgetResultsKeys(mine);
    store = await openStudyStore({ name: `work-${++counter}`, deps: { clock: () => clock } });
    const otherKey = await newDataKey();
    await store.setUp(await testKeyring(otherKey), otherKey);
    await store.setSyncState({ email: 'test@example.com', pulled: 0, pushedSeq: 0, keyringVersion: 1, keyringSent: '', seenAt: 0 } as SyncState);
    const held = s.key();
    s.swapKey(null); // this account's own key on its own account
    const other = await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    expect(other).toMatchObject({ filed: 0, problem: null });
    expect(s.queue.resultsFor('me')).toHaveLength(1); // not confirmed, not filed
    forgetResultsKeys(store);
    store.close();
    store = mine;
    s.swapKey(held);
    expect(await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ })).toMatchObject({ filed: 1 });
  });

  it('sends only the pictures for a bank already filled while open, and a page’s earlier reading with its text', async () => {
    const { deck, section } = await setUp();
    const s = servers();
    // The bank was filled while the app was open (Make quiz questions now), at every level (#123)
    await store.addQuestions(
      section.id,
      Array.from({ length: 30 }, (_, i) => ({ form: 'choice' as const, level: (1 + (i % 3)) as 1 | 2 | 3, page: 1 + (i % 4), question: `Old question ${i}?`, options: ['a', 'b', 'c', 'd'] as [string, string, string, string], answer: 0 as const, explanation: '' })),
    );
    await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    const job = s.calls.find((c) => c.url === '/ai/work')!.body as { pages: { page: number; image: string | null }[]; questions?: unknown };
    expect(job.pages.map((p) => p.page)).toEqual([2]);
    expect(job.questions).toBeUndefined();

    // Later the bank is emptied (say the class's questions were deleted): page 2 was read, so its reading goes in its text
    for (const h of [1, 2]) {
      clock = new Date(NOW.getTime() + h * HOUR);
      await s.queue.tick();
    }
    await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    expect(await store.listPageReadings(deck.id)).toHaveLength(1);
    const banked = await store.listQuestions(section.id);
    for (const q of banked) await store.deleteQuestion(q.id);
    await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    const again = s.calls.filter((c) => c.url === '/ai/work').at(-1)!.body as { pages: { page: number; text: string; image: string | null }[]; questions: unknown };
    expect(again.pages.map((p) => p.image)).toEqual([null, null, null, null]); // nothing left to read
    expect(again.pages[1]!.text).toContain('[Graph] A zig-zag line.');
    expect(again.questions).toBeDefined();
  });

  it('plans questions for a page that is only a picture (its reading comes in the same job), and drops repeats', async () => {
    const { section } = await setUp(undefined, true);
    const s = servers();
    await store.addQuestions(section.id, [{ form: 'choice', level: 1, page: 1, question: 'Which value is shown 1?', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '' }]);
    await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    const job = s.calls.find((c) => c.url === '/ai/work')!.body as { pages: { page: number; text: string }[]; questions: { requests: { pages: number[] }[] } };
    expect(job.pages.find((p) => p.page === 2)!.text).toBe('');
    expect(job.questions.requests.flatMap((r) => r.pages)).toContain(2);
    for (const h of [1, 2]) {
      clock = new Date(NOW.getTime() + h * HOUR);
      await s.queue.tick();
    }
    const round = await workOnce(store, { fetcher: s.fetcher, now: () => clock, timeZone: TZ });
    // The fake writer's first question repeats the one already in the bank: it isn't added twice
    const banked = await store.listQuestions(section.id);
    expect(banked.filter((q) => q.question === 'Which value is shown 1?')).toHaveLength(1);
    expect(round!.questions).toBe(banked.length - 1);
  });

  it('binds results to the account by its public key', async () => {
    const a = await accountIdOf(new Uint8Array(65).fill(4));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await accountIdOf(new Uint8Array(65).fill(5))).not.toBe(a);
  });
});
