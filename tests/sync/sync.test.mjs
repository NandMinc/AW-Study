// The sync server (sync/, #95): Google sign-in, accounts and sessions, over real HTTP, with a fake
// Google made here (its token endpoint checks the client secret, the redirect address and PKCE, and
// signs ID tokens with a key made here). Nothing reaches Google.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSync, deviceName, MAX_FILE_BYTES, RECENT_SIGN_IN_MS, safePath, SESSION_COOKIE, SESSION_IDLE_MS, SESSION_MAX_MS, SIGN_IN_WAIT_MS, SIGNIN_COOKIE } from '../../sync/app.mjs';
import { openDb, SCHEMA_STEP } from '../../sync/db.mjs';
import { googleClient, SignInError } from '../../sync/google.mjs';

const ORIGIN = 'http://honed.test';
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const SECRET = 'GOCSPX-test-secret';
const REDIRECT = `${ORIGIN}/api/auth/callback`;
const ENDPOINTS = {
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
  authorize: 'https://google.test/auth',
  token: 'https://google.test/token',
  keys: 'https://google.test/certs',
};
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';

const googleKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

function idToken(claims, { key = googleKey.privateKey, kid = 'g1', alg = 'RS256' } = {}) {
  const head = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${signature}`;
}

/** A fake Google: remembers each approved sign-in by its code, and answers the token endpoint like Google. */
function fakeGoogle(clock) {
  const codes = new Map();
  const google = {
    keyFetches: 0,
    /** Plays the user approving the sign-in on Google's page: gives the code Google would send back. */
    approve(authorizeUrl, person, tweak = {}) {
      const url = new URL(authorizeUrl);
      const code = `code-${codes.size + 1}`;
      codes.set(code, { params: url.searchParams, person, tweak });
      return code;
    },
    async fetch(address, init = {}) {
      if (address === ENDPOINTS.keys) {
        google.keyFetches++;
        return Response.json({ keys: [{ ...googleKey.publicKey.export({ format: 'jwk' }), kid: 'g1', alg: 'RS256', use: 'sig' }] });
      }
      if (address === ENDPOINTS.token && init.method === 'POST') {
        const form = new URLSearchParams(init.body);
        const grant = codes.get(form.get('code'));
        codes.delete(form.get('code')); // a code works once
        const challenge = grant && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (
          !grant ||
          form.get('client_id') !== CLIENT_ID ||
          form.get('client_secret') !== SECRET ||
          form.get('redirect_uri') !== REDIRECT ||
          form.get('grant_type') !== 'authorization_code' ||
          grant.params.get('code_challenge_method') !== 'S256' ||
          challenge !== grant.params.get('code_challenge')
        ) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        const seconds = Math.floor(clock.getTime() / 1000);
        const claims = {
          iss: 'https://accounts.google.com',
          aud: CLIENT_ID,
          sub: grant.person.sub,
          email: grant.person.email,
          email_verified: true,
          nonce: grant.params.get('nonce'),
          iat: seconds,
          exp: seconds + 3600,
          ...grant.tweak.claims,
        };
        return Response.json({ id_token: idToken(claims, grant.tweak.sign), access_token: 'unused', token_type: 'Bearer' });
      }
      return new Response('not found', { status: 404 });
    },
  };
  return google;
}

const MATT = { sub: '1001', email: 'matt@example.com' };
const NATHAN = { sub: '1002', email: 'Nathan@Example.com' }; // Google may send capitals
const STRANGER = { sub: '9999', email: 'stranger@example.com' };

let dir;
let db;
let server;
let base;
let clock;
let google;
let logs;
let allowed;

async function start() {
  logs = [];
  const handle = createSync({
    db,
    google: googleClient({ clientId: CLIENT_ID, clientSecret: SECRET, redirectUri: REDIRECT, endpoints: ENDPOINTS, fetch: google.fetch, now: () => clock.getTime() }),
    allowedEmails: allowed,
    appOrigin: ORIGIN,
    filesDir: join(dir, 'files'),
    log: (line) => logs.push(line),
    now: () => new Date(clock),
  });
  server = createServer((req, res) => void handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'honed-sync-'));
  db = openDb(dir);
  clock = new Date('2026-11-20T18:00:00Z');
  google = fakeGoogle(clock);
  allowed = ['matt@example.com', 'nathan@example.com'];
  await start();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A browser: keeps cookies like one (by name), sends them back, never follows redirects by itself. */
function browser(agent = CHROME) {
  const jar = new Map();
  const b = {
    jar,
    setCookies: [],
    async go(path, init = {}) {
      const res = await fetch(base + path, {
        redirect: 'manual',
        ...init,
        headers: { 'User-Agent': agent, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(init.headers ?? {}) },
      });
      for (const line of res.headers.getSetCookie()) {
        b.setCookies.push(line);
        const [pair, ...attrs] = line.split(';');
        const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
        if (attrs.some((a) => a.trim().toLowerCase() === 'max-age=0')) jar.delete(name);
        else jar.set(name, value);
      }
      return res;
    },
    /** POST/DELETE as the app does: JSON, from our own site. */
    send(method, path, body = {}) {
      return b.go(path, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    },
    async me() {
      return (await b.go('/api/me')).json();
    },
  };
  return b;
}

/** The whole Google round trip; gives the callback's response. */
async function signIn(b, person, { then, tweak, fresh } = {}) {
  const query = new URLSearchParams({ ...(then !== undefined ? { then } : {}), ...(fresh ? { fresh: '1' } : {}) });
  const start = await b.go(`/api/auth/google?${query}`);
  expect(start.status).toBe(303);
  const authorize = start.headers.get('location');
  const state = new URL(authorize).searchParams.get('state');
  const code = google.approve(authorize, person, tweak);
  return b.go(`/api/auth/callback?${new URLSearchParams({ code, state })}`);
}

describe('signing in with Google', () => {
  it('sends the browser to Google with our client, openid email, state, nonce and PKCE', async () => {
    const b = browser();
    const res = await b.go('/api/auth/google?then=%2F%23%2Fsettings');
    expect(res.status).toBe(303);
    const url = new URL(res.headers.get('location'));
    expect(url.origin + url.pathname).toBe(ENDPOINTS.authorize);
    const p = url.searchParams;
    expect(Object.fromEntries(p)).toMatchObject({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: 'openid email', code_challenge_method: 'S256' });
    expect(p.get('state')).toMatch(/^[\w-]{43}$/);
    expect(p.get('nonce')).toMatch(/^[\w-]{43}$/);
    expect(p.get('nonce')).not.toBe(p.get('state'));
    expect(p.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(p.has('prompt')).toBe(false);
    // The state is also in a cookie for /api/auth/ only, so the sign-in can only finish in this browser
    expect(b.jar.get(SIGNIN_COOKIE)).toBe(p.get('state'));
    expect(b.setCookies[0]).toMatch(/Path=\/api\/auth\/; HttpOnly; SameSite=Lax; Max-Age=600/);
  });

  it('signs in: makes the account, sets the session cookie, goes back where it started', async () => {
    const b = browser();
    const res = await signIn(b, NATHAN, { then: '/#/settings' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/#/settings');
    const cookie = b.setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/; Path=\/api\/; HttpOnly; SameSite=Lax; Max-Age=15552000/);
    expect(b.jar.has(SIGNIN_COOKIE)).toBe(false); // cleared
    expect(await b.me()).toEqual({ signedIn: true, email: 'nathan@example.com', device: expect.any(String) });

    // Keyed by Google's sub; the session is stored as a hash, never the token
    const accounts = db.prepare('SELECT * FROM accounts').all();
    expect(accounts).toEqual([expect.objectContaining({ google_sub: '1002', email: 'nathan@example.com' })]);
    const token = b.jar.get(SESSION_COOKIE);
    expect(token).toMatch(/^[\w-]{43}$/);
    const sessions = db.prepare('SELECT * FROM sessions').all();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].hash).toBe(createHash('sha256').update(token).digest('base64url'));
    expect(JSON.stringify(sessions)).not.toContain(token);
    expect(sessions[0].device).toBe('Chrome on Windows');
  });

  it('a second sign-in finds the same account by Google id, even if the email changed', async () => {
    await new Promise((resolve) => server.close(resolve));
    allowed.push('nathan.new@example.com');
    await start();
    await signIn(browser(), NATHAN);
    await signIn(browser(IPHONE), { ...NATHAN, email: 'nathan.new@example.com' });
    expect(db.prepare('SELECT google_sub, email FROM accounts').all()).toEqual([{ google_sub: '1002', email: 'nathan.new@example.com' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(2);
  });

  it('refuses anyone not on the allow list, and makes no account', async () => {
    const b = browser();
    const res = await signIn(b, STRANGER);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('invite-only');
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n).toBe(0);
  });

  it('an empty allow list lets nobody in', async () => {
    await new Promise((resolve) => server.close(resolve));
    allowed = [];
    await start();
    expect((await signIn(browser(), NATHAN)).status).toBe(403);
  });

  it('a sign-in can only finish in the browser that started it, once, within 10 minutes', async () => {
    // Someone sends you their own callback link: your browser has no matching state cookie
    const attacker = browser();
    const start = await attacker.go('/api/auth/google');
    const authorize = start.headers.get('location');
    const code = google.approve(authorize, STRANGER);
    const victim = browser();
    const link = `/api/auth/callback?${new URLSearchParams({ code, state: new URL(authorize).searchParams.get('state') })}`;
    const res = await victim.go(link);
    expect(res.status).toBe(400);
    expect(victim.jar.has(SESSION_COOKIE)).toBe(false);
    // The same callback twice: the state is used up
    const b = browser();
    const first = await b.go('/api/auth/google');
    const state = new URL(first.headers.get('location')).searchParams.get('state');
    const code2 = google.approve(first.headers.get('location'), MATT);
    const cookie = b.jar.get(SIGNIN_COOKIE);
    expect((await b.go(`/api/auth/callback?${new URLSearchParams({ code: code2, state })}`)).status).toBe(303);
    b.jar.set(SIGNIN_COOKIE, cookie);
    expect((await b.go(`/api/auth/callback?${new URLSearchParams({ code: code2, state })}`)).status).toBe(400);
    // Too slow
    const c = browser();
    const slow = await c.go('/api/auth/google');
    const code3 = google.approve(slow.headers.get('location'), MATT);
    clock.setTime(clock.getTime() + SIGN_IN_WAIT_MS + 1000);
    const late = await c.go(`/api/auth/callback?${new URLSearchParams({ code: code3, state: new URL(slow.headers.get('location')).searchParams.get('state') })}`);
    expect(late.status).toBe(400);
    expect(c.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it('a cancelled sign-in says so', async () => {
    const b = browser();
    const start = await b.go('/api/auth/google');
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const res = await b.go(`/api/auth/callback?error=access_denied&state=${state}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('cancelled');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('refuses tokens that are forged, for another app, expired, for another sign-in, unverified or not from Google', async () => {
    const cases = [
      [{ sign: { key: otherKey.privateKey } }, 'signature'],
      [{ claims: { aud: 'someone-else.apps.googleusercontent.com' } }, 'another app'],
      [{ claims: { exp: Math.floor(clock.getTime() / 1000) - 3600 } }, 'expired'],
      [{ claims: { nonce: 'not-this-one' } }, 'this sign-in'],
      [{ claims: { email_verified: false } }, 'verified'],
      [{ claims: { iss: 'https://evil.example' } }, 'other than Google'],
      [{ sign: { kid: 'unknown' } }, 'unknown key'],
    ];
    for (const [tweak, words] of cases) {
      const b = browser();
      const res = await signIn(b, NATHAN, { tweak });
      expect(res.status, words).toBe(400);
      expect(await res.text(), words).toContain(words);
      expect(b.jar.has(SESSION_COOKIE), words).toBe(false);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n).toBe(0);
  });

  it('refuses an unsigned token (alg none) and garbage', async () => {
    const client = googleClient({ clientId: CLIENT_ID, clientSecret: SECRET, redirectUri: REDIRECT, endpoints: ENDPOINTS, fetch: google.fetch, now: () => clock.getTime() });
    const claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1', email: 'a@b.c', email_verified: true, nonce: 'n', exp: clock.getTime() / 1000 + 60 };
    const head = Buffer.from(JSON.stringify({ alg: 'none', kid: 'g1' })).toString('base64url');
    const none = `${head}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    await expect(client.verifyIdToken(none, 'n')).rejects.toThrow(SignInError);
    await expect(client.verifyIdToken('not.a.token', 'n')).rejects.toThrow(SignInError);
    await expect(client.verifyIdToken('nope', 'n')).rejects.toThrow(SignInError);
    // And accepts the real thing (so the cases above fail for their own reasons)
    await expect(client.verifyIdToken(idToken(claims), 'n')).resolves.toEqual({ sub: '1', email: 'a@b.c', authTime: null });
  });

  it('a code Google refuses (wrong PKCE verifier, used twice) is no sign-in', async () => {
    const client = googleClient({ clientId: CLIENT_ID, clientSecret: SECRET, redirectUri: REDIRECT, endpoints: ENDPOINTS, fetch: google.fetch });
    const url = client.signInUrl({ state: 's', nonce: 'n', verifier: 'right-verifier' });
    const code = google.approve(url, NATHAN);
    await expect(client.exchange(code, 'wrong-verifier')).rejects.toThrow(SignInError);
    const code2 = google.approve(url, NATHAN);
    await expect(client.exchange(code2, 'right-verifier')).resolves.toEqual(expect.any(String));
    await expect(client.exchange(code2, 'right-verifier')).rejects.toThrow(SignInError);
  });

  it('only ever goes back to a path on our own site', async () => {
    for (const evil of ['//evil.example/', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)', '/ok\nSet-Cookie: x=1', 'x'.repeat(400)]) {
      expect(safePath(evil), evil).toBe('/#/settings');
    }
    expect(safePath('/#/class/abc')).toBe('/#/class/abc');
    expect(safePath(null)).toBe('/#/settings');
    const res = await signIn(browser(), MATT, { then: '//evil.example/' });
    expect(res.headers.get('location')).toBe('/#/settings');
  });

  it('fresh=1 asks Google to choose the account again', async () => {
    const res = await browser().go('/api/auth/google?fresh=1');
    expect(new URL(res.headers.get('location')).searchParams.get('prompt')).toBe('select_account');
  });

  it('reloads Google’s keys at most once a minute for unknown key ids', async () => {
    await signIn(browser(), MATT);
    expect(google.keyFetches).toBe(1);
    await signIn(browser(), MATT, { tweak: { sign: { kid: 'new' } } });
    await signIn(browser(), MATT, { tweak: { sign: { kid: 'new' } } });
    expect(google.keyFetches).toBe(1);
    clock.setTime(clock.getTime() + 61_000);
    await signIn(browser(), MATT, { tweak: { sign: { kid: 'new' } } });
    expect(google.keyFetches).toBe(2);
  });
});

describe('sessions', () => {
  it('signs out, and the cookie is cleared', async () => {
    const b = browser();
    await signIn(b, MATT);
    const res = await b.send('POST', '/api/auth/signout');
    expect(res.status).toBe(200);
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(0);
    expect(await b.me()).toEqual({ signedIn: false });
  });

  it('ends after 30 days unused, and after 180 days however much it’s used', async () => {
    const idle = browser();
    await signIn(idle, MATT);
    const busy = browser();
    await signIn(busy, NATHAN);
    clock.setTime(clock.getTime() + SESSION_IDLE_MS - 3_600_000);
    expect((await idle.me()).signedIn).toBe(true); // used: counts again from now
    clock.setTime(clock.getTime() + SESSION_IDLE_MS + 1000);
    expect((await idle.me()).signedIn).toBe(false);
    // Used every 20 days until 180 days have passed since signing in
    const s = browser();
    clock.setTime(clock.getTime() + 1000);
    await signIn(s, NATHAN);
    const born = clock.getTime();
    while (clock.getTime() + 20 * 86_400_000 < born + SESSION_MAX_MS) {
      clock.setTime(clock.getTime() + 20 * 86_400_000);
      expect((await s.me()).signedIn).toBe(true);
    }
    clock.setTime(born + SESSION_MAX_MS + 1000);
    expect((await s.me()).signedIn).toBe(false);
  });

  it('someone taken off the allow list is signed out', async () => {
    const b = browser();
    await signIn(b, MATT);
    await new Promise((resolve) => server.close(resolve));
    allowed = ['nathan@example.com'];
    await start();
    expect(await b.me()).toEqual({ signedIn: false });
  });

  it('lists the account’s devices; signs one out, never another account’s; or all of them', async () => {
    const pc = browser();
    await signIn(pc, NATHAN);
    const phone = browser(IPHONE);
    await signIn(phone, NATHAN);
    const matt = browser();
    await signIn(matt, MATT);

    const { devices } = await (await pc.go('/api/devices')).json();
    expect(devices.map((d) => [d.device, d.current])).toEqual(
      expect.arrayContaining([
        ['Chrome on Windows', true],
        ['Safari on iPhone', false],
      ]),
    );
    expect(devices).toHaveLength(2);
    const phoneId = devices.find((d) => !d.current).id;

    // Matt can't sign out Nathan's phone
    expect((await matt.send('POST', '/api/devices/signout', { id: phoneId })).status).toBe(200);
    expect((await phone.me()).signedIn).toBe(true);
    // Nathan can
    expect((await pc.send('POST', '/api/devices/signout', { id: phoneId })).status).toBe(200);
    expect((await phone.me()).signedIn).toBe(false);
    expect((await pc.me()).signedIn).toBe(true);

    // All of them
    await signIn(phone, NATHAN);
    await pc.send('POST', '/api/devices/signout', { all: true });
    expect((await pc.me()).signedIn).toBe(false);
    expect((await phone.me()).signedIn).toBe(false);
    expect((await matt.me()).signedIn).toBe(true);
    expect(pc.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it('signing in again on a device replaces its session', async () => {
    const b = browser();
    await signIn(b, MATT);
    await signIn(b, MATT);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(1);
  });

  it('refuses changes from other sites, or not as JSON, and private reads when signed out', async () => {
    const b = browser();
    await signIn(b, MATT);
    const noOrigin = await b.go('/api/auth/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(noOrigin.status).toBe(403);
    const evil = await b.go('/api/devices/signout', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"all":true}' });
    expect(evil.status).toBe(403);
    const form = await b.go('/api/devices/signout', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: '{"all":true}' });
    expect(form.status).toBe(415);
    expect((await b.me()).signedIn).toBe(true); // none of them did anything
    const bad = await b.go('/api/devices/signout', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{nope' });
    expect(bad.status).toBe(400);
    expect((await browser().go('/api/devices')).status).toBe(401);
    expect((await browser().send('DELETE', '/api/account')).status).toBe(401);
  });

  it('never lets an answer be cached', async () => {
    const res = await browser().go('/api/me');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('deleting the account', () => {
  it('needs a Google sign-in in the last 5 minutes, then removes the account and every session', async () => {
    const pc = browser();
    await signIn(pc, NATHAN);
    const phone = browser(IPHONE);
    await signIn(phone, NATHAN);
    await signIn(browser(), MATT);

    clock.setTime(clock.getTime() + RECENT_SIGN_IN_MS + 1000);
    const stale = await pc.send('DELETE', '/api/account');
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ needsSignIn: true });

    await signIn(pc, NATHAN, { fresh: true });
    const res = await pc.send('DELETE', '/api/account');
    expect(res.status).toBe(200);
    expect(pc.jar.has(SESSION_COOKIE)).toBe(false);
    expect((await phone.me()).signedIn).toBe(false);
    expect(db.prepare('SELECT email FROM accounts').all()).toEqual([{ email: 'matt@example.com' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(1); // Matt's
  });
});

describe('logs and storage', () => {
  it('logs routes, statuses and times only: never emails, tokens or codes', async () => {
    const b = browser();
    await signIn(b, NATHAN);
    await b.me();
    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(2);
    for (const secret of ['nathan', 'code-1', b.jar.get(SESSION_COOKIE)]) expect(text).not.toContain(secret);
    expect(logs[0]).toEqual({ at: expect.any(String), route: 'GET /api/auth/google', status: 303, ms: expect.any(Number) });
  });

  it('numbers its schema steps and refuses a database from a newer version', () => {
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(SCHEMA_STEP);
    const newer = mkdtempSync(join(tmpdir(), 'honed-sync-newer-'));
    const d = new DatabaseSync(join(newer, 'sync.db'));
    d.exec(`PRAGMA user_version = ${SCHEMA_STEP + 1}`);
    d.close();
    expect(() => openDb(newer)).toThrow(/newer version/);
    rmSync(newer, { recursive: true, force: true });
  });

  it('answers its health check', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('device names', () => {
  it('tells common browsers apart', () => {
    expect(deviceName(CHROME)).toBe('Chrome on Windows');
    expect(deviceName(IPHONE)).toBe('Safari on iPhone');
    expect(deviceName('Mozilla/5.0 (Linux; Android 16; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15')).toBe('Safari on Mac');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('Edge on Windows');
    expect(deviceName('')).toBe('A browser');
  });
});

describe('Google unlock (#101)', () => {
  it('turning it on gives the account one key; any device of the account gets the same; others a different one', async () => {
    const pc = browser();
    await signIn(pc, NATHAN);
    const first = await (await pc.send('POST', '/api/unlock-key')).json();
    expect(first.key).toMatch(/^[\w-]{43}$/); // 32 bytes
    const phone = browser(IPHONE);
    await signIn(phone, NATHAN);
    expect((await (await phone.send('POST', '/api/unlock-key')).json()).key).toBe(first.key);
    const matt = browser();
    await signIn(matt, MATT);
    expect((await (await matt.send('POST', '/api/unlock-key')).json()).key).not.toBe(first.key);
  });

  it('gives the key only after a fresh Google sign-in, and records each time (never the key)', async () => {
    const b = browser(IPHONE);
    await signIn(b, NATHAN);
    const { key } = await (await b.send('POST', '/api/unlock-key')).json();

    const fresh = await b.go('/api/unlock-key');
    expect(fresh.status).toBe(200);
    expect((await fresh.json()).key).toBe(key);

    clock.setTime(clock.getTime() + RECENT_SIGN_IN_MS + 1000);
    const stale = await b.go('/api/unlock-key');
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ needsSignIn: true });

    await signIn(b, NATHAN, { fresh: true });
    expect((await (await b.go('/api/unlock-key')).json()).key).toBe(key);

    const { uses } = await (await b.go('/api/unlock-uses')).json();
    expect(uses).toEqual([
      { device: 'Safari on iPhone', at: clock.toISOString() },
      { device: 'Safari on iPhone', at: new Date(clock.getTime() - RECENT_SIGN_IN_MS - 1000).toISOString() },
    ]);
    const stored = JSON.stringify(db.prepare('SELECT * FROM unlock_uses').all());
    expect(stored).not.toContain(key);
    expect(JSON.stringify(logs)).not.toContain(key);
  });

  it('turning it off deletes the key; turning it on again makes a new one', async () => {
    const b = browser();
    await signIn(b, NATHAN);
    const { key } = await (await b.send('POST', '/api/unlock-key')).json();
    expect((await b.send('DELETE', '/api/unlock-key')).status).toBe(200);
    const off = await b.go('/api/unlock-key');
    expect(off.status).toBe(404);
    expect(await off.json()).toMatchObject({ off: true });
    expect((await (await b.send('POST', '/api/unlock-key')).json()).key).not.toBe(key);
  });

  it('needs a signed-in request from our own site, and goes with the account', async () => {
    expect((await browser().go('/api/unlock-key')).status).toBe(401);
    expect((await browser().send('POST', '/api/unlock-key')).status).toBe(401);
    const b = browser();
    await signIn(b, NATHAN);
    const evil = await b.go('/api/unlock-key', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
    expect(evil.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM unlock_keys').get().n).toBe(0);
    await b.send('POST', '/api/unlock-key');
    await b.go('/api/unlock-key');
    await b.send('DELETE', '/api/account');
    expect(db.prepare('SELECT COUNT(*) AS n FROM unlock_keys').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM unlock_uses').get().n).toBe(0);
  });

  it('upgrades a step-1 database without losing accounts', async () => {
    const old = mkdtempSync(join(tmpdir(), 'honed-sync-step1-'));
    const d = new DatabaseSync(join(old, 'sync.db'));
    d.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL, created_at TEXT NOT NULL, signed_in_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, device TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT NOT NULL, signed_in_at TEXT NOT NULL);
      CREATE INDEX sessions_account ON sessions(account_id);
      INSERT INTO accounts VALUES ('a1', '1002', 'nathan@example.com', 'x', 'x');
      PRAGMA user_version = 1;`);
    d.close();
    const upgraded = openDb(old);
    expect(upgraded.prepare('PRAGMA user_version').get().user_version).toBe(SCHEMA_STEP);
    expect(upgraded.prepare('SELECT email FROM accounts').all()).toEqual([{ email: 'nathan@example.com' }]);
    expect(upgraded.prepare('SELECT COUNT(*) AS n FROM unlock_keys').get().n).toBe(0);
    upgraded.close();
    rmSync(old, { recursive: true, force: true });
  });
});

