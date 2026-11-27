// The rounds of AI work in the background (#168; DESIGN.md "Reading pictures and choosing models"). Each is
// a round for ./queue.mjs: it gets a job's pages and the person, and gives the next round what it found.
//
// Reading (round 1): every page that came with a picture is read, Haiku first. A page whose pictures hold
// hard kinds of content (chemistry, graphs, maths, circuits) or a part Haiku couldn't read is read again by
// Sonnet, whose reading replaces Haiku's (the model test, #155: Haiku is enough for pictures of text, not for
// chemistry or exact graph values). An unusable answer is asked for once more; a page that fails twice fails
// the round, and the queue tries the job again in the next batch, skipping the pages already read (the
// person's cache, by keyed fingerprint). Pages without a picture have nothing to read.
import { ClaudeError } from './claude.mjs';
import { buildPrompt, JOBS, ReplyError, replyObject, systemPrompt } from './jobs.mjs';
import { needsStrongerModel, parseReading, ReadingError, readingPrompt, READING_SYSTEM } from './reading.mjs';

export const READING_MODELS = { first: 'claude-haiku-5-5', stronger: 'claude-sonnet-5-5' };

/**
 * @param {object} options
 * @param {{ label: string, token: string }[]} options.people
 * @param {typeof import('./claude.mjs').runClaude} options.run
 * @param {number} options.timeoutMs
 * @param {string[]} [options.command]  (tests)
 * @param {object} [options.extraEnv]  (tests)
 * @param {(line: object) => void} [options.log]
 */
/**
 * Reads one page (its picture and text): Haiku, then Sonnet if Haiku found hard content or couldn't read a part.
 * The batch's reading round and the helper's `read` job (Explain or Ask on a page not read yet, #175) both use it.
 * Gives { reading, model }; throws if the page can't be read twice running.
 */
export async function readPage(page, token, person, options) {
  const log = options.log ?? (() => {});
  async function readOnce(model) {
    let problem;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await options.run({
          prompt: readingPrompt(page.text),
          system: READING_SYSTEM,
          image: page.image,
          token,
          model,
          timeoutMs: options.timeoutMs,
          command: options.command,
          extraEnv: options.extraEnv,
          onUsage: (u) => log({ work: 'read page', person, model, ...u }),
        });
        return parseReading(text);
      } catch (err) {
        if (!(err instanceof ClaudeError || err instanceof ReadingError)) throw err;
        problem = err;
      }
    }
    throw new Error(`A page couldn't be read (${problem?.message}).`);
  }
  const first = await readOnce(READING_MODELS.first);
  if (!needsStrongerModel(first)) return { reading: first, model: READING_MODELS.first };
  return { reading: await readOnce(READING_MODELS.stronger), model: READING_MODELS.stronger };
}

export function readingRound(options) {
  const { people } = options;

  return {
    name: 'read',
    async run({ pages, carry, plan, person, cache }) {
      const who = people.find((p) => p.label === person);
      if (!who) throw new Error('Nobody to run this as.');
      const readings = [];
      let readAny = false;
      for (const page of pages) {
        if (!page.image) continue;
        const cached = cache.get(`read:${page.fp}`);
        if (cached) {
          readings.push({ page: page.page, fp: page.fp, ...cached });
          continue;
        }
        readAny = true;
        const { reading, model } = await readPage(page, who.token, person, options);
        cache.set(`read:${page.fp}`, { reading, model });
        readings.push({ page: page.page, fp: page.fp, reading, model });
      }
      // Reading only (no question plan): done. Nothing new read: the questions needn't wait for another batch
      if (!plan?.questions) return { done: true, output: { ...(carry ?? {}), readings } };
      return { carry: { ...(carry ?? {}), readings }, quick: !readAny };
    },
  };
}

