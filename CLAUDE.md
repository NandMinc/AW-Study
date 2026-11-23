# Honed (repo: AW-Study)

Spaced repetition for lecture content, built by Matt and Nathan, each working with Claude Code on
their own PC. This file is shared: both Claudes follow it. Keep personal notes in your own Claude
memory, not here. The full design is `docs/DESIGN.md`. Read it before any feature work, and update it
in the same PR when a decision changes.

## Working together (two Claudes on two machines)

Matt's Claude and Nathan's Claude run on different machines and accounts and **cannot message each
other**. GitHub is the shared channel. Each human relays only when something needs a person.

**At the start of every session**, before any work:
1. `git switch main && git pull`.
2. Read `docs/PROGRESS.md` (the status board: who is doing what, decisions, gotchas).
3. `gh issue list --label agent-task` and `gh pr list`: open tasks and work in progress. Read the
   comments on any issue you're involved in: the other Claude may have asked you something.

**Taking a task:**
- Work only on a task that has an issue labelled `agent-task`. No issue yet? Make one first
  (what, which files, done when).
- **Claim it only with `node tools/claim-task.mjs <issue> "what you'll do"`**, never by writing "taking
  this" yourself (#133: twice on Nov 22 a task was claimed minutes after the other Claude had it, and once
  built twice). The script reads the comments and assignees and refuses if the other Claude holds it,
  assigns it to you and posts the claim, then backs off if you both claimed at once (the earlier claim
  wins). If it refuses, pick another task or ask on the issue. `--check <issue>` shows who holds one;
  `--release <issue> "why"` lets yours go. `gh issue list --label agent-task` shows who has each.
- Branch, and open a **draft PR** at once with `Closes #<issue>`, so `gh pr list` shows the
  work is in progress.
- Only edit the files your task owns (its row in `docs/PROGRESS.md`). Need a change elsewhere,
  especially to the shared contract `src/types/lecture.ts`? Ask in the issue first.

