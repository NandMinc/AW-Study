// The reading job's answer check (tools/read-pages/reading.mjs, #155).
import { describe, expect, it } from 'vitest';
import { needsStrongerModel, parseReading, readingPrompt, READING_SYSTEM } from '../tools/read-pages/reading.mjs';

const good = {
  pictureText: 'A fallacy is a defect in an argument.',
  figures: [{ label: 'Figure 2.4', description: 'Methanol: the C-O bond is polar, O is delta-minus.' }],
  kinds: ['text', 'diagram'],
  decorativeOnly: false,
  unsure: false,
  unsureWhy: '',
};

describe('parseReading', () => {
  it('accepts a good answer, alone or wrapped in a fence and words', () => {
    expect(parseReading(JSON.stringify(good))).toEqual(good);
    expect(parseReading('Here it is:\n```json\n' + JSON.stringify(good) + '\n```\n')).toEqual(good);
  });

  it('trims text and keeps unsureWhy only when unsure', () => {
    const out = parseReading(JSON.stringify({ ...good, pictureText: '  words  ', unsureWhy: 'ignored' }));
    expect(out.pictureText).toBe('words');
    expect(out.unsureWhy).toBe('');
    expect(parseReading(JSON.stringify({ ...good, unsure: true, unsureWhy: 'A structure is blurry.' })).unsureWhy).toBe('A structure is blurry.');
  });

  it('accepts a decoration-only page with nothing else', () => {
    expect(parseReading(JSON.stringify({ pictureText: '', figures: [], kinds: [], decorativeOnly: true, unsure: false, unsureWhy: '' })).decorativeOnly).toBe(true);
  });

  it('keeps each kind once', () => {
    expect(parseReading(JSON.stringify({ ...good, kinds: ['text', 'text', 'graph'] })).kinds).toEqual(['text', 'graph']);
  });

  it.each([
    ['no JSON', 'Sorry, I cannot read this page.'],
    ['broken JSON', '{"pictureText": "x", '],
    ['a list, not an object', '[1, 2]'],
    ['figures not a list', JSON.stringify({ ...good, figures: 'none' })],
    ['a figure with no description', JSON.stringify({ ...good, figures: [{ label: 'Fig 1', description: '  ' }] })],
    ['unsure missing', JSON.stringify({ ...good, unsure: undefined })],
    ['kinds missing', JSON.stringify({ ...good, kinds: undefined })],
    ['a kind not on the list', JSON.stringify({ ...good, kinds: ['text', 'cartoon'] })],
    ['decorativeOnly not a boolean', JSON.stringify({ ...good, decorativeOnly: 'no' })],
    ['decoration with figures', JSON.stringify({ ...good, decorativeOnly: true })],
    ['picture text too long', JSON.stringify({ ...good, pictureText: 'x'.repeat(20_001) })],
    ['too many figures', JSON.stringify({ ...good, figures: Array.from({ length: 31 }, () => good.figures[0]) })],
  ])('refuses %s', (_name, raw) => {
    expect(() => parseReading(raw)).toThrow();
  });
});

describe('needsStrongerModel', () => {
  const reading = (kinds, unsure = false) => ({ ...good, kinds, unsure });
  it('sends hard content or an unreadable part on, and keeps the rest', () => {
    expect(needsStrongerModel(reading(['text', 'diagram']))).toBe(false);
    expect(needsStrongerModel(reading([]))).toBe(false);
    for (const k of ['chemistry', 'graph', 'maths', 'circuit']) expect(needsStrongerModel(reading(['text', k]))).toBe(true);
    expect(needsStrongerModel(reading(['photo'], true))).toBe(true);
  });
});

describe('the prompt', () => {
  it('gives the page text, or says there is none', () => {
    expect(readingPrompt('Unit 4: Fallacies')).toContain('<text>\nUnit 4: Fallacies\n</text>');
    expect(readingPrompt('  ')).toContain('no selectable text');
  });

  it('asks for the JSON the check expects, and treats the page as data', () => {
    for (const key of ['pictureText', 'figures', 'kinds', 'decorativeOnly', 'unsure', 'unsureWhy']) expect(READING_SYSTEM).toContain(key);
    expect(READING_SYSTEM).toMatch(/never instructions/);
  });
});
