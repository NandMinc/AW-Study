// #194 EXPERIMENT (branch only, not for merging as is): clicking through setup vs. starting from a ready-made
// database (Playwright storageState with IndexedDB) and unlocking. Prints PROBE lines with the times.
import { expect, fastKdf, keepDrawing, test, type BrowserContext, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, navBar, pdfFile } from './class-helpers';
import { openUnlocked, unlockWithPassphrase } from './lock-helpers';

test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });
const NOW = new Date('2026-11-18T10:00:00-08:00');

async function answerQuestions(page: Page) {
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
}

/** practice.spec.ts finalOnFriday, after setup: a class, a lecture with slides and a bank, a final on Friday. */
async function content(page: Page) {
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
  await expect(page.getByTestId('task-practice')).toHaveText('Practice for BIO 110’s Final (in 2 days)');
}

test('ready-made database: clicking through vs restoring', async ({ browser, browserName, page, context }, info) => {
  test.setTimeout(240_000);
  const timed = async <T,>(fn: () => Promise<T>) => {
    const t = performance.now();
    await fn();
    return Math.round(performance.now() - t);
  };
  await page.clock.install({ time: NOW });
  await answerQuestions(page);

  const setup = await timed(() => openUnlocked(page));
  const vault = await context.storageState({ indexedDB: true });
  const built = await timed(() => content(page));
  const full = await context.storageState({ indexedDB: true });

  const restore = async (state: typeof vault, check: (p: Page) => Promise<void>) => {
    let other: BrowserContext | undefined;
    const ms = await timed(async () => {
      other = await browser.newContext({ ...info.project.use, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', storageState: state });
      await keepDrawing(other, browserName);
      await fastKdf(other);
      const p = await other.newPage();
      await p.clock.install({ time: NOW });
      await p.goto('/');
      await unlockWithPassphrase(p);
      await check(p);
    });
    await other!.close();
    return ms;
  };
  const times = { restoreVault: [] as number[], restoreFull: [] as number[] };
  for (let i = 0; i < 3; i++) {
    times.restoreVault.push(await restore(vault, async (p) => expect(p.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible()));
    times.restoreFull.push(
      await restore(full, async (p) => expect(p.getByTestId('task-practice')).toHaveText('Practice for BIO 110’s Final (in 2 days)')),
    );
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[1];
  const kb = Math.round(JSON.stringify(full).length / 1024);
  console.log(
    `PROBE ${info.project.name} setup ${setup} content ${built} | restoreVault ${med(times.restoreVault)} restoreFull ${med(times.restoreFull)} | fullState ${kb} KB`,
  );
});
