// Page transitions (#149, src/ui/page-motion.ts) and new ticks on Tasks (#153, src/ui/tick-memory.ts): a new screen slides in from the side it comes from, the same
// screen doesn't move, nothing after unlocking, and nothing with reduced motion. Browser tests default to reduced
// motion (playwright.config.ts); these turn it back on.
import { expect, test, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, navBar, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked, unlockWithPassphrase } from './lock-helpers';

test.use({ contextOptions: { reducedMotion: 'no-preference' } });

const wrapper = (page: Page) => page.locator('main > .page');

/**
 * Where the current screen's slide starts, in pixels across (0 for a fade), or null when it doesn't move. Read from
 * its animation's first keyframe, not the running animation: on a slow phone the 0.24 s can be over before we look.
 */
const slideStart = (page: Page) =>
  wrapper(page).evaluate((el) => {
    const name = getComputedStyle(el).animationName;
    if (name === 'none') return null;
    const rule = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .find((r): r is CSSKeyframesRule => r instanceof CSSKeyframesRule && r.name === name);
    const from = rule?.findRule('from');
    if (!from) throw new Error(`no keyframes for ${name}`);
    const probe = document.createElement('div');
    probe.style.transform = from.style.transform || 'none'; // CSSOM, not a style attribute in HTML: the CSP allows it
    el.append(probe);
    const start = new DOMMatrix(getComputedStyle(probe).transform === 'none' ? '' : getComputedStyle(probe).transform).m41;
    probe.remove();
    return Math.round(start);
  });

const mark = (page: Page) => wrapper(page).evaluate((el) => ((el as HTMLElement & { marked?: boolean }).marked = true));
const marked = (page: Page) => wrapper(page).evaluate((el) => (el as HTMLElement & { marked?: boolean }).marked === true);

