// Locking (#17) through the real screens: setup with a passphrase and the recovery key, unlocking,
// recovery, and changing how you unlock in Settings. Desktop Chrome, Android and iPhone (WebKit).
// Passkeys run in Chromium only, with a virtual authenticator: WebKit can't fake one, so on an
// iPhone they're tried by hand (see PR #21).
//
// Each test starts with an empty database (a fresh browser context).
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures';
import {
  chooseRemember,
  confirmRecoveryKey,
  PASSPHRASE,
  readRecoveryKey,
  setUpWithPassphrase,
  unlockWithPassphrase,
} from './lock-helpers';
import { makePdf } from '../../src/viewer/test-pdf';
import { addClass, addClassAndReturn, pdfFile } from './class-helpers';

// The real cost (#192): every other test runs PBKDF2 at 1,000 rounds (fixtures.ts fastKdf); setup and unlock here
// run the app's 600,000 on every device.
test.use({ realKdf: true });

test('the lock tests run with the browser’s own WebCrypto, at the real rounds', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => String(crypto.subtle.deriveKey))).toContain('[native code]');
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  return errors;
}

const unlockHeading = (page: Page) => page.getByRole('heading', { name: /^Unlock/ });
const alert = (page: Page) => page.getByRole('alert');

test('set up with a passphrase, then unlock after a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lock your classes and slides' })).toBeVisible();
  await expect(page.getByText(/Only you can unlock them/)).toBeVisible();

  // Too short, then not matching, are refused with a message
  await page.getByRole('button', { name: 'Use a passphrase' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('short');
  await expect(page.getByText(/at least 10 characters/)).toBeVisible();
  await page.getByLabel('Type it again').fill('short');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(alert(page)).toContainText('at least 10 characters');
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await expect(page.getByText('Strong.')).toBeVisible();
  await page.getByLabel('Type it again').fill(`${PASSPHRASE}!`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(alert(page)).toContainText('don’t match');
  await page.getByLabel('Type it again').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Continue' }).click();

  // The recovery key: shown once, says what losing it means, downloads, and must be typed back
  const recoveryKey = await readRecoveryKey(page);
  expect(recoveryKey).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  await expect(page.getByText(/your classes and slides are gone/)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toMatch(/-recovery-key\.txt$/); // no spaces: WebKit on Linux turns them into underscores
  expect(await readFile((await download.path())!, 'utf8')).toContain(recoveryKey);

  const save = page.getByRole('button', { name: /I’ve saved it/ });
  await expect(save).toBeDisabled();
  await page.getByLabel(/type group \d of your recovery key/).fill('ZZZZ');
  await expect(save).toBeDisabled();
  await confirmRecoveryKey(page, recoveryKey);
  await chooseRemember(page, false); // so the reload below asks (remembering: remember.spec.ts)
  await save.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks', exact: true })).toBeVisible(); // the home page
  await addClassAndReturn(page, 'Biology');

  // A reload locks; a wrong passphrase is refused; the right one opens the same classes
  await page.reload();
  await expect(unlockHeading(page)).toBeVisible();
  await expect(page.getByText('Biology')).toBeHidden();
  await page.getByLabel('Passphrase', { exact: true }).fill('not my passphrase');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(alert(page)).toContainText('doesn’t unlock');
  await unlockWithPassphrase(page);
  await expect(page.getByTestId('class-row').filter({ hasText: 'Biology' })).toBeVisible();

  // Lock from the header
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(unlockHeading(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('after setup, nothing a person wrote is readable in the browser’s database', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await setUpWithPassphrase(page);
  const marker = 'Zebrafish7Marker';
  // A class, a PDF whose bytes and page text hold the marker, and a lecture covering it
  await addClass(page, `${marker} class`);
  await page.getByRole('button', { name: 'What was covered?' }).click();
  await page.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile(`${marker}.pdf`, makePdf([{ title: `${marker} slide` }, { title: 'Two' }])));
  await page.getByLabel('First slide').fill('1');
  await page.getByLabel('Last slide').fill('2');
  await page.getByLabel('Minutes').fill('50');
  await page.getByLabel(/Make quiz questions now/).uncheck(); // these tests don't answer /ai/
  await page.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toContainText('slides 1–2');

  // Every record of every store in every database, bytes decoded as text, searched for the marker
  const dump = await page.evaluate(async () => {
    const text: string[] = [];
    const decode = (v: unknown): unknown =>
      v instanceof Uint8Array || v instanceof ArrayBuffer ? new TextDecoder().decode(v) : v;
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        const req = indexedDB.open(name!);
        req.onsuccess = () => ok(req.result);
        req.onerror = () => fail(req.error);
      });
      for (const store of db.objectStoreNames) {
        const rows = await new Promise<unknown[]>((ok, fail) => {
          const req = db.transaction(store).objectStore(store).getAll();
          req.onsuccess = () => ok(req.result);
          req.onerror = () => fail(req.error);
        });
        text.push(`${name}/${store}: ${JSON.stringify(rows, (_k, v) => decode(v))}`);
      }
      db.close();
    }
    return text.join('\n');
  });
  expect(dump).toContain('/courses:'); // the scan really read the stores
  expect(dump).toContain('/deckFiles:');
  expect(dump).not.toContain(marker);
  expect(errors).toEqual([]);
});

test('recover with the recovery key and choose a new passphrase', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  const recoveryKey = await setUpWithPassphrase(page);
  await addClassAndReturn(page, 'History');
  await page.reload();

  await page.getByRole('button', { name: 'Use your recovery key' }).click();
  await chooseRemember(page, false);
  const field = page.getByLabel('Recovery key');
  // A typo is caught as you type, before trying it
  const typo = recoveryKey.slice(0, -1) + (recoveryKey.endsWith('0') ? '1' : '0');
  await field.fill(typo);
  await expect(page.getByText('isn’t quite right')).toBeVisible();
  // Lower case and spaces instead of dashes are fine
  await field.fill(recoveryKey.toLowerCase().replaceAll('-', ' '));
  await expect(page.getByText('isn’t quite right')).toBeHidden();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Set a new passphrase' })).toBeVisible();
  const fresh = 'violet harbor engine maple';
  await page.getByLabel('New passphrase', { exact: true }).fill(fresh);
  await page.getByLabel('Type it again').fill(fresh);
  await page.getByRole('button', { name: 'Save and open' }).click();
  await expect(page.getByTestId('class-row').filter({ hasText: 'History' })).toBeVisible();

  // From now on, the new passphrase opens it and the old one doesn't
  await page.reload();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(alert(page)).toContainText('doesn’t unlock');
  await unlockWithPassphrase(page, fresh);
  expect(errors).toEqual([]);
});

