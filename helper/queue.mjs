// AI work in the background (#166; docs/DESIGN.md "From upload to quiz", docs/SECURITY.md "AI work in the
// background"). A device sends the pages a student says were covered; the work runs later, in rounds, and the
// result comes back sealed to the student's results key.
//
// Batches are simulated (DESIGN.md "Batches before there's an API account"): each round of a job waits for
// the next "batch" (`delayMs`) unless that would miss its deadline ("needed by", the next study session that
// uses the pages, less `marginMs`), in which case it runs straight away. Starting a study session runs a job
// now. A daily page limit per person spreads a big section over the next days, and wins over deadlines.
//
// Everything is in memory (the helper has no disk): waiting pages are never written anywhere, a restart drops
// them, and the device sends them again (it finds its job unknown). Results are sealed the moment a job is
// done (./seal.mjs), so only the student's unlocked devices can open them; the device fetches and confirms
// them, and they're deleted.
import { InputError, JOBS } from './jobs.mjs';
import { sealResult } from './seal.mjs';

export const QUEUE = {
  /** Pages in one job (a lecture's section). */
  maxPages: 60,
  /** A page's text, characters. */
  maxText: 20_000,
  /** A page's picture (PNG), bytes. */
  maxImage: 4 * 1024 * 1024,
  /** Pictures waiting, all people together, bytes: past this, new work is refused until some is done. */
  maxQueuedBytes: 300 * 1024 * 1024,
  /** A job's note (sealed by the device with its own key: the helper can't read it), base64url characters. */
  maxNote: 64 * 1024,
  /** Question groups in one job (a section of 60 pages in groups of 5 is 12). */
  maxRequests: 20,
  /** Tries per round before a job is given up. */
  maxAttempts: 3,
  /** Jobs are forgotten this long after they arrive, whatever their state. */
  keepJobsMs: 7 * 86_400_000,
  /** Results not fetched are deleted after this. */
  keepResultsMs: 30 * 86_400_000,
};

const ID = /^[\w-]{1,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DAY_MS = 86_400_000;

export class WorkError extends Error {
  /** @param {number} status  the HTTP status it answers with */
  constructor(status, message) {
    super(message);
    this.name = 'WorkError';
    this.status = status;
  }
}

/** Checks a job as a device sends it (POST /ai/work); gives it with bytes decoded. Throws WorkError 400. */
export function validateWork(body) {
  const bad = (m) => new WorkError(400, m);
  if (typeof body !== 'object' || body === null) throw bad('Send a JSON object.');
  const { id, accountId, publicKey, neededBy, pages, note, questions } = body;
  if (typeof id !== 'string' || !ID.test(id)) throw bad('id: letters, digits, - and _ only, 1 to 64.');
  if (typeof accountId !== 'string' || !ID.test(accountId)) throw bad('accountId: letters, digits, - and _ only, 1 to 64.');
  if (typeof publicKey !== 'string' || !/^[\w-]{87}$/.test(publicKey)) throw bad('publicKey: a P-256 public key, base64url.');
  let needed = null;
  if (neededBy !== null && neededBy !== undefined) {
    if (typeof neededBy !== 'string' || Number.isNaN(Date.parse(neededBy))) throw bad('neededBy: a date and time, or null.');
    needed = Date.parse(neededBy);
  }
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > QUEUE.maxPages) throw bad(`pages: 1 to ${QUEUE.maxPages}.`);
  const seen = new Set();
  const decoded = pages.map((p, i) => {
    if (typeof p !== 'object' || p === null) throw bad(`pages[${i}]: an object.`);
    if (!Number.isInteger(p.page) || p.page < 1) throw bad(`pages[${i}].page: the page number.`);
    if (typeof p.fp !== 'string' || !HEX64.test(p.fp)) throw bad(`pages[${i}].fp: a keyed fingerprint (64 hex digits).`);
    if (typeof p.text !== 'string' || p.text.length > QUEUE.maxText) throw bad(`pages[${i}].text: at most ${QUEUE.maxText} characters.`);
    let image = null;
    if (p.image !== null && p.image !== undefined) {
      if (typeof p.image !== 'string' || !/^[\w-]+$/.test(p.image)) throw bad(`pages[${i}].image: a PNG, base64url.`);
      image = new Uint8Array(Buffer.from(p.image, 'base64url'));
      if (image.length > QUEUE.maxImage) throw bad(`pages[${i}].image: at most ${QUEUE.maxImage} bytes.`);
      if (!(image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47)) throw bad(`pages[${i}].image: not a PNG.`);
    }
    if (seen.has(p.page)) throw bad(`pages[${i}]: page ${p.page} twice.`);
    seen.add(p.page);
    return { page: p.page, fp: p.fp, text: p.text, image };
  });
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > QUEUE.maxNote || !/^[\w-]*$/.test(note))) {
    throw bad(`note: base64url, at most ${QUEUE.maxNote} characters.`);
  }
  return {
    id,
    accountId,
    publicKey: new Uint8Array(Buffer.from(publicKey, 'base64url')),
    neededBy: needed,
    pages: decoded,
    note: note ?? null,
    plan: questions === undefined || questions === null ? null : { questions: questionPlan(questions, decoded) },
  };
}

