// The look (#68, docs/design/README.md): the nav bar on the three main pages, the Phone / Light / Dark
// setting (kept on the device, so the unlock screen has it too) and the bundled font. Desktop Chrome,
// an Android phone and an iPhone (WebKit).
import { expect, test, type Page } from './fixtures';
import { addClass, navBar, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

const GREY = 'rgb(39, 39, 39)'; // #272727
const WHITE = 'rgb(242, 245, 241)'; // #f2f5f1
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const barColour = (page: Page) => page.locator('meta[name="theme-color"]').getAttribute('content');

test('the nav bar goes between Tasks, Classes and Settings, showing where you are; full-screen screens hide it', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  const nav = navBar(page);
  const current = nav.locator('[aria-current="page"]');

  // Tasks is the home page
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
  await expect(current).toHaveAccessibleName('Tasks');
  await expect(current).toHaveCount(1);

  await nav.getByRole('link', { name: 'Classes' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes' })).toBeVisible();
  await expect(page).toHaveURL(/#\/classes$/);
  await expect(current).toHaveAccessibleName('Classes');

  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
  await expect(current).toHaveAccessibleName('Settings');
  // The bar never covers the end of a long page (Settings, once all of it is there, is longer than the screen)
  await expect(page.getByRole('button', { name: 'Lock now' })).toBeVisible();
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const bar = (await nav.boundingBox())!;
    const lastLine = (await page.getByRole('contentinfo').locator('span').last().boundingBox())!;
    expect(lastLine.y + lastLine.height).toBeLessThanOrEqual(bar.y);
  }).toPass();

  // A class's own screen is full-screen: no bar, a back link instead
  await addClass(page, 'COMP 2000');
  await expect(nav).toBeHidden();
  await page.getByRole('link', { name: '← Classes' }).click();
  await expect(current).toHaveAccessibleName('Classes');

  await nav.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('tasks-empty')).toContainText('Nothing to study yet');
  expect(await problems()).toEqual([]);
});

test('Phone, Light or Dark: chosen in Settings, kept on this device, and used on the unlock screen too', async ({ page }) => {
  const problems = await watchProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await openUnlocked(page);
  expect(await background(page)).toBe(WHITE); // Phone, the default, follows the phone
  expect(await barColour(page)).toBe('#f2f5f1');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => background(page)).toBe(GREY);
  await expect.poll(() => barColour(page)).toBe('#272727');

  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  const colours = page.getByRole('group', { name: 'Colours' });
  await expect(colours.getByRole('button', { name: 'Phone' })).toHaveAttribute('aria-pressed', 'true');

  // Light, though the phone is dark
  await colours.getByRole('button', { name: 'Light' }).click();
  await expect(colours.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
  expect(await background(page)).toBe(WHITE);
  expect(await barColour(page)).toBe('#f2f5f1');

  // A reload locks: the unlock screen is already light
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Unlock/ })).toBeVisible();
  expect(await background(page)).toBe(WHITE);

  // Dark, though the phone is light
  await page.emulateMedia({ colorScheme: 'light' });
  await openUnlocked(page, '/#/settings');
  await page.getByRole('group', { name: 'Colours' }).getByRole('button', { name: 'Dark' }).click();
  expect(await background(page)).toBe(GREY);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Unlock/ })).toBeVisible();
  expect(await background(page)).toBe(GREY);

  // Back to Phone: nothing kept, the phone decides again
  await openUnlocked(page, '/#/settings');
  await page.getByRole('group', { name: 'Colours' }).getByRole('button', { name: 'Phone' }).click();
  expect(await background(page)).toBe(WHITE);
  expect(await page.evaluate(() => localStorage.getItem('honed:theme'))).toBeNull();
  expect(await problems()).toEqual([]);
});

test('the font is bundled with the app: loaded from this site, within the security policy', async ({ page, baseURL }) => {
  const problems = await watchProblems(page);
  const fonts: string[] = [];
  page.on('request', (r) => r.resourceType() === 'font' && fonts.push(r.url()));
  await openUnlocked(page);
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "Lexend Variable"'))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Lexend Variable"?,/);
  expect(fonts.length).toBeGreaterThan(0);
  for (const url of fonts) expect(url.startsWith(`${baseURL}/assets/lexend-`), url).toBe(true);
  expect(await problems()).toEqual([]);
});

