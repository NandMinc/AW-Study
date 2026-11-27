# Progress

The shared status board for everyone working on Honed: Matt, Nathan and each one's Claude Code.
**Read it at the start of every session. Update it in every PR** (your task's row, and a line in the
log). The design is in `DESIGN.md`; how we work together is in `../CLAUDE.md` ("Working together").

## Now (updated Nov 23, 2026)

Milestones 3 to 9 are **done** (8, first run and after-class prompts: #129, #136; 9, exams: #86, #87). The restyle
is finished, and so are accounts and sync (#93-#108). Now: **exam style and question levels** (DESIGN, #117): steps
1-4 are **done** (#120, #121, #122, #123); the last is the quiz screen's short answers, #124.

Milestone 3, **Lock it down** (done): encryption, the recovery key, persistent storage, backup and
restore, in the GitHub milestone "M3: Lock it down".

| Task | Issue | Who | Files it owns | Status |
| --- | --- | --- | --- | --- |
| Encryption design and crypto core | #15 | Nathan's Claude | `docs/SECURITY.md`, `src/types/crypto.ts`, `src/lib/crypto.ts`, `src/lib/passkey.ts` | **Done** (PR #20 contract, PR #22 implementation) |
| Encrypted storage: records encrypted, migration of M2 data, lock/unlock | #16 | Nathan's Claude | `src/db/` | **Done** (PR #23) |
| Setup and unlock screens, recovery key, settings | #17 | Matt's Claude | `src/ui/`, `src/App.tsx`, `src/main.tsx` | **Done** (PR #21). Passkeys still to try by hand on an iPhone after deploy |
| Persistent storage, backup and restore | #18 | Matt's Claude | `src/backup/`, the backup part of Settings, backup methods in `src/db/store.ts` | **Done** (PR #31) |

Milestone 2 (#5, #6, #7) is done: see the log.

### Next: the redesign (Nov 18)

**Matt and Nathan redesigned the app** around lectures, slides and AI quizzes (`docs/DESIGN.md`,
rewritten). Milestone 3 continues unchanged. The new work, in GitHub milestones "M4: Classes and
slides" and "M6: AI helper and quizzes":

| Task | Issue | Who | Files it owns | Status |
| --- | --- | --- | --- | --- |
| Contract and storage: classes, exams, decks, lectures, sections | #24 | Nathan's Claude | `src/types/lecture.ts`, `src/db/`, SECURITY.md's table | **Done** (contract PR #29, storage PR #30) |
| PDF slide viewer component | #25 | Matt's Claude | `src/viewer/`, `viewer-demo.html`, the PDF.js part of `vite.config.ts` | **Done** (PR #32) |
| Class and lecture screens; remove the flashcard layer | #26 | Nathan's Claude | `src/ui/` (not #17's screens), routes, old flashcard files | **Done** (screens PR #36, removal PR #37) |
| AI helper on the server | #27 | Matt's Claude | `helper/`, `tests/helper/`, its CI job | **Done and live** (PR #33; server set up Nov 18, Matt's token still to add) |
| AiBackend in the app (client for `/ai/`, and a fake) | #34 | Matt's Claude | `src/ai/` | **Done** (PR #35) |
| Quizzes: question banks and multiple-choice quizzes (app side) | #40 | Nathan's Claude | `src/types/quiz.ts`, `src/db/quiz.ts`, `src/quiz/`, quiz screens in `src/ui/` | **Done** (contract #41, storage #42, screens #43); scores move the schedule with milestone 5 |
| Planner and today's checklist with Play (milestone 5) | #47 | Nathan's Claude | `src/types/plan.ts`, `src/db/plan.ts`, `src/plan/`, Today and session screens, the home route | **Done** (contract #48, storage and planner #49, screens #50) |
| Viewer tools: highlights, notes, Explain this, Ask about this (milestone 7) | #56 | Matt's Claude | `src/types/annotation.ts`, `src/db/annotations.ts` (and its wiring in `schema.ts`, `store.ts`, the delete cascades in `lectures.ts`), `src/viewer/`, the viewer props in the Slides, Play and Quiz screens | **Done** (contract and storage PR #57, viewer tools PR #58). Try on an iPhone after deploy |
| First-week quizzes: 10 questions, scaled by the section's slides (restyle step 6) | #70 | Nathan's Claude | `src/plan/rules.ts`, `src/plan/planner.ts`, `src/quiz/pick.ts`, one line of `src/ui/PlayScreen.tsx` | **Done** (PR #71) |
| Tasks page logic: grouped by class, saved order, statuses, progress (restyle step 2, no screen) | #72 | Nathan's Claude | `src/types/plan.ts` (`StudySettings`), the settings part of `src/db/plan.ts`, new `src/plan/tasks.ts` | Contract and storage (PR #73) and the logic (`src/plan/tasks.ts`, PR #74) **done**; the screen next (#68 is in) |
| Restyle step 1: colours (dark and light), Phone / Light / Dark setting, the Lexend font, the nav bar, the Tasks, Classes and Settings pages | #68 | Matt's Claude | `src/app.css` (colours, buttons, nav bar), `src/ui/theme.ts`, `src/ui/NavBar.tsx`, `src/ui/TasksScreen.tsx`, the routes, the frame in `src/App.tsx`, the theme part of Settings, `tests/browsers/look.spec.ts` | **Done** (PR #69). Steps 2 to 5 are free |
| Restyle step 2: the Tasks page screen (rows by class, drag, ticks, penguin) | #77 | Nathan's Claude | `src/ui/TasksScreen.tsx`, `src/ui/Penguin.tsx`, `src/ui/planning.ts`, which items Play runs in `src/ui/PlayScreen.tsx`, the daily minutes in Settings, the Tasks styles | **Done** (PR #78) |
| Layout fixes from Nathan's iPhone: main page titles, long file names | #84 | Nathan's Claude | the title, class-name and `.choices` rules in `src/app.css`, `className` on the three main pages' `h2`, the deck button text in `LectureForm.tsx`, `tests/browsers/layout.spec.ts` | **Done** (PR #85) |
| Restyle step 3: the Classes page (a heading and menu per class, date buttons for lectures to fill in, a round +) | #75 | Matt's Claude | `src/ui/ClassesScreen.tsx`, `src/ui/ClassMenu.tsx`, `unfilledLectures` and `shortDate` in `src/ui/classes.ts`, the class routes' part and date, opening at them in `ClassScreen.tsx`, the Classes styles in `src/app.css` | **Done** (PR #76) |
| Restyle step 4: Settings on one page (AI sign-in check, Compare models) | #79 | Matt's Claude | `src/ui/AiSettings.tsx`, `status()` in `src/ai/` (backend, http, fake, tests), one line of `SettingsScreen.tsx`, the quiz route's `/compare` and its prop in `QuizScreen.tsx`, `tests/browsers/settings.spec.ts` | **Done** (PR #80). Daily minutes came to Settings with #78 |
| Restyle step 5: the other screens to match (setup, unlock, a class's page, What was covered?, the viewer, quizzes, Play) | #82 | Matt's Claude | the step 5 block at the end of `src/app.css`, `className="back"` on the back links | **Done** (PR #83). The restyle is finished |
| Milestone 9a: exams pull their sections forward (planner) | #86 | Matt's Claude | the exam rules in `src/plan/planner.ts` (+ `RULES.examPullDays`, `examQuizzes`), `PlanInput.exams`, `Plan.examsOver` (through `tasks.ts`), loading exams in `planning.ts`, the note on `TasksScreen.tsx` | **Done** (PR #88) |
| Milestone 9b: exam practice with AI-graded short answers | #87 | Matt's Claude | the contract (`WrittenAnswer`, `examId`, `written`), `recordQuizAttempt`, `describeScore`; `practiceFor` and `Plan.practice` in the planner; `src/quiz/practice.ts`, `src/ui/PracticeScreen.tsx`, the practice route, `TasksDay.practice` in `src/plan/tasks.ts`, the practice row in `TasksScreen.tsx`, `tests/browsers/practice.spec.ts` | **Done** (helper PR #89, contract PR #114, planner PR #118, screen PR #125). Try on a real phone after deploy |
| Viewer: fit width for portrait pages (documents saved as PDF) | #46 | Nathan's Claude | `src/viewer/SlideViewer.tsx`, `viewer.css`, new `fit.ts` + `fit.test.ts`, the page size in `test-pdf.ts`, `tests/browsers/viewer.spec.ts` | **Done** (this PR). Try on a real phone after deploy |
| Accounts and sync (v2), testing phase on the home server: **design first** | #93 | Nathan's Claude | `docs/SECURITY.md` ("Accounts and sync"), the accounts lines in `docs/DESIGN.md` | **Done** (design merged; built in #95, #105, #108) |
| Sync step 1: the `honed-sync` server's Google sign-in and accounts, Settings' Account box | #95 | Nathan's Claude | `sync/`, `tests/sync/`, the `sync-image` CI job, `/api/` in `vite.config.ts` and `app.spec.ts`, `src/sync/`, one line of `SettingsScreen.tsx`, `tests/browsers/account.spec.ts` | **Done** (this PR). Live once Nathan sets up the server side (Google client, dataset, app, tunnel route) |
| Remember this device, and opt-in Google unlock: **design first** | #97 | Nathan's Claude | `docs/SECURITY.md` ("Remembering a device", "Google unlock", the threat table), a line of `docs/DESIGN.md` | **Done** (design merged; built in #99, #101) |
| Remember this device: unlock once, then open straight in | #99 | Nathan's Claude | `RememberedKey` in `src/types/crypto.ts`, `rememberKey`/`recallKey` in `src/lib/crypto.ts`, `getRemembered`/`remember`/`forget` in `src/db/store.ts` and `src/ui/vault.ts`, `openKey` in `src/ui/keys.ts`, the unlock and setup screens, Lock in `src/App.tsx`, `src/ui/ThisDevice.tsx` (Settings), the test helpers (unticked by default) | **Done** (this PR). Try on a real phone after deploy |
| Google unlock: a Google sign-in opens Honed instead of a passkey (opt-in) | #101 | Nathan's Claude | `sync/` (schema step 2, `/api/unlock-key`, `/api/unlock-uses`), the `google` keyring method (`src/types/crypto.ts`, `wrapWithGoogleKey` in `src/lib/crypto.ts`, the keyring rule in `src/db/store.ts`), `src/sync/client.ts`, `src/sync/GoogleUnlockSettings.tsx`, the unlock and setup screens, ProveItsYou, `src/App.tsx` (the return addresses) | **Done** (this PR). Needs both images deployed (honed-sync and site-honed) |
| Sync step 2: classes, lectures, quizzes and notes between devices | #105 | Nathan's Claude | server: `sync/` (schema step 3, `/api/keyring`, `/api/changes`), `tests/sync/`; app: `src/db/store.ts` and `schema.ts` (step 8: change-log indexes), `src/sync/`, Settings and setup | **Done** (server PR #106, app this PR). Slide PDFs are step 3 |
| Sync step 3: slide PDFs on demand | #108 | Nathan's Claude | `sync/` (schema step 4, `/api/files/`), `getSlideDeckFile`/`Pages` in `src/db/lectures.ts`, `src/db/sync.ts`, `src/sync/engine.ts`, `SyncRunner.tsx`, tests | **Done** (PR #109) |
| Phone slide page: just the slides | #110 | Nathan's Claude | `src/App.tsx`, `src/ui/SlidesScreen.tsx`, `src/viewer/SlideViewer.tsx`, `src/app.css`, `src/viewer/viewer.css`, tests | **Done** (this PR) |
| CI: tests side by side, no second run on main, images built alongside | #112 | Nathan's Claude | `.github/workflows/publish.yml`, its line in `CLAUDE.md` | **Done** (this PR) |
| AI questions stand on their own (no "this diagram"), with worked problems | #115 | Nathan's Claude | the question prompts and `refersToUnseen` in `helper/jobs.mjs`, `tests/helper/helper.test.mjs`, a line of `docs/DESIGN.md` | **Done** (this PR). Live once `honed-ai` is updated; banks made before keep their old questions |
| Design: exam style guide per class, question levels, short answers in quizzes | #117 | Nathan's Claude | `docs/DESIGN.md` ("Exam style and question levels", the Quizzes decision, two open questions) | **Done** (PR #119, Matt's OK); built in #120-#124. Scores weighted by level; "File types to support" list (Nathan, Nov 22) |
| Exam style 1: contract and storage | #120 | Nathan's Claude | new `src/types/style.ts`; `Level`, `ChoiceQuestion`/`ShortQuestion`, `ShortAnswer`, the weighted score in `src/types/quiz.ts`; `src/db/quiz.ts` (forms, levels, short answers, weighted score); `pickQuiz` multiple choice only for now; then the materials and guide storage in `src/db/` and sync | Contract and quiz storage **done** (PR #126); materials and guide storage **this PR** (schema step 9, `src/db/style.ts`, sync incl. the sync server) |
| Claiming tasks only with `tools/claim-task.mjs` | #133 | Nathan's Claude | `tools/claim-task.mjs`, `tests/claim-task.test.mjs`, "Taking a task" in `CLAUDE.md` | **Done** (PR #134, Matt's OK) |
| Exam style 2: helper jobs (`style`, `grade-many`, levels and forms in `questions`) | #121 | Matt's Claude | `helper/jobs.mjs`, `tests/helper/`, `src/ai/` (backend, http, fake, check, new `style.ts`), the filter in `CompareModels.tsx` | **Done** (PR #127). **The helper changed: press Update for `honed-ai`** |
| Exam style 3: the class page's Exam style (documents, notes, the guide) | #122 | Matt's Claude | new `src/ui/ExamStyleSection.tsx`, `src/quiz/guide.ts`, `readMaterialFile` in `src/ui/pdf-file.ts`, the `style` part in `route.ts` and `ClassMenu.tsx`, its place in `ClassScreen.tsx`, the exam style styles, `tests/browsers/exam-style.spec.ts` | **Done** (PR #130) |
| Exam style 4: bank, picking and planner by level | #123 | Nathan's Claude | new `src/quiz/levels.ts` (+ test), `RULES.levels`, `src/quiz/bank.ts`, `src/quiz/pick.ts`, the stage and timing in `src/plan/planner.ts` and `tasks.ts`, the stage in `PlayScreen`/`QuizScreen`, the guide before questions in `bank-jobs.tsx`/`QuizScreen`, `answerStyle` in `tests/browsers/fixtures.ts`, `tests/browsers/levels.spec.ts` | **Done** (PR #135) |
| Exam style 5: short answers in quizzes | #124 | Nathan's Claude | `RULES.levels.shortAnswers` on, `pickQuiz`'s short answers, new `src/quiz/start.ts` (+ test), the `Quiz` component in `QuizScreen.tsx` (typed answers, marking at the end), `describeScore`'s weighted percentage, `PlayScreen`, `tests/browsers/short-answers.spec.ts` | **Done** (this PR) |
| After-class reminder: a popup when Honed opens links to the lecture to fill in | #129 | Matt's Claude | new `src/ui/AfterClass.tsx` and `src/ui/after-class.ts` (+ tests), its place in `src/App.tsx`, `tests/browsers/after-class.spec.ts` | **Done** (PR #132). Try on a real phone after deploy |
| First-run tutorial: a short tour, then Getting started on Tasks | #136 | Matt's Claude | new `src/ui/GettingStarted.tsx` and `src/ui/getting-started.ts` (+ tests), `start` in `planning.ts`, its place in `TasksScreen.tsx`, `#/tour` and `#/classes/new` (`route.ts`, `App.tsx`, `ClassesScreen.tsx`), Help in `SettingsScreen.tsx`, the `storageState` in `playwright.config.ts`, `tests/browsers/first-run.spec.ts` | **Done** (PR #137). Milestone 8 is done |
| Animate the site, step 1: the nav bar's pill slides, buttons fill in on hover and press | #143 | Matt's Claude | `NavBar.tsx` (the pill, `data-at`), the nav bar styles in `src/app.css`, the pill tests in `tests/browsers/look.spec.ts`, the nav bar part of `docs/design/README.md` | **Done** (PR #144). Later steps get their own issues |
| Nav bar: hover rings the icon, the pill moves only with the page | #147 | Matt's Claude | the nav bar styles in `src/app.css`, the pill tests in `tests/browsers/look.spec.ts`, the nav bar part of `docs/design/README.md` | **Done** (PR #148) |
| Animate the site, step 2: page transitions | #149 | Matt's Claude | new `src/ui/page-motion.ts` (+ test), the screen's wrapper and `usePageMotion` in `src/App.tsx`, the page transition styles in `src/app.css`, reduced motion by default in `playwright.config.ts`, `tests/browsers/motion.spec.ts`, the motion part of `docs/design/README.md` | **Done** (PR #150) |
| Animate the site, step 3: ticking off a task | #153 | Matt's Claude | new `src/ui/tick-memory.ts` (+ test), `fresh` on `Tick` in `src/ui/TasksScreen.tsx`, the tick styles in `src/app.css`, the tick tests in `tests/browsers/motion.spec.ts`, the Tasks part of `docs/design/README.md` | **Done** (PR #154) |
| UI design reference (`docs/design/`): the Tasks and Classes screens, colours, nav bar | #66 | Nathan's Claude | `docs/design/` | **Done** (this PR). The restyle follows in its own issues, in the README's order |
| Design: read pictures at upload, and choose models by difficulty (reading and quizzes) | #151 | Nathan's Claude | `docs/DESIGN.md` ("Reading pictures and choosing models", a line of "Decisions so far") | **Done** (PR #152, Matt's OK). Built in its own issues, in the design's build order |
| Reading pictures, step 1: model test (Haiku vs Sonnet vs Opus on real pages) | #155 | Nathan's Claude | new `tools/read-pages/` (the tool and the reading prompt), `tests/read-pages.test.mjs`, "Model test results" in `docs/DESIGN.md` | **Done** (this PR): a handout, a chemistry textbook and a statistics textbook |
| Reading pictures, step 2: sort pages on the device, page fingerprints | #157 | Nathan's Claude | new `src/reading/` (`sort.ts`, `scan.ts`, tests, `calibrate.test.ts` skipped without real PDFs), optional `drawing`/`picture`/`noBar` in `src/viewer/test-pdf.ts` | **Done** (this PR). Not wired in yet: the queue (step 4) calls it |

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Skeleton: installable offline PWA, server, tests, CI | **Done** (#2, #3). Live at https://honed.pacificfish.ca |
| 2 | Study by hand (flashcards, FSRS) | **Done**, then **superseded** by the Nov 18 redesign; **removed** (PR #37) |
| 3 | Lock it down: encryption, recovery key, persistent storage, backup and restore | **Done** (#15-#18); passkeys not yet tried on a real iPhone |
| 4 | Classes and slides: classes, exams, PDFs, the viewer, lectures and sections | **Done** (#24-#26); not yet tried on a real phone |
| 5 | Planner and the daily checklist with Play | **Done** (#47); exams pulling sections forward come with 9 |
| 6 | AI helper and quizzes | **Helper live** (#27); question banks and quizzes **done** (#40); scores moving the schedule waits for 5 |
| 7 | Viewer tools: highlights, notes, explain, ask | **Done** (#56); not yet tried on a real phone |
| 8 | First run (tutorial) and after-class prompts | **Done** (#129, #136); not yet tried on a real phone |
| 9 | Exams: pulling forward, practice tests with AI-graded short answers | **Done** (#86, #87); not yet tried on a real phone |

## Live

https://honed.pacificfish.ca runs whatever `main` was when someone last pressed **Update from
GitHub** at apps.pacificfish.ca (Matt and Nathan both have the button). After merging, wait for
the "Test and publish" run on `main` to finish, then press Update.

## Decisions (newest first)

- **Nov 22: Exam style and question levels** (Nathan, #117, design): each class keeps an AI-written exam style guide from
  its slides, uploaded materials and the student's notes; questions get levels 1-3; well-known sections get easy questions,
  new ones exam-style ones; regular quizzes may include short answers (at most two sentences), AI-marked in one request.
- **Nov 22: Questions stand on their own** (Nathan, #115): an expert on the subject who has never seen the slides must be able
  to score perfectly. Questions never refer to the slides, the lecture or a picture (the AI only gets slide text, never
  the pictures), and include worked problems ("Solve ...", wrong options = common mistakes) where the material allows.
- **Nov 19: The look** (Matt and Nathan): `docs/design/` is the reference for how the app looks and behaves.
  Dark grey `#272727`, white `#f2f5f1`, green `#9fe870`, plus a light mode; three main pages (Tasks,
  Classes, Settings) behind a nav bar; Tasks grouped by class in a saved order; no times shown. First-week
  quizzes default to 10 questions (later ones still follow the score table).
- **Nov 18: Redesign** (Matt and Nathan). FSRS and flashcards were a reference, not the product.
  Honed is built around **lectures**: classes, PDF slides studied in a built-in viewer, and AI
  multiple-choice quizzes whose scores schedule each section (a low score adds study time later,
  never an immediate re-study). Data stays on the device. AI is Claude Code in a locked-down helper
  on Nathan's server, on Matt's and Nathan's own subscriptions. PDF only for now; flashcards out.
  Everything in `docs/DESIGN.md`; the flashcard code goes in #26.

- **Nov 18 (#15):** Encryption, as written in `docs/SECURITY.md`: one random AES-GCM data key
  encrypts every record's private part (fresh random IV, additional data
  `honed:v1:<store>:<id>`); it is stored only wrapped (AES-KW) under a passphrase (PBKDF2-SHA-256,
  600,000 iterations), a passkey (WebAuthn PRF + HKDF) and a recovery key (128 bits + a 4-byte
  check, 8 groups of 4 Crockford base32 characters; HKDF). Ids, links and due/review times stay
  readable for the indexes. Changing how you unlock rewraps the same key.

- **Nov 18:** Merging widened (Nathan): **either Claude may merge any PR**, its own or the
  other's, once CI is green on the latest commit. Say so on the PR first; if it needs `main`
  merged in or a small fix, push to that branch and tell its owner to pull.
- **Nov 18:** Review rule changed (Matt and Nathan): the PR's author merges once CI is green.
  Review is optional: ask for one when wanted, and before changing the shared contract or files
  another open task owns.
- **Nov 18:** The repo moved from EassunKim/AW-Study to the **NandMinc** organisation
  (github.com/NandMinc/AW-Study; Matt and Nathan are admins). The image follows the repo's name:
  `ghcr.io/nandminc/aw-study`. Update your clone: `git remote set-url origin
  https://github.com/NandMinc/AW-Study.git`.
- **Nov 18:** Matt's and Nathan's Claudes coordinate through GitHub: one issue per task (label
  `agent-task`), a draft PR as soon as work starts, this file updated in every PR. They can't
  message each other directly (different accounts and machines).
- **Nov 18:** Notes and cards are separate, as in Anki: a note is what you write, a card is what
  you review. A basic note makes one card, a cloze note one per cloze number ("siblings").
- **Nov 18 (replaces the SQLite decision below):** Storage is **IndexedDB** through `idb` (ISC,
  ~1 KB, no dependencies); tests use `fake-indexeddb` (Apache-2.0). The #6 spike showed SQLite on
  OPFS working in Chromium, but **Playwright's WebKit has no working OPFS at all**
  (`navigator.storage.getDirectory()` fails with "UnknownError", on Windows and on Linux in CI,
  with a throwaway or a saved profile), so its iPhone behaviour could never be tested. IndexedDB
  works in every engine, needs no worker or 860 KB WebAssembly download, and suits per-record
  encryption in milestone 3. `@sqlite.org/sqlite-wasm` is removed.
- **Nov 18:** FSRS through **ts-fsrs 6** (MIT). Storage: **SQLite** (`@sqlite.org/sqlite-wasm`,
  Apache-2.0) in a Web Worker on OPFS (`opfs-sahpool`). To be confirmed by the #6 spike in WebKit;
  IndexedDB is the fallback. *(Storage part replaced, see above.)*
- **Nov 17:** Licence: proprietary, all rights reserved (Matt, #4).
- **Nov 17:** Name: **Honed** (working name), only in `src/brand.ts`. The repo, package and image
  stay `aw-study`.
- **Nov 17:** Stack: TypeScript, React, Vite, Vitest, Playwright. Ships as a small image like
  Nathan's chess site.
- **Nov 17:** Local-first: users' data stays encrypted on their own devices; the server only serves
  the app. v2 adds end-to-end encrypted sync.

## Log (newest first)

- **Nov 26 (#157):** Reading pictures, step 2: sorting pages on the device. `scanPages` draws pages 300 px wide and calls a
  page *pictures* when over 0.15% is drawn outside its text and the deck's template (logos and bars on most pages), *text*
  or *blank* otherwise; vector graphs count. Calibrated on the three real PDFs (text pages measure 0; small graphs and
  formulas 0.28-0.42%, so a first 0.4% cutoff missed two). Fingerprints are exact (text + drawing SHA-256): a near-match
  rule wasn't safe. 18 tests; 5 deliberate breaks, all caught.
- **Nov 26 (#155):** Reading pictures, step 1: the model test. `tools/read-pages/run.mjs` draws PDF pages and compares
  models on the reading prompt (`reading.mjs`, with `parseReading` and `needsStrongerModel`, tests in
  `tests/read-pages.test.mjs`; 4 deliberate breaks, all caught). Findings (DESIGN.md "Model test results"): `claude -p`
  takes images with every tool off; Haiku is enough for pictures of text, Sonnet is needed for chemistry and matches
  Opus; route by the page's kinds of content, since "unsure" meant "chemistry"; reading costs about 3× the first estimate
  (a page image is ~1,950 tokens). Graphs (a statistics textbook): Haiku reads simple charts right but is loose on detail,
  so graphs stay with Sonnet; they and line-drawn tables are vector drawings, not images, which step 2 must handle.
- **Nov 26 (#151, design, Matt's OK):** Reading pictures. Two real files showed the AI misses what isn't text: a
  handout whose definitions are pictures of text, and an organic chemistry textbook whose structures and arrows are
  drawings. Design: pages sorted on the device, picture pages read once by Claude when added (Haiku first, Sonnet for about
  1 in 4, Nathan's choice), the descriptions stored encrypted with the slide text; quizzes by difficulty too (Haiku; Sonnet
  for hard pages, level 3 and questions that fail a blind check). Estimated ~$7-12 a student a month on the API (Opus
  everywhere ~$50). First step when it's agreed: a side-by-side model test. **Workflow agreed by Matt and Nathan the same
  day:** batch the reading and the questions once pages are marked covered (the device sends only those pages, with a
  "needed by" time; two rounds, a third if time allows; anything late runs straight away); results locked to the
  account with a results key pair; Explain on an unread page reads it at once (kept by page fingerprint); a greyed quiz
  button that says when the quiz will be ready; batches simulated on our subscriptions until there are other users.
- **Nov 26 (#153):** Ticking off a task. Back on Tasks after a quiz, each tick done since the page was last shown (a
  lecture's Quiz done, a class's Done, Practice done) draws its stroke in with a small pop (`pathLength="1"` and
  `stroke-dashoffset`, 0.45 s). `src/ui/tick-memory.ts` remembers which ticks were seen, in memory only, per study
  day. The first look after the app opens, or at a new day's start, seeds it, so nothing draws then. Seen ticks stay
  still, and with reduced motion nothing moves. 9 deliberate breaks, all caught.
- **Nov 26 (#149):** Page transitions. A new screen slides in 1.5rem and fades in over 0.24 s, from the side it comes
  from (`src/ui/page-motion.ts`). Between Tasks, Classes and Settings it follows the nav bar's order. Going deeper (a
  class, then What was covered?, the slides, a quiz, practice or Play) comes from the right, going back from the left,
  and the same depth fades. A change within one screen (a class's part, a quiz's comparison) doesn't move, and neither
  does the first screen after unlocking. Enter only: there's no exit animation, so a click is never held up. The
  header, footer and nav bar stay put. With reduced motion nothing moves. **Browser tests now default to reduced
  motion** (`playwright.config.ts`): see Gotchas. 8 deliberate breaks, all caught.

- **Nov 26 (#147):** From Matt on desktop: the pill following the mouse looked odd. Now it stays under the page you're
  on and slides only when the page changes (a click or tap). Hovering another icon draws a green ring around it
  (`box-shadow`, inside `@media (hover: hover)`), never on the current page. Focus and press no longer move it either.
  4 deliberate breaks, all caught.
- **Nov 26 (#145):** Docs only. Nathan and Matt's starting list of file types is in DESIGN.md's "File types to
  support": main information (Google Slides, Google Docs, `.docx`, `.pptx`, `.pdf`, `.txt`, `.md`) and supplemental
  information (`.jpg`, `.png`, `.svg`, code files), each with what works today and its open questions. Not a commitment
  to build every one; no solutions chosen.
- **Nov 26 (#143):** Animating the site begins (Matt). The nav bar's green pill is now one element behind the three
  buttons. It slides (0.3 s) to the button under the mouse and back when the mouse leaves, to a focused or pressed
  button, and to the new page. The button under it turns dark grey, and a press shrinks it a little. Hover counts
  only with a mouse (`@media (hover: hover)`): a tap on a phone would leave the pill stuck on a page you didn't
  open. With reduced motion (`prefers-reduced-motion`) nothing slides. CSS only, placed by `data-at` and `:has`:
  no `style=` (CSP). It slides between pages because the bar stays the same element (`App.tsx` renders one
  `NavBar`): giving it a `key` per page would break that, and the test checks for it.

- **Nov 23 (#141, agreed by Matt):** The bug button from Nathan's other apps: off unless `?bugs=on` or Settings'
  switch; a picture of the screen and a note, sent to `https://bugs.pacificfish.ca/api/bugs` (Nathan's admin server behind
  its own Access application: Matt and Nathan can send, only Nathan's admin site reads them, each with who sent it). The
  first send from a browser offers "Sign in to send". Changes two rules for this button only: `connect-src` gains
  `https://bugs.pacificfish.ca`, and SECURITY.md gets a "Bug reports" exception.
- **Nov 22 (#124):** Short answers in quizzes. Banks get them (the guide's share of level 3); a quiz whose bank has them first
  checks the helper's whoami (no AI used, 5 s at most) and otherwise goes multiple choice only with a note saying why; typed
  answers (no instant feedback) are marked in one `grade-many` request at the end, a blank one 0 and never sent; the results show
  each mark, its feedback and a full answer's points; a failed marking offers Try marking again or Save without them, never a
  made-up mark. Also: the results' percentage is now the weighted score (`describeScore(right, asked, score)`; since #120 it had
  still shown the plain one). Exam practice is unchanged. 9 deliberate breaks, all caught. **The exam style plan (#117) is built.**
- **Nov 23 (#136):** **The first run.** After setup, a three-card tour of the main ideas (once, for someone with no
  classes; again from Settings > Help), then **Getting started** on Tasks: add a class, add what a lecture covered,
  do a first study session or quiz, each ticking itself from the data and linking to where to do it, gone when all
  are done or skipped. Every other browser test starts as if the tour was seen and the checklist skipped
  (`storageState` in `playwright.config.ts`; `first-run.spec.ts` starts without), as the helpers untick "Remember
  this device": otherwise the tour would stand in front of every test. 14 deliberate breaks, all caught.
  **Milestone 8 is done** (with #129).
- **Nov 23 (#139):** Fixed a flaky test, `quiz.spec.ts` "locking stops the background work". Since #123, making
  questions asks `/ai/style` before `/ai/questions`, and the test locked as soon as it saw "Making quiz questions":
  under load that was still the guide step, so no questions request was ever sent and the test waited for one forever.
  It now waits for the questions request before locking, with `/ai/style` slowed in the test so that path always runs
  (with the slow step and no wait it failed every time; with the wait, 12 of 12 on all three devices).

- **Nov 22 (#123):** Quizzes by level. A section's stage (new: first week or last score under 70%; known: last two 90%+ and no
  exam-style question missed in the last; exam: in an exam's run-up; learning otherwise) sets each quiz's levels
  (`RULES.levels.stageShares`), a known quiz always has one exam-style question (the anchor), a level short of questions borrows from
  the nearest, and the plan's quiz minutes are by level (20 s / 45 s / 2 min: a known quiz of 3 is 4 min, a new one of 10 is 13, a
  15-question first quiz after the first week 21). Banks hold levels 1-3 as 25/35/40% and ask only for what each level lacks.
  Making questions brings the guide up to date first and sends it; a failed guide never blocks questions. Browser tests get a
  default `/ai/style` answer (`answerStyle` in fixtures.ts). Planner tests' minutes updated to the new times (one budget raised from
  30 to 35 to keep its point). 11 deliberate breaks, all caught (two only after making them compile: a build that fails leaves the
  old build in place, so a browser break must build).
- **Nov 22 (#129):** **After-class reminder.** When Honed opens or comes back into view on Tasks, Classes or Settings,
  a popup lists lectures that have ended in the last 7 days since the class was added and aren't filled in, each
  linking to its "What was covered?". Later, Escape or a tap outside puts them off until tomorrow (localStorage);
  following a link counts as seen. Not about lectures from before a class was added: those are the Classes page's
  date buttons, and popping them up at once would greet every new class with its past week. WebKit caught Escape
  being lost (see Gotchas). 15 deliberate breaks, all caught.

- **Nov 22 (#133):** Claims go through `tools/claim-task.mjs` (reads comments and assignees, refuses if held, assigns and posts,
  backs off on a simultaneous claim; `--check`, `--release`). Why: Nathan's Claude claimed #121 and #122 minutes after Matt's
  Claude without reading the comments, and built #122 a second time (#131). Nathan's PC also has a Claude Code hook that blocks
  posting "taking this" by hand. 6 deliberate breaks, all caught.
- **Nov 22 (#122):** A class's **Exam style** on its page (and in the Classes page's menu): documents (PDF or text,
  each a past exam, outline, practice set or other), notes about the exam, and the guide (read, edit, Remake).
  The guide is made only when the student acts (Write the guide, Remake, or changing the documents or notes
  there): opening the page sends nothing, it only says when the guide is out of date (`src/quiz/guide.ts`;
  `refreshGuide` brings it up to date when #123 makes questions). A first version made it on opening the page;
  78 browser tests failed on the unanswered `/ai/style`, which showed it broke SECURITY.md's "nothing is sent
  unless asked for". Browser tests check that opening sends nothing, and that the documents' text and the notes
  go only to `/ai/style`. 19 deliberate breaks, all caught.
- **Nov 22 (#129):** New task: an after-class reminder when Honed opens (Matt). This answers DESIGN's open
  question "After-class prompts" for now: ask when the app is opened, not by push.

- **Nov 22 (#121):** The AI helper's exam style jobs. `questions` takes the class's guide and a `mix` (how many
  at each level, and how many short answers). Every question now comes back with its level (2 when the AI gives
  none), and short ones with their points. New `grade-many` marks a quiz's short answers in one request, all
  or nothing; new `style` writes a class's guide. On the device: `checkQuestions` (with the mix),
  `checkGradeMany`, `checkStyle`, and `styleRequest` (`src/ai/style.ts`), which fits notes, materials and
  slides into the helper's limits. Nothing calls the new jobs yet (#122-#124). 42 deliberate breaks, all
  caught. **Press Update for `honed-ai`.**

- **Nov 22 (#120, part 2):** Exam style storage. Schema step 9: `materials`, `materialFiles` (raw bytes, like `deckFiles`),
  `materialPages`, `examStyles` (one per class, under `examStyleId` = `style-<class id>`, not the class's own id: sync finds a
  record's latest change by id alone, so sharing it made the class's and its style's changes overrule each other). `src/db/style.ts`
  (`ExamStyleStore`); a text file's text is read from the file itself. Deleting a class takes its materials, files and style. Sync: the
  new entities, material files over `/api/files/` like decks; the **sync server** accepts them and deletes a material's files with it
  (**deploy honed-sync before site-honed**). Also fixed: a device's change times now always move forward (at least 1 ms each), so two
  edits of one record in the same millisecond no longer reach other devices as a tie that kept the first. 13 deliberate breaks, all caught.
- **Nov 22 (#87, part 5):** **Exam practice** is built. On the 2 days before an exam, Tasks has a practice row
  that opens `#/practice/<examId>`. The AI writes a short-answer question for each section (`written`); the
  multiple choice comes from the banks. No feedback until the end, then the AI marks the short answers (`grade`;
  a blank one is 0 and never sent), one attempt per section is saved, and the results show every answer. When
  writing fails, the practice can go on with the multiple choice alone; when marking fails, it can be tried again
  or saved without the unmarked ones, which don't count. Never a made-up mark. A browser test checks the typed
  answer goes only to `/ai/grade`. 16 deliberate breaks, all caught. **Milestone 9 is done.**

- **Nov 22 (#120, part 1):** Exam style contract. `src/types/style.ts` (materials, notes, the guide, `ExamStyleStore`; storage next).
  Questions have `form` (`choice` | `short`) and `level` 1-3; older ones read as choice, level 2 (`withDefaults`, `isChoice`). Attempts
  record each answer's level and short answers to banked questions; `score` is weighted by level (exam practice's written answers
  count as level 3; `right` stays a plain count). `pickQuiz` asks multiple choice only until #124.
- **Nov 22 (#87, part 4):** The planner offers **exam practice** on the 2 days before an exam (`practiceFor`,
  `Plan.practice`, `RULES.examPracticeDays` and `examPractice`), until a practice for it is saved in those days.
  It covers up to 10 of the exam's sections, the weakest, in lecture order, with 2 multiple-choice and 1
  short-answer question each. It's kept out of `today`, whose items each belong to one section, so the Tasks and
  Play screens are unchanged until the practice screen. 16 deliberate breaks, all caught.

- **Nov 22 (#117):** Design for exam style guides, question levels and short answers in quizzes (DESIGN, "Exam style and
  question levels"). Nothing built yet; five build steps listed there.
- **Nov 22 (#115):** Both question prompts (`questions`, `written`) gain the stand-on-its-own rule and worked problems. The helper
  drops any question (or option) that still points at unseen material ("this diagram", "according to the slide", "slide 4",
  "shown above"; narrow, so "the periodic table" and "the image of 2 under f" pass) before trimming to the count, and retries
  only when none are left. Each check proven to fail without its rule.
- **Nov 22 (#87, part 3):** Exam practice's contract (contract change, agreed in #87). `QuizAttempt` gains
  `examId` and `written` (`WrittenAnswer`: the AI's question, its 1-6 points, the slide, what was typed, the
  mark, the feedback), both optional, so older attempts read unchanged and sync carries them as before. A
  short answer counts as one question worth mark ÷ points; `right` is rounded to 2 places, and
  `describeScore` shows it to one ("7.7 of 10 right"). The store checks the exam is the class's, each short
  answer's slide, mark (a whole number in range) and lengths, and takes an attempt of only short answers.
  20 deliberate breaks, all caught.

- **Nov 22 (#112):** **CI is faster.** The unit tests and the browser tests (4 shards) run side by side, and the three images are built and checked alongside them, pushed under the commit only; a `publish` job moves the three `:main` tags once the tests passed. A push to main that merges a PR with exactly the same files, whose run passed, skips the tests (the `gate` job). The same change on Nathan's chess repo took a PR run from ~210 s to 98 s and the main run from ~200 s to 53 s. Local `npm test` is unchanged.

- **Nov 21 (#110):** **Slides on a phone are just the slides.** After using synced slides on his iPhone, Nathan found the bar cluttered and jumpy ("This section" turning into the longer "Outside this section" pushed zoom, Whole page and Notes onto another row). On touch screens the Slides page now drops the header, footer, step and zoom buttons and the section label: one line with the back link and Whole page / Notes, then the slides and thumbnails. The computer keeps everything; its section label keeps one width. Tests: a new one on all three devices; phones' older tests use thumbnails and keys; 7 deliberate breaks caught.

- **Nov 21 (#108):** **Slide PDFs sync.** A deck's PDF and page text go up once, sealed as stored (nothing decrypted); a device
  fetches them only when it opens the deck (the store asks the sync server for a missing file, opens it with its key, refuses
  one sealed with another key, keeps it), so the viewer, Play and quizzes work unchanged. The server keeps them as files
  (written whole or not at all), removes a deck's when its delete arrives and an account's when it's deleted; 100 MB a file,
  5 GB an account. Tests: server (4 new), engine through the real server (3 new), browsers (a deck added on the PC opens in
  the phone's viewer, all three devices); 8 deliberate breaks caught.

- **Nov 20 (#105, part 2):** **Sync between devices** built: Settings > Sync (turn on, last synced, Sync now, turn off), setup's
  "I already use Honed on another device" (sign in with Google, unlock the account's keyring with Google unlock, a synced
  passkey, the passphrase or the recovery key, download everything), and a device with its own data is asked before it's
  replaced. The store applies other devices' changes (the later `at` wins, the device id breaks ties, deletes stay deleted, a
  change arrives once, hints that disagree are refused), its change clock moves past what it applied, and schema step 8 indexes
  the change log by change and record id. Sync runs while unlocked: at once, every 30 s, on coming back into view or online.
  Slide PDFs stay where they were added (a synced deck says so). Tests: store (11), the engine through the real server (6), and two
  browsers syncing through it (2, all three devices); 10 deliberate breaks caught (one, re-downloading from the start, needed a
  new check: it wastes data but changes nothing visible).

- **Nov 20 (#105, part 1):** The sync server stores the account's keyring (compare and swap; a different key check is refused) and
  an append-only list of sealed changes (each id once, in arrival order, numbers may skip; 500 a batch, 1 MB a change, 200 MB an
  account in testing). 6 new server tests; 7 deliberate breaks caught. No device uses it yet.

- **Nov 20 (#103):** Docs: SECURITY.md's intro (an "In short"), key diagram, threat table, keyring rule, the server's holdings and
  "Where it lives" brought up to date with #95, #99 and #101; the README has a Privacy section and a current status.

- **Nov 20 (#101):** **Google unlock** built (opt-in; docs/SECURITY.md "Google unlock"), ahead of sync because it already
  replaces the passkey: Settings turns it on (prove it's you, the plain warning), the unlock screen's Unlock with Google
  (signs in again when the last Google sign-in is over 5 minutes old, and comes back by itself), setup's Use your Google
  account, Prove it's you with Google. The keyring rule is now one of passphrase, passkey or Google, plus always a recovery
  key, so passkeys can be removed. Server: one key per account, given out only after a fresh sign-in, each use recorded.
  12 deliberate breaks, all caught. A new device still needs sync (step 2) to get its data.

- **Nov 20 (#99):** **Remember this device** built: ticked by default at setup and unlock, so Honed opens straight in after
  the first unlock; Lock and Settings > This device > Forget make it ask again; a damaged remembered unlock is forgotten and
  the screen asks. Tests: the remembered key and the session key are never extractable, the store checks a remembered
  unlock against the key check, backups never hold it and a restore forgets it, plus browsers on all three devices. The
  test helpers untick the box by default (`chooseRemember`), so other tests still unlock for real. 11 of 12 deliberate
  breaks were caught; the twelfth (forgetting after locking instead of before) isn't a real fault: the forget request is
  made in the same moment, and IndexedDB keeps the order, so the unlock screen never reads it first.

- **Nov 20 (#97):** Designed, not built: **remembering a device** (one unlock per device, then Honed opens straight in; the data
  key kept wrapped by a non-extractable device key in this device's IndexedDB, never synced or backed up; Lock forgets it) and
  opt-in **Google unlock** (the server keeps a key so Google alone unlocks a new device; for those who turn it on the server
  could read their data, said plainly in Settings). Nathan's choice: both, the second per person.

- **Nov 20 (#95):** Sync step 1, the sync server's sign-in and accounts (`sync/`, image `ghcr.io/nandminc/aw-study-sync`): Google
  OpenID Connect with PKCE, state bound to a cookie (a sign-in finishes only in the browser that started it), our own ID token
  checks, an email allow list (rechecked on every request), hashed sessions (30 days idle, 180 at most), the devices list,
  signing out one or all, deleting the account after a fresh sign-in. 25 server tests against a fake Google; each of 19 rules
  broken on purpose was caught. Settings has an Account (testing) box that asks the server only when you press a button. The
  service worker leaves `/api/` to the network (Google returns to `/api/auth/callback`). Nothing syncs yet.

- **Nov 20 (#93):** Accounts and sync designed (`docs/SECURITY.md`, "Accounts and sync"), not built. Nathan's
  decisions: Google sign-in with our own code (OpenID Connect, no hosted service); a new server app `honed-sync` at
  `/api/` on his home server with its own dataset, `site-honed` staying a file server; testers only (an email allow
  list); sync opt-in. Signing in never unlocks: the server holds ciphertext and wrapped keys. A trap found while
  designing: a sealed record's additional data covers only its store and id, not the readable fields beside it, so
  synced changes are sealed again with everything inside, and devices never act on the server's readable hints.

- **Nov 20 (#46):** Portrait pages fit the width and scroll down (DESIGN, "The slide viewer"), with a Whole page /
  Page width switch. Measured on the real Slides screen with a US Letter document: the stage is 361 × 196 on the
  iPhone 15, 380 × 376 on the Pixel 7 and 886 × 341 on desktop, so a whole page was 151, 290 and 263 px wide; fit
  width makes it 361, 380 and 816 (real size). Thumbnails now fit 96 × 72, which gave the Pixel's stage 52 px more
  height. The iPhone's stage sits at the viewer's 12rem minimum (the Slides screen around it is taller than the
  screen), which may be worth a look on its own. Checked live after deploy #90 the same day: 152 passed; only
  `app.spec.ts:69` failed, as always live (Access answers `/ai/`).

- **Nov 20 (#81):** iPhone (WebKit) tests that timed out under load. Measured with all three projects at
  48 workers on a 24-thread PC, `--repeat-each=4`. Three separate causes:
  1. WebKit is about 3× slower than Chromium, so its long tests take up to 50 s under load. The iphone
     project now has a 90 s test budget and 15 s for each `expect` (`playwright.config.ts`).
  2. Some WebKit pages stopped drawing frames, so a click waited forever on "stable". This is the test
     browser, not Honed. Every browser test now imports `test`/`expect` from
     `tests/browsers/fixtures.ts`, which keeps a frame loop running in WebKit pages. Before: about one
     stall a run. After: 0 in 3 runs (1,812 tests). A run without the loop stalled again.
  3. A click on "Ask about this slide" right after "Keep as note" landed beside the button when the panel
     scrolled. It's now pressed with Enter.
- **Nov 20 (#87, part 2):** The AI helper's new `written` job writes short-answer questions for exam practice (each
  with 1-6 points a full answer makes, and its slide), checked by the helper and again on the device
  (`checkWritten`); `AiBackend.makeWrittenQuestions` (HTTP and fake). Grading uses the existing `grade` job.
  **The helper changed: after merging, press Update for `honed-ai` too.**
- **Nov 20 (#86):** Exams pull their sections forward. From 10 days before an exam (`RULES.examPullDays`), each
  section it covers (its listed lectures, or all of its class's up to the date) is quizzed at least twice
  (`examQuizzes`) before the day: the first quiz at once, the second halfway to the exam, never on the day. Those
  sections come first, weakest first (never quizzed counts as weakest), and are planned even past the daily
  minutes; `Plan.examsOver` names the exam, and Tasks says "More than your daily time today, to get you ready for
  PHYS 150's Midterm 1 (in 5 days)." Pulled quizzes are `kind: 'quiz'` with an `examId`.
- **Nov 20 (#82):** Restyle step 5, the last. Every other screen was checked on an iPhone-sized screen, dark
  and light: setup, the recovery key, unlock, a class's page, What was covered?, an exam, the viewer, a quiz
  (asked and answered) and Play. Fixed: cards and forms are outlines on the page's background, not filled
  boxes; back links are a bold green arrow and name (`a.back`), not underlined; file pickers' buttons are
  green pills in our font (they were the browser's serif); checkboxes are green; focus rings are green; and
  Play's text was 1.2× too big (an old rule for the Play button, which is gone).
- **Nov 20 (#84):** From Nathan's iPhone: the Classes title looked like the class names (now `h2.page-title`, 2rem with
  room under it, on all three main pages; class names 1.35rem), and a long file name (a hash with no spaces) pushed
  "What was covered?" sideways (now the page breaks long words, `overflow-wrap: break-word` on `body`, and a deck's
  button ends its name in "…" but keeps the slide count). `tests/browsers/layout.spec.ts` fails without either.
- **Nov 20 (#79):** Restyle step 4, Settings on one page. New **AI** section: **Check AI sign-in** asks
  the helper's `GET /ai/whoami` (no AI used; only when pressed, so opening Settings sends nothing) and says
  "Signed in for AI as … 3 of 200 AI requests used today", or not signed in, or not allowed; **Sign in for
  AI** is always there. `AiBackend.status()` is new (HTTP and fake). **Compare models** lists your 5 latest
  sections, each opening its quiz screen with the comparison showing (`#/class/<id>/quiz/<sectionId>/compare`).
  Daily study minutes move here with #78 (Nathan's Claude).
  Also fixed a race in `annotations.spec.ts` ("dragging across words"): closing the notes panel redraws the
  slide wider, so the test now waits for the slide's size to hold before measuring the words (it failed
  1 run in 5 on desktop, and once in CI).
- **Nov 20 (#75):** Restyle step 3, the Classes page. Each class is a heading (opening its page) with a
  three-dots menu: What lectures covered, Class details, Exams, Files (each opens the class's page at
  that part: `#/class/<id>/<part>`) and Delete class (asks first). Under it, a round button per lecture
  not filled in yet (`unfilledLectures`: every lecture time from a week before the class was added, or
  the term's start if later, to now, never past the term's end), opening "What was covered?" for that
  date (`#/class/<id>/cover/<date>`) and coming back to Classes when saved or cancelled. The latest
  lectures list and each class's details left this page; they're on the class's page.
- **Nov 19 (#77):** The Tasks page as drawn: progress bar, Start, a row per class (`::` to drag, saved; arrow keys
  too), tap to open its lectures (name = slides, Quiz = quiz, a tick when done), the penguin when there's nothing.
  Play runs the same list in the same order, skipping what's done (slides read but no quiz yet: straight to the
  quiz). `Today.tsx` is gone; the daily minutes moved to Settings ("Study time"). The selected nav icon is dark
  grey in dark mode too. Gotcha: drag handlers bound before a re-render saw the old order in WebKit; the order
  lives in a ref.
- **Nov 19 (#72):** `src/plan/tasks.ts`: the Tasks page's day, grouped by class in the saved order, fixed at the start of
  the day (worked out from the history before today, so done items stay, ticked), done = its quiz done, statuses
  (Exam soon within 7 days, New, Review, done) and the progress bar (slide time creeps up to 80% of the study part).
  The screen is #77.
- **Nov 19 (#72):** `StudySettings.classOrder` (contract change): the Tasks page's class order, saved with the daily
  minutes and encrypted like them. `saveStudySettings` now takes only what changes (`{ dailyMinutes }` keeps the order);
  settings saved before read with an empty order.
- **Nov 19 (#68):** Restyle step 1. The colours from `docs/design/` are CSS variables in `src/app.css`, dark
  and light (`--accent` for green text and outlines, darker in light mode; `--fill`/`--on-fill` for green
  behind things). Settings has **Colours: Phone / Light / Dark** (`src/ui/theme.ts`: localStorage
  `honed:theme`, not the encrypted store, so the unlock screen has it; `<html data-theme>`, none for Phone).
  Lexend is bundled (`@fontsource-variable/lexend`, OFL, precached). Buttons are green outlined pills, the
  main one filled. The nav bar (`NavBar.tsx`) is on Tasks (`#/`, now the home page), Classes (`#/classes`)
  and Settings only. Tasks and Classes keep their old content until steps 2 and 3. Lock stays in the
  header too (every screen), and Settings lost its back link (the bar replaces it).
- **Nov 19 (#70):** First-week quizzes are sized by the section: half a question a slide, 5 to 15 (20 slides make the
  default 10; `RULES.firstWeekQuiz`). The first quiz after the first week uses the same size; the score table takes over
  after it. A quiz started by hand from a class asks 10 (`QUIZ_SIZE`, was 5).
- **Nov 19:** The first UI design is in `docs/design/` (`screens.png` + README with Nathan's answers to the
  open questions). No code yet: building it is planned in the README, one PR per step.
- **Nov 19:** "Sign in for AI" goes to the helper's new `GET /ai/signin?then=<path>` (a plain page, strict CSP:
  "You're signed in for AI", **Back to the app**, "close this tab if it opened in one"), not `/ai/whoami`.
  On Nathan's iPhone Home Screen app the sign-in had left him on whoami's JSON with no way back. `then`
  is the screen you were on (`signInUrl()`), and the helper only links to a path on this site, never
  `/ai/` (`returnPath`, tested with hostile values). Needs **Update for both `site-honed` and `honed-ai`**.
- **Nov 19:** Real iPhone (Nathan, Home Screen app): setup with a passkey and Face ID unlock work. A
  passkey saved to Chrome stopped working (see Gotchas); one in Apple's Passwords works. The class form's
  time and date boxes overflowed their columns (Safari draws them ~183 px wide): fixed in PR #63
  (`appearance: none`, `min-width: 0` on the boxes and `label.inline`, rows lined up by their bottom);
  confirmed on the iPhone, the time picker still opens.

- **Nov 19:** Deployed main 8ee4c61 (the viewer tools, #56) and checked it live (#60): `/healthz` 200,
  the security headers and CSP intact, no Cloudflare script injected, `/assets/` immutable. The whole
  browser suite run against https://honed.pacificfish.ca (desktop, Android, iPhone): 110 passed, 5
  skipped; only `app.spec.ts`'s "/ai/ is left to the network" failed, as it must there (it expects the
  test server's 404, and live `/ai/whoami` answers Cloudflare Access's 302 to sign-in). Milestone 3
  marked done. Real phones still to try.

- **Nov 18:** Viewer tools (#56, PR #58): `src/viewer/AnnotatedViewer.tsx` over `SlideViewer` (which gained
  an `overlay` and `barExtra`) and `src/ui/DeckSlides.tsx` (store + AI), on the Slides and Play screens.
  A Notes panel (beside the slides; under them on phones) with Box, Pin a note and Ask about this slide;
  selecting words offers four colours, Explain this and Ask about this; answers can be kept as notes.
  Explain sends the selection (or a box's words) and the slide with its neighbours, nothing more. Traps
  found by WebKit and Android: opening the panel resized the slide, whose redraw dropped a selection being
  made (now the slide keeps its height on phones and the panel opens when the press ends), and a mouse
  drag over words counted as a swipe. 9 of 10 deliberate bugs caught (the 10th is a doubled guard).
  (Matt's Claude)

- **Nov 18:** Notes and highlights, contract and storage (#56, PR #57): `src/types/annotation.ts` and
  `src/db/annotations.ts`, schema step 7 (store `annotations`, by course and by deck). An annotation
  belongs to a deck's page (not a section), so it shows wherever that slide is open. Positions are
  fractions of the page; text highlights keep their words. Unlike attempts and sessions they can be
  edited (colour, note) and deleted; deleting a deck or class deletes them. Only id, courseId and
  deckId stay readable (the page is sealed too). 18 deliberate bugs caught. (Matt's Claude)

- **Nov 18:** Updates never reload an unlocked app (PR #55): the service worker's autoUpdate reloaded the
  page as soon as a new version arrived, which locked it, so a passkey was asked for twice (and a quiz in
  progress could be lost). Now (`src/ui/update.ts`) it reloads at once only when locked with no unlock
  started; otherwise a banner says a new version is ready (Reload), and it applies on the next Lock.
  WebKit found a race in the banner (an update arriving between its first render and its listener). 5
  deliberate bugs caught. (Nathan's Claude)

- **Nov 18:** Maths in quizzes (PR #53, Nathan's request after a calculus test): the helper's system prompt
  asks for LaTeX between `\(` `\)` or `\[` `\]`, never dollars; `src/quiz/math.ts` splits text, and `MathText` draws
  the maths with KaTeX 0.19.1 (MIT; `trust: false`; `katex.render` sets sizes through element.style, which
  the CSP allows). `vite.config.ts` never inlines fonts as data: URLs (the CSP's font-src 'self' blocked
  them). Questions already in a bank stay as written. 6 deliberate bugs caught. (Nathan's Claude)

- **Nov 18:** Questions made in the background (PR #52, Nathan's request): "What was covered?" has
  **Make quiz questions now**, on by default; on saving, its sections join a queue (`src/ui/bank-jobs.tsx`,
  held by App, so it carries on across screens) that fills each bank in turn, with a status line on
  every screen. A lapsed sign-in pauses it (Sign in for AI, Try again); locking stops it. Not kept across
  a reload: the Quiz page still has Make questions. 6 deliberate bugs caught. (Nathan's Claude)

- **Nov 18:** Compare models (PR #51, Nathan's request): the helper takes an optional `model` on any
  job, only one of `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` (`MODELS` in `helper/app.mjs`;
  anything else 400 before Claude Code runs), says which answered, and logs it (counts only). In the
  app, a section's quiz page has **Compare models**: the same first slides to each model in turn, their
  questions side by side with the time taken, nothing saved unless one model's are added to the bank.
  `AiModel`/`AI_MODELS` and `MakeQuestionsRequest.model` in `src/ai/backend.ts`. 6 deliberate bugs caught.
  (Nathan's Claude)

- **Nov 18:** #47 screens (PR #50): **Today** on the home screen (what fits today's minutes, minutes
  done and planned, what's waiting beyond today, the daily minutes to change) and **Play** (`#/play`):
  each study item is the section's slides with a timer; at 80% of its time the quiz is offered, *I'm
  ready* starts it any time; then the quiz (questions can be made right there); extra study is slides
  only; quizzes are the quiz only. Sessions and quizzes are saved as they end; *Stop for now* leaves the
  rest on the list. Browser tests on a clock the test controls; 8 deliberate bugs each caught.
  (Nathan's Claude)

- **Nov 18:** #47 storage and planner (PR #49): schema step 6 (`studySessions`, `settings`) and
  `src/db/plan.ts`; `src/plan/planner.ts` works today's checklist out from the history each time. First
  week on days 1, 3 and 7 (a third of the budget each, one at a time, a late one pushing the next by its
  spacing), then quizzes by the score table (first gap 7 days), extra study the day after a score under
  70%, priority weakest, then new, then most overdue, filled to the daily minutes less what's done today.
  Numbers in `src/plan/rules.ts`. 12 of 13 deliberate bugs caught (the 13th, the 90% band's 3-day minimum,
  can't bite with whole-day gaps). (Nathan's Claude)

- **Nov 18:** #40 screens (PR #43): each section of a lecture has a **Quiz** link (with its last score) on the
  class page. "Make questions" fills the section's bank through the AI helper: 3 a slide, at least 10, five
  slides a request, saved as each answer arrives, repeats dropped; only slide text is sent. The quiz needs
  no AI: 5 questions (last time's wrong ones first, then new, then the longest-ago), options in a fresh
  order, instant feedback with the explanation and the slide shown in place, the score saved at the end.
  A lapsed Access sign-in shows "Sign in for AI" (`/ai/whoami` in a new tab). Browser tests answer `/ai/`
  like the helper, on all three devices; 8 deliberate bugs each caught. (Nathan's Claude)

- **Nov 18:** #40 storage (PR #42): schema step 5 (`questions`, `quizAttempts`, both indexed by class
  and section) and `src/db/quiz.ts`. Questions are checked when added (a slide in the section, four
  different options, the answer among them, no repeat of the bank; 100 a call, 500 a section), all or
  none. An attempt is marked by the store against the stored answers (a "right" from the screen is
  ignored) and only ever added. Deleting a lecture or class takes its questions and attempts.
  Backups name them "questions" and "quizzes". 8 deliberate bugs each caught. (Nathan's Claude)

- **Nov 18:** #26 part 2, flashcards removed (PR #37): the deck, note and card screens, store
  methods and tests, `src/lib/scheduler.ts`, `src/lib/cloze.ts`, `src/types/study.ts`, and `ts-fsrs`.
  **Schema step 4** deletes the `decks`, `notes`, `cards` and `reviews` stores and their change-log
  rows (step 1 still makes them, as shipped, so a fresh install makes and drops them). The store,
  encryption and backup tests now use classes as their data; a browser test upgrades a version 3
  database holding cards (desktop, Android, iPhone). The lock screens say "classes and slides".
  Open: `docs/SECURITY.md` doesn't mention the AI helper yet (slide text will go to it for
  questions). (Nathan's Claude)

- **Nov 18:** #26 part 1, the screens (PR #36). Home is now the classes list, with reminders for
  lectures not filled in yet and the latest lectures. A class page has its lecture times, "What was
  covered?" (date and minutes default to the latest lecture that has started; one or more slide
  ranges, each from a deck already added or a PDF picked then; it suggests carrying on from where
  the last lecture stopped), lectures (edit date and minutes, delete), exams (midterm, final or
  test; every lecture up to it or chosen ones) and slide decks (upload, rename, delete, open). A
  section opens in the viewer at its first slide with its range marked (`#/class/<id>/slides/<deck>/<a>-<b>`).
  The lock and backup browser tests now use classes; the old flashcard screens moved to `#/cards`.
  (Nathan's Claude)

- **Nov 18:** #34 the app's AI client (PR #35): `src/ai/` with the `AiBackend` interface
  (`makeQuestions`, `gradeAnswer`, `explain`, `ask`), `HttpAiBackend` (posts JSON to `/ai/` on our
  own site only, the Access cookie only same-site, never follows redirects, so a lapsed Access
  sign-in shows as `'signed-out'` and the screen can open `signInUrl()`), every reply checked again
  on the device (`check.ts`), and `FakeAiBackend` for tests and screens. 10 tests on a fake fetch;
  14 of 16 deliberate bugs caught (the other two are covered by another check). (Matt's Claude)

- **Nov 18:** #27 AI helper (PR #33): `helper/`, a Node server (its own modules only) for
  `POST /ai/questions`, `/ai/grade`, `/ai/explain`, `/ai/ask` (and `GET /ai/whoami` for setup). It checks the Cloudflare Access
  token itself (signature, team, audience, expiry), maps the email to that person's own Claude
  Code token, and runs `claude -p` with **no tools** (`--tools ""`, `--disallowedTools "*"`), no
  MCP, no skills, no saved session, one turn, our own system prompt, the prompt on stdin, a fresh
  home folder deleted after each run, and a time limit. User text goes in one JSON block between
  nonce markers, marked as data. Replies are checked (4 distinct options, an answer among them, a
  slide that was given; marks in range) and retried once. Limits: per person per day, one at a
  time, sizes. Logs are counts only. Image `ghcr.io/nandminc/aw-study-ai`, checked in CI running
  read-only as an unprivileged user. 55 tests with a fake `claude`; 32 of 34 deliberate bugs caught (the other two are covered by another check).
  (Matt's Claude)

- **Nov 18:** #24 storage (PR #30): schema step 3 (`courses`, `exams`, `slideDecks`, `deckFiles`,
  `deckPages`, `lectures`, `sections`) and `src/db/lectures.ts`, every `LectureStore` method. PDFs are
  sealed as raw bytes (`encryptBytes`), page text separately; a section's `nextDue` is readable for the
  planner; a lecture's minutes are shared by page count, adding up exactly. Fixed #18's `openBackup`,
  which would have called every backup with a PDF "damaged" (it parsed each record as JSON), and its
  summary now names classes and slide decks and leaves out empty and internal stores. 30 new tests;
  8 rules proved to fail without them. (Nathan's Claude)

- **Nov 18:** #25 slide viewer (PR #32): `src/viewer/` with `<SlideViewer pdf page range
  onPageChange>` (one slide fitted to the screen; keys, buttons, swipes, thumbnails; pinch, +/−
  zoom; the section's range marked; a selectable text layer for milestone 7; thumbnails drawn only
  near the screen) and `extractPageText(pdf)`. PDF.js 6 (`pdfjs-dist`, Apache-2.0), **legacy
  build**; its worker and data files (fonts, decoders, colour profiles, character maps) come from
  our own site (`/pdfjs/`, copied by `vite.config.ts`), so the CSP needed **no change**. Test page
  `/viewer-demo.html` until #26 uses it. Unit tests on PDFs generated in the test
  (`src/viewer/test-pdf.ts`); browser tests on all three engines (no errors, no CSP
  violations, every request same-site, a 150-slide deck in under 5 s with under 40 thumbnails
  drawn). 12 deliberate bugs each caught. (Matt's Claude)

- **Nov 18:** #18 backups (PR #31): `.honed` backup files (the database as stored, no record
  decrypted; format in SECURITY.md "Backups"), download or share from Settings, automatic backups
  to a folder on Chrome/Edge desktops (hourly at most, newest 5 kept), a reminder after a week,
  restore on the setup screen ("Moving from another device?") or in Settings, persistent storage
  asked after setup and shown in Settings. The store gains `exportSealed`, `replaceFromBackup`
  (one transaction, all or nothing) and `latestChange`. Backups copy every store in
  `RECORD_STORES`, so #24's stores join automatically. 23 unit tests and browser tests on all
  three engines (download, restore on a new device, replace in Settings, wrong passphrase, a
  non-backup file); 18 deliberate bugs each caught. Folder backups can't be driven by Playwright
  (no way to answer the folder picker): unit-tested with a fake folder. (Matt's Claude)

- **Nov 18:** #17 screens (PR #21): first-run setup (passkey or passphrase, the recovery key shown once and typed back), the unlock screen (passkey, passphrase, recovery key, then a new passphrase), Settings (change passphrase, add/remove passkeys, new recovery key, Lock now), on the encrypted store from #16. Browser tests on all three engines, including an end-to-end scan of the real IndexedDB for plaintext; passkeys tested in Chromium with a virtual authenticator with PRF. 15 rules proved to fail without them. (Matt's Claude)

- **Nov 18:** Redesign written into `docs/DESIGN.md`, `CLAUDE.md` (product, schedule and AI rules)
  and this file; milestones 4-9 replace the old 4-7; issues #24-#27. (Nathan's Claude)

- **Nov 18:** #16 encrypted storage (PR #23): `StudyStore` gains the `Vault` methods agreed with
  #17 (`status`, `getKeyring`, `setUp` with progress, `unlock`, `lock`, three keyring
  operations); records are sealed per SECURITY.md (only index fields readable); `setUp`
  encrypts milestone 2 data in place, resumable; schema step 2. The whole store test suite runs
  twice (plain and encrypted), plus 15 encryption tests (no plaintext on disk, exact readable
  fields, locking, wrong keys, keyring rules, a v1 database migrated with progress, an
  interrupted setup finished by unlock, moved records). Eight deliberate bugs each caught.
  2,000 encrypted cards: listDecks 6 ms, studyQueue 30 ms in Node. (Nathan's Claude)

- **Nov 18:** #15 crypto core (PRs #20, #22): `docs/SECURITY.md`; `src/lib/crypto.ts` (data key,
  wrapping under passphrase / recovery key / passkey PRF, `unlock`, recovery key format,
  record encryption with additional data) and `src/lib/passkey.ts` (create a passkey with PRF, get
  its secret, `isPrfSupported`), 31 tests on Node's WebCrypto and a fake `navigator.credentials`.
  Nine deliberate bugs (fixed IV, ignored additional data, no NFC, skipped recovery check,
  passkey id not matched, extractable keys, fewer iterations, no user verification) each caught.
  #16 and #17 can start. (Nathan's Claude)

- **Nov 18:** Milestone 3 planned: issues #15-#18 in the GitHub milestone "M3: Lock it down".
  (Nathan's Claude)

- **Nov 18:** #7 screens (PR #14): decks (counts, create, rename, delete with an in-page
  confirmation), a deck's notes (add, edit, delete; Basic or Cloze with live cloze checks and card
  previews), review (Show answer / Space, Again-Hard-Good-Easy / 1-4 with interval labels, time to
  answer recorded, "Done for now"), hash routes `#/`, `#/deck/<id>`, `#/review/<id>`. Card text is
  never HTML. Browser tests click through all of it on desktop, Android and iPhone (28 checks);
  four deliberate UI bugs each caught. **Milestone 2 is complete.** (Nathan's Claude)

- **Nov 18:** #5 scheduler and cloze (PR #12): `src/lib/scheduler.ts` (ts-fsrs 6, retention 0.9,
  max 36500 days, deterministic fuzz; the daily queue with the study day, new-card limit,
  suspended cards and one card per note per day; button labels) and `src/lib/cloze.ts`
  (`checkCloze`, `renderCloze`), with 71 Vitest tests. Each key rule was proved to fail without it
  (30 of 32; the other two are already enforced by ts-fsrs). Signatures unchanged. (Matt's Claude)
- **Nov 18:** CI's test job runs in Playwright's own image (`mcr.microsoft.com/playwright`) after
  `playwright install --with-deps` hung twice on Ubuntu's mirrors; jobs get time limits (20 and
  15 min); Docker actions moved to their Node 24 majors (#10). (Nathan's Claude)
- **Nov 18:** #6 data layer (PR #9): `src/db/schema.ts` (IndexedDB, migration step 1),
  `src/db/store.ts` (`StudyStore`: decks, notes and their cards, suspend, study queue, answers,
  change log), 18 Vitest tests (each key rule proved to fail without it) and browser tests in all
  three engines (persistence across reload, offline). SQLite tried and dropped (see Decisions).
  (The temporary `globalThis.__honedStore` was removed in #14: the screens get the store through
  React context.)
  (Nathan's Claude)
- **Nov 18:** Repo moved to NandMinc (Matt). References updated; the server switches to
  `ghcr.io/nandminc/aw-study` after the first publish from the new home. (Nathan's Claude)
- **Nov 18:** Kickoff for milestone 2: shared types, scheduler and cloze stubs, ts-fsrs and
  sqlite-wasm added, this file, the "Working together" rules, issues #5-#7. (Nathan's Claude)
- **Nov 18:** First deploy of the skeleton to honed.pacificfish.ca, checked live in Chromium and
  WebKit. (Nathan's Claude)
- **Nov 18:** Licence added (#4, Matt). Name Honed (#3).
- **Nov 17:** Skeleton merged (#2). Design merged (#1).

## Gotchas worth knowing

- **Browser tests run with reduced motion** (#149, `playwright.config.ts`): no page slides or pill movement, so a
  test that measures a box or a colour never catches a screen mid-slide. A test of motion turns it back on with
  `test.use({ contextOptions: { reducedMotion: 'no-preference' } })` (`motion.spec.ts`, the pill in `look.spec.ts`).
  The screen's wrapper (`main > .page`) is keyed by `pageKey`: a new key is a new screen and slides in.
- **The nav bar must stay one element between the three main pages** (#143): its pill slides from the old page to
  the new one only because React keeps the same `<nav>`. Don't give `NavBar` a `key`, or render it inside each page.
  Hover styles go inside `@media (hover: hover)`, or a phone keeps a tapped button "hovered".
- **Browser tests start past the first run** (#136): `playwright.config.ts` gives every test's context localStorage
  saying the tour was seen and Getting started skipped (for 127.0.0.1 and localhost). A test that makes its own
  context with `browser.newContext()` doesn't get it, so the tour opens there: pass the same `storageState`.
- Breaking code on purpose for a browser test: check the build still succeeds (`npm run build` type-checks), or the test runs the last good build and passes (#123).
- **A popup's Escape key: add the listener in `useLayoutEffect`, not `useEffect`** (#129). `useEffect` runs after the
  browser paints, so a test (or a quick person) can see the popup and press Escape before the listener exists.
  WebKit lost it 5 runs in 8. The listener is added once while the popup is open, reading the current handler
  through a ref (as for keyboard shortcuts below).
- Claim with `tools/claim-task.mjs`, not by hand: `gh issue list` doesn't show claim comments, so a task can look free when it isn't (#133).
- A record's sync id must be its own: sync finds a record's latest change by `entityId` alone (not entity and id), so two kinds of
  record sharing an id overrule each other's changes (#120: the exam style is `style-<class id>`).

- **Import `test` and `expect` from `tests/browsers/fixtures.ts`, never from '@playwright/test'.**
  Under load, a WebKit page can stop drawing frames, and Playwright's clicks then wait forever for
  "stable" (#81). The fixture keeps WebKit pages drawing. A test that makes its own browser context
  calls `keepDrawing(context, browserName)` (see `backup.spec.ts`).
- **Playwright's `getByRole(..., { name: 'Classes' })` matches any name *containing* "classes", any
  case**, so "Lock your classes and slides" on the setup screen passed for the Classes page's heading
  (found in #68). Use `exact: true` for headings and links whose words appear elsewhere.
- **On a phone, the slides have a fixed height with the notes panel under them (`annotate.css`), so
  anything that makes the viewer's bar taller pushes the thumbnails over the panel**, where they catch
  taps meant for Box and Pin a note. The restyle's roomier pill buttons and the wider Lexend did it on
  the iPhone (#68): the bar's buttons are compact on purpose (`viewer.css`, `.sv-bar button`). The
  iPhone run of `annotations.spec.ts` catches it (a click that waits forever on "intercepts pointer
  events").
- **On an iPhone, a passkey saved to Chrome (Google Password Manager) can't be trusted for unlocking.**
  Nathan's (Nov 19) unlocked once, then every try through "More from Chrome…" ended in "cancelled or
  timed out" (`NotAllowedError`). A new one saved to Apple's Passwords works. Exact cause unknown (PRF
  through a third-party provider is the guess). Set up passkeys on iPhones in Apple's Passwords.
- **An iPhone Home Screen app opens a `target="_blank"` link to our own site inside itself, with no Back
  button.** Anything a link opens (like Access sign-in) must offer a way back into the app.

- **Anything that resizes the slide redraws its text layer, which drops the user's selection.** Don't
  change the viewer's size while words may be selected (the notes panel waits for the press to end).
  Mouse drags that start on words are never swipes (`SlideViewer` gestures).
- **PDF.js: use the legacy build** (`pdfjs-dist/legacy/build/pdf.mjs`, and its worker). The
  modern build of PDF.js 6 needs `Uint8Array.prototype.toHex` (Chrome 140, Safari 18.2, Node 25)
  and `Promise.try`, so it fails in Node 24 and on older iPhones. In v6, `destroy()` is on the
  loading task, not the document: use `openPdf()`'s `close()` (`src/viewer/pdf.ts`). PDF.js takes
  ownership of the bytes it's given, so `openPdf` copies them.
- **A mutation check that breaks the type check proves nothing in browser tests:** `npm run build`
  fails, and the tests run against the old `dist/`. Check the build succeeded before trusting a
  "missed" or "caught".
- WebAuthn (passkeys) refuses an IP-address origin: Playwright's passkey test opens `localhost`, not `127.0.0.1`. Chromium's virtual authenticator supports PRF (`hasPrf: true`); WebKit has none, so iPhone passkeys are tried by hand.

- **Writing to the encrypted store: read, decrypt, compute, encrypt, then write** in a second
  transaction (never encrypt inside one). Wrap every write in `exclusive()` in
  `src/db/store.ts` so nothing slips in between. Counting cards uses their readable fields
  (`cardFacts`), so it needs no decryption.

- **WebCrypto and `Uint8Array` types:** TypeScript wants `Uint8Array<ArrayBuffer>` for WebCrypto
  inputs. Copy with `new Uint8Array(data)` (the `bytes()` helper in `src/lib/crypto.ts`) rather
  than casting.
- **Keys you'll want to wrap again must be extractable.** `unlock()` gives a non-extractable key
  for everyday use; Settings must call it with `{ extractable: true }` (after the user proves who
  they are) to add or change an unlock method.

- **Keyboard shortcuts in React: register the listener once and read state through a ref
  updated in `useLayoutEffect`.** A listener re-added in `useEffect` after each new card left a
  gap where a key reached the old card's handler and was lost (5 of 6 WebKit runs failed). See
  `src/ui/ReviewScreen.tsx`.
- **A test run stopped half-way can leave WebKit processes behind** (`WebKitNetworkProcess`) that
  make the next run hang. On Windows: `Get-Process WebKit* | Stop-Process` before running again.
- **On Windows PowerShell 5.1, don't round-trip source files through `Get-Content`/`Set-Content`**:
  it reads UTF-8 as Windows-1252 and adds a byte-order mark, turning “quotes” into "â€œ". Edit
  files with your editor or Node instead.

- ts-fsrs's review log `due` field is the card's previous review time, not its old due date.
  `review()` fills `ReviewEntry.dueBefore` from the state passed in instead. ts-fsrs 6 also marks
  the classic `fsrs()` API we use as deprecated (it still works); only `scheduler.ts` would change.
- `npm install` on a different Node version (Matt's PC has Node 22) can rewrite
  `package-lock.json`. Don't commit that unless the PR is about dependencies.
- **Don't use `America/Vancouver` in tests.** BC moved to permanent UTC-7 in 2026, and only newer
  time zone data knows it: Node 26 says UTC-7 in November, Node 22 says UTC-8, so a test that
  passes on one PC fails on another. Use a zone whose rules haven't changed (`America/Los_Angeles`,
  `America/New_York`, `Asia/Tokyo`, `UTC`).
- **Upgrading Playwright?** Also change the image tag in `.github/workflows/publish.yml`
  (`mcr.microsoft.com/playwright:v<version>-noble`) and the version in its check step, or CI fails.
- **Playwright's WebKit has no OPFS** (the browser's private file system): anything built on it
  can't be tested for iPhones here. Real Safari has it; our tests can't show it.
- **IndexedDB transactions commit as soon as nothing is pending.** Inside one, await only
  IndexedDB requests; do other async work (fetch, crypto.subtle, timers) before opening it.
- **Aborting an IndexedDB transaction rejects `tx.done`**: unless something catches that, the
  browser logs an unhandled rejection (which fails our "no errors" tests). Use `abort()` in
  `src/db/store.ts`.
- The image name comes from the repo's owner (`ghcr.io/${GITHUB_REPOSITORY,,}` in the workflow).
  Moving or renaming the repo moves the image, and the home server keeps deploying the old name
  until Nathan switches its compose file and `apps.json`. Tell Nathan before any such move.
- A merged PR ignores later pushes to its branch. Before pushing more, check
  `gh pr view <n> --json state`; if it's merged, start a new branch from that commit.
- The service worker needs `clientsClaim` (in `vite.config.ts`), or the first visit isn't
  offline-ready.
- Playwright can only take Chromium offline with a service worker; offline tests skip WebKit.
- Never pass an `async` function to Playwright's `waitForFunction` (its promise counts as true).
- Everything is LF (`.gitattributes`). Nathan's PC has Node 26; CI uses Node 24.
