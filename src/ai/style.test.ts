// What the style job is sent (#121): the notes, the materials strongest first, every lecture a share, in limits.
import { describe, expect, it } from 'vitest';
import type { StyleGuide } from '../types/style';
import { hasStyleText, STYLE_LIMITS, styleRequest, type StyleSources } from './style';

const base: StyleSources = { className: ' CHEM 101 ', notes: '  No proofs.  ', materials: [], lectures: [], previous: null };
const x = (n: number) => 'x'.repeat(n);
const total = (r: ReturnType<typeof styleRequest>) => r.notes.length + r.materials.reduce((n, m) => n + m.text.length, 0) + r.lectures.reduce((n, l) => n + l.text.length, 0);

describe('styleRequest', () => {
  it('trims the name and notes, joins each document’s pages, and leaves out empty ones', () => {
    const r = styleRequest({
      ...base,
      materials: [
        { kind: 'outline', title: 'Syllabus', pageTexts: [' Week 1 ', '', 'Week 2'] },
        { kind: 'other', title: 'Scan', pageTexts: ['  ', ''] },
      ],
      lectures: [{ date: '2026-11-16', pageTexts: ['Bonds', 'Ions'] }],
    });
    expect(r).toEqual({
      className: 'CHEM 101',
      notes: 'No proofs.',
      materials: [{ kind: 'outline', title: 'Syllabus', text: 'Week 1\n\nWeek 2' }],
      lectures: [{ date: '2026-11-16', text: 'Bonds\n\nIons' }],
      previous: null,
    });
  });

  it('past exams first, then outlines, then practice sets and the rest; the materials get at most 60% of the room', () => {
    const r = styleRequest({
      ...base,
      notes: '',
      materials: [
        { kind: 'other', title: 'Other', pageTexts: [x(10)] },
        { kind: 'outline', title: 'Outline', pageTexts: [x(10)] },
        { kind: 'past-exam', title: 'Midterm', pageTexts: [x(100_000)] },
        { kind: 'practice', title: 'Set 1', pageTexts: [x(10)] },
      ],
      lectures: [{ date: '2026-11-16', pageTexts: [x(100_000)] }],
    });
    expect(r.materials.map((m) => [m.title, m.text.length])).toEqual([['Midterm', 72_000]]); // 60% of 120,000, all taken by the exam
    expect(r.lectures[0]!.text.length).toBe(48_000);
    expect(total(r)).toBe(STYLE_LIMITS.totalText);
  });

  it('the latest 60 lectures, in date order; a short one keeps all its text and the rest share what’s left', () => {
    const lectures = Array.from({ length: 62 }, (_, i) => ({ date: `2026-${String(9 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, pageTexts: [i === 61 ? 'short' : x(10_000)] }));
    const r = styleRequest({ ...base, notes: '', lectures: [...lectures].reverse() });
    expect(r.lectures).toHaveLength(60);
    expect(r.lectures[0]!.date).toBe(lectures[2]!.date);
    expect(r.lectures.map((l) => l.date)).toEqual([...r.lectures.map((l) => l.date)].sort());
    expect(r.lectures.at(-1)!.text).toBe('short');
    expect(r.lectures[0]!.text.length).toBe(Math.floor((STYLE_LIMITS.totalText - 5) / 59));
    expect(total(r)).toBeLessThanOrEqual(STYLE_LIMITS.totalText);
  });

  it('at most 20 materials, and those left out use none of the room', () => {
    const materials = Array.from({ length: 22 }, (_, i) => ({ kind: (i < 2 ? 'other' : 'past-exam') as 'other' | 'past-exam', title: `M${i}`, pageTexts: [x(100)] }));
    const r = styleRequest({ ...base, materials });
    expect(r.materials).toHaveLength(20);
    expect(r.materials.every((m) => m.kind === 'past-exam' && m.text.length === 100)).toBe(true); // the two "other" ones were last
  });

  it('a previous guide goes with whether the student edited it', () => {
    const guide: StyleGuide = { tests: 'T', levels: ['a', 'b', 'c'], shortShare: 0.2, madeAt: '2026-11-20T00:00:00.000Z', from: { lectureIds: [], materialIds: [], notesAt: null }, editedAt: null };
    expect(styleRequest({ ...base, previous: guide }).previous).toEqual({ tests: 'T', levels: ['a', 'b', 'c'], shortShare: 0.2, edited: false });
    expect(styleRequest({ ...base, previous: { ...guide, editedAt: '2026-11-21T00:00:00.000Z' } }).previous!.edited).toBe(true);
  });

  it('knows when there’s nothing to write a guide from', () => {
    expect(hasStyleText(styleRequest({ ...base, notes: ' ', lectures: [{ date: '2026-11-16', pageTexts: ['  '] }] }))).toBe(false);
    expect(hasStyleText(styleRequest(base))).toBe(true); // the notes are enough
    expect(hasStyleText(styleRequest({ ...base, notes: '', lectures: [{ date: '2026-11-16', pageTexts: ['Bonds'] }] }))).toBe(true);
  });
});
