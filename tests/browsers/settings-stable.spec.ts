// #92: Settings must not move after it's first drawn. Its sections used to load their own data after the page
// appeared (Study time, Sync, Compare models, Storage), growing the page under a tap: on an iPhone the
// "Restore from a backup…" button moved ~470 px within 0.1 s of appearing, so a tap (a person's or a test's)
// landed where it had been and the restore box never opened. Now Settings loads all of it before drawing.
//
// The browser's storage estimate is slowed here, so the old behaviour fails on every device, not only when the
// machine is busy; the IndexedDB loads are left as they are (WebKit catches those on its own).
import { expect, test } from './fixtures';
import { setUpWithPassphrase } from './lock-helpers';
import { addClassAndReturn } from './class-helpers';

test('Settings draws once: no heading or button moves after the page appears', async ({ page }) => {
  await page.addInitScript(() => {
    const storage = navigator.storage as StorageManager | undefined;
    if (!storage?.estimate) return;
    const estimate = storage.estimate.bind(storage);
    storage.estimate = () => new Promise((done) => setTimeout(() => done(estimate()), 400));
  });
  await page.goto('/');
  await setUpWithPassphrase(page);
  await addClassAndReturn(page, 'Stable class');

  // Every frame from the one where Settings first shows: where each heading and button is
  await page.evaluate(() => {
    const w = window as unknown as { layouts: string[] };
    w.layouts = [];
    const t0 = performance.now();
    const tick = () => {
      if (document.getElementById('settings-title')) {
        const where = (e: Element) => `${e.textContent?.trim()}@${Math.round(e.getBoundingClientRect().top + window.scrollY)}`;
        const layout = [...document.querySelectorAll('.settings h3, .settings button')].map(where).join(' | ');
        if (w.layouts[w.layouts.length - 1] !== layout) w.layouts.push(layout);
      }
      if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('storage-state')).toBeVisible();
  await page.waitForTimeout(1500); // past the slowed estimate and every load
  const layouts = await page.evaluate(() => (window as unknown as { layouts: string[] }).layouts);
  expect(layouts.length).toBeGreaterThan(0);
  expect(layouts, 'the page changed after it first appeared').toEqual([layouts[0]]);

  // And the tap that used to miss opens the restore box
  await page.getByRole('button', { name: 'Restore from a backup…' }).click();
  await expect(page.getByLabel(/Backup file/)).toBeVisible();
});
