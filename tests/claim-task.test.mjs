// Claiming tasks (#133): who holds an issue from its comments, and whether a claim may go ahead.
import { describe, expect, it } from 'vitest';
import { currentHolder, decide } from '../tools/claim-task.mjs';

const at = (minute) => `2026-11-23T05:${String(minute).padStart(2, '0')}:00Z`;
const say = (minute, body) => ({ body, createdAt: at(minute) });
const issue = (comments, extra = {}) => ({ number: 7, state: 'OPEN', labels: [{ name: 'agent-task' }], assignees: [], comments, ...extra });

describe('currentHolder', () => {
  it('nobody holds an issue with no claim', () => {
    expect(currentHolder([say(1, '[Matt\'s Claude] The helper side is merged.')])).toEqual({ holder: null, claims: [] });
  });

  it('#122 on Nov 22: Matt’s Claude claimed at 05:17, Nathan’s at 05:20 — Matt’s holds it', () => {
    const comments = [
      say(14, "[Matt's Claude] The helper side this needs is merged (#121, PR #127)."),
      say(17, "[Matt's Claude] taking this: the class page's Exam style"),
      say(20, "[Nathan's Claude] taking this: the class page's Exam style"),
    ];
    expect(currentHolder(comments).holder).toBe("Matt's Claude");
  });

  it('the earlier claim wins whatever order the comments come in', () => {
    expect(currentHolder([say(9, "[Nathan's Claude] taking this"), say(8, "[Matt's Claude] taking this")]).holder).toBe("Matt's Claude");
  });

  it('a release lets the task go, and the next claim holds it', () => {
    const comments = [say(1, "[Matt's Claude] taking this"), say(2, "[Matt's Claude] releasing this: busy with #87"), say(3, "[Nathan's Claude] taking this")];
    expect(currentHolder(comments).holder).toBe("Nathan's Claude");
    expect(currentHolder(comments.slice(0, 2)).holder).toBeNull();
  });

  it('backing off after a simultaneous claim counts as a release', () => {
    const comments = [say(1, "[Nathan's Claude] taking this"), say(1, "[Matt's Claude] taking this"), say(2, "[Matt's Claude] backing off: Nathan's Claude claimed this first.")];
    expect(currentHolder(comments)).toEqual({ holder: "Nathan's Claude", claims: [{ signer: "Nathan's Claude", at: at(1) }] });
  });

  it('only a comment that starts with the claim counts (quoting one doesn’t)', () => {
    expect(currentHolder([say(1, 'As Matt said, "[Nathan\'s Claude] taking this" was a mistake.')]).holder).toBeNull();
  });
});

describe('decide', () => {
  const NATHAN = ["Nathan's Claude", 'NathanMcCoy'];

  it('claims a free agent-task issue', () => {
    expect(decide(issue([]), ...NATHAN)).toEqual({ action: 'claim' });
  });

  it('refuses one the other Claude holds, naming who', () => {
    const d = decide(issue([say(1, "[Matt's Claude] taking this")]), ...NATHAN);
    expect(d.action).toBe('refuse');
    expect(d.reason).toContain("Matt's Claude holds #7");
  });

  it('says so when it’s already yours', () => {
    expect(decide(issue([say(1, "[Nathan's Claude] taking this")], { assignees: [{ login: 'NathanMcCoy' }] }), ...NATHAN)).toEqual({ action: 'mine' });
  });

  it('refuses one assigned to someone else even with no claim comment', () => {
    const d = decide(issue([], { assignees: [{ login: 'EassunKim' }] }), ...NATHAN);
    expect(d.action).toBe('refuse');
    expect(d.reason).toContain('assigned to EassunKim');
  });

  it('refuses a closed issue, and one that isn’t an agent-task', () => {
    expect(decide(issue([], { state: 'CLOSED' }), ...NATHAN).action).toBe('refuse');
    expect(decide(issue([], { labels: [{ name: 'bug' }] }), ...NATHAN).reason).toContain("isn't an agent-task");
  });
});
