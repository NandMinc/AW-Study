// Classes, lectures and slides (#26) through the real screens, in desktop Chrome, an Android phone
// and an iPhone (WebKit): add a class, upload slides and say what a lecture covered, open them in
// the viewer, and find everything again after a reload. Checks for errors and Content-Security-
// Policy violations throughout. PDFs are made in the test.
import { expect, test, type Page } from './fixtures';
import { makePdf, numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, classRow, openClass, pdfFile, toClasses, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

const lectureRow = (page: Page) => page.getByTestId('lecture-row');
const lectureForm = (page: Page) => page.getByRole('form', { name: 'What was covered?' });
const slides = (page: Page, n: number) => lectureForm(page).getByRole('group', { name: `Slides ${n}` });

async function record(page: Page, { date, minutes, first, last }: { date?: string; minutes?: number; first: number; last: number }) {
  const form = lectureForm(page);
  if (date) await form.getByLabel('Lecture date').fill(date);
  if (minutes) await form.getByLabel('Minutes').fill(String(minutes));
  await slides(page, 1).getByLabel('First slide').fill(String(first));
  await slides(page, 1).getByLabel('Last slide').fill(String(last));
  await form.getByLabel(/Make quiz questions now/).uncheck(); // these tests don't answer /ai/
  await form.getByRole('button', { name: 'Save lecture' }).click();
}

test('add a class, record a lecture with new slides, view them, and find it all after a reload', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  // Tasks, the home page, has nothing yet and points to Classes
  await expect(page.getByTestId('tasks-empty')).toBeVisible();
  await toClasses(page);
  await expect(page.getByText('No classes yet')).toBeVisible();

  await addClass(page, 'CHEM 101', { days: ['Mon', 'Wed', 'Fri'], start: '10:30', minutes: 50 });
  await expect(page.getByTestId('class-times')).toHaveText('Mon, Wed, Fri 10:30 am, 50 min');

  // What was covered: upload a PDF, give a range past its end (refused), then a good one
  await page.getByRole('button', { name: 'What was covered?' }).click();
  await slides(page, 1).getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Week 4.pdf', numberedSlides(5)));
  await expect(slides(page, 1).getByTestId('chosen-slides')).toHaveText('Week 4: 5 slides (new)');
  await record(page, { date: '2026-11-16', minutes: 50, first: 4, last: 9 });
  await expect(lectureForm(page).getByRole('alert')).toHaveText('“Week 4” has only 5 slides.');
  await record(page, { first: 5, last: 2 });
  await expect(lectureForm(page).getByRole('alert')).toHaveText('The first slide comes before the last one.');
  // Nothing stored by the refused tries: the PDF is still new (once stored, it's a deck of the class)
  await expect(slides(page, 1).getByTestId('chosen-slides')).toHaveText('Week 4: 5 slides (new)');
  await expect(page.getByTestId('deck-row')).toHaveCount(0);
  await record(page, { first: 2, last: 4 });
  await expect(lectureForm(page)).toBeHidden();
  await expect(lectureRow(page)).toHaveCount(1);
  await expect(lectureRow(page)).toContainText('Mon, Nov 16');
  await expect(lectureRow(page)).toContainText('Week 4, slides 2–4');
  await expect(lectureRow(page)).toContainText('50 min to study');
  await expect(page.getByTestId('deck-row')).toContainText('Week 4');
  await expect(page.getByTestId('deck-row')).toContainText('5 slides');

  // The section opens in the viewer at its first slide, with its range marked
  await lectureRow(page).getByRole('link', { name: 'Week 4, slides 2–4', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Week 4/ })).toContainText('slides 2–4');
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 2 of 5');
  await expect(page.getByTestId('slide-page')).toHaveAttribute('data-rendered', '2');

  // A reload locks; after unlocking, the same slides are there (straight from the address)
  await reloadUnlocked(page);
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 2 of 5');
  await page.getByRole('link', { name: '← CHEM 101' }).click();
  await expect(lectureRow(page)).toContainText('Week 4, slides 2–4');
  await page.getByRole('link', { name: '← Classes' }).click();
  await expect(classRow(page, 'CHEM 101')).toBeVisible();

  expect(await problems()).toEqual([]);
});

