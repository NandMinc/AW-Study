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
export function readingRound(options) {
  const { people, run, timeoutMs } = options;
  const log = options.log ?? (() => {});

  async function readOnce(page, model, token, person) {
    let problem;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await run({
          prompt: readingPrompt(page.text),
          system: READING_SYSTEM,
          image: page.image,
          token,
          model,
          timeoutMs,
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

  return {
    name: 'read',
    async run({ pages, carry, person, cache }) {
      const who = people.find((p) => p.label === person);
      if (!who) throw new Error('Nobody to run this as.');
      const readings = [];
      for (const page of pages) {
        if (!page.image) continue;
        const cached = cache.get(`read:${page.fp}`);
        if (cached) {
          readings.push({ page: page.page, fp: page.fp, ...cached });
          continue;
        }
        let reading = await readOnce(page, READING_MODELS.first, who.token, person);
        let model = READING_MODELS.first;
        if (needsStrongerModel(reading)) {
          reading = await readOnce(page, READING_MODELS.stronger, who.token, person);
          model = READING_MODELS.stronger;
        }
        cache.set(`read:${page.fp}`, { reading, model });
        readings.push({ page: page.page, fp: page.fp, reading, model });
      }
      return { carry: { ...(carry ?? {}), readings } };
    },
  };
}