describe('sync: the keyring (#105)', () => {
  const KEYRING = { v: 1, entries: [{ id: 'e1', method: 'recovery', wrapped: 'AAAA' }] };
  const KEYCHECK = { v: 1, iv: 'aaaaaaaaaaaaaaaa', ct: 'bbbb' };

  it('the first device uploads it; later uploads name the version they replace; the key check never changes', async () => {
    const pc = browser();
    await signIn(pc, NATHAN);
    expect((await pc.go('/api/keyring')).status).toBe(404);
    expect((await pc.send('PUT', '/api/keyring', { version: 3, keyring: KEYRING, keycheck: KEYCHECK })).status).toBe(409);
    expect(await (await pc.send('PUT', '/api/keyring', { version: 0, keyring: KEYRING, keycheck: KEYCHECK })).json()).toEqual({ version: 1 });
    expect(await (await pc.go('/api/keyring')).json()).toEqual({ version: 1, keyring: KEYRING, keycheck: KEYCHECK });

    // A passkey added on the phone: replaces version 1
    const phone = browser(IPHONE);
    await signIn(phone, NATHAN);
    const more = { v: 1, entries: [...KEYRING.entries, { id: 'e2', method: 'passkey', wrapped: 'CCCC' }] };
    expect(await (await phone.send('PUT', '/api/keyring', { version: 1, keyring: more, keycheck: KEYCHECK })).json()).toEqual({ version: 2 });
    // The PC, not knowing, tries to replace version 1 too: refused, told the current version
    const late = await pc.send('PUT', '/api/keyring', { version: 1, keyring: KEYRING, keycheck: KEYCHECK });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ version: 2 });
    // A keyring for another data key (another key check) is refused, whatever the version
    const other = await pc.send('PUT', '/api/keyring', { version: 2, keyring: KEYRING, keycheck: { ...KEYCHECK, ct: 'zzzz' } });
    expect(other.status).toBe(422);
    expect(await (await pc.go('/api/keyring')).json()).toMatchObject({ version: 2, keyring: more });
    // Another account sees none of it
    const matt = browser();
    await signIn(matt, MATT);
    expect((await matt.go('/api/keyring')).status).toBe(404);
  });

  it('refuses a badly formed or oversized keyring', async () => {
    const b = browser();
    await signIn(b, NATHAN);
    expect((await b.send('PUT', '/api/keyring', { version: 0, keyring: { v: 2 }, keycheck: KEYCHECK })).status).toBe(400);
    expect((await b.send('PUT', '/api/keyring', { version: -1, keyring: KEYRING, keycheck: KEYCHECK })).status).toBe(400);
    const huge = { v: 1, entries: [{ id: 'e', wrapped: 'A'.repeat(70_000) }] };
    // Bigger than the 16 KB body limit: refused
    expect((await b.send('PUT', '/api/keyring', { version: 0, keyring: huge, keycheck: KEYCHECK })).status).toBe(400);
    expect((await b.go('/api/keyring')).status).toBe(404);
  });
});