test('the next lecture carries on where the last stopped, and can use two decks', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await addClass(page, 'BIOL 200');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  await slides(page, 1).getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(12)));
  await record(page, { date: '2026-11-16', minutes: 60, first: 1, last: 6 });
  await expect(lectureRow(page)).toHaveCount(1);

  // The deck is chosen and the first slide filled in: 7
  await page.getByRole('button', { name: 'What was covered?' }).click();
  await expect(slides(page, 1).getByRole('button', { name: /Cells/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(slides(page, 1).getByLabel('First slide')).toHaveValue('7');
  await expect(slides(page, 1).getByTestId('chosen-slides')).toContainText('the last lecture ended at slide 6');

  // Slides 7–12 of Cells, and 1–3 of a new PDF: 60 minutes shared 40/20 by page count
  await lectureForm(page).getByLabel('Lecture date').fill('2026-11-18');
  await lectureForm(page).getByLabel('Minutes').fill('60');
  await slides(page, 1).getByLabel('Last slide').fill('12');
  await lectureForm(page).getByRole('button', { name: 'Add slides from another deck' }).click();
  await slides(page, 2).getByLabel('Or upload a new PDF').setInputFiles(pdfFile('Tissues.pdf', numberedSlides(3)));
  await slides(page, 2).getByLabel('Last slide').fill('3');
  await lectureForm(page).getByLabel(/Make quiz questions now/).uncheck(); // these tests don't answer /ai/
  await lectureForm(page).getByRole('button', { name: 'Save lecture' }).click();
  await expect(lectureRow(page)).toHaveCount(2);
  const newest = lectureRow(page).first();
  await expect(newest).toContainText('Wed, Nov 18');
  await expect(newest.getByRole('listitem')).toHaveText([/Cells, slides 7–12\s*40 min to study/, /Tissues, slides 1–3\s*20 min to study/]);

  expect(await problems()).toEqual([]);
});

test('a class with lectures every day: a date button for each lecture to fill in opens it with its date and length', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  // Every day at midnight: the latest lecture is always today's
  await addClass(page, 'Daily', { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start: '00:00', minutes: 45 });
  await expect(page.getByTestId('cover-prompt')).toBeVisible();
  await page.getByRole('link', { name: '← Classes' }).click();
  // On the Classes page: a button for today's lecture and each of the week before the class was added
  const toFill = classRow(page, 'Daily').getByRole('list', { name: 'Lectures to fill in for Daily' }).getByRole('link');
  await expect(toFill).toHaveCount(8);
  await expect(toFill.first()).toHaveText(/^[A-Z][a-z]{2} \d{1,2}$/); // "Nov 15"
  await toFill.last().click();

  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await expect(lectureForm(page).getByLabel('Lecture date')).toHaveValue(today);
  await expect(lectureForm(page).getByLabel('Minutes')).toHaveValue('45');
  await slides(page, 1).getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Daily.pdf', numberedSlides(2)));
  await record(page, { first: 1, last: 2 });
  // Saved: back on the Classes page, where today's button has gone
  await expect(page.getByRole('heading', { level: 2, name: 'Classes', exact: true })).toBeVisible();
  await expect(toFill).toHaveCount(7);
  await openClass(page, 'Daily');
  await expect(lectureRow(page)).toHaveCount(1);
  await expect(page.getByTestId('cover-prompt')).toBeHidden();
  expect(await problems()).toEqual([]);
});