test('Settings: change the passphrase and make a new recovery key', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  const oldRecoveryKey = await setUpWithPassphrase(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // Change the passphrase: prove it's you first (a wrong one is refused)
  await page.getByRole('button', { name: 'Change passphrase' }).click();
  await page.getByLabel('Current passphrase').fill('wrong wrong wrong');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(alert(page)).toContainText('doesn’t unlock');
  await page.getByLabel('Current passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Continue' }).click();
  const changed = 'cedar quartz lantern ferry';
  await page.getByLabel('New passphrase', { exact: true }).fill(changed);
  await page.getByLabel('Type it again').fill(changed);
  await page.getByRole('button', { name: 'Save passphrase' }).click();
  await expect(page.getByRole('status')).toContainText('Passphrase changed');

  // A new recovery key, proved with the recovery key this time
  await page.getByRole('button', { name: 'Make a new recovery key' }).click();
  await page.getByRole('button', { name: 'Use your recovery key instead' }).click();
  await page.getByLabel('Recovery key').fill(oldRecoveryKey);
  await page.getByRole('button', { name: 'Continue' }).click();
  const newRecoveryKey = await readRecoveryKey(page);
  expect(newRecoveryKey).not.toBe(oldRecoveryKey);
  await confirmRecoveryKey(page, newRecoveryKey);
  await page.getByRole('button', { name: /replace the old key/ }).click();
  await expect(page.getByRole('status')).toContainText('New recovery key saved');

  // Lock now; the old recovery key and old passphrase no longer work, the new ones do
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(unlockHeading(page)).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(alert(page)).toContainText('doesn’t unlock');
  await page.getByRole('button', { name: 'Use your recovery key' }).click();
  await page.getByLabel('Recovery key').fill(oldRecoveryKey);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(alert(page)).toContainText('recovery key doesn’t unlock');
  await page.getByRole('button', { name: 'Use your passphrase instead' }).click();
  await unlockWithPassphrase(page, changed);
  expect(errors).toEqual([]);
});

test.describe('passkeys (Chromium, virtual authenticator)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'WebKit has no virtual authenticator: tried by hand on an iPhone');

  test('set up with a passkey, unlock with it, add and remove one in Settings', async ({ page, context, baseURL }) => {
    const errors = watchErrors(page);
    // WebAuthn needs a domain name, not an IP address
    const origin = baseURL!.replace('127.0.0.1', 'localhost');
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
        hasPrf: true,
      },
    });

    await page.goto(`${origin}/`);
    await page.getByRole('button', { name: 'Use a passkey' }).click();
    await page.getByLabel('Name this passkey').fill('Test laptop');
    await page.getByRole('button', { name: 'Create passkey' }).click();
    const recoveryKey = await readRecoveryKey(page);
    await confirmRecoveryKey(page, recoveryKey);
    await chooseRemember(page, false);
    await page.getByRole('button', { name: /I’ve saved it/ }).click();
    await addClassAndReturn(page, 'Physics');

    // A reload locks; the passkey opens it (no passphrase was ever set)
    await page.reload();
    await expect(unlockHeading(page)).toBeVisible();
    await chooseRemember(page, false);
    await page.getByRole('button', { name: 'Unlock with a passkey' }).click();
    await expect(page.getByTestId('class-row').filter({ hasText: 'Physics' })).toBeVisible();

    // Settings: add a second passkey (proved with the first), then remove the first
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByText('Passphrase: none')).toBeVisible();
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await page.getByRole('button', { name: 'Use a passkey' }).click();
    await page.getByLabel('Name this passkey').fill('Second key');
    await page.getByRole('button', { name: 'Create passkey' }).click();
    await expect(page.getByRole('status')).toContainText('Added the passkey “Second key”');
    await expect(page.getByTestId('passkey-row')).toHaveCount(2);

    await page.getByRole('button', { name: 'Remove passkey Test laptop' }).click();
    await page.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await expect(page.getByTestId('passkey-row')).toHaveCount(1);

    // The last passkey can't be removed while there's no passphrase: that would lock you out
    await page.getByRole('button', { name: 'Remove passkey Second key' }).click();
    await page.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await expect(alert(page)).toContainText('without one you couldn’t unlock');
    await expect(page.getByTestId('passkey-row')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});
