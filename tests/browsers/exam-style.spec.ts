// A class's Exam style (#122) through the real screens and the real AI client, in desktop Chrome, an Android phone and
// an iPhone (WebKit): documents, notes and the exam style guide, written and remade by itself as they change, edited
// and remade by hand. The test answers /ai/style itself, the way the helper does, so nothing is spent or sent.
import { expect, test, type Page, type Route } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, classRow, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block' });

interface StyleAsk {
  className: string;
  notes: string;
  materials: { kind: string; title: string; text: string }[];
  lectures: { date: string; text: string }[];
  previous: { tests: string; edited: boolean } | null;
}

/** Answers /ai/style like the helper, numbering each guide it writes; records what each request sent. */
async function fakeStyle(page: Page, { failFirst = 0 }: { failFirst?: number } = {}) {
  const asked: StyleAsk[] = [];
  let failures = failFirst;
  await page.route('**/ai/style', async (route: Route) => {
    if (failures > 0) {
      failures--;
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"signed out"}' });
    }
    const body = route.request().postDataJSON() as StyleAsk;
    asked.push(body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tests: `Guide ${asked.length}: essays on causes and consequences.`,
        levels: ['Who signed the treaty?', 'Why did it matter then?', 'Explain in two sentences why it failed.'],
        shortShare: 0.75,
      }),
    });
  });
  return asked;
}

/** A class with one lecture (slides 2-3 of a 3-slide deck), no questions made; ends on its page. */
async function classWithLecture(page: Page) {
  await openUnlocked(page);
  await addClass(page, 'HIST 200');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Treaty.pdf', numberedSlides(3)));
  await form.getByLabel('Lecture date').fill('2026-11-16');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('3');
  await form.getByLabel(/Make quiz questions now/).uncheck();
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toBeVisible();
}

const section = (page: Page) => page.getByTestId('exam-style');
const guide = (page: Page) => section(page).getByTestId('guide');
const textFile = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