test('exams, editing and deleting; a deck in use can’t be deleted; a file that isn’t a PDF is refused', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await addClass(page, 'PHYS 150');

  // Not a PDF, then a real one, uploaded from the decks list
  await page.getByLabel('Add slides (PDF)').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>no</html>') });
  await expect(page.getByRole('alert')).toContainText('isn’t a PDF');
  await page.getByLabel('Add slides (PDF)').setInputFiles(pdfFile('Forces.pdf', makePdf([{ title: 'Newton' }, { title: 'Friction' }, { title: 'Drag' }])));
  await expect(page.getByTestId('deck-row')).toContainText('Forces');

  // A lecture using it, then deleting the deck is refused with a reason
  await page.getByRole('button', { name: 'What was covered?' }).click();
  await slides(page, 1).getByRole('button', { name: /Forces/ }).click();
  await record(page, { date: '2026-11-17', minutes: 80, first: 1, last: 3 });
  await expect(lectureRow(page)).toContainText('80 min to study');
  await page.getByRole('button', { name: 'Delete Forces' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('delete those lectures first');

  // Change the lecture's length: its study time follows
  await page.getByRole('button', { name: 'Edit lecture of Tue, Nov 17' }).click();
  await page.getByRole('form', { name: 'Edit lecture' }).getByLabel('Minutes').fill('50');
  await page.getByRole('form', { name: 'Edit lecture' }).getByRole('button', { name: 'Save' }).click();
  await expect(lectureRow(page)).toContainText('50 min to study');

  // Exams: add (no date is refused), edit, delete
  await page.getByRole('button', { name: 'Add an exam' }).click();
  const examForm = page.getByRole('form', { name: 'New exam' });
  await examForm.getByRole('button', { name: 'Add exam' }).click();
  await expect(examForm.getByRole('alert')).toHaveText('Give the exam a date.');
  await examForm.getByLabel('Exam date').fill('2026-12-10');
  await examForm.getByRole('button', { name: 'Final' }).click();
  await examForm.getByRole('button', { name: 'Add exam' }).click();
  const examRow = page.getByTestId('exam-row');
  await expect(examRow).toContainText('Final');
  await expect(examRow).toContainText('Thu, Dec 10');
  await expect(examRow).toContainText('Covers every lecture up to it');
  await page.getByRole('button', { name: 'Edit Final' }).click();
  const edit = page.getByRole('form', { name: 'Edit Final' });
  await edit.getByLabel('Title (optional)').fill('Final exam');
  await edit.getByLabel('Chosen lectures').check();
  await edit.getByLabel('Lecture of Tue, Nov 17').check();
  await edit.getByRole('button', { name: 'Save exam' }).click();
  await expect(examRow).toContainText('Final exam');
  await expect(examRow).toContainText('Covers 1 chosen lecture');
  await page.getByRole('button', { name: 'Delete Final exam' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(examRow).toHaveCount(0);

  // Edit the class: rename it and give it lecture times
  await page.getByRole('button', { name: 'Edit class' }).click();
  const classForm = page.getByRole('form', { name: 'Edit PHYS 150' });
  await classForm.getByLabel('Class name').fill('PHYS 151');
  await classForm.getByRole('group', { name: 'Days for lecture time 1' }).getByRole('button', { name: 'Tue' }).click();
  await classForm.getByLabel('Starts at').fill('14:00');
  await classForm.getByLabel('Minutes').fill('80');
  await classForm.getByRole('button', { name: 'Save class' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'PHYS 151' })).toBeVisible();
  await expect(page.getByTestId('class-times')).toHaveText('Tue 2:00 pm, 80 min');

  // Delete the lecture, then the deck can go; deleting the class goes back to an empty list
  await page.getByRole('button', { name: 'Delete lecture of Tue, Nov 17' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(lectureRow(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Forces' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('deck-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete class' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No classes yet')).toBeVisible();

  expect(await problems()).toEqual([]);
});

test('a missing class or deck says so', async ({ page }) => {
  await openUnlocked(page);
  await page.goto('/#/class/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Class not found' })).toBeVisible();
  await page.goto('/#/class/does-not-exist/slides/nope/1-2');
  await expect(page.getByRole('heading', { name: 'Slides not found' })).toBeVisible();
});

test('a device with milestone 2’s flashcards upgrades: the cards are dropped, the app works', async ({ page }) => {
  const problems = await watchProblems(page);
  await page.goto('/viewer-demo.html'); // same site, but the app (and its database) isn't opened
  // The database as the live site left it before #26: version 3, with a deck, a card, and changes for
  // the deck (to drop) and a class (to keep)
  await page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const req = indexedDB.open('honed', 3);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('meta', { keyPath: 'key' });
          db.createObjectStore('decks', { keyPath: 'id' });
          db.createObjectStore('notes', { keyPath: 'id' }).createIndex('byDeck', 'deckId');
          const cards = db.createObjectStore('cards', { keyPath: 'id' });
          cards.createIndex('byDeck', 'deckId');
          cards.createIndex('byNote', 'noteId');
          const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
          reviews.createIndex('byCard', 'cardId');
          reviews.createIndex('byTime', 'reviewedAt');
          db.createObjectStore('changes', { keyPath: 'seq', autoIncrement: true });
          db.createObjectStore('courses', { keyPath: 'id' });
          for (const s of ['exams', 'slideDecks', 'lectures']) db.createObjectStore(s, { keyPath: 'id' }).createIndex('byCourse', 'courseId');
          db.createObjectStore('deckFiles', { keyPath: 'id' });
          db.createObjectStore('deckPages', { keyPath: 'id' });
          const sections = db.createObjectStore('sections', { keyPath: 'id' });
          sections.createIndex('byCourse', 'courseId');
          sections.createIndex('byLecture', 'lectureId');
          sections.createIndex('byDeck', 'deckId');
        };
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['decks', 'cards', 'changes'], 'readwrite');
          tx.objectStore('decks').put({ id: 'old', name: 'Old flashcards', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z' });
          tx.objectStore('cards').put({ id: 'card', deckId: 'old', noteId: 'n' });
          tx.objectStore('changes').put({ id: 'c1', deviceId: 'd', at: '2026-11-17T00:00:00Z', entity: 'deck', entityId: 'old', op: 'put', data: null });
          tx.objectStore('changes').put({ id: 'c2', deviceId: 'd', at: '2026-11-17T00:00:00Z', entity: 'course', entityId: 'gone', op: 'delete', data: null });
          tx.oncomplete = () => (db.close(), done());
          tx.onerror = () => fail(tx.error);
        };
      }),
  );

  await openUnlocked(page); // sets up: nothing to encrypt but the database itself
  await toClasses(page);
  await expect(page.getByText('No classes yet')).toBeVisible();
  await addClass(page, 'After the upgrade');
  const state = await page.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; changes: string[] }>((done, fail) => {
        const req = indexedDB.open('honed');
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const all = db.transaction('changes').objectStore('changes').getAll();
          all.onsuccess = () => {
            done({ version: db.version, stores: [...db.objectStoreNames], changes: all.result.map((c: { entity: string }) => c.entity) });
            db.close();
          };
        };
      }),
  );
  expect(state.version).toBeGreaterThanOrEqual(4); // step 4 dropped the cards (later steps add stores)
  expect(state.stores.filter((s) => ['decks', 'notes', 'cards', 'reviews'].includes(s))).toEqual([]);
  expect(state.changes).toEqual(['course', 'course']); // the old class change stays; the new class's is added
  expect(await problems()).toEqual([]);
});