test('the browser’s own controls follow the look: file pickers in our font, green checkboxes, quiet back links', async ({ page }) => {
  await openUnlocked(page);
  await addClass(page, 'COMP 2000');
  const look = await page.evaluate(() => {
    const file = document.querySelector('input[type="file"]')!;
    const back = document.querySelector('a.back')!;
    const root = getComputedStyle(document.documentElement);
    return {
      fileButtonFont: getComputedStyle(file, '::file-selector-button').fontFamily,
      backUnderline: getComputedStyle(back).textDecorationLine,
      backText: back.textContent,
      fill: root.getPropertyValue('--fill').trim(),
    };
  });
  expect(look.fileButtonFont).toMatch(/Lexend/);
  expect(look.backText).toBe('← Classes');
  expect(look.backUnderline).toBe('none');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const checkbox = page.getByRole('form', { name: 'What was covered?' }).getByRole('checkbox').first();
  expect(await checkbox.evaluate((el) => getComputedStyle(el).accentColor)).toBe('rgb(159, 232, 112)'); // #9fe870
});

// The nav bar's pill slides (#143): one element behind the buttons, under the current page, sliding to the new page
// when one is pressed; hover only rings an icon (#147, with a mouse); no movement with reduced motion.
test.describe('the nav bar pill slides', () => {
  const ACCENT_DARK = 'rgb(159, 232, 112)'; // --accent in dark, #9fe870
  /** How far the pill's middle is from a button's middle, in pixels (0 once it has slid there). */
  const offset = (page: Page, label: string) =>
    navBar(page).evaluate((nav, name) => {
      const pill = nav.querySelector('.nav-pill')!.getBoundingClientRect();
      const button = nav.querySelector(`a[aria-label="${name}"]`)!.getBoundingClientRect();
      return Math.round(Math.abs(pill.left + pill.width / 2 - (button.left + button.width / 2)));
    }, label);
  const colour = (page: Page, label: string) => navBar(page).getByRole('link', { name: label }).evaluate((a) => getComputedStyle(a).color);
  test.use({ contextOptions: { reducedMotion: 'no-preference' } }); // tests default to reduced motion (#149)

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openUnlocked(page);
  });

  test('it sits under the current page and slides to the next, the bar staying the same element', async ({ page }) => {
    const nav = navBar(page);
    await expect.poll(() => offset(page, 'Tasks')).toBe(0);
    expect(await nav.locator('.nav-pill').evaluate((p) => getComputedStyle(p).transitionDuration)).toBe('0.3s');
    await nav.evaluate((n) => ((n as HTMLElement & { marked?: boolean }).marked = true));

    await nav.getByRole('link', { name: 'Classes' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Classes' })).toBeVisible();
    await expect.poll(() => offset(page, 'Classes')).toBe(0);
    expect(await nav.evaluate((n) => (n as HTMLElement & { marked?: boolean }).marked)).toBe(true); // not drawn again: it slid

    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect.poll(() => offset(page, 'Settings')).toBe(0);
  });

  test('hovering rings an icon in green but leaves the pill on your page; not on a phone (#147)', async ({ page }, info) => {
    const ring = (label: string) => navBar(page).getByRole('link', { name: label }).evaluate((a) => getComputedStyle(a).boxShadow);
    await expect.poll(() => offset(page, 'Tasks')).toBe(0);
    await navBar(page).getByRole('link', { name: 'Settings' }).hover();
    if (info.project.name === 'desktop') {
      await expect.poll(() => ring('Settings')).toContain(ACCENT_DARK);
    } else {
      await page.waitForTimeout(400); // a tap leaves a phone "hovering": no ring left behind
      expect(await ring('Settings')).toBe('none');
    }
    await page.waitForTimeout(400); // longer than the slide: the pill hasn't moved
    expect(await offset(page, 'Tasks')).toBe(0);
    expect(await colour(page, 'Tasks')).toBe(GREY);
    expect(await colour(page, 'Settings')).toBe(ACCENT_DARK);
    // Your own page gets no ring
    await navBar(page).getByRole('link', { name: 'Tasks' }).hover();
    await page.waitForTimeout(250);
    expect(await ring('Tasks')).toBe('none');
  });

  test('with reduced motion it moves at once', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    expect(await navBar(page).locator('.nav-pill').evaluate((p) => getComputedStyle(p).transitionDuration)).toBe('0s');
  });
});
