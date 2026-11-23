// The after-class reminder (#129) through the real screens, in desktop Chrome, an Android phone and an iPhone
// (WebKit), on a clock the test controls, in Los Angeles. BIO 110 meets Monday, Wednesday and Friday at 10:00
// for 50 minutes, and is added on Monday Nov 16, 2026 at 9:00.
import { expect, test, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, navBar, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });

const at = (date: string, time: string) => new Date(`${date}T${time}:00-08:00`);
const popup = (page: Page) => page.getByTestId('after-class');

/** Moves the clock on, then the app "comes back into view" (as when the phone is picked up again). */
async function later(page: Page, date: string, time: string) {
  await page.clock.setSystemTime(at(date, time));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: at('2026-11-16', '09:00') });
});

test('after a lecture, opening Honed links to it; Later waits until tomorrow; filling it in ends it; never over Play', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await addClass(page, 'BIO 110', { days: ['Mon', 'Wed', 'Fri'], start: '10:00', minutes: 50 });
  await page.getByRole('link', { name: '← Classes' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes', exact: true })).toBeVisible();
  await expect(popup(page)).toBeHidden(); // nothing has happened since it was added

  // During the lecture: nothing yet. Once it has ended: the reminder, linking to that lecture
  await later(page, '2026-11-16', '10:30');
  await navBar(page).getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
  await expect(popup(page)).toBeHidden();
  await later(page, '2026-11-16', '11:00');
  await expect(popup(page).getByRole('heading', { name: 'BIO 110 had a lecture' })).toBeVisible();
  await expect(popup(page)).toContainText('On Mon, Nov 16.');
  const link = popup(page).getByRole('link', { name: 'Add what BIO 110 covered on Mon, Nov 16' });
  await expect(link).toBeFocused();
  await link.click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await expect(form.getByLabel('Lecture date')).toHaveValue('2026-11-16');
  await expect(form.getByLabel('Minutes')).toHaveValue('50');
  // Seen: coming back without filling it in doesn't ask again today
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes', exact: true })).toBeVisible();
  await expect(popup(page)).toBeHidden();

  // Wednesday after class: Monday's is back, with Wednesday's, newest first
  await later(page, '2026-11-18', '11:00');
  await expect(popup(page).getByRole('heading', { name: 'Lectures to fill in' })).toBeVisible();
  await expect(popup(page).getByTestId('after-class-lecture')).toHaveText([/BIO 110 · Wed, Nov 18/, /BIO 110 · Mon, Nov 16/]);
  // Later: gone for the day, on every main page and after a reload
  await popup(page).getByRole('button', { name: 'Later' }).click();
  await expect(popup(page)).toBeHidden();
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  await reloadUnlocked(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
  await later(page, '2026-11-18', '20:00');
  await expect(popup(page)).toBeHidden();

  // Thursday: never over Play; back on a main page, it asks. Escape works like Later
  await page.clock.setSystemTime(at('2026-11-19', '09:00'));
  await page.evaluate(() => (window.location.hash = '#/play'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page).toHaveURL(/#\/play$/);
  await expect(popup(page)).toBeHidden();
  await page.evaluate(() => (window.location.hash = '#/'));
  await expect(popup(page).getByTestId('after-class-lecture')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toBeHidden();

  // Friday: fill in Monday's from the reminder; then only the other two are left
  await later(page, '2026-11-20', '11:00');
  await expect(popup(page).getByTestId('after-class-lecture')).toHaveText([/Fri, Nov 20/, /Wed, Nov 18/, /Mon, Nov 16/]);
  await popup(page).getByRole('link', { name: 'Add what BIO 110 covered on Mon, Nov 16' }).click();
  await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(3)));
  await form.getByLabel('First slide').fill('1');
  await form.getByLabel('Last slide').fill('3');
  await form.getByLabel(/Make quiz questions now/).uncheck();
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes', exact: true })).toBeVisible();
  await expect(popup(page)).toBeHidden(); // put off for today when its link was followed
  await later(page, '2026-11-21', '09:00');
  await expect(popup(page).getByTestId('after-class-lecture')).toHaveText([/Fri, Nov 20/, /Wed, Nov 18/]);
  expect(await problems()).toEqual([]);
});

test('many lectures: the first four, and a link to the rest on the Classes page; a tap outside is Later', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await addClass(page, 'Daily', { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start: '10:00', minutes: 50 });
  await page.getByRole('link', { name: '← Classes' }).click();
  await later(page, '2026-11-21', '12:00'); // Saturday: Monday to Saturday, 6 lectures
  await expect(popup(page).getByTestId('after-class-lecture')).toHaveCount(4);
  await expect(popup(page).getByRole('link', { name: 'And 2 more on the Classes page' })).toBeVisible();
  await page.mouse.click(5, 5); // the backdrop
  await expect(popup(page)).toBeHidden();
  await later(page, '2026-11-21', '13:00');
  await expect(popup(page)).toBeHidden();
  expect(await problems()).toEqual([]);
});
