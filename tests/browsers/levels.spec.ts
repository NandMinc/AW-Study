// Question levels in making questions (#123), through the real screens and AI client, in desktop Chrome, an Android
// phone and an iPhone: making a section's questions brings the class's exam style guide up to date first (once), then
// asks for a mix of levels following it; a failed guide never stops the questions. The test answers /ai/ itself.
import { expect, test, type Page, type Route } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block' });

interface Asked {
  count: number;
  pages: { page: number }[];
  guide?: { tests: string };
  mix?: { choice: [number, number, number]; short: number };
}

/** Answers /ai/questions following the mix it's sent (levels 1-3 in turn), and /ai/style as `style` says. */
async function fakeHelper(page: Page, { styleFails = false } = {}) {
  const order: string[] = [];
  const asked: Asked[] = [];
  await page.route('**/ai/style', async (route: Route) => {
    order.push('style');
    if (styleFails) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"The AI failed."}' });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tests: 'Worked problems on bonds.', levels: ['Name it.', 'Apply it.', 'Work it out.'], shortShare: 0 }),
    });
  });
  await page.route('**/ai/questions', async (route: Route) => {
    order.push('questions');
    const body = route.request().postDataJSON() as Asked;
    asked.push(body);
    const levels = body.mix ? body.mix.choice.flatMap((n, i) => Array<number>(n).fill(i + 1)) : Array<number>(body.count).fill(2);
    const questions = levels.map((level, i) => {
      const slide = body.pages[i % body.pages.length]!;
      return {
        form: 'choice',
        level,
        question: `Question ${asked.length}.${i + 1} (level ${level})?`,
        options: [`Wrong ${i}`, `Right ${i}`, `Other ${i}`, `Else ${i}`],
        answer: 1,
        page: slide.page,
        explanation: '',
      };
    });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ questions }) });
  });
  return { order, asked };
}

async function classWithLecture(page: Page) {
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
  await expect(page.getByTestId('lecture-row')).toContainText('Bonds, slides 2–4');
  await page.getByRole('link', { name: 'Quiz on Bonds, slides 2–4' }).click();
}

test('making questions writes the guide first (once), then asks for every level, following it', async ({ page }) => {
  const problems = await watchProblems(page);
  const { order, asked } = await fakeHelper(page);
  await classWithLecture(page);
  expect(order).toEqual([]); // nothing until asked

  await page.getByRole('button', { name: 'Make questions' }).click();
  await expect(page.getByTestId('bank-size')).toHaveText('10 questions in this section’s bank.');
  expect(order).toEqual(['style', 'questions']); // the guide first, then the questions
  expect(asked[0]!.guide).toMatchObject({ tests: 'Worked problems on bonds.' });
  expect(asked[0]!.mix).toEqual({ choice: [3, 3, 4], short: 0 }); // the bank's shares of levels 1-3
  expect(asked[0]!.count).toBe(10);

  // The guide is up to date now: the quiz needs no AI, and nothing more goes to /ai/style
  await page.getByRole('button', { name: /Start the quiz/ }).click();
  await expect(page.getByText(/Question 1 of/)).toBeVisible();
  expect(order).toEqual(['style', 'questions']);
  expect(await problems()).toEqual([]);
});

test('a guide that can’t be made never stops the questions: they’re made without one', async ({ page }) => {
  const problems = await watchProblems(page);
  const { order, asked } = await fakeHelper(page, { styleFails: true });
  await classWithLecture(page);
  await page.getByRole('button', { name: 'Make questions' }).click();
  await expect(page.getByTestId('bank-size')).toHaveText('10 questions in this section’s bank.');
  expect(order).toEqual(['style', 'questions']);
  expect(asked[0]!.guide).toBeUndefined();
  expect(asked[0]!.mix).toEqual({ choice: [3, 3, 4], short: 0 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The browser logs the 500 this test sent on purpose; nothing else
  expect((await problems()).filter((p) => !p.includes('status of 500'))).toEqual([]);
});
