// Sync between two devices (#105), through the real screens: a "PC" and a "phone" (two browser contexts) sync
// through the real sync server (sync/app.mjs), run here with an in-memory database. Each page's /api/ requests
// are passed to it with that device's session, as the tunnel would. Signing in to Google is the one thing
// not shown: the sessions are made in the database.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, fastKdf, test, type Page } from './fixtures';
import { addClass, addClassAndReturn, navBar, pdfFile } from './class-helpers';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { PASSPHRASE, setUpWithPassphrase } from './lock-helpers';
// @ts-expect-error: plain JavaScript (the server's own modules), no types
import { createSync } from '../../sync/app.mjs';
// @ts-expect-error: plain JavaScript, no types
import { openDb } from '../../sync/db.mjs';

test.use({ serviceWorkers: 'block' }); // Playwright's routing doesn't see a service worker's requests

type Db = { prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] }; close(): void };

async function syncServer(appOrigin: string) {
  const db: Db = openDb(':memory:');
  const filesDir = mkdtempSync(join(tmpdir(), 'honed-files-'));
  const handle = createSync({ db, google: {}, allowedEmails: ['nathan@example.com'], appOrigin, filesDir, log: () => {} });
  const server: Server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO accounts (id, google_sub, email, created_at, signed_in_at) VALUES (?, ?, ?, ?, ?)').run('acct', 'sub', 'nathan@example.com', now, now);
  let n = 0;
  return {
    db,
    /** Signs this page's device in (a session made here) and passes its /api/ requests to the server. */
    async connect(page: Page) {
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions (id, hash, account_id, device, created_at, used_at, signed_in_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        `s${++n}`,
        createHash('sha256').update(token).digest('base64url'),
        'acct',
        'Test',
        now,
        now,
        now,
      );
      await page.route('**/api/**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const body = ['GET', 'HEAD'].includes(req.method()) ? undefined : (req.postDataBuffer() ?? undefined);
        const res = await fetch(base + url.pathname + url.search, {
          method: req.method(),
          headers: {
            'Content-Type': req.headers()['content-type'] ?? 'application/json',
            Origin: appOrigin,
            Cookie: `honed_session=${token}`,
            ...(body ? { 'Content-Length': String(body.length) } : {}),
          },
          body,
        });
        await route.fulfill({ status: res.status, headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' }, body: Buffer.from(await res.arrayBuffer()) });
      });
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      rmSync(filesDir, { recursive: true, force: true });
    },
  };
}

async function toSettings(page: Page) {
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Settings', exact: true })).toBeVisible();
}

async function syncNow(page: Page) {
  await toSettings(page);
  const box = page.getByRole('group', { name: 'Sync' });
  await box.getByRole('button', { name: 'Sync now' }).click();
  await expect(box.getByTestId('sync-message')).toHaveText('Synced.');
}

async function classNames(page: Page) {
  await navBar(page).getByRole('link', { name: 'Classes' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes' })).toBeVisible();
  return page.getByRole('list', { name: 'Your classes' }).getByRole('heading', { level: 3 }).allInnerTexts();
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));
  return errors;
}

test('a class made on the PC reaches a new phone that joins; the phone’s class reaches the PC; the server can’t read them', async ({ page, browser }, info) => {
  const origin = new URL(info.project.use.baseURL ?? 'http://127.0.0.1:4173').origin;
  const server = await syncServer(origin);
  try {
    const pcErrors = watchErrors(page);
    await server.connect(page);
    await page.goto('/');
    await setUpWithPassphrase(page);
    await addClassAndReturn(page, 'Biology');

    // The PC turns sync on: it's the first device, so its data goes up
    await toSettings(page);
    const box = page.getByRole('group', { name: 'Sync' });
    await box.getByRole('button', { name: 'Turn on sync' }).click();
    await expect(box.getByTestId('sync-message')).toContainText('Sync is on');
    await expect(box.getByTestId('sync-state')).toContainText('Syncing with nathan@example.com');

    // A new phone joins from setup with the account's passphrase, and gets the class
    const phoneContext = await browser.newContext({ ...info.project.use, serviceWorkers: 'block' });
    await fastKdf(phoneContext); // the same rounds as the PC (fixtures.ts)
    const phone = await phoneContext.newPage();
    const phoneErrors = watchErrors(phone);
    await server.connect(phone);
    await phone.goto('/');
    await phone.getByRole('button', { name: 'I already use Honed on another device' }).click();
    const join = phone.getByRole('group', { name: 'Unlock your account’s data' });
    await join.getByLabel('Remember this device').setChecked(false);
    await join.getByLabel('Your passphrase').fill(PASSPHRASE);
    await join.getByRole('button', { name: 'Unlock and download' }).click();
    await expect(phone.getByRole('banner').getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
    expect(await classNames(phone)).toEqual(['Biology']);

    // The phone adds one; the PC gets it
    await addClassAndReturn(phone, 'Chemistry');
    await syncNow(phone);
    await syncNow(page);
    expect((await classNames(page)).sort()).toEqual(['Biology', 'Chemistry']);

    // The phone unlocks with the same passphrase after a reload (it took the account's keyring)
    await phone.reload();
    await phone.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
    await phone.getByRole('button', { name: 'Unlock', exact: true }).click();
    expect((await classNames(phone)).sort()).toEqual(['Biology', 'Chemistry']);

    // What the server holds is sealed
    const held = JSON.stringify([server.db.prepare('SELECT * FROM changes').all(), server.db.prepare('SELECT * FROM keyrings').all()]);
    for (const name of ['Biology', 'Chemistry']) expect(held).not.toContain(name);
    expect(pcErrors).toEqual([]);
    expect(phoneErrors).toEqual([]);
    await phoneContext.close();
  } finally {
    await server.close();
  }
});

test('a device with its own data is asked before it’s replaced with the account’s', async ({ page, browser }, info) => {
  const origin = new URL(info.project.use.baseURL ?? 'http://127.0.0.1:4173').origin;
  const server = await syncServer(origin);
  try {
    await server.connect(page);
    await page.goto('/');
    await setUpWithPassphrase(page);
    await addClassAndReturn(page, 'From the PC');
    await toSettings(page);
    await page.getByRole('group', { name: 'Sync' }).getByRole('button', { name: 'Turn on sync' }).click();
    await expect(page.getByTestId('sync-message')).toContainText('Sync is on');

    // A second device set up on its own (its own key and data)
    const otherContext = await browser.newContext({ ...info.project.use, serviceWorkers: 'block' });
    await fastKdf(otherContext); // the same rounds as the PC (fixtures.ts)
    const other = await otherContext.newPage();
    await server.connect(other);
    await other.goto('/');
    await setUpWithPassphrase(other, 'a different passphrase here');
    await addClassAndReturn(other, 'Only here');
    await toSettings(other);
    const box = other.getByRole('group', { name: 'Sync' });
    await box.getByRole('button', { name: 'Turn on sync' }).click();
    await expect(box.getByTestId('sync-replace')).toContainText('will be gone');
    // Its own passphrase doesn't open the account's data
    const join = other.getByRole('group', { name: 'Unlock your account’s data' });
    await join.getByLabel('Your passphrase').fill('a different passphrase here');
    await join.getByRole('button', { name: 'Replace this device’s data' }).click();
    await expect(join.getByRole('alert')).toContainText('doesn’t unlock');
    expect(await classNames(other)).toEqual(['Only here']); // untouched so far
    await toSettings(other);
    await box.getByRole('button', { name: 'Turn on sync' }).click();
    await join.getByLabel('Your passphrase').fill(PASSPHRASE);
    await join.getByRole('button', { name: 'Replace this device’s data' }).click();
    await expect(box.getByTestId('sync-message')).toContainText('now has your account’s data');
    expect(await classNames(other)).toEqual(['From the PC']);
  } finally {
    await server.close();
  }
});

test('slides added on the PC open on the phone: the PDF comes across when they’re opened (#108)', async ({ page, browser }, info) => {
  const origin = new URL(info.project.use.baseURL ?? 'http://127.0.0.1:4173').origin;
  const server = await syncServer(origin);
  try {
    const pcErrors = watchErrors(page);
    await server.connect(page);
    await page.goto('/');
    await setUpWithPassphrase(page);
    // A lecture with slides on the PC
    await addClass(page, 'BIO 110');
    await page.getByRole('button', { name: 'What was covered?' }).click();
    const form = page.getByRole('form', { name: 'What was covered?' });
    await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(3)));
    await form.getByLabel('Lecture date').fill('2026-11-16');
    await form.getByLabel('Minutes').fill('50');
    await form.getByLabel('First slide').fill('1');
    await form.getByLabel('Last slide').fill('3');
    await form.getByLabel(/Make quiz questions now/).uncheck();
    await form.getByRole('button', { name: 'Save lecture' }).click();
    await expect(page.getByRole('link', { name: 'Cells, slides 1–3', exact: true })).toBeVisible();
    await page.evaluate(() => (location.hash = '#/settings')); // the class page has no nav bar
    await expect(page.getByRole('heading', { level: 2, name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('group', { name: 'Sync' }).getByRole('button', { name: 'Turn on sync' }).click();
    await expect(page.getByTestId('sync-message')).toContainText('Sync is on');
    await expect.poll(() => server.db.prepare('SELECT COUNT(*) AS n FROM files').get()).toEqual({ n: 2 });

    // The phone joins and opens the slides: the PDF is fetched then, and the viewer shows it
    const phoneContext = await browser.newContext({ ...info.project.use, serviceWorkers: 'block' });
    await fastKdf(phoneContext); // the same rounds as the PC (fixtures.ts)
    const phone = await phoneContext.newPage();
    const phoneErrors = watchErrors(phone);
    await server.connect(phone);
    await phone.goto('/');
    await phone.getByRole('button', { name: 'I already use Honed on another device' }).click();
    const join = phone.getByRole('group', { name: 'Unlock your account’s data' });
    await join.getByLabel('Your passphrase').fill(PASSPHRASE);
    await join.getByRole('button', { name: 'Unlock and download' }).click();
    await expect(phone.getByRole('banner').getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
    await navBar(phone).getByRole('link', { name: 'Classes' }).click();
    await phone.getByRole('link', { name: 'BIO 110' }).click();
    await phone.getByRole('link', { name: 'Cells, slides 1–3', exact: true }).click();
    await expect(phone.getByTestId('slide-position')).toHaveText('Slide 1 of 3');
    await expect(phone.getByTestId('slide-page')).toHaveAttribute('data-rendered', '1');
    await expect(phone.getByTestId('slide-page').locator('.textLayer')).toContainText('Slide 1');
    expect(pcErrors).toEqual([]);
    expect(phoneErrors).toEqual([]);
    await phoneContext.close();
  } finally {
    await server.close();
  }
});
