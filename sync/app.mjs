// The sync server's HTTP API (#95, served at /api/ through the tunnel; docs/SECURITY.md "Accounts and
// sync"). Step 1 is accounts only: nothing syncs yet.
//
//   GET    /api/auth/google?then=<path>[&fresh=1]  start a Google sign-in (fresh: choose the account again)
//   GET    /api/auth/callback                       where Google sends the browser back
//   GET    /api/me                                  { signedIn, email?, device? }
//   GET    /api/devices                             this account's signed-in devices
//   POST   /api/auth/signout                        sign this device out
//   POST   /api/devices/signout  { id } | { all: true }   sign another device, or every device, out
//   DELETE /api/account                             delete the account (needs a sign-in in the last 5 minutes)
//   POST   /api/unlock-key                          Google unlock on (#101): the account's key, made the first time
//   GET    /api/unlock-key                          the key, for unlocking (needs a sign-in in the last 5 minutes; recorded)
//   DELETE /api/unlock-key                          Google unlock off: the key is deleted
//   GET    /api/unlock-uses                         when and on which device the key was given out
//   GET    /api/keyring                             sync (#105): the account's keyring and key check, or 404
//   PUT    /api/keyring  { version, keyring, keycheck }  compare and swap; the key check never changes
//   GET    /api/results-key                         the account's results key (#161): { publicKey, sealed }, or 404
//   PUT    /api/results-key  { publicKey, sealed }  saved once; the same key again is fine, another one is refused (422)
//   POST   /api/changes  { changes: [...] }          sealed changes, added (the same id twice is kept once)
//   GET    /api/changes?after=N[&limit=M]           the changes after number N, oldest first
//   PUT    /api/files/<deckId>/<pdf|pages>         a deck's file, sealed, as raw bytes (#108)
//   GET    /api/files/<deckId>/<pdf|pages>         the same bytes back
//   GET    /healthz                                 for the container's health check
//
// Requests that change something must come from our own site (Origin) as JSON. Answers are never
// cached. Logs are routes, statuses and times: never emails, tokens or codes.
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomToken, SignInError } from './google.mjs';

export const SESSION_COOKIE = 'honed_session';
export const SIGNIN_COOKIE = 'honed_signin';
const DAY = 86_400_000;
export const SESSION_IDLE_MS = 30 * DAY;
export const SESSION_MAX_MS = 180 * DAY;
export const RECENT_SIGN_IN_MS = 5 * 60_000;
export const SIGN_IN_WAIT_MS = 10 * 60_000; // how long a started sign-in may take
const MAX_PENDING = 500;
const MAX_BODY = 16 * 1024;
const MAX_CHANGES_BODY = 8 * 1024 * 1024; // POST /api/changes: up to MAX_BATCH changes
export const MAX_BATCH = 500;
export const MAX_CHANGE_BYTES = 1024 * 1024; // one sealed change, base64url (records are small; PDFs aren't changes)
export const MAX_ACCOUNT_BYTES = 200 * 1024 * 1024; // all of an account's changes, in the testing phase
export const MAX_KEYRING_BYTES = 64 * 1024;
export const MAX_FILE_BYTES = 110 * 1024 * 1024; // a sealed 100 MB PDF (Honed's limit, and Cloudflare's upload limit) and a little
export const MAX_ACCOUNT_FILE_BYTES = 5 * 1024 * 1024 * 1024; // in the testing phase
const FILE_PATH = /^\/api\/files\/([\w-]{1,64})\/(pdf|pages)$/;
// material and examStyle: #120 (a class's other documents and its exam style)
const ENTITIES = new Set(['course', 'exam', 'slideDeck', 'lecture', 'section', 'question', 'quizAttempt', 'studySession', 'settings', 'annotation', 'material', 'examStyle']);
const ID = /^[\w-]{1,64}$/;
const B64URL = /^[\w-]*$/;
const TOUCH_EVERY_MS = 3_600_000; // a session's "last used" is saved at most hourly

