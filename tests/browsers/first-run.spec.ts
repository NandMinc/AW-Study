// The first run (#136) through the real screens, in desktop Chrome, an Android phone and an iPhone (WebKit): the tour
// after setup, then Getting started on Tasks ticking itself as a class, a lecture and a first quiz are added. Unlike
// every other browser test, these start with no "tour seen" or "skipped" on the device (playwright.config.ts).
import { expect, test, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { navBar, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });

const tour = (page: Page) => page.getByTestId('tour');
const checklist = (page: Page) => page.getByTestId('getting-started');
const ticks = (page: Page) => checklist(page).getByRole('img', { name: 'Done' });

/** Answers /ai/questions like the helper: "Right n" is right. */
async function fakeQuestions(page: Page) {
  await page.route('**/ai/questions', async (route) => {
    const body = route.request().postDataJSON() as { pages: { page: number }[]; count: number };
    const questions = Array.from({ length: body.count }, (_, i) => ({
      question: `Question ${i + 1}?`,
      options: [`Right ${i + 1}`, `Wrong ${i + 1}`, `Other ${i + 1}`, `Else ${i + 1}`],
      answer: 0,
      page: body.pages[i % body.pages.length]!.page,
      explanation: 'Because.',
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
  });
}

test('a new user: the tour, then Getting started, each step linking on and ticking itself until it’s gone', async ({ page }) => {
  const problems = await watchProblems(page);
  await fakeQuestions(page);
  await openUnlocked(page);

  // The tour opens by itself after setup: three cards, Next and Back
  await expect(tour(page).getByTestId('tour-position')).toHaveText('1 of 3');
  await expect(tour(page).getByRole('heading', { name: 'Your classes' })).toBeVisible();
  await expect(tour(page).getByRole('button', { name: 'Next' })).toBeFocused();
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await expect(tour(page).getByRole('heading', { name: 'After each lecture' })).toBeVisible();
  await tour(page).getByRole('button', { name: 'Back' }).click();
  await expect(tour(page).getByTestId('tour-position')).toHaveText('1 of 3');
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await expect(tour(page).getByRole('heading', { name: 'Every day' })).toBeVisible();
  await tour(page).getByRole('button', { name: 'Let’s go' }).click();
  await expect(tour(page)).toBeHidden();

  // Getting started: nothing done; step 1 goes straight to adding a class
  await expect(page.getByTestId('start-step')).toHaveCount(3);
  await expect(ticks(page)).toHaveCount(0);
  await checklist(page).getByRole('link', { name: 'Add a class' }).click();
  await expect(page).toHaveURL(/#\/classes\/new$/);
  const form = page.getByRole('form', { name: 'New class' });
  await form.getByLabel('Class name').fill('BIO 110');
  await form.getByRole('button', { name: 'Add class' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'BIO 110' })).toBeVisible();
  await page.getByRole('link', { name: '← Classes' }).click();
  await navBar(page).getByRole('link', { name: 'Tasks' }).click();
  await expect(ticks(page)).toHaveCount(1);

  // Step 2 goes to the class, to say what a lecture covered
  await checklist(page).getByRole('link', { name: 'Add what a lecture covered' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'BIO 110' })).toBeVisible();
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const lecture = page.getByRole('form', { name: 'What was covered?' });
  await lecture.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(4)));
  await lecture.getByLabel('Lecture date').fill('2026-11-02');
  await lecture.getByLabel('Minutes').fill('50');
  await lecture.getByLabel('First slide').fill('1');
  await lecture.getByLabel('Last slide').fill('4');
  await lecture.getByLabel(/Make quiz questions now/).uncheck();
  await lecture.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toContainText('Cells, slides 1–4');
  await page.getByRole('link', { name: '← Classes' }).click();
  await navBar(page).getByRole('link', { name: 'Tasks' }).click();
  await expect(ticks(page)).toHaveCount(2);

  // Step 3: a first quiz (here from the class page), and Getting started is done and gone
  await navBar(page).getByRole('link', { name: 'Classes' }).click();
  await page.getByRole('heading', { level: 3, name: 'BIO 110' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Quiz on Cells, slides 1–4' }).click();
  await page.getByRole('button', { name: 'Make questions' }).click();
  await page.getByRole('button', { name: /Start the quiz/ }).click();
  const total = Number((await page.getByTestId('quiz-position').innerText()).match(/of (\d+)/)![1]);
  for (let n = 1; n <= total; n++) {
    await page.getByRole('group', { name: 'Answers' }).getByRole('button', { name: /Right/ }).click();
    await page.getByTestId('quiz-feedback').getByRole('button', { name: n < total ? 'Next question' : 'See your score' }).click();
  }
  await expect(page.getByTestId('quiz-score')).toBeVisible();
  await page.goto('/#/');
  await reloadUnlocked(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
  await expect(checklist(page)).toBeHidden();
  await expect(tour(page)).toBeHidden(); // seen once: not again
  expect(await problems()).toEqual([]);
});

test('Skip hides Getting started for good; Escape closes the tour; Settings opens it again', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await expect(tour(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour(page)).toBeHidden();

  await checklist(page).getByRole('button', { name: 'Skip this' }).click();
  await expect(checklist(page)).toBeHidden();
  await reloadUnlocked(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
  await expect(checklist(page)).toBeHidden();
  await expect(tour(page)).toBeHidden();

  // Settings: "How Honed works" opens the tour on Tasks; closing it comes back to the plain Tasks page
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: /works$/ }).click();
  await expect(page).toHaveURL(/#\/tour$/);
  await expect(tour(page).getByRole('heading', { name: 'Your classes' })).toBeVisible();
  await tour(page).getByRole('button', { name: 'Close' }).click();
  await expect(tour(page)).toBeHidden();
  await expect(page).toHaveURL(/#\/$/);
  expect(await problems()).toEqual([]);
});
