// Quizzes (#40) through the real screens and the real AI client (src/ai/http.ts), in desktop Chrome,
// an Android phone and an iPhone (WebKit). The test answers /ai/ itself, the way the helper does, so
// nothing is spent or sent. Service workers are off here: Playwright's routing doesn't see requests a
// service worker makes.
import { expect, test, type Page, type Route } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, pdfFile, toClasses, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked, unlockWithPassphrase } from './lock-helpers';

test.use({ serviceWorkers: 'block' });

interface AskedFor {
  pages: { page: number; text: string }[];
  count: number;
  avoid?: string[];
}

/** Answers /ai/questions like the helper: `count` questions over the slides sent, "Right n" being right. */
async function fakeHelper(page: Page) {
  const asked: AskedFor[] = [];
  await page.route('**/ai/questions', async (route: Route) => {
    const body = route.request().postDataJSON() as AskedFor;
    asked.push(body);
    const questions = Array.from({ length: body.count }, (_, i) => {
      const slide = body.pages[i % body.pages.length]!;
      return {
        question: `Question ${asked.length}.${i + 1} about slide ${slide.page}?`,
        options: [`Wrong ${i + 1}`, `Right ${i + 1}`, `Other ${i + 1}`, `Else ${i + 1}`],
        answer: 1,
        page: slide.page,
        explanation: `Slide ${slide.page} explains it.`,
      };
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
  });
  return asked;
}

/** A class with a lecture that covered slides 2-4 of a 4-slide PDF, ending on the class page. */
async function classWithLecture(page: Page, { makeQuestions = false } = {}) {
  await openUnlocked(page);
  await addClass(page, 'BIO 110');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(4)));
  await form.getByLabel('Lecture date').fill('2026-11-16');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('4');
  await expect(form.getByLabel(/Make quiz questions now/)).toBeChecked(); // on unless turned off
  if (!makeQuestions) await form.getByLabel(/Make quiz questions now/).uncheck();
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toContainText('Cells, slides 2–4');
}

const quizLink = (page: Page) => page.getByRole('link', { name: 'Quiz on Cells, slides 2–4' });

test('make a section’s questions with AI, take a quiz with feedback and the slide, and keep the score', async ({ page }) => {
  const problems = await watchProblems(page);
  const asked = await fakeHelper(page);
  await classWithLecture(page);
  await quizLink(page).click();
  await expect(page.getByRole('heading', { level: 2, name: /Quiz: Cells/ })).toBeVisible();
  await expect(page.getByTestId('bank-size')).toContainText('No questions yet');

  // Make questions: only the section's slide text goes, never the PDF
  await page.getByRole('button', { name: 'Make questions' }).click();
  await expect(page.getByTestId('bank-size')).toHaveText('10 questions in this section’s bank.');
  expect(asked).toHaveLength(1);
  expect(asked[0]!.count).toBe(10); // 3 slides: at least 10
  expect(asked[0]!.pages.map((p) => p.page)).toEqual([2, 3, 4]);
  expect(asked[0]!.pages[0]!.text).toContain('Slide 2');
  expect(JSON.stringify(asked[0])).not.toContain('%PDF');

  // From here on the quiz needs no AI at all
  const aiCalls: string[] = [];
  await page.route('**/ai/**', (route) => (aiCalls.push(route.request().url()), route.abort()));

  await page.getByRole('button', { name: 'Start the quiz (10 questions)' }).click();
  for (let n = 1; n <= 10; n++) {
    await expect(page.getByTestId('quiz-position')).toHaveText(`Question ${n} of 10`);
    const answers = page.getByRole('group', { name: 'Answers' });
    const pick = n <= 8 ? /Right/ : /Wrong/; // eight right, two wrong
    await answers.getByRole('button', { name: pick }).click();
    const feedback = page.getByTestId('quiz-feedback');
    if (n <= 8) await expect(feedback).toContainText('Right.');
    else await expect(feedback).toContainText(/Not quite\. The answer is [A-D]: Right \d+\./);
    await expect(feedback).toContainText(/Slide \d explains it\./);
    await expect(answers.getByRole('button')).toHaveCount(4);
    for (const option of await answers.getByRole('button').all()) await expect(option).toBeDisabled(); // one try
    if (n === 1) {
      // The slide it came from, right here
      const slide = Number((await feedback.getByRole('button', { name: /Show slide/ }).innerText()).match(/\d+/)![0]);
      await feedback.getByRole('button', { name: /Show slide/ }).click();
      await expect(page.getByTestId('slide-position')).toHaveText(`Slide ${slide} of 4`);
    }
    await feedback.getByRole('button', { name: n < 10 ? 'Next question' : 'See your score' }).click();
  }
  await expect(page.getByTestId('quiz-score')).toHaveText('8 of 10 right (80%)');
  await expect(page.getByTestId('quiz-done').getByRole('listitem')).toHaveCount(2); // the two to look at again
  expect(aiCalls).toEqual([]);

  // The score stays: on the quiz page, on the class page, and after a reload
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('last-score')).toHaveText('Last quiz: 8 of 10 right (80%)');
  await page.getByRole('link', { name: '← BIO 110' }).click();
  await expect(page.getByTestId('section-last-quiz')).toContainText('8 of 10 right (80%)');
  await reloadUnlocked(page);
  await expect(page.getByTestId('section-last-quiz')).toContainText('8 of 10 right (80%)');
  expect(await problems()).toEqual([]);
});

