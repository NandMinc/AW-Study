// Running Claude Code for one job, locked down:
// - headless (`-p`), JSON output, one turn;
// - **no tools at all** (`--tools ""` and `--disallowedTools "*"`), no MCP servers, no skills or
//   slash commands: it can only read the prompt and answer in text;
// - our own fixed system prompt in place of Claude Code's;
// - no saved session, and a fresh, empty home folder for each run, deleted afterwards, so nothing
//   from one request (or person) survives into the next;
// - only the asking person's token in its environment, nothing else of ours;
// - the prompt goes in on stdin (never on the command line, where other processes could see it);
// - a time limit, after which it's killed.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class ClaudeError extends Error {
  /** @param {'timeout' | 'failed' | 'bad-output'} code */
  constructor(code, message) {
    super(message);
    this.name = 'ClaudeError';
    this.code = code;
  }
}

const MAX_OUTPUT = 2 * 1024 * 1024;

/**
 * The arguments every run gets. Tests check the tools-off ones are always there. `stream`: the prompt goes in
 * as a stream-json message, so it can carry a picture (a page to read, #168); the answer comes back as JSON lines.
 */
export function claudeArgs({ system, model, stream = false }) {
  return [
    '-p',
    ...(stream ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']),
    '--tools', '',
    '--disallowedTools', '*',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--max-turns', '1',
    '--model', model,
    '--system-prompt', system,
  ];
}

/**
 * Runs `claude` once and gives its answer text. `command` is the program and any leading
 * arguments (tests use a fake). `extraEnv` exists for tests only.
 */
export async function runClaude({ prompt, system, token, model, timeoutMs, command = ['claude'], extraEnv = {}, image, onUsage }) {
  // With a picture (a PNG page to read): one stream-json message holding the picture and the prompt
  const stream = image !== undefined;
  const input = stream
    ? `${JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(image).toString('base64') } },
            { type: 'text', text: prompt },
          ],
        },
      })}\n`
    : prompt;
  const home = await mkdtemp(join(tmpdir(), 'honed-ai-'));
  try {
    const env = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: home,
      USERPROFILE: home,
      TMPDIR: home,
      CLAUDE_CODE_OAUTH_TOKEN: token,
      CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
      ...extraEnv,
    };
    const [program, ...lead] = command;
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(program, [...lead, ...claudeArgs({ system, model, stream })], { cwd: home, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let size = 0;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_OUTPUT) child.kill('SIGKILL');
        else out += chunk;
      });
      child.stderr.resume(); // never logged: it could echo the prompt
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new ClaudeError('failed', `Couldn't start Claude Code (${err.code ?? err.message}).`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return reject(new ClaudeError('timeout', 'The AI took too long.'));
        if (size > MAX_OUTPUT) return reject(new ClaudeError('bad-output', 'The AI said too much.'));
        if (code !== 0) return reject(new ClaudeError('failed', `Claude Code stopped with code ${code}.`));
        resolve(out);
      });
      child.stdin.on('error', () => {}); // it may exit before reading everything
      child.stdin.end(input);
    });
    let result;
    try {
      // stream-json: one JSON object a line; the answer is the "result" one
      result = stream
        ? stdout.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).find((m) => m?.type === 'result')
        : JSON.parse(stdout);
    } catch {
      throw new ClaudeError('bad-output', 'Claude Code’s output wasn’t JSON.');
    }
    if (result?.is_error || result?.subtype !== 'success' || typeof result.result !== 'string') {
      throw new ClaudeError('failed', 'Claude Code reported an error.');
    }
    // Token counts for the logs (never content): DESIGN.md asks for real numbers from the start
    if (onUsage && result.usage) {
      const u = result.usage;
      onUsage({
        input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        output: u.output_tokens ?? 0,
      });
    }
    return result.result;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