// --- Questions (#172; DESIGN.md "Quizzes by difficulty too") ---
//
// Round 2 writes each planned group with the `questions` job (helper/jobs.mjs: the same prompt, levels, guide and
// checks as when the app asks while open), each page's text with what its pictures hold added. By difficulty:
// Haiku writes a group's level 1 and 2 multiple choice, Sonnet its level 3 and short answers, and Sonnet writes all
// of a group that has a page Sonnet had to read. Haiku's questions are then answered blind by Haiku (no answer
// key): one it answers differently, finds no single right option in, or can't settle is dropped and noted. Round 3
// has Sonnet write as many again, on the same pages at the same levels. A job with nothing to rewrite finishes
// after round 2; a job without a question plan (reading only) finishes after round 1.

export const QUESTION_MODELS = { easy: 'claude-haiku-5-5', hard: 'claude-sonnet-5-5', check: 'claude-haiku-5-5', rewrite: 'claude-sonnet-5-5' };

/** A page's text for writing questions: its own text, then what the AI read on its pictures. */
export function pageForQuestions(page, reading) {
  if (!reading || reading.decorativeOnly) return { page: page.page, text: page.text };
  const parts = [page.text];
  if (reading.pictureText) parts.push(`[Text in the slide's pictures]\n${reading.pictureText}`);
  for (const f of reading.figures ?? []) parts.push(`[${f.label || 'Figure'}] ${f.description}`);
  return { page: page.page, text: parts.filter((p) => p && p.trim()).join('\n').slice(0, 8_000) };
}

const BLIND_CHECK = [
  'These multiple-choice questions were written from the slides in DATA.pages. Answer each question in DATA.questions yourself, in order, using only DATA.pages and what an expert in the subject knows.',
  "For each, give the index (0 to 3) of the one right option. Give -1 if no option is right, more than one is right, or the slides don't settle it.",
  'Reply with only: {"answers": [one number per question, in order]}',
].join('\n');

/** Checks a blind answer reply: one whole number from -1 to 3 per question. */
export function checkBlindAnswers(text, count) {
  const reply = replyObject(text);
  if (!Array.isArray(reply.answers) || reply.answers.length !== count) throw new ReplyError('One answer per question, please.');
  if (!reply.answers.every((a) => Number.isInteger(a) && a >= -1 && a <= 3)) throw new ReplyError('Each answer is -1 to 3.');
  return reply.answers;
}

