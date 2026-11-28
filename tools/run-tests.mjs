#!/usr/bin/env node
// `npm test` (#192): the unit tests and the browser tests (build, then Playwright) side by side instead of one after
// the other; they share nothing (the unit tests use their own random ports and never read dist/). The browser tests'
// output streams as usual; the unit tests' is held and printed in one piece when they finish, so the two don't
// interleave. Fails if either fails. CI runs them as separate jobs and doesn't use this.
//
// While working, pass Playwright's own arguments to run less (the quick loop): `npm test -- --project=desktop`,
// `npm test -- tests/browsers/play.spec.ts`, or both. The full run, every device, before a PR.
import { spawn } from 'node:child_process';

const quote = (arg) => (/^[\w./:=@-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`);
const extra = process.argv.slice(2).map(quote).join(' ');

const run = (command, { quiet }) =>
  new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (quiet) {
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
    }
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });

const unit = run('npx vitest run', { quiet: true }).then((result) => {
  process.stdout.write(`\n--- Unit tests (vitest) ---\n${result.output}\n`);
  return result;
});
const browsers = run(extra ? `npm run test:browsers -- ${extra}` : 'npm run test:browsers', { quiet: false });
const [u, b] = await Promise.all([unit, browsers]);
if (u.code !== 0) console.error(`Unit tests failed (exit ${u.code}).`);
if (b.code !== 0) console.error(`Browser tests failed (exit ${b.code}).`);
process.exit(u.code || b.code);