/**
 * A job's question plan (#172): the device's planBank groups (page numbers from the job, a count, a mix of levels),
 * with the class's guide and the questions already in the bank to avoid. Each group is checked exactly as the
 * `questions` job checks a request (helper/jobs.mjs), with the pages' text as sent, so a bad plan is refused now.
 */
function questionPlan(value, pages) {
  const bad = (m) => new WorkError(400, `questions: ${m}`);
  if (typeof value !== 'object' || value === null) throw bad('an object.');
  const { requests, guide, avoid } = value;
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > QUEUE.maxRequests) throw bad(`1 to ${QUEUE.maxRequests} requests.`);
  const text = new Map(pages.map((p) => [p.page, p.text]));
  try {
    const checked = requests.map((r, i) => {
      if (typeof r !== 'object' || r === null || !Array.isArray(r.pages) || r.pages.some((n) => !text.has(n))) throw bad(`requests[${i}].pages: pages of this job.`);
      const input = JOBS.questions.validate({ pages: r.pages.map((n) => ({ page: n, text: text.get(n) })), count: r.count, mix: r.mix, avoid: [], guide });
      return { pages: r.pages, count: input.count, mix: input.mix ?? { choice: [0, input.count, 0], short: 0 } };
    });
    const kept = JOBS.questions.validate({ pages: [{ page: 1, text: 'x' }], count: 1, avoid: avoid ?? [], guide });
    return { requests: checked, guide: kept.guide ?? null, avoid: kept.avoid };
  } catch (err) {
    if (err instanceof InputError) throw bad(err.message);
    throw err;
  }
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const startOf = (day) => Date.parse(`${day}T00:00:00.000Z`);

/**
 * @param {object} options
 * @param {{ name: string, run: (ctx: object) => Promise<{ carry?: unknown, done?: boolean, output?: unknown, quick?: boolean }> }[]} options.rounds
 *   in order. A round gets { jobId, pages, carry, plan, neededBy, person, cache } and gives the next round its carry,
 *   or finishes the job early with { done: true, output }. `quick: true` (it did no AI work) lets the next round run
 *   at the next tick instead of the next batch. After the last round the job's output is its carry. `plan` is the
 *   job's question plan ({ questions } or null).
 *   `cache` is a Map for this person that lasts across their jobs (pages already read, by keyed fingerprint).
 * @param {number} options.delayMs   how long a batch takes to come round
 * @param {number} options.marginMs  how long before "needed by" a job must be done
 * @param {number} options.dailyPages  pages per person per day (UTC)
 * @param {() => Date} [options.now]
 * @param {(line: object) => void} [options.log]
 * @param {typeof sealResult} [options.seal]
 */
