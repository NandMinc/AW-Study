#!/usr/bin/env node
// Claiming an agent-task issue (#133, CLAUDE.md "Taking a task"): the only way to claim, so two Claudes never take
// the same task. It reads the issue's comments and assignees first and refuses if the other Claude holds it; if it's
// free, it assigns the issue to this GitHub account and posts the claim; then it reads again a few seconds later and
// backs off if both claimed at once (the earlier claim wins).
//
//   node tools/claim-task.mjs <issue> ["what you'll do"]     claim
//   node tools/claim-task.mjs --release <issue> ["why"]      let it go (unassigns, says so)
//   node tools/claim-task.mjs --check <issue>                who holds it, changing nothing
//
// Who you are comes from the GitHub login `gh` is signed in as (SIGNERS). Needs `gh`, signed in.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** GitHub login → how that person's Claude signs (CLAUDE.md "Talking to the other Claude"). */
export const SIGNERS = { NathanMcCoy: "Nathan's Claude", EassunKim: "Matt's Claude" };

const CLAIM = /^\[(Nathan's|Matt's) Claude\] taking this/i;
const RELEASE = /^\[(Nathan's|Matt's) Claude\] (releasing this|not taking this|backing off)/i;

/**
 * Who holds an issue from its comments (oldest first; each `{ body, createdAt }`): the earliest claim that hasn't
 * been released. A claim counts from its own time, so of two claims made close together the earlier wins.
 * Returns { holder: "Nathan's Claude" | "Matt's Claude" | null, claims: [{ signer, at }] (active, earliest first) }.
 */
export function currentHolder(comments) {
  const active = new Map(); // signer → the time of their claim still standing
  for (const c of [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const body = (c.body ?? '').trim();
    if (CLAIM.test(body)) {
      const signer = `${body.match(CLAIM)[1]} Claude`;
      if (!active.has(signer)) active.set(signer, c.createdAt);
    } else if (RELEASE.test(body)) {
      active.delete(`${body.match(RELEASE)[1]} Claude`);
    }
  }
  const claims = [...active].map(([signer, at]) => ({ signer, at })).sort((a, b) => a.at.localeCompare(b.at));
  return { holder: claims[0]?.signer ?? null, claims };
}

/**
 * What to do about a claim by `me`, given the issue: 'claim', 'mine' (already), or 'refuse' with a reason. Assignees
 * count too: an issue assigned to someone else's login is held, even with no comment.
 */
export function decide(issue, me, myLogin) {
  if (issue.state !== 'OPEN') return { action: 'refuse', reason: `#${issue.number} is ${issue.state.toLowerCase()}.` };
  if (!issue.labels.some((l) => l.name === 'agent-task')) {
    return { action: 'refuse', reason: `#${issue.number} isn't an agent-task issue: make one first (CLAUDE.md "Taking a task").` };
  }
  const { holder } = currentHolder(issue.comments);
  if (holder && holder !== me) return { action: 'refuse', reason: `${holder} holds #${issue.number}. Pick another task, or ask on the issue.` };
  const others = issue.assignees.map((a) => a.login).filter((login) => login !== myLogin);
  if (!holder && others.length > 0) {
    return { action: 'refuse', reason: `#${issue.number} is assigned to ${others.join(', ')}. Ask on the issue before taking it.` };
  }
  return holder === me ? { action: 'mine' } : { action: 'claim' };
}

// --- Talking to GitHub (not unit-tested: the logic above is) ---

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const readIssue = (n) => JSON.parse(gh('issue', 'view', String(n), '--json', 'number,state,labels,assignees,comments'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main(argv) {
  const mode = argv[0] === '--release' ? 'release' : argv[0] === '--check' ? 'check' : 'claim';
  const rest = mode === 'claim' ? argv : argv.slice(1);
  const n = Number(rest[0]);
  const note = rest.slice(1).join(' ').trim();
  if (!Number.isInteger(n) || n < 1) {
    console.error('Usage: node tools/claim-task.mjs [--release | --check] <issue number> ["note"]');
    return 2;
  }
  const login = gh('api', 'user', '-q', '.login').trim();
  const me = SIGNERS[login];
  if (!me) {
    console.error(`gh is signed in as ${login}, who isn't in SIGNERS (tools/claim-task.mjs).`);
    return 2;
  }

  const issue = readIssue(n);
  if (mode === 'check') {
    const { holder } = currentHolder(issue.comments);
    console.log(`#${n} (${issue.state.toLowerCase()}): ${holder ? `held by ${holder}` : 'free'}; assigned: ${issue.assignees.map((a) => a.login).join(', ') || 'nobody'}`);
    return 0;
  }
  if (mode === 'release') {
    if (currentHolder(issue.comments).holder !== me) {
      console.error(`#${n} isn't held by ${me}: nothing to release.`);
      return 1;
    }
    gh('issue', 'comment', String(n), '--body', `[${me}] releasing this${note ? `: ${note}` : ''}`);
    gh('issue', 'edit', String(n), '--remove-assignee', '@me');
    console.log(`Released #${n}.`);
    return 0;
  }

  const first = decide(issue, me, login);
  if (first.action === 'refuse') {
    console.error(`Not claimed: ${first.reason}`);
    return 1;
  }
  if (first.action === 'mine') {
    console.log(`#${n} is already yours (${me}).`);
    return 0;
  }
  gh('issue', 'comment', String(n), '--body', `[${me}] taking this${note ? `: ${note}` : ''}`);
  gh('issue', 'edit', String(n), '--add-assignee', '@me');
  // Both may have claimed at nearly the same moment: look again, and back off if the other's claim came first
  await sleep(5_000);
  const { holder } = currentHolder(readIssue(n).comments);
  if (holder !== me) {
    gh('issue', 'comment', String(n), '--body', `[${me}] backing off: ${holder} claimed this first.`);
    gh('issue', 'edit', String(n), '--remove-assignee', '@me');
    console.error(`Not claimed: ${holder} claimed #${n} at the same time, first. Backed off.`);
    return 1;
  }
  console.log(`Claimed #${n} as ${me}. Next: branch and open a draft PR with "Closes #${n}".`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.stderr?.toString() || err.message);
      process.exit(1);
    },
  );
}
