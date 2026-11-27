// The helper's background work queue (#166, helper/queue.mjs), on a clock the test moves. Rounds are fakes;
// results are sealed by helper/seal.mjs and opened with the app's own code (src/lib/results-key.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQueue, QUEUE, validateWork, WorkError } from '../../helper/queue.mjs';
import { isResultsPublicKey } from '../../helper/seal.mjs';
import { newDataKey } from '../../src/lib/crypto';
import { newResultsKey, openResult } from '../../src/lib/results-key';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-11-26T10:00:00Z');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const fp = (n) => n.toString(16).padStart(64, '0');

let t;
let calls;
let key;
let publicKey;

beforeEach(async () => {
  t = T0;
  calls = [];
  ({ key, upload: { publicKey } } = await newResultsKey(await newDataKey()));
});

/** A job as validateWork gives it: `n` pages from page `from`. */
function work(id, n = 3, { neededBy = null, from = 1 } = {}) {
  return {
    id,
    accountId: 'acc1',
    publicKey,
    neededBy,
    pages: Array.from({ length: n }, (_, i) => ({ page: from + i, fp: fp(from + i), text: `page ${from + i}`, image: new Uint8Array(PNG) })),
  };
}

/** Rounds that record when they ran; `fail[name]` makes a round throw that many times first. */
function rounds(names = ['read', 'questions'], fail = {}) {
  return names.map((name) => ({
    name,
    run: async ({ jobId, pages, carry, person, cache }) => {
      calls.push({ name, jobId, person, at: t, carry });
      if (fail[name] > 0) {
        fail[name] -= 1;
        throw new Error('flaky');
      }
      cache.set(`${name}:${jobId}`, true);
      return { carry: [...(carry ?? []), `${name}(${pages ? pages.length : 'none'})`] };
    },
  }));
}

function queue(opts = {}) {
  return createQueue({ rounds: rounds(), delayMs: HOUR, marginMs: 2 * HOUR, dailyPages: 100, now: () => new Date(t), ...opts });
}

/** Moves the clock and runs a tick. */
async function at(ms, q) {
  t = ms;
  await q.tick();
}

async function opened(q, person, id) {
  const r = q.resultsFor(person).find((x) => x.id === id);
  return JSON.parse(new TextDecoder().decode(await openResult(key, r.accountId, r.id, r.sealed)));
}

