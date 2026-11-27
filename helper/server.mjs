// The AI helper's entry point (helper/Dockerfile runs it). Settings come from the environment:
//
//   ACCESS_TEAM_DOMAIN  https://<team>.cloudflareaccess.com (Zero Trust → Settings → Custom pages)
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
//   PERSON_1_EMAIL      matt@…  (the email they sign in to Access with)
//   PERSON_1_TOKEN      the token from that person's own `claude setup-token`
//   PERSON_2_EMAIL, PERSON_2_TOKEN, …
//   APP_ORIGIN          https://honed.pacificfish.ca (default)
//   HELPER_MODEL        claude-opus-5-5 (default)
//   HELPER_DAILY_LIMIT  requests per person per day, 200 (default)
//   HELPER_TIMEOUT_MS   per Claude Code run, 120000 (default)
//   PORT                3001 (default)
//   Background work (#166, #168; docs/DESIGN.md "From upload to quiz"):
//   HELPER_BACKGROUND   on (default) or off: off answers /ai/work with 501
//   HELPER_BATCH_DELAY_MS   how long a simulated batch takes to come round, 1800000 (30 minutes, default)
//   HELPER_BATCH_MARGIN_MS  how long before "needed by" work must be done, 7200000 (2 hours, default)
//   HELPER_DAILY_PAGES      pages of background work per person per day, 300 (default)
import { createServer } from 'node:http';
import { accessChecker } from './access.mjs';
import { createHelper, peopleFromEnv } from './app.mjs';
import { runClaude } from './claude.mjs';
import { createQueue } from './queue.mjs';
import { questionRounds, readingRound } from './rounds.mjs';

const env = process.env;
const people = peopleFromEnv(env);
if (people.length === 0) throw new Error('No people configured: set PERSON_1_EMAIL and PERSON_1_TOKEN.');
const timeoutMs = Number(env.HELPER_TIMEOUT_MS ?? 120_000);
const log = (line) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));

// Background work: in memory only, so a restart drops what's waiting and devices send it again
const queue =
  (env.HELPER_BACKGROUND ?? 'on') === 'off'
    ? null
    : createQueue({
        rounds: [readingRound({ people, run: runClaude, timeoutMs, log }), ...questionRounds({ people, run: runClaude, timeoutMs, log })],
        delayMs: Number(env.HELPER_BATCH_DELAY_MS ?? 1_800_000),
        marginMs: Number(env.HELPER_BATCH_MARGIN_MS ?? 7_200_000),
        dailyPages: Number(env.HELPER_DAILY_PAGES ?? 300),
        log,
      });
if (queue) setInterval(() => void queue.tick().catch((err) => log({ work: 'tick failed', error: err?.name ?? 'unknown' })), 30_000).unref();

const handle = createHelper({
  queue,
  checkAccess: accessChecker({ teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD }),
  people,
  appOrigin: env.APP_ORIGIN ?? 'https://honed.pacificfish.ca',
  model: env.HELPER_MODEL ?? 'claude-opus-5-5',
  dailyLimit: Number(env.HELPER_DAILY_LIMIT ?? 200),
  timeoutMs,
});

const port = Number(env.PORT ?? 3001);
createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end();
  });
}).listen(port, () => console.log(JSON.stringify({ at: new Date().toISOString(), started: true, port, people: people.length })));