export function createQueue(options) {
  const { rounds, delayMs, marginMs, dailyPages } = options;
  if (!rounds.length) throw new Error('A queue needs at least one round.');
  const now = () => (options.now ?? (() => new Date()))().getTime();
  const log = options.log ?? (() => {});
  const seal = options.seal ?? sealResult;
  const jobs = new Map(); // `${person}/${id}` -> job
  const results = new Map(); // `${person}/${id}` -> { id, person, accountId, sealed, at }
  const usedPages = new Map(); // person -> Map(day -> pages)
  const caches = new Map(); // person -> Map
  let ticking = null;

  const key = (person, id) => `${person}/${id}`;
  const queuedBytes = () => [...jobs.values()].reduce((n, j) => n + (j.state === 'waiting' || j.state === 'running' ? j.bytes : 0), 0);

  /** When a job's next round may run, from time `t`: the next batch, or now if a batch would miss the deadline. */
  function nextReadyAt(job, t) {
    let at = t + delayMs;
    if (job.neededBy !== null && at > job.neededBy - marginMs) at = t;
    return Math.max(at, startOf(job.day));
  }

  function status(job) {
    const result = results.get(key(job.person, job.id));
    return {
      id: job.id,
      state: job.state,
      round: job.state === 'waiting' || job.state === 'running' ? rounds[job.round].name : null,
      readyAt: job.state === 'waiting' ? new Date(job.readyAt).toISOString() : null,
      neededBy: job.neededBy === null ? null : new Date(job.neededBy).toISOString(),
      day: job.day,
      error: job.error,
      fetched: job.state === 'done' && !result,
    };
  }

  /** Adds a job (the same id again gives the one already there). Throws WorkError 413 / 503. */
  function submit(person, work) {
    const existing = jobs.get(key(person, work.id));
    if (existing) return status(existing);
    const n = work.pages.length;
    if (n > dailyPages) throw new WorkError(413, `At most ${dailyPages} pages a day: split this section.`);
    const bytes = work.pages.reduce((s, p) => s + (p.image?.length ?? 0) + p.text.length, 0);
    if (queuedBytes() + bytes > QUEUE.maxQueuedBytes) throw new WorkError(503, 'The AI helper is full right now. Try again later.');
    // The first day from today with room for every page of the job
    const used = usedPages.get(person) ?? new Map();
    usedPages.set(person, used);
    const t = now();
    let day = dayOf(t);
    while ((used.get(day) ?? 0) + n > dailyPages) day = dayOf(startOf(day) + DAY_MS);
    used.set(day, (used.get(day) ?? 0) + n);
    const job = { ...work, person, day, bytes, submittedAt: t, state: 'waiting', round: 0, carry: undefined, attempts: 0, error: null, readyAt: 0 };
    job.readyAt = nextReadyAt(job, t);
    jobs.set(key(person, work.id), job);
    log({ work: 'added', person, pages: n, day, readyInMs: job.readyAt - t });
    return status(job);
  }

  /** The job's state, or null if it isn't known (never sent, forgotten, or lost in a restart: send it again). */
  function get(person, id) {
    const job = jobs.get(key(person, id));
    return job ? status(job) : null;
  }

  /** A study session started: run this job at the next tick (still not before its day, if the limit moved it). */
  function runNow(person, id) {
    const job = jobs.get(key(person, id));
    if (!job) return null;
    if (job.state === 'waiting') job.readyAt = Math.max(now(), startOf(job.day));
    return status(job);
  }

  /** This person's results that haven't been confirmed yet. */
  function resultsFor(person) {
    return [...results.values()].filter((r) => r.person === person).map(({ id, accountId, sealed, at }) => ({ id, accountId, sealed, at: new Date(at).toISOString() }));
  }

  /** The device has the results safely: delete them. Gives how many were deleted. */
  function confirm(person, ids) {
    let n = 0;
    for (const id of ids) if (results.delete(key(person, id))) n++;
    return n;
  }

  async function runRound(job) {
    job.state = 'running';
    const round = rounds[job.round];
    const cache = caches.get(job.person) ?? new Map();
    caches.set(job.person, cache);
    let r;
    try {
      r = await round.run({ jobId: job.id, pages: job.pages, carry: job.carry, plan: job.plan ?? null, neededBy: job.neededBy, person: job.person, cache });
    } catch (err) {
      job.attempts += 1;
      log({ work: 'round failed', person: job.person, round: round.name, attempt: job.attempts, error: err instanceof Error ? err.name : 'unknown' });
      if (job.attempts >= QUEUE.maxAttempts) {
        job.state = 'failed';
        job.error = `The ${round.name} round failed ${job.attempts} times.`;
        job.pages = null;
      } else {
        job.state = 'waiting';
        job.readyAt = nextReadyAt(job, now());
      }
      return;
    }
    job.attempts = 0;
    if (r?.done || job.round === rounds.length - 1) {
      // The device's note comes back beside the work, inside the sealed result: which deck and pages it was
      const output = { note: job.note ?? null, result: (r?.done ? r.output : r?.carry) ?? null };
      const sealed = await seal(job.publicKey, job.accountId, job.id, new TextEncoder().encode(JSON.stringify(output)));
      results.set(key(job.person, job.id), { id: job.id, person: job.person, accountId: job.accountId, sealed, at: now() });
      job.state = 'done';
      job.pages = null; // the pictures aren't needed any more
      job.carry = undefined;
      log({ work: 'done', person: job.person, rounds: job.round + 1 });
      return;
    }
    job.carry = r?.carry;
    job.round += 1;
    job.state = 'waiting';
    // A round that did no AI work (nothing to read) doesn't make the next one wait for a batch
    job.readyAt = r?.quick ? Math.max(now(), startOf(job.day)) : nextReadyAt(job, now());
  }

  /** Runs every job whose time has come, one at a time; forgets old jobs and results. Safe to call often. */
  function tick() {
    if (ticking) return ticking;
    // .finally runs after this assignment even when nothing is awaited (a finally inside the async function
    // would run first, leave `ticking` set to the finished promise for good, and stop the queue)
    ticking = (async () => {
      {
        const t = now();
        for (const [k, job] of jobs) if (t - job.submittedAt > QUEUE.keepJobsMs) jobs.delete(k);
        for (const [k, r] of results) if (t - r.at > QUEUE.keepResultsMs) results.delete(k);
        for (const used of usedPages.values()) for (const day of used.keys()) if (startOf(day) < t - 2 * DAY_MS) used.delete(day);
        // Oldest deadline first, then oldest job
        const due = [...jobs.values()]
          .filter((j) => j.state === 'waiting' && j.readyAt <= now())
          .sort((a, b) => (a.neededBy ?? Infinity) - (b.neededBy ?? Infinity) || a.submittedAt - b.submittedAt);
        for (const job of due) if (job.state === 'waiting' && job.readyAt <= now()) await runRound(job);
      }
    })().finally(() => {
      ticking = null;
    });
    return ticking;
  }

  return { submit, get, runNow, resultsFor, confirm, tick };
}
