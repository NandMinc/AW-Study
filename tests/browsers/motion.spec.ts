// Page transitions (#149, src/ui/page-motion.ts): a new screen slides in from the side it comes from, the same
// screen doesn't move, nothing after unlocking, and nothing with reduced motion. Browser tests default to reduced
// motion (playwright.config.ts); these turn it back on.
import { expect, test, type Page } from './fixtures';
import { addClass, navBar, watchProblems } from './class-helpers';
import { openUnlocked, unlockWithPassphrase } from './lock-helpers';

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
