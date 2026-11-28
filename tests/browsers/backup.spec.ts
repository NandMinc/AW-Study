// Backups (#18) through the real screens: download a backup, restore it on a new device (a fresh
// browser context) and on this one, and refuse a wrong passphrase or a file that isn't a backup.
// Desktop Chrome, Android and iPhone (WebKit).
//
// Not covered here: automatic backups to a folder. Playwright can't answer the browser's folder
// picker (showDirectoryPicker), so the folder logic is unit-tested with a fake folder instead
// (src/backup/folder.test.ts).
import { readFile } from 'node:fs/promises';
import { expect, fastKdf, keepDrawing, test, type Page } from './fixtures';
import { PASSPHRASE, setUpWithPassphrase, unlockWithPassphrase } from './lock-helpers';
import { addClassAndReturn, toClasses } from './class-helpers';

const MARKER = 'Quokka5Marker';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  return errors;
}

/** From Settings: downloads a backup and returns the file's path. */
async function downloadBackup(page: Page): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download a backup' }).click()]);
  expect(download.suggestedFilename()).toMatch(/-backup-\d{4}-\d\d-\d\d-\d{4}\.honed$/);
  return (await download.path())!;
}

/** In the restore panel: picks the file, opens it with the passphrase, and confirms. */
async function restore(page: Page, file: string, confirmLabel: string) {
  await page.getByLabel(/Backup file/).setInputFiles(file);
  await page.getByLabel('The backup’s passphrase').fill('not the passphrase');
  await page.getByRole('button', { name: 'Open backup' }).click();
  await expect(page.getByRole('alert')).toContainText('doesn’t unlock');
  await page.getByLabel('The backup’s passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Open backup' }).click();
  await expect(page.getByTestId('backup-summary')).toContainText('1 class');
  await page.getByRole('button', { name: 'Restore this backup' }).click();
  await page.getByRole('button', { name: confirmLabel, exact: true }).click();
}

test('download a backup with no plaintext in it, then restore it on a new device', async ({ page, browser, browserName }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await setUpWithPassphrase(page);
  await addClassAndReturn(page, `${MARKER} class`);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('last-backup')).toHaveText('No backup yet.');
  await expect(page.getByTestId('storage-state')).toBeVisible();

  const file = await downloadBackup(page);
  const text = await readFile(file, 'utf8');
  expect(text).toContain('"format":"honed-backup"');
  expect(text).not.toContain(MARKER);
  await expect(page.getByTestId('last-backup')).toHaveText('Last backup: today.');

  // A new device: an empty browser with the same screen
  const other = await browser.newContext(test.info().project.use);
  await keepDrawing(other, browserName);
  await fastKdf(other); // the same rounds as the first device (fixtures.ts)
  const fresh = await other.newPage();
  const freshErrors = watchErrors(fresh);
  await fresh.goto('/');
  await fresh.getByRole('button', { name: /Restore a backup/ }).click();
  await restore(fresh, file, 'Restore');
  await toClasses(fresh);
  await expect(fresh.getByTestId('class-row').filter({ hasText: `${MARKER} class` })).toBeVisible();

  // It stays: a reload locks, and the backup's passphrase opens it
  await fresh.reload();
  await unlockWithPassphrase(fresh);
  await expect(fresh.getByTestId('class-row').filter({ hasText: `${MARKER} class` })).toBeVisible();
  await other.close();
  expect(errors).toEqual([]);
  expect(freshErrors).toEqual([]);
});

test('restoring in Settings replaces this device’s data; a file that isn’t a backup changes nothing', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await setUpWithPassphrase(page);
  await addClassAndReturn(page, 'In the backup');
  await page.getByRole('link', { name: 'Settings' }).click();
  const file = await downloadBackup(page);
  await toClasses(page);
  await addClassAndReturn(page, 'Added later');

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Restore from a backup…' }).click();
  await page.getByLabel(/Backup file/).setInputFiles({ name: 'notes.honed', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole('alert')).toContainText('isn’t a backup');

  await restore(page, file, 'Replace with the backup');
  await expect(page.getByRole('status').filter({ hasText: 'Backup restored.' })).toBeVisible();
  await toClasses(page);
  await expect(page.getByTestId('class-row').filter({ hasText: 'In the backup' })).toBeVisible();
  await expect(page.getByTestId('class-row').filter({ hasText: 'Added later' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