describe('the queue', () => {
  it('waits for a batch, each round for the next, then seals a result only the account opens', async () => {
    const q = queue();
    expect(q.submit('nathan', work('j1'))).toMatchObject({ state: 'waiting', round: 'read', readyAt: new Date(T0 + HOUR).toISOString() });
    await at(T0 + HOUR - 1, q);
    expect(calls).toEqual([]);
    await at(T0 + HOUR, q);
    expect(calls.map((c) => c.name)).toEqual(['read']);
    expect(q.get('nathan', 'j1')).toMatchObject({ state: 'waiting', round: 'questions', readyAt: new Date(T0 + 2 * HOUR).toISOString() });
    await at(T0 + 2 * HOUR, q);
    expect(calls.map((c) => c.name)).toEqual(['read', 'questions']);
    expect(q.get('nathan', 'j1')).toMatchObject({ state: 'done', round: null, fetched: false });
    // Sealed by the helper, opened by the app's code; each round got the one before's carry
    expect(await opened(q, 'nathan', 'j1')).toEqual(['read(3)', 'questions(3)']);
    await expect(openResult(key, 'acc2', 'j1', q.resultsFor('nathan')[0].sealed)).rejects.toThrow();
    // Confirmed: deleted; the job says it was fetched
    expect(q.confirm('nathan', ['j1'])).toBe(1);
    expect(q.resultsFor('nathan')).toEqual([]);
    expect(q.get('nathan', 'j1')).toMatchObject({ state: 'done', fetched: true });
  });

  it('runs straight away when waiting for a batch would miss the deadline', async () => {
    const q = queue();
    q.submit('nathan', work('soon', 2, { neededBy: T0 + 2.5 * HOUR })); // a batch (+1 h) is past 2.5 h - 2 h margin
    expect(q.get('nathan', 'soon').readyAt).toBe(new Date(T0).toISOString());
    await at(T0, q);
    await at(T0 + MIN, q); // round 2 straight away too
    expect(calls.map((c) => [c.name, c.at])).toEqual([['read', T0], ['questions', T0 + MIN]]);
    expect(q.get('nathan', 'soon').state).toBe('done');
  });

  it('uses a third batch when there is time for it, and goes straight away when there isn’t', async () => {
    const q = queue({ rounds: rounds(['read', 'questions', 'rewrites']) });
    q.submit('nathan', work('j', 2, { neededBy: T0 + 4.5 * HOUR })); // must be done by T0 + 2.5 h
    await at(T0 + HOUR, q); // read, in the first batch
    await at(T0 + 2 * HOUR, q); // questions, in the second
    // A third batch would come at T0 + 3 h, past T0 + 2.5 h: the rewrites run straight away
    expect(q.get('nathan', 'j').readyAt).toBe(new Date(T0 + 2 * HOUR).toISOString());
    await at(T0 + 2 * HOUR + MIN, q);
    expect(calls.map((c) => [c.name, c.at])).toEqual([['read', T0 + HOUR], ['questions', T0 + 2 * HOUR], ['rewrites', T0 + 2 * HOUR + MIN]]);

    // With plenty of time, every round waits for its batch
    const q2 = queue({ rounds: rounds(['read', 'questions', 'rewrites']) });
    calls = [];
    t = T0;
    q2.submit('nathan', work('k', 2, { neededBy: T0 + 10 * HOUR }));
    for (const h of [1, 2, 3]) await at(T0 + h * HOUR, q2);
    expect(calls.map((c) => c.at)).toEqual([T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR]);
  });

  it('runs a job at the next tick when a study session starts', async () => {
    const q = queue();
    q.submit('nathan', work('j'));
    await at(T0 + 10 * MIN, q);
    expect(calls).toEqual([]);
    expect(q.runNow('nathan', 'j').readyAt).toBe(new Date(T0 + 10 * MIN).toISOString());
    await q.tick();
    expect(calls.map((c) => c.name)).toEqual(['read']);
    expect(q.runNow('nathan', 'nope')).toBeNull();
  });

  it('spreads pages past the daily limit over the next days, which wins over deadlines and run now', async () => {
    const q = queue({ dailyPages: 10 });
    expect(q.submit('nathan', work('a', 8)).day).toBe('2026-11-26');
    const b = q.submit('nathan', work('b', 5, { neededBy: T0 + HOUR, from: 9 }));
    expect(b.day).toBe('2026-11-27');
    expect(b.readyAt).toBe('2026-11-27T00:00:00.000Z');
    q.runNow('nathan', 'b');
    expect(q.get('nathan', 'b').readyAt).toBe('2026-11-27T00:00:00.000Z');
    expect(() => q.submit('nathan', work('c', 11))).toThrow(expect.objectContaining({ status: 413 }));
    // Another person has their own limit
    expect(q.submit('matt', work('a', 10)).day).toBe('2026-11-26');
    await at(Date.parse('2026-11-27T00:00:00Z'), q);
    expect(calls.filter((c) => c.jobId === 'b').map((c) => c.name)).toEqual(['read']);
  });

  it('tries a round again in the next batch, and gives up after three failures', async () => {
    const q = queue({ rounds: rounds(['read', 'questions'], { read: 2 }) });
    q.submit('nathan', work('j'));
    await at(T0 + HOUR, q); // fails
    expect(q.get('nathan', 'j')).toMatchObject({ state: 'waiting', round: 'read', readyAt: new Date(T0 + 2 * HOUR).toISOString() });
    await at(T0 + 2 * HOUR, q); // fails
    await at(T0 + 3 * HOUR, q); // works
    await at(T0 + 4 * HOUR, q);
    expect(q.get('nathan', 'j').state).toBe('done');

    const q2 = queue({ rounds: rounds(['read'], { read: 5 }) });
    t = T0;
    q2.submit('nathan', work('k'));
    for (const h of [1, 2, 3, 4]) await at(T0 + h * HOUR, q2);
    expect(q2.get('nathan', 'k')).toMatchObject({ state: 'failed', error: 'The read round failed 3 times.' });
    expect(q2.resultsFor('nathan')).toEqual([]);
  });

  it('finishes early when a round says so', async () => {
    const q = queue({
      rounds: [
        { name: 'read', run: async () => ({ done: true, output: { nothing: 'to do' } }) },
        { name: 'questions', run: async () => { throw new Error('must not run'); } },
      ],
    });
    q.submit('nathan', work('j'));
    await at(T0 + HOUR, q);
    expect(q.get('nathan', 'j').state).toBe('done');
    expect(await opened(q, 'nathan', 'j')).toEqual({ nothing: 'to do' });
  });

  it('keeps people apart, and the same job sent twice once', async () => {
    const q = queue();
    q.submit('nathan', work('j'));
    expect(q.submit('nathan', { ...work('j'), pages: work('x', 9).pages }).id).toBe('j'); // the one already there
    expect(q.get('matt', 'j')).toBeNull();
    await at(T0 + HOUR, q);
    await at(T0 + 2 * HOUR, q);
    expect(calls.filter((c) => c.name === 'read')).toHaveLength(1);
    expect(q.resultsFor('matt')).toEqual([]);
    expect(q.confirm('matt', ['j'])).toBe(0);
    expect(q.resultsFor('nathan')).toHaveLength(1);
  });

  it('gives each person a cache that lasts across their jobs', async () => {
    const seen = [];
    const q = queue({ rounds: [{ name: 'read', run: async ({ cache, jobId }) => { seen.push([jobId, [...cache.keys()]]); cache.set(jobId, 1); return { carry: 1 }; } }] });
    q.submit('nathan', work('a'));
    q.submit('nathan', work('b', 3, { from: 4 }));
    q.submit('matt', work('c'));
    await at(T0 + HOUR, q);
    expect(seen).toEqual([['a', []], ['b', ['a']], ['c', []]]);
  });

  it('forgets jobs after 7 days and unfetched results after 30', async () => {
    const q = queue({ rounds: rounds(['read']) });
    q.submit('nathan', work('done'));
    await at(T0 + HOUR, q);
    t = T0 + HOUR;
    q.submit('nathan', work('never', 1, { from: 50 }));
    // ...a job far in the future never runs: here, by a limit pushing it out
    await at(T0 + 8 * 86_400_000, q);
    expect(q.get('nathan', 'done')).toBeNull();
    expect(q.get('nathan', 'never')).toBeNull();
    expect(q.resultsFor('nathan')).toHaveLength(1);
    await at(T0 + 31 * 86_400_000, q);
    expect(q.resultsFor('nathan')).toEqual([]);
  });

  describe('when full', () => {
    const was = QUEUE.maxQueuedBytes;
    afterEach(() => (QUEUE.maxQueuedBytes = was));
    it('refuses new work until some is done', async () => {
      const q = queue({ rounds: rounds(['read']) });
      QUEUE.maxQueuedBytes = 60;
      q.submit('nathan', work('a', 2));
      expect(() => q.submit('nathan', work('b', 2, { from: 3 }))).toThrow(expect.objectContaining({ status: 503 }));
      await at(T0 + HOUR, q);
      expect(q.submit('nathan', work('b', 2, { from: 3 })).state).toBe('waiting');
    });
  });
});

