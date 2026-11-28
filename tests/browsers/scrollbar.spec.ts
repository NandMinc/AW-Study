// #184 (bug report 8, Matt, Chrome on Windows): the nav bar shifted sideways on entering Settings. Settings is
// taller than the window, so desktop Chrome gives it a classic scrollbar that Tasks (shorter) doesn't have; the
// viewport loses the scrollbar's width and everything centred in it (the fixed nav bar, the page column) jumps by
// half of that. Now every page keeps the scrollbar's space (`scrollbar-gutter: stable` on html, src/app.css).
//
// Playwright's headless Chromium hides scrollbars (--hide-scrollbars), which hides this bug, so the test launches
// its own Chromium without that flag. Phones (the Android and iPhone projects) have overlay scrollbars that take
// no space, so this is desktop only.
import { expect, fastKdf, test } from './fixtures';
import { navBar } from './class-helpers';
import { openUnlocked } from './lock-helpers';

test('the nav bar and the page stay put between a short page and a long one with a scrollbar', async ({ playwright, browserName }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'phones have overlay scrollbars');
  expect(browserName).toBe('chromium');
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    const { baseURL, storageState, contextOptions } = testInfo.project.use;
    // Short enough that Settings scrolls and the empty Tasks page doesn't
    const context = await browser.newContext({ ...contextOptions, baseURL, storageState, viewport: { width: 1280, height: 720 } });
    await fastKdf(context);
    const page = await context.newPage();
    await openUnlocked(page);
    const nav = navBar(page);

    const where = async (heading: string) => {
      const h2 = page.getByRole('heading', { level: 2, name: heading });
      await expect(h2).toBeVisible();
      const bar = (await nav.boundingBox())!;
      const title = (await h2.boundingBox())!;
      const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
      const gutter = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
      return { barX: bar.x, titleX: title.x, scrolls, gutter };
    };

    const tasks = await where('Tasks');
    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('button', { name: 'Lock now' })).toBeVisible(); // Settings fully drawn
    const settings = await where('Settings');

    // The setup this test needs: Tasks fits, Settings scrolls, and the scrollbar really takes space
    expect(tasks.scrolls).toBe(false);
    expect(settings.scrolls).toBe(true);
    expect(settings.gutter).toBeGreaterThan(0);

    expect(settings.barX).toBe(tasks.barX);
    expect(settings.titleX).toBe(tasks.titleX);
    await context.close();
  } finally {
    await browser.close();
  }
});
