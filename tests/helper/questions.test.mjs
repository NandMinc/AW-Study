// The questions and rewrites rounds (#172, helper/rounds.mjs), through the real runClaude with a fake `claude`
// answering in order: which model writes what, the blind check, the rewrites, and the job's question plan.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClaude } from '../../helper/claude.mjs';
import { validateWork, WorkError } from '../../helper/queue.mjs';
import { checkBlindAnswers, pageForQuestions, questionRounds, READING_MODELS } from '../../helper/rounds.mjs';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
let dir;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'honed-q-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const mc = (n, level, answer = 0, page = 1) => ({
  form: 'choice',
  level,
  question: `What does mechanism ${n} do to the electron pair?`,
  options: [`It moves ${n}a`, `It moves ${n}b`, `It moves ${n}c`, `It moves ${n}d`],
  answer,
  page,
  explanation: 'Because of the arrow.',
});
const short = (n, page = 1) => ({ form: 'short', level: 3, question: `Explain why resonance ${n} stabilises the ion.`, points: ['delocalised charge'], page, explanation: 'Charge is spread.' });
const reply = (questions) => ({ result: JSON.stringify({ questions }) });
const answers = (list) => ({ result: JSON.stringify({ answers: list }) });

function rounds(replies) {
  writeFileSync(join(dir, 'replies.json'), JSON.stringify(replies));
  return questionRounds({ people: [{ label: 'p', token: 'tok' }], run: runClaude, timeoutMs: 10_000, command: [process.execPath, FAKE], extraEnv: { FAKE_DIR: dir } });
}
const calls = () => (existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const modelOf = (c) => c.argv[c.argv.indexOf('--model') + 1];

const pages = [
  { page: 1, text: 'Resonance forms of the acetate ion', image: null },
  { page: 2, text: 'Curved arrows show electron movement', image: null },
];
const plan = (mix, count, extra = {}) => ({ questions: { requests: [{ pages: [1, 2], count, mix }], guide: null, avoid: ['An old question?'], ...extra } });

describe('the questions round', () => {
  it('has Haiku write levels 1-2 and Sonnet level 3 and short answers; drops what fails the blind check', async () => {
    const [round] = rounds([
      reply([mc(1, 1, 0), mc(2, 2, 1), mc(3, 2, 3)]), // Haiku: level 1 and 2
      answers([0, 2, -1]), // Haiku, blind: agrees with 1; 2 answered differently; 3 can't be settled
      reply([mc(4, 3, 2), short(5)]), // Sonnet: level 3 and a short answer
    ]);
    const out = await round.run({ pages, carry: { readings: [] }, plan: plan({ choice: [1, 2, 1], short: 1 }, 5), person: 'p' });
    expect(calls().map(modelOf)).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5']);
    // The blind check got the questions without their answers
    const blind = calls()[1].stdin;
    expect(blind).toContain('mechanism 1');
    expect(blind).not.toMatch(/"answer"/);
    expect(out.done).toBeUndefined();
    expect(out.carry.questions.map((q) => [q.question.match(/\d/)[0], q.model])).toEqual([['1', 'claude-haiku-5-5'], ['4', 'claude-sonnet-5-5'], ['5', 'claude-sonnet-5-5']]);
    expect(out.carry.failed.map((f) => [f.level, f.page])).toEqual([[2, 1], [2, 1]]);
    // The earlier questions to avoid went to the writer
    expect(calls()[0].stdin).toContain('An old question?');
  });

  it('finishes the job when nothing fails the check', async () => {
    const [round] = rounds([reply([mc(1, 1, 0), mc(2, 2, 1)]), answers([0, 1])]);
    const out = await round.run({ pages, carry: { readings: [] }, plan: plan({ choice: [1, 1, 0], short: 0 }, 2), person: 'p' });
    expect(out.done).toBe(true);
    expect(out.output.questions).toHaveLength(2);
    expect(calls()).toHaveLength(2); // no Sonnet part: no level 3 or short answers asked for
  });

  it('has Sonnet write all of a group with a page Sonnet had to read, unchecked', async () => {
    const [round] = rounds([reply([mc(1, 1, 0), mc(2, 3, 1)])]);
    const readings = [{ page: 2, model: READING_MODELS.stronger, reading: { pictureText: '', figures: [{ label: 'Figure 2.4', description: 'Methanol: polar C-O bond.' }], kinds: ['chemistry'], decorativeOnly: false } }];
    const out = await round.run({ pages, carry: { readings }, plan: plan({ choice: [1, 0, 1], short: 0 }, 2), person: 'p' });
    expect(calls().map(modelOf)).toEqual(['claude-sonnet-5-5']);
    expect(out.done).toBe(true);
    // The page's reading went in with its text
    expect(calls()[0].stdin).toContain('Methanol: polar C-O bond.');
  });

  it('rewrites everything when the blind check can’t be done', async () => {
    const [round] = rounds([reply([mc(1, 1, 0), mc(2, 2, 1)]), { result: 'no idea' }, { result: '{"answers": [9, 9]}' }]);
    const out = await round.run({ pages, carry: { readings: [] }, plan: plan({ choice: [1, 1, 0], short: 0 }, 2), person: 'p' });
    expect(out.carry.questions).toEqual([]);
    expect(out.carry.failed).toHaveLength(2);
  });

  it('finishes a reading-only job (no plan) without asking anything', async () => {
    const [round] = rounds([]);
    expect(await round.run({ pages, carry: { readings: [{ page: 1 }] }, plan: null, person: 'p' })).toEqual({ done: true, output: { readings: [{ page: 1 }] } });
    expect(calls()).toEqual([]);
  });
});

describe('the rewrites round', () => {
  it('has Sonnet write as many again, at the same levels, avoiding the failed ones', async () => {
    const [, rewrites] = rounds([reply([mc(7, 2, 0), mc(8, 2, 1)])]);
    const carry = { readings: [], questions: [mc(1, 1, 0)], failed: [{ page: 1, level: 2, question: 'Failed one?', pages: [1, 2] }, { page: 2, level: 2, question: 'Failed two?', pages: [1, 2] }] };
    const out = await rewrites.run({ pages, carry, plan: plan({ choice: [1, 2, 0], short: 0 }, 3), person: 'p' });
    expect(calls().map(modelOf)).toEqual(['claude-sonnet-5-5']);
    expect(calls()[0].stdin).toContain('Failed one?');
    expect(calls()[0].stdin).toContain('2 multiple-choice at level 2');
    expect(out.carry.questions.map((q) => q.question.match(/\d/)[0])).toEqual(['1', '7', '8']);
    expect(out.carry.failed).toBeUndefined();
  });
});

describe('pieces', () => {
  it('adds what the pictures hold to a page’s text, not decoration', () => {
    const reading = { pictureText: 'A fallacy is a defect.', figures: [{ label: 'Table 2.1', description: 'Dipole moments.' }], decorativeOnly: false };
    expect(pageForQuestions(pages[0], reading).text).toBe("Resonance forms of the acetate ion\n[Text in the slide's pictures]\nA fallacy is a defect.\n[Table 2.1] Dipole moments.");
    expect(pageForQuestions(pages[0], { ...reading, decorativeOnly: true }).text).toBe(pages[0].text);
    expect(pageForQuestions(pages[0], undefined).text).toBe(pages[0].text);
  });

  it('checks blind answers', () => {
    expect(checkBlindAnswers('{"answers": [0, -1, 3]}', 3)).toEqual([0, -1, 3]);
    expect(() => checkBlindAnswers('{"answers": [0]}', 3)).toThrow();
    expect(() => checkBlindAnswers('{"answers": [0, 4, 1]}', 3)).toThrow();
  });
});

describe('a job’s question plan', () => {
  const base = () => ({
    id: 'j',
    accountId: 'acc',
    publicKey: 'B'.repeat(87),
    neededBy: null,
    pages: [{ page: 51, fp: 'a'.repeat(64), text: 'Resonance forms', image: null }, { page: 52, fp: 'b'.repeat(64), text: 'Curved arrows', image: null }],
  });
  it('is checked like a questions request', () => {
    const w = validateWork({ ...base(), questions: { requests: [{ pages: [51, 52], count: 4, mix: { choice: [1, 2, 1], short: 0 } }], avoid: ['Old?'] } });
    expect(w.plan.questions).toEqual({ requests: [{ pages: [51, 52], count: 4, mix: { choice: [1, 2, 1], short: 0 } }], guide: null, avoid: ['Old?'] });
    expect(validateWork(base()).plan).toBeNull();
  });
  it.each([
    ['a page not in the job', { requests: [{ pages: [53], count: 2 }] }],
    ['a mix that doesn’t add up', { requests: [{ pages: [51], count: 4, mix: { choice: [1, 1, 1], short: 0 } }] }],
    ['no requests', { requests: [] }],
    ['too many questions', { requests: [{ pages: [51], count: 500 }] }],
  ])('refuses %s', (_name, questions) => {
    expect(() => validateWork({ ...base(), questions })).toThrow(WorkError);
  });
});