/** The questions and rewrites rounds. Options as for readingRound. */
export function questionRounds(options) {
  const { people, run, timeoutMs } = options;
  const log = options.log ?? (() => {});

  /** One request to Claude, asked once more if its answer isn't usable. */
  async function ask(prompt, model, token, person, check) {
    let problem;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await run({
          prompt,
          system: systemPrompt(),
          token,
          model,
          timeoutMs,
          command: options.command,
          extraEnv: options.extraEnv,
          onUsage: (u) => log({ work: 'questions', person, model, ...u }),
        });
        return check(text);
      } catch (err) {
        if (!(err instanceof ClaudeError || err instanceof ReplyError)) throw err;
        problem = err;
      }
    }
    throw new Error(`Questions couldn't be written (${problem?.message}).`);
  }

  /** Writes `count` questions of this mix on these pages with this model. */
  async function write(pages, count, mix, avoid, guide, model, token, person) {
    const input = JOBS.questions.validate({ pages, count, mix, avoid: avoid.slice(-200), ...(guide && { guide }) });
    const made = await ask(JOBS.questions.prompt(input), model, token, person, (text) => JOBS.questions.check(text, input).questions);
    return made.map((q) => ({ ...q, model }));
  }

  /** Haiku answers Haiku's multiple choice blind: gives the ones it agrees with, and the ones to rewrite. */
  async function blindCheck(pages, questions, token, person) {
    const choice = questions.filter((q) => q.form === 'choice');
    if (!choice.length) return { kept: questions, failed: [] };
    let answers;
    try {
      const prompt = buildPrompt(BLIND_CHECK, { pages, questions: choice.map((q) => ({ question: q.question, options: q.options })) });
      answers = await ask(prompt, QUESTION_MODELS.check, token, person, (text) => checkBlindAnswers(text, choice.length));
    } catch {
      // The check itself couldn't be done: rewrite them all rather than keep unchecked ones
      return { kept: questions.filter((q) => q.form !== 'choice'), failed: choice };
    }
    const failed = choice.filter((q, i) => answers[i] !== q.answer);
    return { kept: questions.filter((q) => !failed.includes(q)), failed };
  }

  const tokenFor = (person) => {
    const who = people.find((p) => p.label === person);
    if (!who) throw new Error('Nobody to run this as.');
    return who.token;
  };

  const questionsRound = {
    name: 'questions',
    async run({ pages, carry, plan, person }) {
      const readings = carry?.readings ?? [];
      if (!plan?.questions) return { done: true, output: { readings } };
      const token = tokenFor(person);
      const byPage = new Map(readings.map((r) => [r.page, r]));
      const text = new Map(pages.map((p) => [p.page, pageForQuestions(p, byPage.get(p.page)?.reading)]));
      const { requests, guide, avoid } = plan.questions;
      const written = [];
      const failed = [];
      const asked = () => [...avoid, ...written.map((q) => q.question)];
      for (const r of requests) {
        const groupPages = r.pages.map((n) => text.get(n));
        const hard = r.pages.some((n) => byPage.get(n)?.model === READING_MODELS.stronger);
        const [l1, l2, l3] = r.mix.choice;
        const parts = hard
          ? [{ model: QUESTION_MODELS.hard, mix: r.mix, count: r.count }]
          : [
              { model: QUESTION_MODELS.easy, mix: { choice: [l1, l2, 0], short: 0 }, count: l1 + l2 },
              { model: QUESTION_MODELS.hard, mix: { choice: [0, 0, l3], short: r.mix.short }, count: l3 + r.mix.short },
            ].filter((p) => p.count > 0);
        for (const part of parts) {
          const made = await write(groupPages, part.count, part.mix, asked(), guide, part.model, token, person);
          if (part.model === QUESTION_MODELS.easy) {
            const checked = await blindCheck(groupPages, made, token, person);
            written.push(...checked.kept);
            failed.push(...checked.failed.map((q) => ({ page: q.page, level: q.level, question: q.question, pages: r.pages })));
          } else written.push(...made);
        }
      }
      log({ work: 'questions written', person, written: written.length, failedCheck: failed.length });
      if (!failed.length) return { done: true, output: { readings, questions: written } };
      return { carry: { readings, questions: written, failed } };
    },
  };

  const rewritesRound = {
    name: 'rewrites',
    async run({ pages, carry, plan, person }) {
      const token = tokenFor(person);
      const byPage = new Map((carry.readings ?? []).map((r) => [r.page, r]));
      const text = new Map(pages.map((p) => [p.page, pageForQuestions(p, byPage.get(p.page)?.reading)]));
      const questions = [...carry.questions];
      // One request per group the failed questions came from, as many again at the same levels
      const groups = new Map();
      for (const f of carry.failed) {
        const k = f.pages.join(',');
        groups.set(k, [...(groups.get(k) ?? []), f]);
      }
      for (const failed of groups.values()) {
        const levels = [1, 2, 3].map((l) => failed.filter((f) => f.level === l).length);
        const avoid = [...plan.questions.avoid, ...questions.map((q) => q.question), ...failed.map((f) => f.question)];
        const made = await write(failed[0].pages.map((n) => text.get(n)), failed.length, { choice: levels, short: 0 }, avoid, plan.questions.guide, QUESTION_MODELS.rewrite, token, person);
        questions.push(...made);
      }
      return { carry: { readings: carry.readings ?? [], questions } };
    },
  };

  return [questionsRound, rewritesRound];
}
