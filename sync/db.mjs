// The sync server's data (#95): one SQLite file, sync.db, in the data folder, through Node's own
// node:sqlite. Numbered schema steps (PRAGMA user_version): never edit a step that has shipped, add one.
//
// Step 1: accounts and sessions. Step 2: Google unlock keys and when they were used. Step 3: sync
// (the keyring and the sealed changes). Step 4: which slide files are kept (the bytes are files beside it). Step 5: results keys (#161). What's readable here is exactly docs/SECURITY.md's "What the sync
// server holds": the Google account id and email, and sessions as SHA-256 hashes, never the tokens.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const STEPS = [
  // Step 1 (Nov 20, 2026, #95)
  `CREATE TABLE accounts (
     id          TEXT PRIMARY KEY,              -- our own random id
     google_sub  TEXT NOT NULL UNIQUE,          -- Google's id for the account (never the email: emails change hands)
     email       TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     signed_in_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     id          TEXT PRIMARY KEY,              -- a random id to name it in the devices list
     hash        TEXT NOT NULL UNIQUE,          -- SHA-256 of the cookie's token, base64url
     account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     device      TEXT NOT NULL,                 -- "Chrome on Windows", from the browser
     created_at  TEXT NOT NULL,
     used_at     TEXT NOT NULL,
     signed_in_at TEXT NOT NULL                 -- the Google sign-in behind it (deleting the account needs a recent one)
   );
   CREATE INDEX sessions_account ON sessions(account_id);`,
  // Step 2 (Nov 20, 2026, #101): Google unlock (docs/SECURITY.md "Google unlock"), opt-in per account. The key
  // opens that account's data: it's only ever given to a session with a fresh Google sign-in, and each time
  // is recorded (never the key itself).
  `CREATE TABLE unlock_keys (
     account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     key         BLOB NOT NULL,                 -- 32 random bytes
     created_at  TEXT NOT NULL
   );
   CREATE TABLE unlock_uses (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     device      TEXT NOT NULL,
     at          TEXT NOT NULL
   );
   CREATE INDEX unlock_uses_account ON unlock_uses(account_id, at);`,
  // Step 3 (Nov 20, 2026, #105): sync. The account's keyring and key check (wrapped keys only, as the
  // device sent them), and an append-only list of sealed changes. The server can read only the hints
  // (entity, its id, put or delete, when) and sizes: docs/SECURITY.md "What the sync server holds".
  `CREATE TABLE keyrings (
     account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     keyring     TEXT NOT NULL,                 -- JSON, bytes as base64url, as the device sent it
     keycheck    TEXT NOT NULL,                 -- JSON; never changes once set
     version     INTEGER NOT NULL,              -- compare and swap: each upload names the one it replaces
     updated_at  TEXT NOT NULL
   );
   CREATE TABLE changes (
     seq         INTEGER PRIMARY KEY AUTOINCREMENT,  -- the order changes arrived in, across the account's devices
     account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     id          TEXT NOT NULL,                 -- the change's own id: the same change twice is stored once
     entity      TEXT NOT NULL,                 -- hints only: devices never act on these
     entity_id   TEXT NOT NULL,
     op          TEXT NOT NULL,
     at          TEXT NOT NULL,
     iv          TEXT NOT NULL,                 -- base64url
     ct          TEXT NOT NULL,                 -- base64url, sealed with additional data honed:v1:sync:<id>
     size        INTEGER NOT NULL,
     received_at TEXT NOT NULL,
     UNIQUE (account_id, id)
   );
   CREATE INDEX changes_account_seq ON changes(account_id, seq);`,
  // Step 4 (Nov 21, 2026, #108): slide PDFs and their page text, sealed exactly as the device stores them. The
  // bytes are files in the data folder (files/<account id>/<deck id>.<pdf|pages>); this table says which exist.
  `CREATE TABLE files (
     account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     deck_id     TEXT NOT NULL,
     kind        TEXT NOT NULL,                 -- 'pdf' or 'pages'
     size        INTEGER NOT NULL,
     uploaded_at TEXT NOT NULL,
     PRIMARY KEY (account_id, deck_id, kind)
   );`,
  // Step 5 (Nov 26, 2026, #161): the account's results key for AI work in the background (docs/SECURITY.md "AI
  // work in the background"). The public key (anyone may know it) and the private part sealed with the data key,
  // stored once and never replaced.
  `CREATE TABLE results_keys (
     account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     public_key  TEXT NOT NULL,                 -- raw P-256 point, base64url
     sealed      TEXT NOT NULL,                 -- JSON { v, iv, ct }, base64url, as the device sent it
     created_at  TEXT NOT NULL
   );`,
];

/** Opens (and if needed creates or upgrades) the database in `dir`, or in memory for ':memory:'. */
export function openDb(dir) {
  const db = new DatabaseSync(dir === ':memory:' ? ':memory:' : join(dir, 'sync.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > STEPS.length) {
    db.close();
    throw new Error(`sync.db is from a newer version (schema step ${version}); update the app`);
  }
  for (let step = version; step < STEPS.length; step++) {
    db.exec('BEGIN');
    try {
      db.exec(STEPS[step]);
      db.exec(`PRAGMA user_version = ${step + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

export const SCHEMA_STEP = STEPS.length;
