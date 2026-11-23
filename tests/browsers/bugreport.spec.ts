// The bug button (#141, public/bugreport.js): off for everyone, on after ?bugs=on or Settings' switch; it takes
// a picture of the screen, asks for a note and sends both to Nathan's admin site. The test answers for the admin
// site itself: nothing is sent anywhere.
import { expect, test, type Page } from './fixtures';
import { navBar, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block' }); // Playwright's routing doesn't see a service worker's requests

const ENDPOINT = 'https://admin.pacificfish.ca/api/bugs';
type Sent = { type: string; extra?: string; body: { app: string; note: string; image: string | null } };

async function fakeAdmin(page: Page, base: string) {
  const sent: Sent[] = [];
  await page.route(ENDPOINT, async (route) => {
    const req = route.request();
    sent.push({ type: req.headers()['content-type'] ?? '', extra: req.headers()['x-requested-with'], body: JSON.parse(req.postData() ?? '{}') });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true,"id":1}',
      headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true' },
    });
  });
  return sent;
}

test('the bug button is off until ?bugs=on, then sends a picture and a note to the admin site', async ({ page, baseURL }) => {
  const problems = await watchProblems(page);
  const sent = await fakeAdmin(page, baseURL!);
  await openUnlocked(page);
  await expect(navBar(page)).toBeVisible();
  await expect(page.locator('.bugreport-button')).toHaveCount(0); // visitors never see it

  await page.goto('/?bugs=on');
  const button = page.locator('button.bugreport-button');
  await expect(button).toBeVisible();
  expect(new URL(page.url()).search).toBe(''); // the address is tidied
  await openUnlocked(page);
  await button.click();
  const box = page.locator('dialog.bugreport-box');
  await expect(box).toBeVisible();
  const src = await box.locator('img').getAttribute('src');
  expect(src, await box.locator('p').first().innerText()).toMatch(/^data:image\/jpeg;base64,/);
  await box.getByRole('textbox', { name: 'Note' }).fill('Tasks looks wrong');
  await box.getByRole('button', { name: 'Save' }).click();
  await expect(box).toHaveCount(0);
  expect(sent).toHaveLength(1);
  expect(sent[0].body.app).toBe('honed');
  expect(sent[0].body.note).toBe('Tasks looks wrong');
  expect(sent[0].body.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(sent[0].type).toMatch(/^text\/plain/); // a plain request: no preflight
  expect(sent[0].extra).toBeUndefined();
  expect(await problems()).toEqual([]);
});

test('Settings turns the bug button on and off on this device', async ({ page }) => {
  await openUnlocked(page);
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  const row = page.getByRole('heading', { name: 'Bug button' });
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Turn on the bug button' }).click(); // reloads, which locks
  await expect(page.locator('button.bugreport-button')).toBeVisible();
  await openUnlocked(page, '/#/settings');
  await page.getByRole('button', { name: 'Turn off the bug button' }).click();
  await expect(page.getByRole('heading', { name: /^Unlock/ })).toBeVisible();
  await expect(page.locator('.bugreport-button')).toHaveCount(0);
});
