# Security design

How Honed keeps a user's classes and slides private. Change it here first, in its own PR, before changing the
code. **Only standard building blocks from the browser's WebCrypto, with standard parameters. No home-made
cryptography.**

**In short (Nov 20, 2026):**
- **On the device:** everything is encrypted with a data key that only a passkey, a passphrase or the recovery key
  opens (milestone 3, #15-#18). Backups hold only ciphertext.
- **Remember this device** (#99, on by default): after one unlock, a device opens straight in. The key it keeps
  can't be read out by the page, and never leaves the device; the device's own lock protects it from there.
- **Accounts** (#95): Google sign-in to our sync server says *which account* a device belongs to. On its own it
  never unlocks anything.
- **Google unlock** (#101, **opt-in**): for people who turn it on, the server keeps a key that opens their data, so a
  Google sign-in can unlock instead of a passkey. For them, our server (or anyone who takes it over, or takes over
  their Google account) could read their data. For everyone else, nothing changes.
- **Sync** (#105, #108, opt-in in Settings): classes, lectures, quizzes, notes, settings and slide PDFs travel
  between a person's devices sealed with their data key; the server holds them but can't open them (unless that
  person turned on Google unlock). A deck's PDF comes down only when a device opens it.

## What it protects against, and what it doesn't

| Threat | Protected? | How |
| --- | --- | --- |
| Our server, or anyone who takes it over, reading your classes and slides | **Yes**, at rest | The server stores none of them. The one exception is AI requests (below): a section's slide text passes through the AI helper on its way to Anthropic, and nothing is kept. With sync (v2, "Accounts and sync") it stores only ciphertext it has no key for. |
| Google, or someone who takes over the Google account, opening the data | **Yes**, unless that person turned on Google unlock | Signing in only says which account it is ("Accounts and sync"). With Google unlock on, a Google sign-in plus our server's key opens it ("Google unlock"). |
| Someone who steals a session cookie | Partly | A session can't unlock anything by itself. With Google unlock on, it can fetch the key only within 5 minutes of a Google sign-in, and each fetch is recorded and shown in Settings. Sessions end after 30 days unused. |
| The sync server withholding or rolling back changes (v2) | **No** (it can't read, forge or alter them) | Every device keeps its own full copy, so sync stops; nothing is lost from a device. |
| A backup file (`.honed`) found in someone's cloud drive | **Yes** | Backups hold only ciphertext and wrapped keys (#18). |
| Another person using the same computer account, or copying the browser's files | **Yes**, while Honed is locked **and the device doesn't remember the unlock** | Records are encrypted at rest; the key is only ever in memory while unlocked. A device that remembers the unlock (#97, "Remembering a device") opens without asking, so there the device's own lock is the protection. |
| Our server reading the data of someone who turned on Google unlock (#97) | **No**, for that person only | They chose to let their Google account unlock Honed, so the server holds a key that opens it ("Google unlock"). Everyone else is unaffected. |
| A lost phone or laptop | By the device | The device's own lock and disk encryption. Honed adds the points above. |
| Malicious code running inside the page while it's unlocked | **No** (encryption can't) | Prevented instead by the strict Content-Security-Policy, no outside scripts, few dependencies. |
| Losing every way to unlock (passphrase, passkeys, Google unlock if on) **and** the recovery key | **No: the data is gone** | Nobody else can unlock them; that is the point. The setup screen says so plainly. |
| Guessing a weak passphrase from stolen browser files | Slowed | PBKDF2 makes every guess cost about half a second. A strong passphrase or a passkey is the real protection. |

## Keys

```
              ┌── passphrase ──────PBKDF2───▶ KEK ─┐
              ├── passkey ─────────PRF+HKDF─▶ KEK ─┤
user secret ──┼── recovery key ────HKDF─────▶ KEK ─┼──AES-KW──▶ wrapped data key (one per method, in the keyring)
              └── Google unlock* ──HKDF─────▶ KEK ─┘
                                                         data key ──AES-GCM──▶ every record

  * opt-in: the 32-byte key is kept by the sync server, given out after a fresh Google sign-in

  remembered device (#99):  device key (non-extractable, this device only) ──AES-GCM──▶ wrapped data key
```

- **Data key:** 256-bit AES-GCM key, made once per user (`crypto.subtle.generateKey`). It
  encrypts every record. It is never stored as-is: only wrapped.
- **Key-encryption keys (KEKs):** 256-bit AES-KW keys, one per way of unlocking, each wrapping its
  own copy of the data key (AES Key Wrap, RFC 3394, which also detects a wrong key).
  - **Passphrase:** PBKDF2-HMAC-SHA-256, **600,000 iterations** (OWASP's recommendation for
    PBKDF2-SHA-256 since 2023), a random 16-byte salt per passphrase. The passphrase is
    Unicode-normalised (NFC) first, so the same words typed on an iPhone and on Windows match.
    WebCrypto has no Argon2; PBKDF2 is what browsers offer without extra code.
  - **Passkey:** the WebAuthn **PRF extension** (Face ID, Touch ID, Windows Hello, security keys,
    where the browser and authenticator support it) gives a 32-byte secret for a random 32-byte
    salt we store; HKDF-SHA-256 turns it into the KEK. Offered only when the browser says it
    supports PRF (`isPrfSupported`); a passphrase is always possible.
  - **Recovery key:** 128 random bits shown once at setup; HKDF-SHA-256 turns them into the KEK.
    It already has full strength, so no slow function is needed.
  - **Google unlock** (#101, opt-in): 256 random bits the sync server keeps for the account and gives out
    only after a fresh Google sign-in; HKDF-SHA-256 (info `honed:v1:google`) turns them into the KEK. See
    "Google unlock" for what it costs.
- **A remembered device** (#99) also keeps the data key wrapped, by a device key that can't be read out of
  the page and never leaves the device. It isn't in the keyring. See "Remembering a device".
- **The keyring** is the list of wrapped copies, stored in the database's `meta` store (#16) and
  in backups (#18). Each entry records its method and every parameter used, so iterations or
  methods can change later without breaking old entries.
- **Changing how you unlock** (new passphrase, adding or removing a passkey, a new recovery key,
  turning Google unlock on or off) rewraps the same data key: no record is re-encrypted. Doing it needs
  the data key in a form that can be wrapped, so Settings asks for the current passphrase, recovery key,
  a passkey, or Google (when it's on) first,
  and only then holds an extractable copy for that one operation. For everyday use the data key is
  unwrapped as **non-extractable**: code in the page can use it but never read its bytes.
- **Replacing the data key itself** (re-encrypting everything) isn't needed for anything in
  milestone 3. It would be the answer to "my data key leaked", which the threat model doesn't
  cover while the page is safe.

## Records

- Each record's private part is encrypted with **AES-GCM**, a fresh random 96-bit IV every time
  (`crypto.getRandomValues`), and **additional data** `honed:v1:<store>:<id>`, so a ciphertext copied
  into another record's place fails to decrypt instead of showing the wrong card.
- Stored as `{ v: 1, iv, ct }` (bytes as `Uint8Array`; backups encode them as base64url).
- The plaintext is the JSON of the record's private fields. Random IVs are safe for far more
  records than anyone will write with one key (the limit is around four billion).
- **Files** (slide PDFs) are encrypted the same way but as raw bytes (`encryptBytes`), one record
  per deck, so the ciphertext is the file's size plus a 16-byte tag. Their page text is a separate
  sealed record, so listing decks never decrypts a whole PDF.

### What stays readable on disk

Only what IndexedDB's indexes need, so lists and the planner work without decrypting everything.
Milestone 4 (#24) added the lecture stores; #40 the question banks and quiz attempts; #47 the study
sessions and settings:

| Store | Readable | Encrypted |
| --- | --- | --- |
| courses (classes) | id | name, meeting days and times, term dates, dates |
| exams | id, courseId, date | title, kind, which lectures, dates |
| slideDecks | id, courseId | title, file name, page count, size, dates |
| deckFiles | id (the deck's) | the whole PDF |
| deckPages | id (the deck's) | the text of every page |
| lectures | id, courseId, date | minutes, dates |
| sections | id, courseId, lectureId, deckId, nextDue | page range, the rest of the schedule (budget, minutes studied, extra minutes), dates |
| questions (#40) | id, courseId, sectionId | the slide number, question, its form and level (#120), options and answer or a short answer's points, explanation, dates |
| quizAttempts (#40) | id, courseId, sectionId | when, every answer, the score; each answer's level and short answers to banked questions (what you typed, the mark and feedback; #120); for exam practice (#87) the exam and every short answer (the question, its points, what you typed, the mark and feedback) |
| studySessions (#47) | id, courseId, sectionId | which session (first week or extra), when, minutes spent |
| settings (#47) | id (`study`) | the daily study minutes, the Tasks page's class order (#72) |
| annotations (#56) | id, courseId, deckId | the page, the kind, where it is on the page, the words highlighted, the colour, the note, dates |
| materials (#120) | id, courseId | a class document's title, file name, kind (outline, past exam...), file type, page count, size, dates |
| materialFiles (#120) | id (the material's) | the whole file |
| materialPages (#120) | id (the material's) | its text, per page |
| examStyles (#120) | id (`style-` + the class's id) | the student's notes about the exam, the AI's exam style guide (what the exam tests, the three levels, the share of short answers), what it was made from, dates |
| changes (log) | seq, entity, entityId, op, at | the record data (file bytes are not in the log) |
| meta | device id, schema step, the keyring (already wrapped) | nothing else is secret |

Milestone 2's flashcard stores (decks, notes, cards, reviews) were removed in #26 (schema step 4,
which also deletes their change-log rows).

So someone with the browser's files could see *how many* classes, decks, lectures and sections
exist, how many questions, quiz attempts and study sessions each section has, on which dates lectures and exams
fall, and when sections are due, but not a word of the slides, the class names, the questions or
the scores. (A field may move from "readable" to "encrypted" if no
index needs it; it must not move the other way without changing this table first.)

## Bug reports (#141, proposed: needs Matt's OK)

The one other way data can leave the device, and only when the person does it on purpose: the **bug
button** (`public/bugreport.js`, the same file as Nathan's admin site's). It's off unless a browser opened
Honed with `?bugs=on` or turned it on in Settings. Pressing it draws a picture of the screen in the browser
(no outside service), shows it with a note box, and only **Save** sends the picture, the note, the page's
address, the device's screen size and browser, and the page's last errors to
`https://admin.pacificfish.ca/api/bugs` (so `connect-src` lists that address). That site is behind
Cloudflare Access and keeps reports only for its admins (Nathan); anyone else's report is refused there.
The picture can show whatever was on screen (slides, notes): that's the point, and why it's opt-in and per press.

## AI requests (#27, #34, #40)

AI is the one time data leaves the device. Everything else in this document is about data at rest.

- **What is sent:** only an AI job's inputs (`src/ai/backend.ts`): to make a section's questions,
  the text of its slides (never the PDF), the questions already in its bank and the class's exam style
  guide (#121); later, a selection or a question from the viewer, or short answers to grade (one, or a
  quiz's in one request). To make a class's exam style guide (#121): the class's name, the student's
  notes about the exam, the text of its materials (outlines, past exams; never the files) and a sample
  of its lectures' slide text, cut to fit (`src/ai/style.ts`), with the guide as it stands. Nothing is
  sent unless the user asks for that job ("Make questions").
- **Where to:** `/ai/` on our own site only (`connect-src 'self'`), over HTTPS. Cloudflare (its edge
  and Access) and the tunnel carry it to the helper on Nathan's server (`helper/`), which sends it
  to Anthropic through Claude Code, on the asking person's own subscription.
- **Who can use it:** only people the Cloudflare Access application allows (Matt and Nathan), and the
  helper checks the Access token itself as well.
- **What is kept:** nothing on the way. The helper logs counts and times, never content. Each run has
  a fresh home folder, deleted after, with Claude Code's session history off. Anthropic handles it under
  that person's Claude terms. What comes back (the questions) is stored on the device, sealed like
  every other record.
- **No AI when quizzing:** a multiple-choice quiz is graded on the device from the stored answer, so
  quizzes work offline and send nothing.

## How the store applies it (#16, `src/db/store.ts`)

- **Three states:** `'new'` (no keyring yet: records are plain, exactly as in milestone 2),
  `'locked'` (set up, key not given: everything refuses except reading the keyring and unlocking)
  and `'unlocked'` (every record written is sealed). The setup screen (#17) gates the app, so in
  practice nothing is written in `'new'` once it exists.
- **Setting up** saves the keyring, an encrypted check value (so `unlock` can tell a wrong key at
  once) and a "migration running" flag, then seals every plain record (every store, the
  change log included), in batches, and clears the flag. If the page closes half-way, the
  store opens `'locked'` and the next `unlock` finishes the job.
- **The keyring always keeps** at least one way to unlock (a passphrase, a passkey, or Google unlock,
  #101) and at least one recovery key; the store refuses changes that would break that. Keyring changes
  never rewrite a record.
- **Schema step 2** bumps the database version, so a milestone 2 tab still open elsewhere can't
  read sealed records as plain or write plain ones among them.

## Backups (#18, `src/backup/`)

A backup is the database as stored: **no record is decrypted to make one**, so a `.honed` file
holds nothing more readable than the browser's own files (the "What stays readable" table above).
It can sit in OneDrive, iCloud Drive or Google Drive.

```jsonc
{
  "format": "honed-backup", "v": 1,          // this file format; a newer v is refused ("update first")
  "createdAt": "2026-11-18T17:30:00.000Z",
  "schema": 2,                                 // the database's schema step when it was made
  "keyring":  { "v": 1, "entries": [...] },    // wrapped data keys only, as in meta
  "keycheck": { "v": 1, "iv": ..., "ct": ... },// as in meta: tells a wrong key at once
  "stores":   { "<store>": [ <row as stored, with its sealed `enc`> ], ... }
}
```

- **Every record store** (`RECORD_STORES` in `src/db/schema.ts`) is copied without naming them,
  so new stores join backups automatically. Not included: `deviceId` (each device keeps its own)
  and the `migration` flag (a backup is only made once setup's sealing has finished).
- **Bytes** (IVs, ciphertexts, wrapped keys, salts, credential ids) are written as
  `{"$bytes": "<base64url, no padding>"}` and read back as `Uint8Array`.
- **Making one** needs the store unlocked, and refuses if any record isn't sealed.
- **Restoring** never touches this device's data until the very end:
  1. The file's shape is checked (format, version, keyring, every row has an id and a sealed `enc`).
  2. The user unlocks the **backup's** keyring with the passphrase, passkey or recovery key they
     had when it was made.
  3. Every record is decrypted once with its own additional data (`honed:v1:<store>:<id>`), so a
     changed, swapped or truncated record fails here. The user sees what's inside and confirms.
  4. The store checks the key against the backup's key check, refuses plain records and newer
     schema steps, then replaces every record store, the keyring and the key check **in one
     IndexedDB transaction**: all or nothing. Afterwards the device unlocks with the backup's ways
     of unlocking.
- A backup from an **older schema step** restores the stores that still exist. A future schema
  step that changes record shapes must also handle older backups (or refuse them clearly).
- **Automatic folder backups** (Chrome and Edge on a computer) keep their folder handle and the
  last backup's time in a separate small database, `honed-backup-state`: nothing private, and a
  restore doesn't overwrite it.
- **Persistent storage:** `navigator.storage.persist()` is asked right after setup and after a
  restore; Settings shows the answer.

## Accounts and sync (v2, #93)

**Built so far:** sign-in, accounts and sessions (#95), remembering a device (#99), Google unlock (#101), and the
keyring on the server, changes and joining a device (#105: `src/db/sync.ts`, `src/sync/engine.ts`, Settings > Sync,
setup's "I already use Honed on another device") and slide files (#108). The testing phase runs on
Nathan's home server, for Matt,
Nathan and a few testers. Every piece is kept easy to move to Cloudflare (Workers, R2, D1) if Honed goes
public. Sync is **opt-in**: a device that never signs in keeps working exactly as today.

### The rule: signing in never unlocks

Google sign-in tells our server **which account** a device belongs to. It never opens the data. The data
key is still opened only by a passkey, passphrase or recovery key, on the device, as in "Keys". So the
server, Google, or anyone who takes either over gets ciphertext and wrapped keys, nothing they can open.
The model is 1Password's, Bitwarden's and Proton's: one sign-in for the account, a separate secret for
the vault. **The one exception is opt-in:** someone who turns on Google unlock lets a Google sign-in open
their data ("Google unlock").

### What the sync server holds, and what it can see

| Held | Readable by the server | Sealed (it has no key) |
| --- | --- | --- |
| Account | Google account id (`sub`), email, when it was made, last sign-in | — |
| Sessions | a SHA-256 hash of each session token, its device label, its times | — |
| The keyring and key check | the methods (passphrase, passkey, recovery key) and their parameters (salts, iterations, credential ids), a version number | the wrapped data keys (useless without the user's secret) |
| Changes | a server sequence number, the change id, size, upload time, and the hints below | everything about the record |
| Files (slide PDFs, their page text) | the deck id, size, upload time | the whole file |
| Google unlock key (#101, only for accounts that turned it on) | **the key itself**: it opens that account's data, so the server could too. When and on which signed-in device it was given out | — |

**Hints:** each change also carries `entity`, `entityId`, `op` and `at` in the clear, as the local change
log does today, so the server could later keep only each record's latest change. They show *how many*
classes, lectures and quizzes there are and *when* things changed: the same as a backup file shows (the
"What stays readable" table). **Devices never trust the hints:** every field a device acts on is inside
the ciphertext, and a change whose hints disagree with its sealed copy is refused.

Not protected: the server can **withhold** changes, serve old ones or delete everything (it can't read,
forge or alter them). Devices keep their own full copy, so the worst case is sync stopping, never data
lost from a device. Ciphertext also sits in the server's snapshots and its backup copy (14 days, then
gone) after a deletion.

### Signing in (Google, OpenID Connect)

- The sync server (`honed-sync`, on our own site at `/api/`, so `connect-src 'self'` doesn't change) does
  the **authorization code flow with PKCE**, asking only for `openid email`, which needs no review by
  Google. Our own code with Node's own modules, as decided in #93: no hosted sign-in service.
- It checks Google's ID token itself: the signature (Google's published keys, cached), the issuer, the
  audience (our client id), the expiry, and a `nonce` and `state` it made for that sign-in, so a token
  meant for another site, an old one or a forged one is refused. `email_verified` must be true.
- The account is keyed by Google's `sub`, never the email (an email can change hands).
- **Testing phase:** only emails on the server's allow list (`ALLOWED_EMAILS`, like the admin site's
  `ADMIN_EMAILS`) can make an account. Everyone else gets "Honed sync is invite-only for now".
- The Google client secret lives in a file on the server, made by Nathan; no Claude ever reads it, and
  it's never in the repo or the image.

### Sessions

- A session is 32 random bytes in a cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/`. The
  page's code can't read it. The server stores only its SHA-256 hash, so a stolen database holds no
  usable sessions.
- It lasts **30 days** from its last use, and **180 days** at most. Settings lists the account's
  devices; any one can be signed out there, or all of them.
- Every request that changes something must be a `POST`, `PUT` or `DELETE` with JSON and an `Origin` of
  our own site, or it's refused (no cross-site request can act as the user).
- **Deleting the account** needs a Google sign-in from the last 5 minutes, then removes the account,
  its sessions, keyring, changes and files at once.

### The keyring on the server

- The account's keyring and key check are what this device already has in `meta`: wrapped copies of
  one data key. The **first device** to turn sync on uploads them.
- **The key check never changes:** the data key is made once and only rewrapped (see "Keys"), so the
  key check stays the same for the account's life. The server refuses a keyring upload with a
  different key check, and so does every device. A stolen session can therefore never swap in a key
  someone else holds; the most it could do is break unlocking, which the device would refuse.
- A keyring change (a new passphrase, a passkey added or removed, a new recovery key) uploads the new
  keyring with the version it replaced (compare and swap, so two devices can't overwrite each other's
  change). Other devices take the new one the next time they sync, and use it the next time they
  unlock.
- A passkey made on one device unlocks on another only where the passkey itself syncs (iCloud
  Keychain, Google Password Manager) and the browser supports PRF. A passphrase or the recovery key
  always works.

### Changes

- Sync carries the change log (`changes`, "How the store applies it"). For upload a change is
  **sealed again** with additional data `honed:v1:sync:<change id>`, with *everything* inside: the
  entity, its id, the operation, the time, the device and the record. The local sealed rows can't be
  sent as they are, because their additional data covers only the store and the id, not the readable
  fields beside it.
- Changes are only ever added. The server numbers them in arrival order; a device asks for "everything
  after number N" and remembers the last number it applied. The same change id twice is stored once.
- **The first device** uploads the **current state** (one `put` per record), not its whole history. A
  device that already syncs uploads its new changes as it makes them, and waits and retries when
  offline.
- Applying a change from another device writes the record through the store as usual (sealed with this
  device's readable fields worked out again, never taken from the hints), but doesn't log it as a new
  change of this device.
- **Conflicts:** quiz attempts and study sessions are only ever added, so they never clash. For
  everything else the later `at` wins, and the device id breaks ties. Each device's clock is kept
  moving forward past every change it has seen (each new `at` is later than the latest it applied), so
  an edit made after seeing another device's edit always wins over it, even with a clock that's
  slightly off. A delete is a change like any other, so a deleted record doesn't come back from another
  device.
- **Sync runs only while unlocked:** applying changes needs the data key.

### Files (slide PDFs) (built in #108)

- A deck's PDF and its page text are uploaded once, sealed exactly as they're stored locally
  (`deckFiles`, `deckPages`: their additional data covers the whole content, so nothing is decrypted to
  send them), and downloaded only when a device opens that deck. There's no button: the store fetches a
  missing file when a screen asks for it (`setFileSource`), opens it with this device's key (a file sealed
  with another key, or changed, is refused and not kept), and keeps it as it came.
- On the wire: raw bytes, `1` (the version), the 12-byte IV, the ciphertext. The server keeps them as files
  (`files/<account>/<deck>.<pdf|pages>`), written whole or not at all.
- A deck's files leave the server when a `slideDeck` delete arrives (the hint is all the server reads; at
  worst a wrong one removes the account's own copy, which a device that has the deck sends again), and all of
  an account's when the account is deleted.
- A device never sends back a deck it fetched (`syncFiles` in its `meta`).
- Limits in the testing phase: 100 MB a file (Cloudflare's upload limit and Honed's PDF limit) and
  5 GB an account.

### Joining a device

1. Sign in with Google. The server sends the account's keyring and key check; the device still can't
   read anything.
2. Unlock with the account's passphrase, recovery key, or a passkey that's synced to this device.
3. The device downloads every change and applies it.

A device that **already has its own data** under a different key is asked to choose: replace this
device's data with the account's (the restore warning, since this device's data goes), or don't sync
this device. Merging two separately made sets of data (decrypting one and re-adding it under the
account's key) is possible, but left for later.

### Remembering a device (#97, built in #99)

So Honed opens straight in instead of asking for a passkey every time (Nathan, Nov 20: "sign in the first
time, save that log in after that").

- **What it is:** after a device is unlocked once (passkey, passphrase or recovery key), it keeps the data
  key for next time, wrapped by a **device key**: a random 256-bit AES-GCM key made on the device with
  `extractable: false` and stored as a `CryptoKey` in this device's IndexedDB (`meta`, key `remembered`:
  the device key plus the data key wrapped by it, with its IV; `RememberedKey` in `src/types/crypto.ts`,
  `rememberKey`/`recallKey` in `src/lib/crypto.ts`). Opening Honed unwraps it and unlocks with no
  prompt; if it fails (damaged, or for another key after a restore elsewhere) it is forgotten and the
  unlock screen asks. The store accepts one only if it opens the key check, and a backup restore
  forgets it. The key used day to day is the one unwrapped from it, never extractable. Making it needs the data key in wrappable form once, so it happens right at unlock, while the
  unlock secret has just been given (as "Changing how you unlock" says).
- **Never leaves the device:** not in the keyring, not synced, not in backups (backups copy only the
  record stores and the keyring), never sent anywhere. The server can't read any more than before.
- **On by default**, with "Don't remember on this device" at unlock for a shared or school computer
  (see the public-computer mode in the plans).
- **Forgetting:** **Lock** forgets it (the next open asks again), and so does Settings > This device >
  "Forget the unlock on this device". When sync exists, a device that learns its session was signed out
  from another device (the devices list) forgets it too, the next time it's online.
- **What it costs:** while a device remembers, Honed's encryption no longer protects against someone using
  that device's unlocked computer account, or copying its browser files: browsers keep a
  non-extractable key's bytes in their own files, so it stops page code reading them, not a copy of the
  profile. That's how every app that stays signed in works; the device's own lock and disk encryption are
  the protection. A device that doesn't remember keeps today's protection.

### Google unlock (opt-in, #97, built in #101)

For people who'd rather never type a passphrase or use a passkey: their Google account can unlock Honed
on a new device. **Off unless the person turns it on, and for them "signing in never unlocks" no longer
holds.**

- **How:** turning it on (in Settings, on an unlocked device, after confirming with the current
  passphrase, passkey or recovery key like any change to how you unlock) makes a random 256-bit **Google
  unlock key**, gives it to the sync server, which stores it with the account, and adds a keyring entry,
  method `google`, wrapping the data key with it (AES-KW, as the other methods).
- **Built before sync (#101)**, because it already replaces the passkey on a device that has its data: the
  unlock screen's **Unlock with Google** asks the server for the key (`GET /api/unlock-key`); without a
  Google sign-in in the last 5 minutes it goes to Google and back (`/#/google-unlock`) and tries again
  once. Setup offers **Use your Google account** (sign in, then the key wraps the new data key; the recovery
  key is still made). "Prove it's you" in Settings accepts it too. The server makes one key per account
  (`POST`), deletes it on `DELETE`, and lists uses at `/api/unlock-uses`. The `google` entry's
  key-encryption key is HKDF-SHA-256 of the account's key (info `honed:v1:google`), as for the recovery key.
- **A new device:** sign in with Google; the device gets the keyring (sync, step 2); it asks the server for the
  Google unlock key, which the server gives only to a session whose Google sign-in was in the last 5
  minutes; the device unwraps the data key and (by default) remembers it as above.
- **What it costs:** our server holds both the key and (with sync) the encrypted data, so the server, or
  anyone who takes it over, could read that person's classes, slides and scores, and so could anyone who
  takes over their Google account. It's the standard iCloud or Google Drive model, chosen per person.
  Settings says this plainly before turning it on, and the person's promise reads "Your data is
  encrypted, and your Google account can unlock it" instead of "Only you can read it".
- **Visible:** the server records each time the Google unlock key is given out (when and to which signed-in
  device, never the key), and Settings shows it ("Unlocked with Google on Safari on iPhone, Nov 21").
- **Turning it off** removes the `google` keyring entry and the server deletes its key. The data key
  itself doesn't change, so whatever the server could read before stays readable to anyone who copied
  that key while it was on; changing the data key (re-encrypting everything) would be the fix, and isn't
  planned yet. Settings says so.
- **The keyring rule becomes:** at least one way to unlock (passphrase, passkey, or Google unlock) and
  always a recovery key, so losing the Google account never means losing the data.

### Turning sync off

Settings > Sync: **sign out on this device** (the data stays here, sync stops), or **delete the account
from the server** (every device keeps its own copy).

## Recovery key format

- 16 random bytes (128 bits), plus a 4-byte check (the first 4 bytes of the secret's SHA-256):
  20 bytes, written as **32 characters of Crockford base32 in 8 groups of 4**,
  e.g. `7K2M-QX9D-…`.
- Typing is forgiving: case doesn't matter, spaces and dashes are ignored, and I, L and O read as
  1, 1 and 0. A typo is caught by the check (it fails one time in four billion) before any
  unlocking is tried, so the screen can say "that's not quite right" at once.

## Errors

Every failure is a `CryptoError` with a `code` the screens can turn into words:
`'wrong-secret'` (the passphrase, recovery key or passkey doesn't unlock this keyring),
`'invalid'` (badly formed input, such as a recovery key failing its check), `'corrupt'` (a record
or keyring entry that won't decrypt or parse), `'unsupported'` (the browser lacks something, such
as PRF).

## Where it lives

| File | What |
| --- | --- |
| `src/types/crypto.ts` | The shared types: keyring entries, encrypted records, `CryptoError` |
| `src/lib/crypto.ts` | Pure WebCrypto functions (tested in Node, which has the same WebCrypto) |
| `src/lib/passkey.ts` | WebAuthn: create a passkey with PRF, get its PRF output, feature detection |
| `src/db/` (#16) | Uses them to encrypt records and keep the keyring |
| `src/ui/` (#17) | Setup, unlock, recovery, Settings |
| `src/backup/` (#18) | The `.honed` file format, making and restoring backups (see "Backups") |
| `sync/` (v2) | The sync server, `honed-sync` (see "Accounts and sync"): Google sign-in, accounts and sessions (#95: `google.mjs`, `app.mjs`, `db.mjs`), Google unlock keys and their uses (#101, schema step 2), the keyring and sealed changes (#105, schema step 3), slide files (#108, schema step 4, kept in `files/`); tests in `tests/sync/` |
| `src/db/sync.ts` (#105) | The store's side of sync: sealing for the server, opening and checking what comes back, applying it (the later change wins), the sync state, joining |
| `src/sync/engine.ts`, `SyncRunner.tsx`, `SyncSettings.tsx`, `JoinUnlock.tsx` (#105) | The engine (keyring, up, down), running it while unlocked, Settings > Sync, unlocking the account's keyring to join |
| `src/sync/` | The app's side: `client.ts` (the server's routes), Settings' Account box (#95) and Google unlock (#101, `GoogleUnlockSettings.tsx`) |
| `src/ui/UnlockScreen.tsx`, `SetupScreen.tsx`, `ThisDevice.tsx` | Remembering a device (#99) and Unlock with Google / Use your Google account (#101) |