describe('validateWork', () => {
  const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
  const body = () => ({
    id: 'job-1',
    accountId: 'acc1',
    publicKey: b64(publicKey),
    neededBy: '2026-11-27T16:00:00Z',
    pages: [{ page: 51, fp: fp(1), text: 'words', image: b64(PNG) }, { page: 52, fp: fp(2), text: '', image: null }],
  });

  it('decodes a good job', async () => {
    const w = validateWork(body());
    expect(w.neededBy).toBe(Date.parse('2026-11-27T16:00:00Z'));
    expect(w.pages[0].image).toEqual(new Uint8Array(PNG));
    expect(w.pages[1].image).toBeNull();
    expect(await isResultsPublicKey(w.publicKey)).toBe(true);
    expect(validateWork({ ...body(), neededBy: null }).neededBy).toBeNull();
  });

  it.each([
    ['a bad id', (b) => (b.id = 'has space')],
    ['a bad account', (b) => (b.accountId = '')],
    ['a short public key', (b) => (b.publicKey = 'abc')],
    ['a bad deadline', (b) => (b.neededBy = 'soon')],
    ['no pages', (b) => (b.pages = [])],
    ['too many pages', (b) => (b.pages = Array.from({ length: QUEUE.maxPages + 1 }, (_, i) => ({ page: i + 1, fp: fp(i), text: '', image: null })))],
    ['a plain fingerprint length', (b) => (b.pages[0].fp = 'abc')],
    ['a picture that isn’t a PNG', (b) => (b.pages[0].image = b64(Buffer.from('GIF89a')))],
    ['the same page twice', (b) => (b.pages[1].page = 51)],
    ['text too long', (b) => (b.pages[0].text = 'x'.repeat(QUEUE.maxText + 1))],
    ['no page number', (b) => delete b.pages[0].page],
  ])('refuses %s', (_name, change) => {
    const b = body();
    change(b);
    expect(() => validateWork(b)).toThrow(WorkError);
  });
});