test('a new screen slides in from where it comes from; the same screen stays put', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
  expect(await slideStart(page)).toBeNull(); // the first screen after unlocking just appears

  // Each new screen is a new element, so its slide plays even when it goes the same way as the last
  for (const [name, start] of [['Classes', 24], ['Settings', 24], ['Classes', -24]] as const) {
    await mark(page);
    await navBar(page).getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    expect(await marked(page)).toBe(false);
    expect(await slideStart(page)).toBe(start); // to the right in the nav bar: from the right (1.5rem); left: from the left
  }

  await addClass(page, 'COMP 2000'); // a class's own page: deeper, from the right
  expect(await slideStart(page)).toBe(24);
  await page.getByRole('link', { name: '← Classes' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes' })).toBeVisible();
  expect(await slideStart(page)).toBe(-24); // back: from the left

  // The page you're on, again: nothing new comes in
  await mark(page);
  await navBar(page).getByRole('link', { name: 'Classes' }).click();
  await page.waitForTimeout(300);
  expect(await marked(page)).toBe(true); // not drawn again, so not slid in again
  expect(await problems()).toEqual([]);
});

test('after unlocking the first screen just appears', async ({ page }) => {
  await openUnlocked(page);
  await navBar(page).getByRole('link', { name: 'Classes' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes' })).toBeVisible();
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await unlockWithPassphrase(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
  expect(await slideStart(page)).toBeNull();
});

test('with reduced motion nothing slides', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openUnlocked(page);
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
  expect(await slideStart(page)).toBeNull();
});

// Ticking off a task (#153): a tick done since Tasks was last shown draws itself in; one already seen stays still.
test.describe('new ticks on Tasks', () => {
  test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });

  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-18T10:00:00-08:00') });
    await page.route('**/ai/questions', async (route) => {
      const body = route.request().postDataJSON() as { pages: { page: number }[]; count: number };
      const questions = Array.from({ length: body.count }, (_, i) => ({
        question: `Question ${i + 1}?`,
        options: [`Right ${i + 1}`, `Wrong ${i + 1}`, `Other ${i + 1}`, `Else ${i + 1}`],
        answer: 0,
        page: body.pages[i % body.pages.length]!.page,
        explanation: 'Because the slide says so.',
      }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
    });
  });

  /** A class with yesterday's lecture, its quiz done, back on Tasks. */
  async function quizDone(page: Page) {
    await addClass(page, 'CHEM 101');
    await page.getByRole('button', { name: 'What was covered?' }).click();
    const form = page.getByRole('form', { name: 'What was covered?' });
    await form.getByLabel(/Upload the slides|Or upload a new PDF/).setInputFiles(pdfFile('chem.pdf', numberedSlides(4)));
    await form.getByLabel('Lecture date').fill('2026-11-17');
    await form.getByLabel('Minutes').fill('30');
    await form.getByLabel('First slide').fill('2');
    await form.getByLabel('Last slide').fill('4');
    await form.getByLabel(/Make quiz questions now/).uncheck();
    await form.getByRole('button', { name: 'Save lecture' }).click();
    await expect(page.getByTestId('lecture-row')).toHaveCount(1);
    await page.getByRole('link', { name: '← Classes' }).click();
    await navBar(page).getByRole('link', { name: 'Tasks' }).click();
    await expect(chem(page).getByTestId('task-status')).toHaveText('New'); // Tasks has seen it, not done
    await chem(page).getByRole('button', { name: /^CHEM 101/ }).click();
    await chem(page).getByRole('link', { name: 'Quiz' }).click();
    await page.getByRole('button', { name: 'Make questions' }).click();
    await page.getByRole('button', { name: /Start the quiz/ }).click();
    for (let n = 1; n <= 10; n++) {
      await expect(page.getByTestId('quiz-position')).toHaveText(`Question ${n} of 10`);
      await page.getByRole('group', { name: 'Answers' }).getByRole('button', { name: /Right/ }).click();
      await page.getByTestId('quiz-feedback').getByRole('button', { name: n < 10 ? 'Next question' : 'See your score' }).click();
    }
    await expect(page.getByTestId('quiz-score')).toContainText('10 of 10');
    await page.evaluate(() => (location.hash = '#/'));
    await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
  }
  const chem = (page: Page) => page.getByTestId('task-class').filter({ hasText: 'CHEM 101' });
  /** How a tick comes in: its pop and its stroke's animations, or 'none'. */
  const motionOf = (page: Page, name: string) =>
    chem(page)
      .getByRole('img', { name })
      .evaluate((svg) => `${getComputedStyle(svg).animationName} ${getComputedStyle(svg.querySelector('path')!).animationName}`);
  /** The stroke's first keyframe: how much of the tick is hidden as it starts drawing (1 = all of it). */
  const drawStart = (page: Page) =>
    page.evaluate(() => {
      const rule = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .find((r): r is CSSKeyframesRule => r instanceof CSSKeyframesRule && r.name === 'tick-draw');
      return parseFloat(rule?.findRule('from')?.style.strokeDashoffset ?? ''); // '1' or '1px', by browser
    });

  test('a tick done while you were away draws itself in; next time it just shows', async ({ page }) => {
    const problems = await watchProblems(page);
    await openUnlocked(page);
    await quizDone(page);
    expect(await motionOf(page, 'Done')).toBe('tick-pop tick-draw'); // the class, done just now
    expect(await drawStart(page)).toBe(1);
    await chem(page).getByRole('button', { name: /^CHEM 101/ }).click();
    expect(await motionOf(page, 'Quiz done')).toBe('tick-pop tick-draw'); // its lecture, opened after

    // Away and back: seen now, so still
    await navBar(page).getByRole('link', { name: 'Classes' }).click();
    await navBar(page).getByRole('link', { name: 'Tasks' }).click();
    expect(await motionOf(page, 'Done')).toBe('none none');

    // Opening the app again: nothing to compare with, so nothing draws
    await reloadUnlocked(page);
    expect(await motionOf(page, 'Done')).toBe('none none');
    expect(await problems()).toEqual([]);
  });

  test('with reduced motion a new tick just shows', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openUnlocked(page);
    await quizDone(page);
    await expect(chem(page).getByRole('img', { name: 'Done' })).toHaveClass('tick tick-new');
    expect(await motionOf(page, 'Done')).toBe('none none');
  });
});
