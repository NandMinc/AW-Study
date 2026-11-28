// Exam practice (#87) through the real screens and the real AI client, in desktop Chrome, an Android
// phone and an iPhone (WebKit), on a clock the test controls (Wednesday Nov 18, 2026, 10:00 in Los
// Angeles): a class whose final is on Friday, so today is a practice day. The test answers /ai/ like
// the helper (service workers off, so Playwright sees the requests).
import { expect, test, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, navBar, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });

const TYPED = 'Cells divide to grow, ANSWER-MARKER-7';

/** Answers /ai/questions (the bank: "Right n" is right) and /ai/written; /ai/grade as `grade` says. */
async function fakeHelper(page: Page, { written = 200, grade = 200 }: { written?: number; grade?: number } = {}) {
  const calls: { url: string; body: string }[] = [];
  page.on('request', (r) => calls.push({ url: new URL(r.url()).pathname, body: r.postData() ?? '' }));
  await page.route('**/ai/questions', async (route) => {
    const body = route.request().postDataJSON() as { pages: { page: number }[]; count: number };
    const questions = Array.from({ length: body.count }, (_, i) => ({
      question: `Question ${i + 1} about slide ${body.pages[i % body.pages.length]!.page}?`,
      options: [`Wrong ${i + 1}`, `Right ${i + 1}`, `Other ${i + 1}`, `Else ${i + 1}`],
      answer: 1,
      page: body.pages[i % body.pages.length]!.page,
      explanation: 'Because.',
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
  });
  const reply = (status: number, ok: unknown) =>
    status === 200 ? { status, contentType: 'application/json', body: JSON.stringify(ok) } : { status, contentType: 'application/json', body: JSON.stringify({ error: status === 401 ? 'Not signed in.' : 'Today’s AI limit (200) is reached.' }) };
  const state = { written, grade };
  await page.route('**/ai/written', (route) => route.fulfill(reply(state.written, { questions: [{ question: 'Why do cells divide?', points: ['To grow', 'To repair'], page: 3 }] })));
  await page.route('**/ai/grade', (route) => route.fulfill(reply(state.grade, { mark: 1, feedback: 'One of the two.' })));
  return { calls, state };
}

/** BIO 110: Monday's lecture on slides 2-4 with its question bank made, and a final on Friday. Ends on Tasks. */
async function finalOnFriday(page: Page) {
  await openUnlocked(page);
  await addClass(page, 'BIO 110');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(4)));
  await form.getByLabel('Lecture date').fill('2026-11-16');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('4');
  await form.getByLabel(/Make quiz questions now/).uncheck();
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await page.getByRole('link', { name: 'Quiz on Cells, slides 2–4' }).click();
  await page.getByRole('button', { name: 'Make questions' }).click();
  await expect(page.getByTestId('bank-size')).toHaveText('10 questions in this section’s bank.');
  await page.getByRole('link', { name: '← BIO 110' }).click();
  await page.getByRole('button', { name: 'Add an exam' }).click();
  const exam = page.getByRole('form', { name: 'New exam' });
  await exam.getByLabel('Exam date').fill('2026-11-20');
  await exam.getByRole('button', { name: 'Final' }).click();
  await exam.getByRole('button', { name: 'Add exam' }).click();
  await expect(page.getByTestId('exam-row')).toContainText('Fri, Nov 20');
  await page.getByRole('link', { name: '← Classes' }).click();
  await navBar(page).getByRole('link', { name: 'Tasks' }).click();
}

const practiceRow = (page: Page) => page.getByTestId('task-practice');

/** Answers the multiple choice (`right` of them right) and types `typed` into each short answer. */
async function answer(page: Page, count: number, { right, typed = '' }: { right: number; typed?: string }) {
  let rightSoFar = 0;
  for (let n = 1; n <= count; n++) {
    await expect(page.getByTestId('practice-position')).toHaveText(`Question ${n} of ${count}`);
    const options = page.getByRole('group', { name: 'Answers' });
    if (await options.isVisible()) {
      await options.getByRole('button', { name: rightSoFar < right ? /Right/ : /Wrong/ }).click();
      rightSoFar++;
      await expect(page.getByTestId('practice-question')).not.toContainText('Not quite'); // no feedback until the end
    } else {
      await page.getByLabel(/Your answer/).fill(typed);
    }
    await page.getByRole('button', { name: n < count ? 'Next question' : 'Finish and mark' }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T10:00:00-08:00') });
});

test('two days before a final: practice from Tasks, short answers written and marked by AI, the answer sent only to be marked', async ({ page }) => {
  const problems = await watchProblems(page);
  const { calls } = await fakeHelper(page);
  await finalOnFriday(page);

  await expect(practiceRow(page)).toHaveText('Practice for BIO 110’s Final (in 2 days)');
  await practiceRow(page).getByRole('link').click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(/Practice: BIO 110 · Final · in 2 days/);
  await expect(page.getByTestId('practice-size')).toContainText('2 multiple-choice and 1 short-answer questions on 1 part of the exam, about 5 min');
  await expect(page.getByTestId('practice-section')).toHaveText('Cells, slides 2–4');

  await page.getByRole('button', { name: 'Start the practice' }).click();
  await answer(page, 3, { right: 1, typed: TYPED });

  // 1 multiple choice right, and the short answer's 1 of 2 points: 1.5 of 3
  await expect(page.getByTestId('practice-score')).toHaveText('1.5 of 3 right (50%)');
  await expect(page.getByTestId('practice-mark')).toHaveText('1 of 2 points. One of the two.');
  await expect(page.getByTestId('practice-review')).toHaveCount(3);

  // What went to the AI: the section's slide text to write the question; the answer only to be marked
  const written = calls.filter((c) => c.url === '/ai/written');
  expect(written).toHaveLength(1);
  expect((JSON.parse(written[0]!.body) as { pages: { page: number }[] }).pages.map((p) => p.page)).toEqual([2, 3, 4]);
  const graded = calls.filter((c) => c.url === '/ai/grade');
  expect(graded).toHaveLength(1);
  const sent = JSON.parse(graded[0]!.body) as { question: string; points: string[]; answer: string; slides: { page: number }[] };
  expect(sent).toMatchObject({ question: 'Why do cells divide?', points: ['To grow', 'To repair'], answer: TYPED });
  expect(sent.slides.map((s) => s.page)).toEqual([2, 3, 4]); // slide 3 and either side
  expect(calls.filter((c) => c.body.includes('ANSWER-MARKER-7')).map((c) => c.url)).toEqual(['/ai/grade']);

  // Ticked on Tasks, and still offered (another practice counts too)
  await page.getByRole('link', { name: 'Done' }).click();
  await expect(practiceRow(page).getByRole('img', { name: 'Practice done' })).toBeVisible();
  expect(await problems()).toEqual([]);
});

test('when the AI can’t write or mark: practice without short answers, or save without the unmarked ones; never a made-up mark', async ({ page }) => {
  const problems = await watchProblems(page);
  const { calls, state } = await fakeHelper(page, { written: 429 });
  await finalOnFriday(page);

  // Writing fails: try again, or go on with the multiple choice alone
  await practiceRow(page).getByRole('link').click();
  await page.getByRole('button', { name: 'Start the practice' }).click();
  await expect(page.getByRole('alert')).toContainText('Today’s AI limit');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'Practise without short answers' }).click();
  await answer(page, 2, { right: 2 });
  await expect(page.getByTestId('practice-score')).toHaveText('2 of 2 right (100%)');
  expect(calls.filter((c) => c.url === '/ai/grade')).toEqual([]);

  // Marking fails (a lapsed sign-in): the multiple choice is saved, the short answer left out
  state.written = 200;
  state.grade = 401;
  await page.getByRole('link', { name: 'Done' }).click();
  await practiceRow(page).getByRole('link').click();
  await expect(page.getByText('You’ve done this practice today.')).toBeVisible();
  await page.getByRole('button', { name: 'Start the practice' }).click();
  await answer(page, 3, { right: 1, typed: TYPED });
  const failed = page.getByTestId('practice-mark-failed');
  await expect(failed.getByRole('alert')).toContainText('Sign in again to use AI. (1 short answer couldn’t be marked)');
  await expect(failed.getByRole('link', { name: 'Sign in for AI' })).toBeVisible();
  await failed.getByRole('button', { name: 'Save without them' }).click();
  await expect(page.getByTestId('practice-score')).toHaveText('1 of 2 right (50%)'); // the short answer doesn't count
  await expect(page.getByTestId('practice-skipped')).toHaveText('1 short answer wasn’t marked, so it doesn’t count.');
  await expect(page.getByTestId('practice-mark')).toHaveText('Not marked.');
  expect((await problems()).filter((p) => !/status of (401|429)/.test(p))).toEqual([]);
});