describe('sync: changes (#105)', () => {
  const change = (n, extra = {}) => ({
    id: `c${n}`,
    entity: 'course',
    entityId: `k${n}`,
    op: 'put',
    at: `2026-11-20T18:00:0${n % 10}.000Z`,
    iv: 'aaaaaaaaaaaaaaaa',
    ct: `sealed${n}`,
    ...extra,
  });

  it('keeps changes in arrival order, each id once, and hands out what comes after a number', async () => {
    const pc = browser();
    await signIn(pc, NATHAN);
    expect(await (await pc.send('POST', '/api/changes', { changes: [change(1), change(2)] })).json()).toEqual({ stored: 2, last: 2 });
    const phone = browser(IPHONE);
    await signIn(phone, NATHAN);
    // The same change sent again (a retry after a lost answer) is kept once. (Numbers may skip one: devices
    // only ever ask for "after N", so gaps don't matter.)
    const second = await (await phone.send('POST', '/api/changes', { changes: [change(2), change(3)] })).json();
    expect(second.stored).toBe(1);

    const all = await (await phone.go('/api/changes?after=0')).json();
    expect(all.changes.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    const seqs = all.changes.map((c) => c.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // in arrival order
    expect(all).toMatchObject({ more: false, last: seqs[2] });
    expect(second.last).toBe(seqs[2]);
    expect(all.changes[0]).toEqual({ seq: seqs[0], ...change(1) });
    expect(await (await phone.go(`/api/changes?after=${seqs[1]}`)).json()).toMatchObject({ changes: [{ id: 'c3' }], last: seqs[2] });
    expect(await (await phone.go(`/api/changes?after=${seqs[2]}`)).json()).toEqual({ changes: [], more: false, last: seqs[2] });
    // A page at a time
    expect(await (await phone.go('/api/changes?after=0&limit=2')).json()).toMatchObject({ more: true, last: seqs[1] });

    // Another account shares nothing; the same change id there is its own
    const matt = browser();
    await signIn(matt, MATT);
    expect(await (await matt.go('/api/changes?after=0')).json()).toEqual({ changes: [], more: false, last: 0 });
    await matt.send('POST', '/api/changes', { changes: [change(1)] });
    expect(await (await matt.go('/api/changes?after=0')).json()).toMatchObject({ changes: [{ id: 'c1' }] });
  });

  it('refuses badly formed changes, and takes a whole batch or none of it', async () => {
    const b = browser();
    await signIn(b, NATHAN);
    const bad = [
      { ...change(1), entity: 'deckFiles' },
      { ...change(1), op: 'patch' },
      { ...change(1), id: 'has spaces' },
      { ...change(1), at: 'yesterday' },
      { ...change(1), iv: 'short' },
      { ...change(1), ct: '' },
      { ...change(1), ct: 'not+base64/url=' },
    ];
    for (const c of bad) {
      expect((await b.send('POST', '/api/changes', { changes: [change(5), c] })).status, JSON.stringify(c)).toBe(400);
    }
    expect((await b.send('POST', '/api/changes', { changes: [] })).status).toBe(400);
    expect((await b.send('POST', '/api/changes', { changes: Array.from({ length: 501 }, (_, i) => change(i)) })).status).toBe(400);
    expect(await (await b.go('/api/changes?after=0')).json()).toMatchObject({ changes: [] }); // change(5) never got in
    expect((await b.go('/api/changes?after=-1')).status).toBe(400);
  });

  it('needs a signed-in request from our own site, and everything goes with the account', async () => {
    expect((await browser().go('/api/changes?after=0')).status).toBe(401);
    expect((await browser().send('POST', '/api/changes', { changes: [change(1)] })).status).toBe(401);
    const b = browser();
    await signIn(b, NATHAN);
    const evil = await b.go('/api/changes', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: [change(1)] }),
    });
    expect(evil.status).toBe(403);
    await b.send('POST', '/api/changes', { changes: [change(1)] });
    await b.send('PUT', '/api/keyring', { version: 0, keyring: { v: 1, entries: [] }, keycheck: { v: 1 } });
    await b.send('DELETE', '/api/account');
    expect(db.prepare('SELECT COUNT(*) AS n FROM changes').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM keyrings').get().n).toBe(0);
  });

  it('logs no change contents', async () => {
    const b = browser();
    await signIn(b, NATHAN);
    await b.send('POST', '/api/changes', { changes: [change(7, { ct: 'secretcipher' })] });
    await b.go('/api/changes?after=0');
    expect(JSON.stringify(logs)).not.toContain('secretcipher');
  });
});