**Talking to the other Claude:** comment on the task's issue (or the PR), signed `[Matt's Claude]`
or `[Nathan's Claude]`. Write so it makes sense to a reader with no other context: what you
need, which file, why. Don't `@`-mention people unless a human must act (it notifies them).

**Finishing:** update your row and add a log line in `docs/PROGRESS.md` in the same PR. Note any
decision there and in `docs/DESIGN.md`, and any trap you hit under "Gotchas". Mark the PR ready,
wait for green CI on the latest commit, then merge it (`gh pr merge <n> --merge --delete-branch`):
both Claudes have standing permission to merge any PR (see Git below). If you can't finish, say
in the issue exactly where you stopped and what's left.

**Before pushing more to a PR,** check it's still open (`gh pr view <n> --json state`): a
merged PR ignores later pushes.

## The product in one paragraph

**Redesigned Nov 18 (read `docs/DESIGN.md`; the flashcard design is history).** A local-first PWA
built around **lectures**: you add classes (days, times, length, exam dates), and after each lecture
the slides (PDF) and the range covered, which becomes a **section**. A planner fits sections into
your daily study minutes (a lecture's length is its first-week budget) and shows today's checklist
with a **Play** button. A study session shows the original slides in a built-in viewer (PDF.js,
with notes and highlights), then a **multiple-choice quiz** from a per-section question bank made
by AI. The score sets when the section comes back, the next quiz's size, and any extra study time
in later days (never an immediate re-study). Everything is stored encrypted on the device. AI runs
as Claude Code in a locked-down helper on Nathan's home server, on Matt's and Nathan's own
subscriptions. Flashcards and FSRS card scheduling are out for now.

## Stack and commands

TypeScript, React 19, Vite 8 (with vite-plugin-pwa), Vitest, Playwright. Node 24+.

| Command | What it does |
| --- | --- |
| `npm install` then `npx playwright install chromium webkit` | First-time setup |
| `npm run dev` | Dev server with live reload (no service worker in dev) |
| `npm test` | Everything: unit tests, type check, build, browser tests (desktop, Android, iPhone) |
| `npm run test:unit` | Vitest only (`src/**/*.test.ts`, `tests/**/*.test.mjs`), under a second |
| `npm run build` then `npm run serve` | The production build on http://127.0.0.1:8091 with the real headers |
| `npm run icons` | Redraw the PNG icons from `public/icons/icon.svg` |

## Layout

- `src/brand.ts`: the app's name (**Honed**, a working name). Every user-visible name comes from
  here: never type the name anywhere else. The repo, npm package and image stay `aw-study`.
- `src/`: the app. Pure logic in `src/lib/` with a `*.test.ts` beside each file.
- `src/types/quiz.ts`: the quiz contract (`Question`, `QuizAttempt`, `QuizStore`); same rules.
- `src/types/lecture.ts`: the shared contract (classes, exams, slide decks, lectures, sections and
  `LectureStore`); plain JSON types, changed only in their own PR, announced in the task issues.
  The flashcard design (decks, notes, cards, FSRS, cloze) was removed in #26; it's in git history.
- `src/lib/crypto.ts`, `src/lib/passkey.ts`, `src/types/crypto.ts`: encryption, exactly as
  `docs/SECURITY.md` describes. Change SECURITY.md first, in its own PR, then the code.
- `src/db/`: storage. `schema.ts` (IndexedDB stores, numbered migrations, sealed record shapes),
  `lectures.ts` (the `LectureStore` methods: classes, exams, slide decks, lectures, sections),
  `quiz.ts` (the `QuizStore` methods: question banks quiz attempts, #40) and
  `plan.ts` (the `PlanStore` methods: study sessions and settings, #47) and
  `store.ts` (the `StudyStore` the screens call, including lock/unlock and the keyring; the
  only code that touches the database). Read the top of `store.ts` before changing it: records are
  sealed (encrypted) per `docs/SECURITY.md`, and every write is read, compute, encrypt, then
  write, inside `exclusive()`.
- `src/viewer/`: the PDF slide viewer (`SlideViewer`, `extractPageText` in `pdf.ts`), on PDF.js's
  legacy build; its data files are served at `/pdfjs/` (`vite.config.ts`). `/viewer-demo.html`
  shows it alone. Test PDFs are generated by `src/viewer/test-pdf.ts` (no real slides).
  `AnnotatedViewer` (#56) adds notes and highlights, Explain this and Ask about this on top of it,
  knowing nothing of storage; `geometry.ts` turns screen positions into fractions of the page.
  `src/ui/DeckSlides.tsx` joins it to the store and the AI (the Slides and Play screens use it).
- `src/types/annotation.ts` and `src/db/annotations.ts` (#56): notes and highlights, per deck page.
- `src/ai/`: the app's side of AI. `AiBackend` (every AI job goes through it, and `status()`, the
  helper's `/ai/whoami` for Settings' sign-in check), `HttpAiBackend`
  (our helper at `/ai/`), `FakeAiBackend` (tests and development), `check.ts` (replies are
  checked on the device before use) and `style.ts` (what the exam style job is sent, cut to fit; #121).
- `src/ui/`: the screens (React). `route.ts` (hash routes, no router library), `store-context.ts`
  (the store reaches screens through React context). Three main pages behind `NavBar` (#68): `TasksScreen`
  (`#/`, the home page: today's checklist), `ClassesScreen` (`#/classes`: a heading and `ClassMenu` per class, a date button per lecture to fill in,
  from `unfilledLectures` in `classes.ts`) and `SettingsScreen`; every other
  screen is full-screen, without the bar, and has a back link. A class's page opens at a part
  (`#/class/<id>/exams` and so on, from the menu) or at "What was covered?" for a date
  (`#/class/<id>/cover/<date>`, from a date button). Classes (#26): `ClassesScreen`,
  `ClassScreen`, `ClassEditor`, `ExamEditor`, `LectureForm` ("What was covered?"), `SlidesScreen`
  (the viewer, loaded lazily with PDF.js), `pdf-file.ts` (reading a picked PDF) and `classes.ts`
  (pure helpers with tests: lecture times, the latest lecture, labels). `ExamStyleSection` (#122: a class's
  documents, notes and exam style guide; the guide's upkeep is `src/quiz/guide.ts`). Quizzes (#40): `QuizScreen` (making
  the bank, the quiz, loaded lazily), `ai-context.ts` (the `AiBackend` the screens use: `HttpAiBackend`).
  `MathText` (quiz text with LaTeX between `\(` `\)` or `\[` `\]`, drawn by KaTeX with `trust: false`; never
  `renderToString` into HTML, whose inline styles the CSP blocks; fonts must not be inlined).
  `update.ts` (when a new version may reload the page: only when locked and idle; never mid-unlock or
  while unlocked, where a banner offers Reload and Lock applies it).
  `bank-jobs.tsx` (making question banks in the background after "What was covered?"; held by App).
  `CompareModels` (the same slides to Haiku, Sonnet and Opus, side by side; the helper allows only those
  three by name; opened from Settings through `#/class/<id>/quiz/<sectionId>/compare`). `AiSettings` (#79):
  Settings' AI sign-in check and Compare models. Planner (#47): `TasksScreen` (#77: today by class from `src/plan/tasks.ts`, the saved order by
  dragging, the progress bar, Start; `Penguin` when there's nothing; the daily minutes are in Settings), `PlayScreen`
  (`#/play`: each item's session with its timer, the quiz offered at 80%, then the quiz), `planning.ts`
  (loads what the planner needs and the names to show). `PracticeScreen` (#87, `#/practice/<examId>`: exam
  practice, short answers written and marked by AI; its pure parts in `src/quiz/practice.ts`).
- `src/plan/`: the planner (#47), pure, with tests: `planner.ts` works out today's checklist from the
  lectures, study sessions and quiz attempts every time (nothing it works out is stored); `rules.ts` holds
  the numbers (days 1/3/7, the score table) in one place, to tune.
- `src/quiz/`: quiz logic with tests: `bank.ts` (the bank's size, the AI requests, saving as they arrive) and
  `pick.ts` (which questions a quiz asks, option order, the score text). Browser tests answer `/ai/` themselves
  (`tests/browsers/quiz.spec.ts`, service workers off there), so they never spend usage. Forms use `noValidate` and
  show our own messages; no `<select>` (WebKit's pulls in a stylesheet the CSP blocks). `ConfirmDialog` (never `confirm()`), `settings.ts` (day
  start 4 a.m.).
- `docs/PROGRESS.md`: the status board. `docs/DESIGN.md`: the design. `docs/design/`: how the app looks
  (`screens.png` and its README: colours, the nav bar, the Tasks and Classes pages, the restyle's order).
- The look (#68): colours are CSS variables in `src/app.css`, dark and light (`--accent` green for text and
  outlines, `--fill`/`--on-fill` for green behind things); never a colour typed into a screen.
  `src/ui/theme.ts` (Phone / Light / Dark, a device setting in localStorage, applied before the first
  draw); the Lexend font is bundled (`@fontsource-variable/lexend`), never fetched from another site.
- `helper/`: the AI helper (milestone 6), its own image `ghcr.io/nandminc/aw-study-ai`: a Node
  server (its own modules only) that checks the Cloudflare Access token, picks the person's own
  Claude Code token and runs `claude -p` with no tools (`helper/claude.mjs`). Tests in
  `tests/helper/` with a fake `claude`; never a real token in tests or CI.
- `sync/` (#95): the sync server, its own image `ghcr.io/nandminc/aw-study-sync` (Node's own modules, `node:sqlite`), at `/api/`:
  Google sign-in (`google.mjs`), accounts and sessions (`app.mjs`, `db.mjs`, numbered schema steps). Tests in `tests/sync/`
  with a fake Google; never real Google credentials in tests or CI. The app's side is `src/sync/` (Settings' Account box).
  Design: `docs/SECURITY.md`, "Accounts and sync". The service worker must leave `/api/` to the network.
  Sync (#105): `src/db/sync.ts` (the store's side: seal for the server, open and check, apply with the later change
  winning, the sync state in `meta`), `src/sync/engine.ts` (keyring, up, down; never sees the data key),
  `SyncRunner` (while unlocked), `SyncSettings`, `JoinUnlock`. Tests: `src/db/sync.test.ts`,
  `tests/sync/engine.test.mjs` (the real server over HTTP), `tests/browsers/sync.spec.ts` (two browsers through it).
- `server/`: the production server (Node's own modules only): serves `dist/`, `/healthz`, and every
  security header (`server/headers.mjs`).
- `tests/server.test.mjs`: the server. `tests/browsers/`: Playwright against the built app. Browser tests
  import `test` and `expect` from `tests/browsers/fixtures.ts`, not '@playwright/test' (it keeps WebKit pages
  drawing under load, #81).
- `.github/workflows/publish.yml`: tests every PR and push; on `main` publishes
  `ghcr.io/nandminc/aw-study:main` (and `-ai`, `-sync`), which the home server deploys when someone
  presses Update. Tests run side by side (`unit`, `browsers` in 4 shards); images are built alongside
  and `publish` moves `:main` after the tests pass; a merge of an already-tested PR skips the tests
  (`gate`, #112). A new test file needs nothing: the shards split whatever Playwright finds.

## Rules

**Git**
- Never push to `main`. Work on a branch, open a PR, wait for the green check, then merge it.
  **Either Claude may merge any PR, its own or the other's**, once CI is green on its latest
  commit and the work is finished (Nathan, Nov 18: "permission to merge ANYTHING ... Same goes for
  Matt's claude"). Merging someone else's PR? Say so in a comment first, and if it needs `main`
  merged in or a small fix, push it to their branch and tell them to pull before continuing.
  Review is optional: ask for one when you want a second look, and always before changing the
  shared contract (`src/types/`) or files another open task owns. Small PRs, merged often.
- Line endings are LF everywhere (`.gitattributes`); don't fight it.

**Tests**
- Every rule gets a test, and you prove the test fails without the rule before trusting it (break
  the code on purpose, watch it fail, put it back).
- Never fix a flaky test by rerunning until green: find the cause.
- Tests must not depend on today's date or the machine's time zone: pass dates and zones in.
- Keep the WebKit (iPhone) project: it catches what Chromium doesn't.

**Privacy and security**
- No user data leaves the device except the inputs of AI jobs (slide text, selections, answers to
  grade), sent only to our own AI helper at `/ai/`, never stored on the way. Tests must check it.
- Nothing loaded from other sites at runtime: no CDNs, fonts, analytics or scripts. Libraries are
  npm packages bundled by Vite. Each new dependency is agreed in its PR.
- The Content-Security-Policy in `server/headers.mjs` stays strict: no `unsafe-inline`, no
  `unsafe-eval`. The AI helper is on the same site (`/ai/`), so `connect-src 'self'` stays as it
  is. No inline `<script>` or `<style>`, and no `style=` in HTML.
- Never commit API keys, `.env` files, real lecture slides or databases. Test data comes from
  public material (e.g. MIT OpenCourseWare).
- Encryption uses WebCrypto building blocks only (AES-GCM, PRF/PBKDF2 for keys). No home-made crypto.

**The schedule** (DESIGN, "Planning the day")
1. Only quiz answers move a section's schedule, never time spent looking at slides.
2. Quiz attempts and study sessions are only ever added to, never edited: they are the history the
   schedule learns from.
3. A low score adds study time in later days; it never sends the user back into the slides on the
   spot.
4. The planner never plans more than the daily minutes, except before an exam, and then says so.
5. The tuning numbers (score table, day 1/3/7, 80% point, questions per slide) live in one settings
   file, so they can change without touching the logic.

**AI**
- Every AI job (make questions, grade a short answer, explain, ask) goes through the `AiBackend`
  interface; tests use a fake backend, so CI never spends usage or sends data.
- Multiple-choice quizzes are graded on the device and need no AI at quiz time (the question bank
  is made earlier).
- The AI helper on the server (milestone 6) runs Claude Code headless with **all tools off**, fixed
  prompts per job, no logging of content, limits per person, in an isolated container. Its tokens
  are created and installed by Matt and Nathan themselves, never by a Claude.
- Questions must be checked before use: four options, one right answer among them, a slide number.

**File types**
- Honed reads PDFs and plain text today. Whenever a new file type comes up (a user's file, a request, a
  design), add it to "File types to support" in `docs/DESIGN.md` with where it came up. Don't build
  support for it until it's been worked through there (Nathan, Nov 22).

## Hosting

The home server runs the image as a TrueNAS app (named when the server side is added), with its
port on 127.0.0.1 behind a Cloudflare Tunnel. Nathan handles the server side.
After merging to `main`, wait for the publish run to finish before pressing Update.