const hashToken = (token) => createHash('sha256').update(token).digest('base64url');

/** A results key's sealed private part, base64url: a P-256 private key and a fingerprint key, sealed (~260 characters). */
export const MAX_RESULTS_KEY_CT = 1024;

/** Whether a base64url string is a real P-256 public point (so nobody stores something results can't be sealed to). */
async function isP256Point(b64) {
  try {
    await webcrypto.subtle.importKey('raw', Buffer.from(b64, 'base64url'), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} options
 * @param {import('node:sqlite').DatabaseSync} options.db  from openDb
 * @param {ReturnType<typeof import('./google.mjs').googleClient>} options.google
 * @param {string[]} options.allowedEmails  who may have an account (testing phase); empty lets nobody in
 * @param {string} options.appOrigin  https://honed.pacificfish.ca
 * @param {string} [options.filesDir]  where slide files are kept (#108): DATA_DIR/files
 * @param {(line: object) => void} [options.log]
 * @param {() => Date} [options.now]
 */
export function createSync({ db, google, allowedEmails, appOrigin, filesDir, log = (line) => console.log(JSON.stringify(line)), now = () => new Date() }) {
  const allowed = new Set(allowedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const pending = new Map(); // state -> { nonce, verifier, then, at }
  const secure = appOrigin.startsWith('https:') ? '; Secure' : '';

  const q = {
    accountBySub: db.prepare('SELECT * FROM accounts WHERE google_sub = ?'),
    addAccount: db.prepare('INSERT INTO accounts (id, google_sub, email, created_at, signed_in_at) VALUES (?, ?, ?, ?, ?)'),
    updateAccount: db.prepare('UPDATE accounts SET email = ?, signed_in_at = ? WHERE id = ?'),
    deleteAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),
    addSession: db.prepare('INSERT INTO sessions (id, hash, account_id, device, created_at, used_at, signed_in_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT s.*, a.email FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.hash = ?'),
    touch: db.prepare('UPDATE sessions SET used_at = ? WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteSessionByHash: db.prepare('DELETE FROM sessions WHERE hash = ?'),
    deleteAccountSession: db.prepare('DELETE FROM sessions WHERE id = ? AND account_id = ?'),
    deleteAccountSessions: db.prepare('DELETE FROM sessions WHERE account_id = ?'),
    devices: db.prepare('SELECT id, device, created_at, used_at FROM sessions WHERE account_id = ? ORDER BY used_at DESC'),
    unlockKey: db.prepare('SELECT key FROM unlock_keys WHERE account_id = ?'),
    addUnlockKey: db.prepare('INSERT INTO unlock_keys (account_id, key, created_at) VALUES (?, ?, ?)'),
    deleteUnlockKey: db.prepare('DELETE FROM unlock_keys WHERE account_id = ?'),
    addUnlockUse: db.prepare('INSERT INTO unlock_uses (account_id, device, at) VALUES (?, ?, ?)'),
    unlockUses: db.prepare('SELECT device, at FROM unlock_uses WHERE account_id = ? ORDER BY at DESC LIMIT 20'),
    resultsKey: db.prepare('SELECT public_key, sealed FROM results_keys WHERE account_id = ?'),
    addResultsKey: db.prepare('INSERT OR IGNORE INTO results_keys (account_id, public_key, sealed, created_at) VALUES (?, ?, ?, ?)'),
    keyring: db.prepare('SELECT keyring, keycheck, version FROM keyrings WHERE account_id = ?'),
    addKeyring: db.prepare('INSERT INTO keyrings (account_id, keyring, keycheck, version, updated_at) VALUES (?, ?, ?, 1, ?)'),
    swapKeyring: db.prepare('UPDATE keyrings SET keyring = ?, version = version + 1, updated_at = ? WHERE account_id = ? AND version = ?'),
    addChange: db.prepare(
      'INSERT OR IGNORE INTO changes (account_id, id, entity, entity_id, op, at, iv, ct, size, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    changesAfter: db.prepare('SELECT seq, id, entity, entity_id, op, at, iv, ct FROM changes WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT ?'),
    lastChange: db.prepare('SELECT COALESCE(MAX(seq), 0) AS last FROM changes WHERE account_id = ?'),
    accountBytes: db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM changes WHERE account_id = ?'),
    file: db.prepare('SELECT size FROM files WHERE account_id = ? AND deck_id = ? AND kind = ?'),
    putFile: db.prepare(
      'INSERT INTO files (account_id, deck_id, kind, size, uploaded_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (account_id, deck_id, kind) DO UPDATE SET size = excluded.size, uploaded_at = excluded.uploaded_at',
    ),
    deleteDeckFiles: db.prepare('DELETE FROM files WHERE account_id = ? AND deck_id = ?'),
    fileBytes: db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM files WHERE account_id = ?'),
  };

  /** The signed-in session for this request, or null (an expired or no-longer-allowed one is removed). */
  const sessionOf = (req) => {
    const token = cookies(req)[SESSION_COOKIE];
    if (!token) return null;
    const row = q.session.get(hashToken(token));
    if (!row) return null;
    const at = now().getTime();
    const expired = at - Date.parse(row.used_at) > SESSION_IDLE_MS || at - Date.parse(row.created_at) > SESSION_MAX_MS;
    if (expired || !allowed.has(row.email)) {
      q.deleteSession.run(row.id);
      return null;
    }
    if (at - Date.parse(row.used_at) > TOUCH_EVERY_MS) q.touch.run(now().toISOString(), row.id);
    return row;
  };

  return async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://sync');
    const route = `${req.method} ${url.pathname}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const done = (status) => log({ at: now().toISOString(), route, status, ms: Date.now() - started });

    const json = (status, body, extra = {}) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
      res.end(JSON.stringify(body));
      done(status);
    };
    const redirect = (to, extra = {}) => {
      res.writeHead(303, { ...headers, Location: to, ...extra });
      res.end();
      done(303);
    };
    // A plain page for sign-in problems (the browser arrived by a redirect, so JSON would be no use)
    const page = (status, message, extra = {}) => {
      res.writeHead(status, {
        ...headers,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        ...extra,
      });
      res.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Honed sign-in</title></head>` +
          `<body><h1>Honed sign-in</h1><p>${escapeHtml(message)}</p><p><a href="/#/settings">Back to Honed</a></p></body></html>`,
      );
      done(status);
    };

    if (url.pathname === '/healthz' && req.method === 'GET') return json(200, { ok: true });

    // --- Signing in ---

    if (url.pathname === '/api/auth/google' && req.method === 'GET') {
      const then = safePath(url.searchParams.get('then'));
      const at = now().getTime();
      for (const [state, p] of pending) if (at - p.at > SIGN_IN_WAIT_MS) pending.delete(state);
      if (pending.size >= MAX_PENDING) return page(503, 'Too many sign-ins at once. Try again in a few minutes.');
      const state = randomToken();
      const sign = { nonce: randomToken(), verifier: randomToken(), then, at };
      pending.set(state, sign);
      // The state also goes in a cookie, so a sign-in can only finish in the browser that started it
      // (nobody can send you a link that signs you in to their account)
      return redirect(google.signInUrl({ state, nonce: sign.nonce, verifier: sign.verifier, prompt: url.searchParams.get('fresh') ? 'select_account' : undefined }), {
        'Set-Cookie': `${SIGNIN_COOKIE}=${state}; Path=/api/auth/; HttpOnly; SameSite=Lax; Max-Age=${SIGN_IN_WAIT_MS / 1000}${secure}`,
      });
    }

    if (url.pathname === '/api/auth/callback' && req.method === 'GET') {
      const clear = `${SIGNIN_COOKIE}=; Path=/api/auth/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
      const state = url.searchParams.get('state') ?? '';
      const sign = pending.get(state);
      pending.delete(state);
      if (url.searchParams.get('error')) return page(400, 'The sign-in was cancelled.', { 'Set-Cookie': clear });
      if (!sign || now().getTime() - sign.at > SIGN_IN_WAIT_MS || cookies(req)[SIGNIN_COOKIE] !== state) {
        return page(400, 'That sign-in link has expired, or was started in another browser. Please sign in again.', { 'Set-Cookie': clear });
      }
      let who;
      try {
        const idToken = await google.exchange(url.searchParams.get('code') ?? '', sign.verifier);
        who = await google.verifyIdToken(idToken, sign.nonce);
      } catch (err) {
        if (err instanceof SignInError) return page(400, `Google sign-in didn’t work: ${err.message}`, { 'Set-Cookie': clear });
        throw err;
      }
      if (!allowed.has(who.email)) {
        return page(403, 'Honed sync is invite-only for now, and this Google account isn’t on the list.', { 'Set-Cookie': clear });
      }

      const at = now().toISOString();
      let account = q.accountBySub.get(who.sub);
      if (account) q.updateAccount.run(who.email, at, account.id);
      else {
        account = { id: randomUUID() };
        q.addAccount.run(account.id, who.sub, who.email, at, at);
      }
      // Signing in again on this device replaces its session rather than adding another
      const old = cookies(req)[SESSION_COOKIE];
      if (old) q.deleteSessionByHash.run(hashToken(old));
      const token = randomBytes(32).toString('base64url');
      q.addSession.run(randomUUID(), hashToken(token), account.id, deviceName(req.headers['user-agent']), at, at, at);
      res.setHeader('Set-Cookie', [clear, `${SESSION_COOKIE}=${token}; Path=/api/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_MS / 1000}${secure}`]);
      return redirect(sign.then);
    }

    // --- Signed in ---

    if (url.pathname === '/api/me' && req.method === 'GET') {
      const s = sessionOf(req);
      return json(200, s ? { signedIn: true, email: s.email, device: s.id } : { signedIn: false });
    }

    if (!url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' });

    // --- Slide files (#108, docs/SECURITY.md "Files (slide PDFs)"): raw bytes, sealed by the device ---
    const fileMatch = FILE_PATH.exec(url.pathname);
    if (fileMatch) {
      if (!filesDir) return json(503, { error: 'Files aren’t set up on this server.' });
      if (req.method !== 'GET' && req.method !== 'PUT') return json(405, { error: 'GET or PUT.' });
      if (req.method === 'PUT') {
        if (req.headers.origin !== appOrigin) return json(403, { error: 'Requests must come from Honed itself.' });
        if (!/^application\/octet-stream\b/i.test(req.headers['content-type'] ?? '')) return json(415, { error: 'Send the bytes.' });
      }
      const owner = sessionOf(req);
      if (!owner) return json(401, { error: 'Not signed in.' }); // checked before a byte is read
      const [, deckId, kind] = fileMatch;
      const path = join(filesDir, owner.account_id, `${deckId}.${kind}`);

      if (req.method === 'GET') {
        const row = q.file.get(owner.account_id, deckId, kind);
        if (!row) return json(404, { error: 'Not uploaded yet.', missing: true });
        res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(row.size) });
        await pipeline(createReadStream(path), res);
        return done(200);
      }

      const length = Number(req.headers['content-length']);
      if (!Number.isInteger(length) || length < 1) return json(411, { error: 'Say how big it is.' });
      if (length > MAX_FILE_BYTES) return json(413, { error: 'That file is too big.' });
      const had = q.file.get(owner.account_id, deckId, kind)?.size ?? 0;
      if (q.fileBytes.get(owner.account_id).bytes - had + length > MAX_ACCOUNT_FILE_BYTES) return json(413, { error: 'This account is full for now.', full: true });
      await mkdir(join(filesDir, owner.account_id), { recursive: true });
      const part = `${path}.${randomBytes(6).toString('hex')}.part`;
      let got = 0;
      const count = new Transform({
        transform(chunk, _enc, next) {
          got += chunk.length;
          next(got > length ? new Error('more than it said') : null, chunk);
        },
      });
      try {
        await pipeline(req, count, createWriteStream(part));
        if (got !== length) throw new Error('less than it said');
      } catch {
        await unlink(part).catch(() => {});
        return json(400, { error: 'The upload didn’t arrive whole.' });
      }
      await rename(part, path); // whole or not at all: a reader never sees half a file
      q.putFile.run(owner.account_id, deckId, kind, length, now().toISOString());
      return json(200, { size: length });
    }

    // Everything below changes something, or is private: our own site only, signed in
    const changing = req.method !== 'GET';
    if (changing) {
      if (req.headers.origin !== appOrigin) return json(403, { error: 'Requests must come from Honed itself.' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return json(415, { error: 'Send JSON.' });
    }
    let body = {};
    if (changing) {
      try {
        body = await readJson(req, url.pathname === '/api/changes' ? MAX_CHANGES_BODY : MAX_BODY);
      } catch {
        return json(400, { error: 'Bad JSON.' });
      }
    }
    const s = sessionOf(req);
    const signOutCookie = `${SESSION_COOKIE}=; Path=/api/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;

    if (url.pathname === '/api/auth/signout' && req.method === 'POST') {
      if (s) q.deleteSession.run(s.id);
      return json(200, { signedIn: false }, { 'Set-Cookie': signOutCookie });
    }

    if (!s) return json(401, { error: 'Not signed in.' });

    if (url.pathname === '/api/devices' && req.method === 'GET') {
      const devices = q.devices.all(s.account_id).map((d) => ({ id: d.id, device: d.device, since: d.created_at, lastUsed: d.used_at, current: d.id === s.id }));
      return json(200, { devices });
    }

    if (url.pathname === '/api/devices/signout' && req.method === 'POST') {
      if (body.all === true) {
        q.deleteAccountSessions.run(s.account_id);
        return json(200, { signedIn: false }, { 'Set-Cookie': signOutCookie });
      }
      if (typeof body.id !== 'string') return json(400, { error: 'Say which device.' });
      q.deleteAccountSession.run(body.id, s.account_id); // never another account's
      return json(200, body.id === s.id ? { signedIn: false } : { signedIn: true }, body.id === s.id ? { 'Set-Cookie': signOutCookie } : {});
    }

    if (url.pathname === '/api/account' && req.method === 'DELETE') {
      if (now().getTime() - Date.parse(s.signed_in_at) > RECENT_SIGN_IN_MS) {
        return json(403, { error: 'Sign in with Google again first, then delete the account within 5 minutes.', needsSignIn: true });
      }
      q.deleteAccount.run(s.account_id); // its sessions go with it (ON DELETE CASCADE)
      if (filesDir) await rm(join(filesDir, s.account_id), { recursive: true, force: true }); // and its slide files
      return json(200, { deleted: true, signedIn: false }, { 'Set-Cookie': signOutCookie });
    }

    // --- Google unlock (#101, docs/SECURITY.md "Google unlock") ---

    if (url.pathname === '/api/unlock-key' && req.method === 'POST') {
      // Turning it on: the device has just proved it's you (passphrase, passkey or recovery key) before asking.
      // One key per account, so every device of the account wraps its data key with the same one.
      let row = q.unlockKey.get(s.account_id);
      if (!row) {
        q.addUnlockKey.run(s.account_id, randomBytes(32), now().toISOString());
        row = q.unlockKey.get(s.account_id);
      }
      return json(200, { key: Buffer.from(row.key).toString('base64url') });
    }

    if (url.pathname === '/api/unlock-key' && req.method === 'GET') {
      if (now().getTime() - Date.parse(s.signed_in_at) > RECENT_SIGN_IN_MS) {
        return json(403, { error: 'Sign in with Google again to unlock.', needsSignIn: true });
      }
      const row = q.unlockKey.get(s.account_id);
      if (!row) return json(404, { error: 'Google unlock is off for this account.', off: true });
      q.addUnlockUse.run(s.account_id, s.device, now().toISOString());
      return json(200, { key: Buffer.from(row.key).toString('base64url') });
    }

    if (url.pathname === '/api/unlock-key' && req.method === 'DELETE') {
      q.deleteUnlockKey.run(s.account_id);
      return json(200, { off: true });
    }

    // --- Sync (#105, docs/SECURITY.md "The keyring on the server", "Changes") ---

    if (url.pathname === '/api/keyring' && req.method === 'GET') {
      const row = q.keyring.get(s.account_id);
      if (!row) return json(404, { none: true });
      return json(200, { version: row.version, keyring: JSON.parse(row.keyring), keycheck: JSON.parse(row.keycheck) });
    }

    if (url.pathname === '/api/keyring' && req.method === 'PUT') {
      const { version, keyring, keycheck } = body;
      if (!Number.isInteger(version) || version < 0) return json(400, { error: 'Say which version this replaces.' });
      if (keyring?.v !== 1 || !Array.isArray(keyring.entries) || keycheck?.v !== 1) return json(400, { error: 'Bad keyring.' });
      const keyringText = JSON.stringify(keyring);
      const keycheckText = JSON.stringify(keycheck);
      if (keyringText.length + keycheckText.length > MAX_KEYRING_BYTES) return json(413, { error: 'Keyring too big.' });
      const row = q.keyring.get(s.account_id);
      const at = now().toISOString();
      if (!row) {
        if (version !== 0) return json(409, { error: 'The account has no keyring yet.', version: 0 });
        q.addKeyring.run(s.account_id, keyringText, keycheckText, at);
        return json(200, { version: 1 });
      }
      // The data key never changes, so neither does the key check: a keyring for another key is refused
      if (row.keycheck !== keycheckText) return json(422, { error: 'That keyring is for a different key.', differentKey: true });
      if (q.swapKeyring.run(keyringText, at, s.account_id, version).changes !== 1) {
        return json(409, { error: 'The keyring changed on another device first.', version: q.keyring.get(s.account_id).version });
      }
      return json(200, { version: version + 1 });
    }

    // --- The results key (#161, docs/SECURITY.md "AI work in the background") ---

    if (url.pathname === '/api/results-key' && req.method === 'GET') {
      const row = q.resultsKey.get(s.account_id);
      if (!row) return json(404, { none: true });
      return json(200, { publicKey: row.public_key, sealed: JSON.parse(row.sealed) });
    }

    if (url.pathname === '/api/results-key' && req.method === 'PUT') {
      const { publicKey, sealed } = body;
      const ok =
        typeof publicKey === 'string' && publicKey.length === 87 && B64URL.test(publicKey) &&
        Buffer.from(publicKey, 'base64url')[0] === 4 &&
        sealed?.v === 1 &&
        typeof sealed.iv === 'string' && sealed.iv.length === 16 && B64URL.test(sealed.iv) &&
        typeof sealed.ct === 'string' && sealed.ct.length > 0 && sealed.ct.length <= MAX_RESULTS_KEY_CT && B64URL.test(sealed.ct);
      if (!ok || !(await isP256Point(publicKey))) return json(400, { error: 'Bad results key.' });
      const sealedText = JSON.stringify({ v: 1, iv: sealed.iv, ct: sealed.ct });
      // Made once, never replaced: the first upload wins, and only that same key is accepted after
      q.addResultsKey.run(s.account_id, publicKey, sealedText, now().toISOString());
      const row = q.resultsKey.get(s.account_id);
      if (row.public_key !== publicKey || row.sealed !== sealedText) {
        return json(422, { error: 'This account already has another results key.', differentKey: true });
      }
      return json(200, { saved: true });
    }

    if (url.pathname === '/api/changes' && req.method === 'POST') {
      const list = body.changes;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) return json(400, { error: `Send 1 to ${MAX_BATCH} changes.` });
      for (const c of list) {
        const ok =
          typeof c === 'object' && c !== null &&
          typeof c.id === 'string' && ID.test(c.id) &&
          ENTITIES.has(c.entity) &&
          typeof c.entityId === 'string' && ID.test(c.entityId) &&
          (c.op === 'put' || c.op === 'delete') &&
          typeof c.at === 'string' && c.at.length <= 40 && !Number.isNaN(Date.parse(c.at)) &&
          typeof c.iv === 'string' && c.iv.length === 16 && B64URL.test(c.iv) &&
          typeof c.ct === 'string' && c.ct.length > 0 && c.ct.length <= MAX_CHANGE_BYTES && B64URL.test(c.ct);
        if (!ok) return json(400, { error: 'A change is badly formed.' });
      }
      const adding = list.reduce((n, c) => n + c.ct.length, 0);
      if (q.accountBytes.get(s.account_id).bytes + adding > MAX_ACCOUNT_BYTES) return json(413, { error: 'This account is full for now.', full: true });
      const at = now().toISOString();
      let stored = 0;
      db.exec('BEGIN');
      try {
        for (const c of list) stored += q.addChange.run(s.account_id, c.id, c.entity, c.entityId, c.op, c.at, c.iv, c.ct, c.ct.length, at).changes;
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      // A deck deleted on a device: its files go too (#108). (The hint is all the server can read; at worst a
      // wrong one removes this account's own files, which the device that has them uploads again.)
      for (const c of list) {
        // A class material's files (#120) are kept the same way, by its id
        if ((c.entity !== 'slideDeck' && c.entity !== 'material') || c.op !== 'delete' || !filesDir) continue;
        q.deleteDeckFiles.run(s.account_id, c.entityId);
        for (const kind of ['pdf', 'pages']) await unlink(join(filesDir, s.account_id, `${c.entityId}.${kind}`)).catch(() => {});
      }
      return json(200, { stored, last: q.lastChange.get(s.account_id).last });
    }

    if (url.pathname === '/api/changes' && req.method === 'GET') {
      const after = Number(url.searchParams.get('after') ?? 0);
      const limit = Math.min(Number(url.searchParams.get('limit') ?? MAX_BATCH), MAX_BATCH);
      if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1) return json(400, { error: 'Bad after or limit.' });
      const rows = q.changesAfter.all(s.account_id, after, limit + 1);
      const more = rows.length > limit;
      const changes = rows.slice(0, limit).map((r) => ({ seq: r.seq, id: r.id, entity: r.entity, entityId: r.entity_id, op: r.op, at: r.at, iv: r.iv, ct: r.ct }));
      return json(200, { changes, more, last: changes.at(-1)?.seq ?? after });
    }

    if (url.pathname === '/api/unlock-uses' && req.method === 'GET') {
      return json(200, { uses: q.unlockUses.all(s.account_id).map((u) => ({ device: u.device, at: u.at })) });
    }

    return json(404, { error: 'Not found.' });
  };
}

/** A path on our own site to go back to after signing in: "/..." only, never another site. */
export function safePath(then) {
  if (typeof then !== 'string' || then.length > 300) return '/#/settings';
  if (!then.startsWith('/') || then.startsWith('//') || then.startsWith('/\\') || /[\u0000-\u001f\u007f\\]/.test(then)) return '/#/settings';
  return then;
}

/** "Chrome on Windows", "Safari on iPhone": enough to tell devices apart in a list. */
export function deviceName(agent = '') {
  const os = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Windows/.test(agent) ? 'Windows' : /Mac OS X|Macintosh/.test(agent) ? 'Mac' : /CrOS/.test(agent) ? 'ChromeOS' : /Linux/.test(agent) ? 'Linux' : null;
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\/|FxiOS/.test(agent) ? 'Firefox' : /CriOS|Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : null;
  if (!os && !browser) return 'A browser';
  return [browser ?? 'A browser', os && `on ${os}`].filter(Boolean).join(' ');
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

async function readJson(req, limit = MAX_BODY) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('too big');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const value = text ? JSON.parse(text) : {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
  return value;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