test('marking can be tried again once the AI is back; a blank answer gets 0 without being sent', async ({ page }) => {
  const problems = await watchProblems(page);
  const { calls, state } = await fakeHelper(page, { grade: 429 });
  await finalOnFriday(page);
  const graded = () => calls.filter((c) => c.url === '/ai/grade').length;

  await practiceRow(page).getByRole('link').click();
  await page.getByRole('button', { name: 'Start the practice' }).click();
  await answer(page, 3, { right: 2, typed: TYPED });
  await expect(page.getByTestId('practice-mark-failed')).toBeVisible();
  state.grade = 200;
  await page.getByRole('button', { name: 'Try marking again' }).click();
  await expect(page.getByTestId('practice-score')).toHaveText('2.5 of 3 right (83%)');
  expect(graded()).toBe(2); // the one that failed, then the one that worked

  await page.getByRole('link', { name: 'Done' }).click();
  await practiceRow(page).getByRole('link').click();
  await page.getByRole('button', { name: 'Start the practice' }).click();
  await answer(page, 3, { right: 2, typed: '   ' });
  await expect(page.getByTestId('practice-score')).toHaveText('2 of 3 right (67%)');
  await expect(page.getByTestId('practice-mark')).toHaveText('0 of 2 points. No answer was given.');
  expect(graded()).toBe(2); // nothing more sent
  expect((await problems()).filter((p) => !/status of 429/.test(p))).toEqual([]);
});

