// A quiz still being written (#177): which sections, and what the student is told.
import { describe, expect, it } from 'vitest';
import type { WorkState } from '../db/work';
import { ALMOST_READY_MS, questionsBeingWritten, writingMessage } from './pending';

function store(sent: WorkState['sent'], banks: Record<string, number> = {}) {
  return {
    getWorkState: async (): Promise<WorkState> => ({ sent, problem: null, lastRound: null }),
    listQuestions: async (sectionId: string) => Array.from({ length: banks[sectionId] ?? 0 }) as never[],
  };
}
const job = (sectionId: string, extra: Partial<WorkState['sent'][string]> = {}) => ({ sectionId, deckId: 'd', pages: [1], sentAt: '2026-11-27T10:00:00Z', neededBy: '2026-11-28T12:00:00Z', ...extra });

describe('questionsBeingWritten', () => {
  it('is the sections sent and not given up on whose bank is still empty', async () => {
    const writing = await questionsBeingWritten(
      store({ a: job('s1'), b: job('s2'), c: job('s3', { failedAt: '2026-11-27T11:00:00Z' }), d: job('s4', { neededBy: undefined }) }, { s2: 12 }),
    );
    expect([...writing.keys()].sort()).toEqual(['s1', 's4']);
    expect(writing.get('s1')).toEqual({ neededBy: '2026-11-28T12:00:00Z' });
    expect(writing.get('s4')).toEqual({ neededBy: null });
  });

  it('can be asked about some sections only', async () => {
    const writing = await questionsBeingWritten(store({ a: job('s1'), b: job('s2') }), ['s2']);
    expect([...writing.keys()]).toEqual(['s2']);
  });
});

describe('writingMessage', () => {
  const now = new Date('2026-11-27T10:00:00Z');
  it('says when the next study session is', () => {
    const m = writingMessage({ neededBy: '2026-11-28T12:00:00Z' }, 'slides 51–58', now);
    expect(m.title).toBe('Your quiz is still being written');
    expect(m.body).toMatch(/^Questions for slides 51–58 will be ready for your next study session \(\w+day,? \d{1,2}:\d{2}\s?[AP]M\)\.$/);
  });
  it('says within a day without a study session, and almost ready once the deadline is near', () => {
    expect(writingMessage({ neededBy: null }, 'slides 2–4', now).body).toBe('Questions for slides 2–4 will be ready within a day.');
    const soon = new Date(now.getTime() + ALMOST_READY_MS - 60_000).toISOString();
    expect(writingMessage({ neededBy: soon }, 'slides 2–4', now).body).toBe('Almost ready: your questions are being written now.');
  });
});