test('when the AI can’t be used, it says why, and a lapsed sign-in offers to sign in again', async ({ page }) => {
  const problems = await watchProblems(page);
  await classWithLecture(page);
  await quizLink(page).click();
  const replies: [number, unknown][] = [
    [401, { error: 'Not signed in through Cloudflare Access.' }],
    [429, { error: 'Today’s AI limit (200) is reached. It resets at midnight UTC.' }],
    [200, { questions: [{ question: 'Broken', options: ['only one'], answer: 0, page: 2 }] }],
  ];
  let reply = 0;
  await page.route('**/ai/questions', (route) => {
    const [status, body] = replies[reply++]!;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const make = page.getByRole('button', { name: 'Make questions' });

  await make.click();
  await expect(page.getByRole('alert')).toHaveText('Sign in again to use AI.');
  await expect(page.getByRole('link', { name: 'Sign in for AI' })).toHaveAttribute('href', /^\/ai\/signin\?then=%2F%23%2F/);
  await make.click();
  await expect(page.getByRole('alert')).toContainText('Today’s AI limit');
  await expect(page.getByRole('link', { name: 'Sign in for AI' })).toBeHidden();
  await make.click();
  await expect(page.getByRole('alert')).toContainText('wasn’t usable');
  await expect(page.getByTestId('bank-size')).toContainText('No questions yet'); // nothing half-made was kept
  await expect(page.getByRole('button', { name: /Start the quiz/ })).toBeHidden();
  // The CSP blocks nothing here, and the failed requests are the test's own 401 and 429 answers
  expect((await problems()).filter((p) => !/status of (401|429)/.test(p))).toEqual([]);
});

test('compare models: the same slides to Haiku, Sonnet and Opus, side by side; one model’s questions can be kept', async ({ page }) => {
  const problems = await watchProblems(page);
  const asked: { model?: string; pages: { page: number }[]; count: number }[] = [];
  await page.route('**/ai/questions', async (route) => {
    const body = route.request().postDataJSON() as (typeof asked)[number];
    asked.push(body);
    const name = (body.model ?? 'default').replace('claude-', '').replace('-5-5', '');
    const questions = Array.from({ length: body.count }, (_, i) => ({
      question: `${name} question ${i + 1}?`,
      options: [`${name} right ${i + 1}`, `wrong ${i + 1}`, `other ${i + 1}`, `else ${i + 1}`],
      answer: 0,
      page: body.pages[i % body.pages.length]!.page,
      explanation: `${name} explains.`,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions, model: body.model }) });
  });
  await classWithLecture(page);
  await quizLink(page).click();
  await page.getByRole('button', { name: 'Compare models' }).click();
  await page.getByRole('button', { name: 'Compare Haiku, Sonnet and Opus' }).click();

  for (const name of ['haiku', 'sonnet', 'opus']) {
    await expect(page.getByTestId(`compare-${name}`).getByTestId('compare-status')).toHaveText(/^5 questions in \d+\.\d s$/);
    await expect(page.getByTestId(`compare-${name}`)).toContainText(`${name} question 1?`);
  }
  // One request per model, the same slides and count, one after another
  expect(asked.map((a) => a.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  expect(new Set(asked.map((a) => JSON.stringify([a.pages, a.count]))).size).toBe(1);
  await expect(page.getByTestId('bank-size')).toContainText('No questions yet'); // nothing saved by comparing

  // Keep Sonnet's: they go into the bank, and the quiz can start
  await page.getByRole('button', { name: 'Add Sonnet’s questions to the bank' }).click();
  await expect(page.getByTestId('compare-sonnet')).toContainText('Added 5 to the bank.');
  await expect(page.getByTestId('bank-size')).toHaveText('5 questions in this section’s bank.');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Start the quiz (5 questions)' }).click();
  await expect(page.getByTestId('quiz-question')).toContainText('sonnet question');

  expect(await problems()).toEqual([]);
});

test('compare models lays the three side by side on a desktop, one under another on a phone', async ({ page }, info) => {
  await page.route('**/ai/questions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ questions: [{ question: 'Q?', options: ['a', 'b', 'c', 'd'], answer: 0, page: 2, explanation: '' }] }),
    }),
  );
  await classWithLecture(page);
  await quizLink(page).click();
  await page.getByRole('button', { name: 'Compare models' }).click();
  await page.getByRole('button', { name: 'Compare Haiku, Sonnet and Opus' }).click();
  await expect(page.getByTestId('compare-opus').getByTestId('compare-status')).toHaveText(/^1 question in /);
  const haiku = (await page.getByTestId('compare-haiku').boundingBox())!;
  const opus = (await page.getByTestId('compare-opus').boundingBox())!;
  if (info.project.name === 'desktop') expect(Math.abs(haiku.y - opus.y)).toBeLessThan(2); // one row
  else expect(opus.y).toBeGreaterThan(haiku.y + haiku.height - 1); // stacked
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('saving what was covered makes the quiz questions in the background, so the quiz is ready', async ({ page }) => {
  const problems = await watchProblems(page);
  // A slow helper: each answer waits until the test lets it go, to see the work carry on across screens
  let release: () => void = () => {};
  const asked: AskedFor[] = [];
  await page.route('**/ai/questions', async (route) => {
    const body = route.request().postDataJSON() as AskedFor;
    asked.push(body);
    await new Promise<void>((resolve) => (release = resolve));
    const questions = Array.from({ length: body.count }, (_, i) => ({
      question: `Background question ${i + 1}?`,
      options: [`Right ${i + 1}`, `Wrong ${i + 1}`, `Other ${i + 1}`, `Else ${i + 1}`],
      answer: 0,
      page: body.pages[i % body.pages.length]!.page,
      explanation: '',
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
  });
  await classWithLecture(page, { makeQuestions: true });
  await expect(page.getByTestId('bank-jobs')).toContainText('Making quiz questions for Cells, slides 2–4');

  // Leave the class page: the work goes on
  await page.getByRole('link', { name: '← Classes' }).click();
  await expect(page.getByTestId('bank-jobs')).toContainText('Making quiz questions');
  await expect.poll(() => asked.length).toBe(1);
  release();
  await expect(page.getByTestId('bank-jobs')).toContainText('Quiz questions ready: 10 for Cells, slides 2–4.');
  await page.getByTestId('bank-jobs').getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('bank-jobs')).toBeHidden();

  // The quiz is ready, without pressing Make questions
  await page.getByTestId('class-row').getByRole('heading').getByRole('link').click();
  await quizLink(page).click();
  await expect(page.getByTestId('bank-size')).toHaveText('10 questions in this section’s bank.');
  await expect(page.getByRole('button', { name: 'Start the quiz (10 questions)' })).toBeVisible();
  expect(await problems()).toEqual([]);
});

test('turned off, nothing is sent; a lapsed sign-in pauses the background work until you try again', async ({ page }) => {
  const problems = await watchProblems(page);
  const asked: string[] = [];
  let signedIn = false;
  await page.route('**/ai/questions', async (route) => {
    asked.push(route.request().url());
    if (!signedIn) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Not signed in.' }) });
    const body = route.request().postDataJSON() as AskedFor;
    const questions = Array.from({ length: body.count }, (_, i) => ({ question: `Q ${i + 1}?`, options: ['a', 'b', 'c', 'd'], answer: 0, page: body.pages[0]!.page, explanation: '' }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
  });

  // Off: no AI request at all
  await classWithLecture(page, { makeQuestions: false });
  await expect(page.getByTestId('lecture-row')).toHaveCount(1);
  expect(asked).toEqual([]);
  await expect(page.getByTestId('bank-jobs')).toBeHidden();

  // On, signed out: it says so, offers to sign in, and goes on when asked
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByRole('button', { name: /Cells/ }).click();
  await form.getByLabel('Lecture date').fill('2026-11-18');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('1');
  await form.getByLabel('Last slide').fill('2');
  await form.getByRole('button', { name: 'Save lecture' }).click();
  const status = page.getByTestId('bank-jobs');
  await expect(status).toContainText('Sign in again to use AI.');
  await expect(status.getByRole('link', { name: 'Sign in for AI' })).toHaveAttribute('href', /^\/ai\/signin\?then=%2F%23%2F/);
  signedIn = true;
  await status.getByRole('button', { name: 'Try again' }).click();
  await expect(status).toContainText('Quiz questions ready: 10 for Cells, slides 1–2.');
  expect((await problems()).filter((p) => !/status of 401/.test(p))).toEqual([]);
});

test('locking stops the background work: a late answer writes nothing', async ({ page }) => {
  let release: () => void = () => {};
  let answered = false;
  await page.route('**/ai/questions', async (route) => {
    const body = route.request().postDataJSON() as AskedFor;
    await new Promise<void>((resolve) => (release = resolve));
    const questions = Array.from({ length: body.count }, (_, i) => ({ question: `Late ${i + 1}?`, options: ['a', 'b', 'c', 'd'], answer: 0, page: body.pages[0]!.page, explanation: '' }));
    answered = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) }).catch(() => {});
  });
  // Making questions brings the class's guide up to date first (#123). Here that step is slow, as under load, and the
  // test locks only once the questions request is out, so it's that request's late answer being tested (#139)
  await page.route('**/ai/style', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fallback();
  });
  const questionsAsked = page.waitForRequest('**/ai/questions');
  await classWithLecture(page, { makeQuestions: true });
  await expect(page.getByTestId('bank-jobs')).toContainText('Making quiz questions');
  await questionsAsked;
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  release();
  await expect.poll(() => answered).toBe(true);
  await unlockWithPassphrase(page);
  await expect(page.getByTestId('bank-jobs')).toBeHidden();
  await toClasses(page); // unlocking opens Tasks
  await page.getByTestId('class-row').getByRole('heading').getByRole('link').click();
  await quizLink(page).click();
  await expect(page.getByTestId('bank-size')).toContainText('No questions yet');
});

test('maths in questions is drawn with KaTeX, within the security policy, with fonts from our own site', async ({ page, baseURL }) => {
  const problems = await watchProblems(page);
  const offSite: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(baseURL!) && !r.url().startsWith('data:')) offSite.push(r.url());
  });
  const fonts: string[] = [];
  page.on('response', (r) => r.url().includes('KaTeX_') && fonts.push(`${r.status()} ${new URL(r.url()).pathname}`));
  await page.route('**/ai/questions', async (route) => {
    const body = route.request().postDataJSON() as AskedFor;
    const questions = Array.from({ length: body.count }, (_, i) => ({
      question: String.raw`Which formula is integration by parts for \(\int u\,\frac{dv}{dx}\,dx\)? (${i + 1})`,
      options: [
        String.raw`\(uv - \int v\,\frac{du}{dx}\,dx\)`,
        String.raw`\(uv + \int v\,\frac{du}{dx}\,dx\)`,
        String.raw`\(\frac{du}{dx}\frac{dv}{dx} - uv\)`,
        `It costs $5 (${i + 1})`, // a dollar stays plain text
      ],
      answer: 0,
      page: body.pages[0]!.page,
      explanation: String.raw`Integrate \[\frac{d}{dx}(uv) = u\frac{dv}{dx} + v\frac{du}{dx}\] and rearrange.`,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
  });
  await classWithLecture(page);
  await quizLink(page).click();
  await page.getByRole('button', { name: 'Make questions' }).click();
  await page.getByRole('button', { name: /Start the quiz/ }).click();

  const question = page.getByTestId('quiz-question');
  await expect(question.locator('.question .katex')).toHaveCount(1); // drawn, not shown as source
  // What's drawn; the LaTeX source stays only in KaTeX's hidden MathML, for screen readers
  await expect(question.locator('.question .katex-html')).toBeVisible();
  expect(await question.locator('.question').innerText()).not.toContain(String.raw`\frac`);
  await expect(question.getByRole('group', { name: 'Answers' }).locator('.katex')).toHaveCount(3);
  await expect(question.getByRole('group', { name: 'Answers' })).toContainText('It costs $5');
  await question.getByRole('group', { name: 'Answers' }).getByRole('button').first().click();
  await expect(page.getByTestId('quiz-feedback').locator('.katex-display')).toHaveCount(1); // \[ \] on its own line
  // KaTeX's fonts load, from our own site; nothing broke the CSP
  await expect.poll(() => fonts.length).toBeGreaterThan(0);
  expect(fonts.every((f) => f.startsWith('200 /assets/'))).toBe(true);
  expect(offSite).toEqual([]);
  expect(await problems()).toEqual([]);
});
