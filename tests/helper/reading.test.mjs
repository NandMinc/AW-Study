// The reading round (#168, helper/rounds.mjs) through the real runClaude with a fake `claude`
// (tests/helper/fake-claude.mjs): what it sends, which model reads which page, retries, the cache.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClaude } from '../../helper/claude.mjs';
import { READING_SYSTEM } from '../../helper/reading.mjs';
import { READING_MODELS, readingRound } from '../../helper/rounds.mjs';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const fp = (n) => n.toString(16).padStart(64, '0');

const reading = (kinds, extra = {}) =>
  JSON.stringify({ pictureText: 'A fallacy is a defect in an argument.', figures: [], kinds, decorativeOnly: false, unsure: false, unsureWhy: '', ...extra });

let dir;
let logs;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'honed-read-'));
  logs = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function round(replies) {
  writeFileSync(join(dir, 'replies.json'), JSON.stringify(replies));
  return readingRound({
    people: [{ label: 'person2', token: 'tok-nathan' }],
    run: runClaude,
    timeoutMs: 10_000,
    command: [process.execPath, FAKE],
    extraEnv: { FAKE_DIR: dir },
    log: (l) => logs.push(l),
  });
}
const calls = () => (existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const modelOf = (call) => call.argv[call.argv.indexOf('--model') + 1];
const page = (n, image = PNG, text = `text of page ${n}`) => ({ page: n, fp: fp(n), text, image });

describe('the reading round', () => {
  it('reads each picture page with Haiku, sending the picture and its text with every tool off', async () => {
    const r = round([{ result: reading(['text']) }]);
    const cache = new Map();
    const out = await r.run({ pages: [page(51), page(52, null)], person: 'person2', cache });
    expect((out.carry ?? out.output).readings).toEqual([{ page: 51, fp: fp(51), model: READING_MODELS.first, reading: JSON.parse(reading(['text'])) }]);
    const [call] = calls(); // page 52 had no picture: nothing to read
    expect(calls()).toHaveLength(1);
    expect(modelOf(call)).toBe('claude-haiku-5-5');
    for (const flag of ['--input-format', 'stream-json', '--tools', '--disallowedTools', '--strict-mcp-config', '--no-session-persistence']) expect(call.argv).toContain(flag);
    expect(call.argv[call.argv.indexOf('--system-prompt') + 1]).toBe(READING_SYSTEM);
    expect(call.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok-nathan');
    const message = JSON.parse(call.stdin);
    expect(message.message.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(PNG).toString('base64') } });
    expect(message.message.content[1].text).toContain('text of page 51');
    // Token counts in the log, never content
    expect(logs).toEqual([{ work: 'read page', person: 'person2', model: 'claude-haiku-5-5', input: 2902, output: 400 }]);
    expect(JSON.stringify(logs)).not.toContain('fallacy');
  });

  it('has Sonnet read again a page with hard content, or a part Haiku couldn’t read', async () => {
    const sonnet = reading(['chemistry'], { figures: [{ label: 'Figure 2.4', description: 'Methanol and methyllithium.' }] });
    const r = round([{ result: reading(['chemistry']) }, { result: sonnet }, { result: reading(['photo'], { unsure: true, unsureWhy: 'blurry' }) }, { result: reading(['photo']) }]);
    const out = await r.run({ pages: [page(1), page(2)], person: 'person2', cache: new Map() });
    expect(calls().map(modelOf)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect((out.carry ?? out.output).readings.map((x) => x.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5']);
    expect((out.carry ?? out.output).readings[0].reading.figures[0].label).toBe('Figure 2.4'); // Sonnet's, not Haiku's
  });

  it('asks once more for an unusable answer, and fails the round after two', async () => {
    const r = round([{ result: 'Sorry, I can’t.' }, { result: reading(['text']) }]);
    const out = await r.run({ pages: [page(1)], person: 'person2', cache: new Map() });
    expect((out.carry ?? out.output).readings).toHaveLength(1);
    expect(calls()).toHaveLength(2);

    rmSync(join(dir, 'calls.jsonl'));
    const bad = round([{ error: true }, { result: '{"pictureText": 1}' }]);
    await expect(bad.run({ pages: [page(1)], person: 'person2', cache: new Map() })).rejects.toThrow(/couldn't be read/);
  });

  it('skips pages already read for this person, and keeps what earlier rounds found', async () => {
    const r = round([{ result: reading(['text']) }]);
    const cache = new Map();
    await r.run({ pages: [page(1)], person: 'person2', cache });
    const out = await r.run({ pages: [page(1), page(2)], carry: { earlier: true }, person: 'person2', cache });
    expect(calls()).toHaveLength(2); // page 1 the first time, page 2 the second
    expect((out.carry ?? out.output).earlier).toBe(true);
    expect((out.carry ?? out.output).readings.map((x) => x.page)).toEqual([1, 2]);
  });

  it('finishes a reading-only job; with a question plan, passes on and says when it read nothing (quick)', async () => {
    const r = round([{ result: reading(['text']) }]);
    const plan = { questions: { requests: [], guide: null, avoid: [] } };
    const cache = new Map();
    expect(await r.run({ pages: [page(1)], person: 'person2', cache })).toMatchObject({ done: true });
    expect(await r.run({ pages: [page(1)], plan, person: 'person2', cache })).toMatchObject({ quick: true, carry: { readings: [{ page: 1 }] } });
    expect(await r.run({ pages: [page(2)], plan, person: 'person2', cache })).toMatchObject({ quick: false });
    expect(await r.run({ pages: [page(3, null)], plan, person: 'person2', cache })).toMatchObject({ quick: true, carry: { readings: [] } });
  });

  it('refuses to run for someone it has no token for', async () => {
    await expect(round([]).run({ pages: [page(1)], person: 'person9', cache: new Map() })).rejects.toThrow(/Nobody/);
  });
});