test('opening a class sends nothing; a document or notes write the guide (with the covered slides), and it can be edited and remade', async ({ page }) => {
  const problems = await watchProblems(page);
  const asked = await fakeStyle(page);
  await classWithLecture(page);

  // Opened from the class's menu, at Exam style: it has slides, but opening a class never sends anything
  await page.getByRole('link', { name: '← Classes' }).click();
  await classRow(page, 'HIST 200').getByRole('button', { name: 'Menu for HIST 200' }).click();
  await page.getByRole('link', { name: 'Exam style' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Exam style' })).toBeFocused();
  await expect(section(page)).toContainText('No guide yet');
  expect(asked).toHaveLength(0);

  // A document: its kind is guessed from its name, and the guide is written from it and the covered slides
  await section(page).getByLabel('Add a document (PDF or text)').setInputFiles(textFile('Midterm 2025.txt', 'Q1. Why did the treaty fail?'));
  const row = section(page).getByTestId('material-row');
  await expect(row).toContainText('Midterm 2025');
  await expect(row).toContainText('Past exam');
  await expect(guide(page)).toContainText('Guide 1: essays on causes');
  await expect(guide(page)).toContainText('Exam-style: Explain in two sentences why it failed.');
  await expect(guide(page)).toContainText('About 75% of exam-style questions are short answers');
  await expect(guide(page)).toContainText('from 1 lecture and 1 document');
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ className: 'HIST 200', notes: '', previous: null });
  expect(asked[0]!.materials).toEqual([{ kind: 'past-exam', title: 'Midterm 2025', text: 'Q1. Why did the treaty fail?' }]);
  expect(asked[0]!.lectures).toHaveLength(1);
  expect(asked[0]!.lectures[0]!.text).toContain('Slide 2');
  expect(asked[0]!.lectures[0]!.text).not.toContain('Slide 1'); // only what the lecture covered

  // Notes: saved, and the guide remade with them
  const notes = section(page).getByRole('form', { name: 'Your notes about the exam' });
  await expect(notes.getByRole('button', { name: 'Save notes' })).toBeDisabled();
  await notes.getByRole('textbox').fill('Two essay questions. No dates to memorise.');
  await notes.getByRole('button', { name: 'Save notes' }).click();
  await expect(guide(page)).toContainText('Guide 2');
  expect(asked[1]!.notes).toBe('Two essay questions. No dates to memorise.');

  // Edited by hand: kept, and a remake is told it was edited
  await section(page).getByRole('button', { name: 'Edit the guide' }).click();
  const editor = section(page).getByRole('form', { name: 'Edit the guide' });
  await editor.getByLabel('What the exam tests').fill('My own words: two essays on the treaty.');
  await editor.getByLabel('Short answers (% of exam-style questions)').fill('150');
  await editor.getByRole('button', { name: 'Save the guide' }).click();
  await expect(editor.getByRole('alert')).toContainText('from 0 to 100');
  await editor.getByLabel('Short answers (% of exam-style questions)').fill('50');
  await editor.getByRole('button', { name: 'Save the guide' }).click();
  await expect(guide(page)).toContainText('My own words: two essays on the treaty.');
  await expect(guide(page)).toContainText('About 50% of exam-style questions are short answers');
  await expect(guide(page)).toContainText('your edits are kept when it’s remade');
  expect(asked).toHaveLength(2); // an edit isn't a reason to remake

  await section(page).getByRole('button', { name: 'Remake the guide' }).click();
  await expect(guide(page)).toContainText('Guide 3');
  expect(asked[2]!.previous).toMatchObject({ tests: 'My own words: two essays on the treaty.', edited: true });

  // Changing a document's kind, then deleting it (remade without it)
  await section(page).getByRole('button', { name: 'Change Midterm 2025' }).click();
  const change = section(page).getByRole('form', { name: 'Change Midterm 2025' });
  // The four kinds fit a phone's width: nothing on the page is wider than the screen
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await change.getByRole('button', { name: 'Practice or assignment' }).click();
  await change.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('Practice or assignment');
  await section(page).getByRole('button', { name: 'Delete Midterm 2025' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
  await expect(guide(page)).toContainText('Guide 4');
  expect(asked[3]!.materials).toEqual([]);

  // Nothing but the texts ever went: no PDF bytes
  expect(JSON.stringify(asked)).not.toContain('%PDF');
  expect(await problems()).toEqual([]);
});

test('a file type that isn’t supported yet is refused, and a signed-out AI says how to sign in, once', async ({ page }) => {
  const problems = await watchProblems(page);
  const asked = await fakeStyle(page, { failFirst: 1 });
  await classWithLecture(page);

  await expect(section(page)).toContainText('No guide yet');
  expect(asked).toHaveLength(0); // opening sends nothing

  // Signed out: the attempt after saving notes fails once, says so with the sign-in link, and isn't retried in a loop
  const notes = section(page).getByRole('form', { name: 'Your notes about the exam' });
  await notes.getByRole('textbox').fill('Essays.');
  await notes.getByRole('button', { name: 'Save notes' }).click();
  await expect(section(page).getByRole('alert')).toContainText('Sign in again to use AI.');
  await expect(section(page).getByRole('link', { name: 'Sign in for AI' })).toBeVisible();
  await expect(section(page)).toContainText('No guide yet');
  expect(asked).toHaveLength(0);

  const docx = { name: 'Outline.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK') };
  await section(page).getByLabel('Add a document (PDF or text)').setInputFiles(docx);
  await expect(section(page).getByRole('alert')).toContainText('Only PDFs and plain text files');
  await expect(section(page).getByTestId('material-row')).toHaveCount(0);

  // Signed in again: pressing the button writes it
  await section(page).getByRole('button', { name: 'Write the guide' }).click();
  await expect(guide(page)).toContainText('Guide 1');
  expect(asked).toHaveLength(1);
  // The browser logs the 401 this test sent on purpose; nothing else
  expect((await problems()).filter((p) => !p.includes('status of 401'))).toEqual([]);
});
