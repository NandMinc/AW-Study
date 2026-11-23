// Short answers in quizzes (#124) through the real screens and AI client, in desktop Chrome, an Android phone and an
// iPhone: typed, marked by the AI in one request at the end (a blank one is 0 and never sent), shown with their marks;
// multiple choice only when the AI can't be reached; and when marking fails, try again or save without them. The
// test answers /ai/ itself, so nothing is spent or sent.
import { expect, test, type Page, type Route } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block' });

interface GradeAsk {
  slides: { page: number; text: string }[];
  items: { question: string; points: string[]; answer: string; page: number }[];
}

/**
 * The helper: a guide asking half its exam-style questions as short answers, questions following the mix, whoami as
 * `whoami` says, and grade-many as `grade` says (default: 1 mark each, "Half there.").
 */
async function fakeHelper(page: Page, { whoami = 200, grade = [200] }: { whoami?: number; grade?: number[] } = {}) {
  const graded: GradeAsk[] = [];
  let gradeCall = 0;
  await page.route('**/ai/style', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tests: 'Explain and work out.', levels: ['a', 'b', 'c'], shortShare: 0.5 }) }),
  );
  await page.route('**/ai/questions', async (route: Route) => {
    const body = route.request().postDataJSON() as { pages: { page: number }[]; mix: { choice: number[]; short: number } };
    const page = body.pages[0]!.page;
    const choice = body.mix.choice.flatMap((n, l) =>
      [...Array(n)].map((_, i) => ({ form: 'choice', level: l + 1, question: `Choice L${l + 1} #${i + 1}?`, options: ['Right', 'Wrong 1', 'Wrong 2', 'Wrong 3'], answer: 0, page, explanation: '' })),
    );
    const short = [...Array(body.mix.short)].map((_, i) => ({ form: 'short', level: 3, question: `Explain bond ${i + 1}.`, points: ['atoms share electrons', 'to fill a shell'], page, explanation: 'They share to fill a shell.' }));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ questions: [...choice, ...short] }) });
  });
  await page.route('**/ai/whoami', (route) =>
    whoami === 200
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ email: 'student@example.com', usedToday: 1, dailyLimit: 200 }) })
      : route.fulfill({ status: whoami, contentType: 'application/json', body: '{"error":"no"}' }),
  );
  await page.route('**/ai/grade-many', async (route: Route) => {
    const body = route.request().postDataJSON() as GradeAsk;
    graded.push(body);
    const status = grade[Math.min(gradeCall++, grade.length - 1)]!;
    if (status !== 200) return route.fulfill({ status, contentType: 'application/json', body: '{"error":"The AI failed."}' });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ marks: body.items.map(() => ({ mark: 1, feedback: 'Half there.' })) }) });
  });
  return { graded };
}

/** A class with a lecture (slides 2-4), its bank made, ending on the quiz's Start. */
async function bankMade(page: Page) {
  await openUnlocked(page);
  await addClass(page, 'CHEM 101');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Bonds.pdf', numberedSlides(4)));
  await form.getByLabel('Lecture date').fill('2026-11-16');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('4');
  await form.getByLabel(/Make quiz questions now/).uncheck();
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await page.getByRole('link', { name: 'Quiz on Bonds, slides 2–4' }).click();
  await page.getByRole('button', { name: 'Make questions' }).click();
  await expect(page.getByTestId('bank-size')).toHaveText('10 questions in this section’s bank.');
}

/** Answers every question: multiple choice right (options are shown shuffled); short answers from `typed` in turn ('' leaves it blank). */
async function answerAll(page: Page, typed: string[]) {
  const shortTyped: string[] = [];
  for (let n = 1; ; n++) {
    // The next question is on screen before looking at what kind it is
    await expect(page.getByTestId('quiz-position')).toHaveText(new RegExp(`^Question ${n} of`));
    const box = page.getByRole('textbox', { name: /Your answer/ });
    if (await box.isVisible()) {
      const text = typed[shortTyped.length] ?? '';
      shortTyped.push(text);
      await box.fill(text);
    } else {
      await page.getByRole('group', { name: 'Answers' }).getByRole('button', { name: /Right$/ }).click();
    }
    const end = page.getByRole('button', { name: 'See your score' });
    if (await end.isVisible()) {
      await end.click();
      return shortTyped;
    }
    await page.getByRole('button', { name: 'Next question' }).click();
  }
}