test('the time, minutes and date fields are one line tall, like the other fields', async ({ page }) => {
  await openUnlocked(page);
  await toClasses(page);
  await page.getByRole('button', { name: 'Add a class' }).click();
  const form = page.getByRole('form', { name: 'New class' });
  const nameHeight = (await form.getByLabel('Class name').boundingBox())!.height;
  for (const label of ['Starts at', 'Minutes', 'Starts', 'Ends']) {
    const box = (await form.getByLabel(label, { exact: true }).boundingBox())!;
    expect(box.height, label).toBeLessThan(nameHeight * 1.5); // they were about 4x as tall (Nov 18)
  }
});

test('slides fill the window: a portrait page (a document saved as PDF) is shown large on a tall screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'a desktop window size');
  await page.setViewportSize({ width: 1280, height: 1300 });
  await openUnlocked(page);
  await addClass(page, 'PHIL 201');
  await page.getByLabel('Add slides (PDF)').setInputFiles(pdfFile('Notes.pdf', portraitPdf()));
  await page.getByTestId('deck-row').getByRole('link', { name: 'Notes' }).click();
  const slide = page.getByTestId('slide-page');
  await expect(slide).toHaveAttribute('data-rendered', '1');
  const box = (await slide.locator('canvas').boundingBox())!;
  expect(box.height).toBeGreaterThan(800); // was about 480 in a fixed 44rem frame (Nov 18)
  // The page itself never scrolls sideways
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

/** A one-page US Letter (portrait) PDF, like a Word document saved as PDF. */
function portraitPdf(): Uint8Array {
  return new TextEncoder().encode(
    makePdf([{ title: 'Unit 4: Fallacies' }])
      .reduce((s, b) => s + String.fromCharCode(b), '')
      .replace('/MediaBox [0 0 720 540]', '/MediaBox [0 0 612 792]'),
  );
}

// A real iPhone (Nov 19): Safari drew the time and date boxes about 183 px wide whatever their column,
// so "Starts at" ran under "Minutes" and the term's "Ends" past the form's edge. Neither Chromium nor
// Windows WebKit draws them that way (even given Safari's width, they widen the column or wrap, as
// they should), so the geometry below can't catch that bug here; it guards the layout in general.
// The fix's rules are checked directly, and the real proof is an iPhone.
test('the new class form keeps every box inside it, side by side boxes lined up and not overlapping', async ({ page }) => {
  await openUnlocked(page);
  await toClasses(page);
  await page.getByRole('button', { name: 'Add a class' }).click();
  const form = page.getByRole('form', { name: 'New class' });

  // The fix: date and time boxes without Safari's own look, allowed to shrink, in labels that can too
  for (const label of ['Starts at', 'Starts', 'Ends']) {
    const input = form.getByLabel(label, { exact: true });
    const style = await input.evaluate((el) => {
      const s = getComputedStyle(el);
      return { appearance: s.appearance, minWidth: s.minWidth, labelMinWidth: getComputedStyle(el.closest('label')!).minWidth };
    });
    expect(style, label).toEqual({ appearance: 'none', minWidth: '0px', labelMinWidth: '0px' });
  }

  const formBox = (await form.boundingBox())!;
  const inputs = form.locator('input');
  const boxes = [];
  for (let i = 0; i < (await inputs.count()); i++) {
    const input = inputs.nth(i);
    const box = (await input.boundingBox())!;
    const name = await input.evaluate((el) => el.closest('label')?.firstChild?.textContent?.trim() || el.type);
    expect(box.x, `${name}: left edge`).toBeGreaterThanOrEqual(formBox.x);
    expect(box.x + box.width, `${name}: right edge`).toBeLessThanOrEqual(formBox.x + formBox.width + 0.5);
    boxes.push({ name, ...box });
  }
  for (const a of boxes)
    for (const b of boxes) {
      if (a === b) continue;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX > 0.5 && overlapY > 0.5, `${a.name} overlaps ${b.name}`).toBe(false);
      if (overlapY > 0.5) expect(Math.abs(a.y + a.height - (b.y + b.height)), `${a.name} and ${b.name} line up`).toBeLessThan(1);
    }
});

