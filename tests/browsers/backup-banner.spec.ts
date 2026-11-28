// The backup reminder banner's look (#182, from Matt's bug reports 6 and 7): it sits clear of the header's Lock
// button, and its actions match: Back up now filled, Settings and Not now outlined pills, all the same height,
// kept together on one row (phones too).
import { expect, test } from './fixtures';
import { addClassAndReturn } from './class-helpers';
import { reloadUnlocked, setUpWithPassphrase } from './lock-helpers';

const DAY = 24 * 60 * 60 * 1000;

test('the backup reminder sits clear of Lock, and its actions match', async ({ page }) => {
  await page.goto('/');
  await setUpWithPassphrase(page);
  await addClassAndReturn(page, 'Banner class');
  // Weeks later with no backup made: the reminder is due
  await page.clock.setSystemTime(Date.now() + 30 * DAY);
  await reloadUnlocked(page);
  const banner = page.getByTestId('backup-banner');
  await expect(banner).toContainText('You haven’t made a backup yet.');

  // Clear of Lock: at least 8 px between the bottom of the button and the banner's border
  const lock = (await page.getByRole('button', { name: 'Lock', exact: true }).boundingBox())!;
  const box = (await banner.boundingBox())!;
  expect(box.y - (lock.y + lock.height), 'space between Lock and the banner').toBeGreaterThanOrEqual(8);

  // The actions: same height and shape, Back up now filled, the others outlined
  const actions = [
    banner.getByRole('button', { name: 'Back up now' }),
    banner.getByRole('link', { name: 'Settings' }),
    banner.getByRole('button', { name: 'Not now' }),
  ];
  const looks = await Promise.all(
    actions.map((a) =>
      a.evaluate((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height), radius: s.borderTopLeftRadius, border: s.borderTopWidth, line: s.textDecorationLine, background: s.backgroundColor };
      }),
    ),
  );
  for (const look of looks) {
    expect(look.height).toBe(looks[0]!.height);
    expect(look.radius).toBe(looks[0]!.radius);
    expect(look.border).toBe(looks[0]!.border);
    expect(look.line).toBe('none');
  }
  expect(looks[0]!.background, 'Back up now is filled').not.toBe(looks[1]!.background);
  expect(looks[1]!.background, 'Settings and Not now look the same').toBe(looks[2]!.background);
  for (const look of looks) expect(look.top, 'the actions on one row (phones too)').toBe(looks[0]!.top);

  // Not now still closes it
  await actions[2]!.click();
  await expect(banner).toHaveCount(0);
});