// #186: Tasks drew its first frame with no class order yet, so it took the "nothing today" layout (penguin, the
// practice row at the top), then the real one a render later, rebuilding the practice row lower down. A tap that
// landed between the two hit whatever had moved into the row's place (the iPhone test above, once, under load).
// Now the first draw is the real layout: the row goes into the page once and the penguin never shows.
test('Tasks draws its real layout first: the practice row goes in once, no penguin flash', async ({ page }) => {
  await fakeHelper(page);
  await page.addInitScript(() => {
    const seen = { practice: 0, penguin: 0 };
    (window as unknown as { seen: typeof seen }).seen = seen;
    new MutationObserver((records) => {
      for (const r of records)
        for (const node of r.addedNodes) {
          if (!(node instanceof Element)) continue;
          const all = [node, ...node.querySelectorAll('*')];
          seen.practice += all.filter((e) => e.matches('[data-testid="task-practice"]')).length;
          seen.penguin += all.filter((e) => e.matches('.penguin, [data-testid="tasks-clear"], [data-testid="tasks-empty"]')).length;
        }
    }).observe(document, { childList: true, subtree: true });
  });
  await finalOnFriday(page);
  await expect(practiceRow(page)).toBeVisible();
  const count = () => page.evaluate(() => (window as unknown as { seen: { practice: number; penguin: number } }).seen);
  const before = await count(); // Tasks before any class (the empty page) counts here
  await navBar(page).getByRole('link', { name: 'Classes' }).click();
  await expect(practiceRow(page)).toBeHidden();
  await navBar(page).getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByTestId('task-class')).toBeVisible();
  await expect(practiceRow(page)).toBeVisible();
  const after = await count();
  expect(after.practice - before.practice).toBe(1);
  expect(after.penguin - before.penguin).toBe(0);
});