describe('sync: slide files (#108)', () => {
  const bytes = (n, fill = 7) => new Uint8Array(n).fill(fill);
  /** A PUT that only says how big it is, as a raw HTTP request; gives the status. */
  const rawPut = (b, path, length) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(base + path, {
        method: 'PUT',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/octet-stream', 'Content-Length': String(length), Cookie: [...b.jar].map(([k, v]) => k + '=' + v).join('; ') },
      });
      req.on('response', (res) => { resolve(res.statusCode); res.resume(); req.destroy(); });
      req.on('error', () => {});
      req.flushHeaders();
    });
  const put = (b, path, body, headers = {}) =>
    b.go(path, { method: 'PUT', headers: { Origin: ORIGIN, 'Content-Type': 'application/octet-stream', ...headers }, body });

  it('keeps a deck’s files as sent and gives them back, to the same account only', async () => {
    const pc = browser();
    await signIn(pc, NATHAN);
    expect((await pc.go('/api/files/deck1/pdf')).status).toBe(404);
    const pdf = bytes(300_000, 3);
    expect(await (await put(pc, '/api/files/deck1/pdf', pdf)).json()).toEqual({ size: 300_000 });
    expect((await put(pc, '/api/files/deck1/pages', bytes(500, 9))).status).toBe(200);

    const phone = browser(IPHONE);
    await signIn(phone, NATHAN);
    const got = await phone.go('/api/files/deck1/pdf');
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/octet-stream');
    expect(got.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(pdf);
    // Sent again (a retry): replaced, not doubled
    await put(phone, '/api/files/deck1/pdf', bytes(10, 1));
    expect(new Uint8Array(await (await pc.go('/api/files/deck1/pdf')).arrayBuffer())).toEqual(bytes(10, 1));
    expect(db.prepare('SELECT COUNT(*) AS n FROM files').get().n).toBe(2);

    const matt = browser();
    await signIn(matt, MATT);
    expect((await matt.go('/api/files/deck1/pdf')).status).toBe(404);
  });

  it('refuses the wrong kind, a bad deck id, another site, not bytes, no size, too big, or signed out', async () => {
    const b = browser();
    await signIn(b, NATHAN);
    // Not a file address at all: refused (as a request that isn't JSON)
    expect((await put(b, '/api/files/deck1/exe', bytes(5))).status).toBeGreaterThanOrEqual(400);
    expect((await put(b, '/api/files/..%2Fsecret/pdf', bytes(5))).status).toBeGreaterThanOrEqual(400);
    expect((await put(b, '/api/files/deck1/pdf', bytes(5), { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await put(b, '/api/files/deck1/pdf', bytes(5), { 'Content-Type': 'application/json' })).status).toBe(415);
    // Says it's bigger than the limit: refused before anything is read (a raw request: fetch won't send a size that isn't true)
    expect(await rawPut(b, '/api/files/deck1/pdf', MAX_FILE_BYTES + 1)).toBe(413);
    expect((await browser().go('/api/files/deck1/pdf', { method: 'PUT', headers: { Origin: ORIGIN, 'Content-Type': 'application/octet-stream' }, body: bytes(5) })).status).toBe(401);
    expect((await browser().go('/api/files/deck1/pdf')).status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM files').get().n).toBe(0);
  });

  it('a deck deleted on a device takes its files with it; so does deleting the account', async () => {
    const b = browser();
    await signIn(b, NATHAN);
    await put(b, '/api/files/deck1/pdf', bytes(50));
    await put(b, '/api/files/deck1/pages', bytes(5));
    await put(b, '/api/files/deck2/pdf', bytes(50));
    const del = { id: 'del1', entity: 'slideDeck', entityId: 'deck1', op: 'delete', at: '2026-11-21T01:00:00.000Z', iv: 'aaaaaaaaaaaaaaaa', ct: 'sealed' };
    await b.send('POST', '/api/changes', { changes: [del] });
    expect((await b.go('/api/files/deck1/pdf')).status).toBe(404);
    expect((await b.go('/api/files/deck1/pages')).status).toBe(404);
    expect((await b.go('/api/files/deck2/pdf')).status).toBe(200);
    const account = db.prepare('SELECT id FROM accounts').get().id;
    expect(readdirSync(join(dir, 'files', account)).sort()).toEqual(['deck2.pdf']);

    await b.send('DELETE', '/api/account');
    expect(existsSync(join(dir, 'files', account))).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM files').get().n).toBe(0);
  });

  it('takes class materials and exam styles (#120); a material deleted on a device takes its files with it', async () => {
    const b = browser();
    await signIn(b, NATHAN);
    await put(b, '/api/files/mat1/pdf', bytes(40));
    await put(b, '/api/files/mat1/pages', bytes(4));
    await put(b, '/api/files/deck2/pdf', bytes(50));
    const at = '2026-11-22T01:00:00.000Z';
    const changes = [
      { id: 'c1', entity: 'examStyle', entityId: 'course1', op: 'put', at, iv: 'aaaaaaaaaaaaaaaa', ct: 'sealed' },
      { id: 'c2', entity: 'material', entityId: 'mat1', op: 'delete', at, iv: 'aaaaaaaaaaaaaaaa', ct: 'sealed' },
    ];
    const res = await b.send('POST', '/api/changes', { changes });
    expect(res.status).toBe(200);
    expect((await res.json()).stored).toBe(2);
    expect((await b.go('/api/files/mat1/pdf')).status).toBe(404);
    expect((await b.go('/api/files/mat1/pages')).status).toBe(404);
    expect((await b.go('/api/files/deck2/pdf')).status).toBe(200);
    const account = db.prepare('SELECT id FROM accounts').get().id;
    expect(readdirSync(join(dir, 'files', account)).sort()).toEqual(['deck2.pdf']);
  });

  it('logs no file contents', async () => {
    const b = browser();
    await signIn(b, NATHAN);
    await put(b, '/api/files/deck1/pdf', new TextEncoder().encode('secret-slide-bytes'));
    await b.go('/api/files/deck1/pdf');
    expect(JSON.stringify(logs)).not.toContain('secret-slide-bytes');
  });
});