test('short answers are typed, marked in one request at the end (a blank one isn’t sent), and shown with their marks', async ({ page }) => {
  const problems = await watchProblems(page);
  const { graded } = await fakeHelper(page);
  await bankMade(page);
  await page.getByRole('button', { name: /Start the quiz/ }).click();
  await expect(page.getByTestId('quiz-note')).toHaveCount(0);
  const typed = await answerAll(page, ['They share electrons.', '']);
  expect(typed.length).toBe(2); // the bank's 2 short answers, both asked in a new section's quiz

  // 8 multiple choice right, the short answers 1 of 2 and 0 of 2: 8.5 of 10, but the percentage is weighted by
  // level (#120), and the half-wrong short answers are level 3, so it's below the plain 85%
  await expect(page.getByTestId('quiz-score')).toContainText('8.5 of 10 right');
  const percent = Number((await page.getByTestId('quiz-score').textContent())!.match(/\((\d+)%\)/)![1]);
  expect(percent).toBeLessThan(85);
  expect(graded).toHaveLength(1); // one request for the whole quiz
  expect(graded[0]!.items).toEqual([{ question: expect.stringMatching(/^Explain bond/), points: ['atoms share electrons', 'to fill a shell'], answer: 'They share electrons.', page: 2 }]);
  expect(graded[0]!.slides.every((s) => s.page >= 2 && s.page <= 4)).toBe(true);
  const marks = page.getByTestId('short-mark');
  await expect(marks).toHaveText(['1 of 2: Half there.', '0 of 2: No answer.']);
  await expect(page.getByTestId('short-results')).toContainText('A full answer says: atoms share electrons; to fill a shell.');
  expect(await problems()).toEqual([]);
});

test('when the AI can’t be reached at the start, the quiz is multiple choice only and says why', async ({ page }) => {
  const problems = await watchProblems(page);
  const { graded } = await fakeHelper(page, { whoami: 401 });
  await bankMade(page);
  await page.getByRole('button', { name: /Start the quiz/ }).click();
  await expect(page.getByTestId('quiz-note')).toContainText('multiple choice only (sign in for AI to get them)');
  const typed = await answerAll(page, []);
  expect(typed).toEqual([]); // no short answers asked
  await expect(page.getByTestId('quiz-score')).toContainText('8 of 8 right'); // the bank's 8 multiple choice
  expect(graded).toHaveLength(0);
  expect((await problems()).filter((p) => !p.includes('status of 401'))).toEqual([]);
});

test('when marking fails: try again, or save without the short answers, which then don’t count', async ({ page }) => {
  const problems = await watchProblems(page);
  const { graded } = await fakeHelper(page, { grade: [500, 500] });
  await bankMade(page);
  await page.getByRole('button', { name: /Start the quiz/ }).click();
  await answerAll(page, ['They share electrons.', 'To be stable.']);
  await expect(page.getByRole('alert')).toContainText('Your short answers couldn’t be marked');
  await expect(page.getByTestId('quiz-score')).toHaveCount(0); // nothing saved yet, and no mark made up
  await page.getByRole('button', { name: 'Try marking again' }).click();
  await expect(page.getByRole('alert')).toContainText('Your short answers couldn’t be marked');
  expect(graded).toHaveLength(2);
  await page.getByRole('button', { name: 'Save without them' }).click();
  await expect(page.getByTestId('quiz-score')).toContainText('8 of 8 right'); // the multiple choice only
  await expect(page.getByTestId('short-results')).toHaveCount(0);
  expect((await problems()).filter((p) => !p.includes('status of 500'))).toEqual([]);
});