test('the Classes page: each class’s menu opens that part of its page, and deletes it after asking', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await addClass(page, 'COMP 2000', { days: ['Mon', 'Wed', 'Fri'], start: '10:30', minutes: 50 });
  await page.getByRole('link', { name: '← Classes' }).click();
  const menuButton = page.getByRole('button', { name: 'Menu for COMP 2000' });
  const menu = page.getByRole('list', { name: 'COMP 2000 menu' });
  const choose = async (item: string) => {
    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await menu.getByRole('link', { name: item }).click();
  };
  const back = async () => {
    await page.getByRole('link', { name: '← Classes' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Classes', exact: true })).toBeVisible();
  };

  // Escape and a tap elsewhere close it
  await menuButton.click();
  await expect(menu.getByRole('listitem')).toHaveText(['What lectures covered', 'Class details', 'Exams', 'Files', 'Exam style', 'Delete class']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await page.getByRole('heading', { level: 2, name: 'Classes', exact: true }).click();
  await expect(menu).toBeHidden();

  // Each part of the class's page
  await choose('Exams');
  await expect(page).toHaveURL(/#\/class\/[^/]+\/exams$/);
  await expect(page.getByRole('heading', { level: 3, name: 'Exams' })).toBeFocused();
  await back();
  await choose('Files');
  await expect(page.getByRole('heading', { level: 3, name: 'Slide decks' })).toBeFocused();
  await back();
  await choose('Exam style'); // #122
  await expect(page).toHaveURL(/#\/class\/[^/]+\/style$/);
  await expect(page.getByRole('heading', { level: 3, name: 'Exam style' })).toBeFocused();
  await back();
  await choose('What lectures covered');
  await expect(page.getByRole('heading', { level: 3, name: '0 lectures' })).toBeFocused();
  await back();
  await choose('Class details');
  await expect(page.getByRole('form', { name: 'Edit COMP 2000' })).toBeVisible();
  await back();

  // A date button opens "What was covered?" for its date; Cancel comes back here
  const toFill = classRow(page, 'COMP 2000').getByRole('list', { name: 'Lectures to fill in for COMP 2000' }).getByRole('link');
  const count = await toFill.count();
  expect(count).toBeGreaterThan(0); // MWF: the week before today has some
  const href = (await toFill.first().getAttribute('href'))!;
  await toFill.first().click();
  await expect(page.getByRole('form', { name: 'What was covered?' }).getByLabel('Lecture date')).toHaveValue(href.slice(-10));
  await expect(page.getByRole('form', { name: 'What was covered?' }).getByLabel('Minutes')).toHaveValue('50');
  await page.getByRole('form', { name: 'What was covered?' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes', exact: true })).toBeVisible();
  await expect(toFill).toHaveCount(count);

  // Delete asks first
  await menuButton.click();
  await menu.getByRole('button', { name: 'Delete class' }).click();
  await expect(page.getByRole('heading', { name: 'Delete “COMP 2000”?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(classRow(page, 'COMP 2000')).toBeVisible();
  await menuButton.click();
  await menu.getByRole('button', { name: 'Delete class' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(classRow(page, 'COMP 2000')).toHaveCount(0);
  await expect(page.getByText('No classes yet')).toBeVisible();
  expect(await problems()).toEqual([]);
});
