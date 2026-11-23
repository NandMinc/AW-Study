// A class's Exam style (#122) through the real screens and the real AI client, in desktop Chrome, an Android
// phone and an iPhone (WebKit): documents, notes, and the guide the AI writes from them, read, edited and remade.
// The test answers /ai/style itself (service workers off, so Playwright sees the requests).
import { expect, test, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block' });

interface StyleBody {
  className: string;
  notes: string;
  materials: { kind: string; title: string; text: string }[];
  lectures: { date: string; text: string }[];
  previous: { tests: string; edited: boolean } | null;
}

/** Answers /ai/style like the helper (or with `status`), recording what was sent; and every request with a body. */
async function fakeHelper(page: Page) {
  const asked: StyleBody[] = [];
  const sent: { url: string; body: string }[] = [];
  const state = { status: 200 };
  page.on('request', (r) => sent.push({ url: new URL(r.url()).pathname, body: r.postData() ?? '' }));
  await page.route('**/ai/style', async (route) => {
    const body = route.request().postDataJSON() as StyleBody;
    asked.push(body);
    if (state.status !== 200) return route.fulfill({ status: state.status, contentType: 'application/json', body: JSON.stringify({ error: 'Not signed in.' }) });
    const guide = { tests: `Guide ${asked.length}: mostly worked problems.`, levels: ['Name the bond.', 'Which bond forms?', 'Explain why water is polar.'], shortShare: 0.25 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(guide) });
  });
  return { asked, sent, state };
}

/** CHEM 101 with a lecture on slides 2-4, on its page. */
async function chemWithLecture(page: Page) {
  await openUnlocked(page);
  await addClass(page, 'CHEM 101');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Bonds.pdf', numberedSlides(4)));
  await form.getByLabel('Lecture date').fill('2026-11-16');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('4');
  await form.getByLabel(/Make quiz questions now/).uncheck();
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toContainText('Bonds, slides 2–4');
}

const section = (page: Page) => page.getByTestId('exam-style');
const textFile = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

test('documents, notes and the guide: written when asked, remade when they change, edited, and sent only to /ai/style', async ({ page }) => {
  const problems = await watchProblems(page);
  const { asked, sent } = await fakeHelper(page);
  await chemWithLecture(page);

  // Opening the page sends nothing (SECURITY.md: only what's asked for); Write the guide does, from the slides
  await expect(section(page).getByTestId('guide-none')).toBeVisible();
  await reloadUnlocked(page);
  await expect(section(page).getByTestId('guide-none')).toBeVisible();
  expect(asked).toEqual([]);
  await section(page).getByRole('button', { name: 'Write the guide' }).click();
  await expect(section(page).getByTestId('guide-tests')).toHaveText('Guide 1: mostly worked problems.');
  await expect(section(page).getByTestId('guide-level')).toHaveText(['Name the bond.', 'Which bond forms?', 'Explain why water is polar.']);
  await expect(section(page).getByTestId('guide-share')).toHaveText('About 25% of exam-style questions are short answers.');
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ className: 'CHEM 101', notes: '', materials: [], previous: null });
  expect(asked[0]!.lectures).toEqual([{ date: '2026-11-16', text: expect.stringContaining('Slide 2') }]);

  // A past exam: say what it is, and the guide is remade with it
  await section(page).getByLabel('Add a document (PDF or text)').setInputFiles(textFile('Midterm 2025.txt', 'MATERIAL-MARKER Q1. Explain why water is polar.'));
  const add = page.getByRole('form', { name: 'New document' });
  await expect(add.getByLabel('Title')).toHaveValue('Midterm 2025');
  await add.getByRole('button', { name: 'Add document' }).click();
  await expect(add.getByRole('alert')).toHaveText('Say what the document is.');
  await add.getByRole('button', { name: 'Past exam' }).click();
  await add.getByRole('button', { name: 'Add document' }).click();
  await expect(section(page).getByTestId('material-row')).toContainText('Midterm 2025 Past exam · text');
  await expect(section(page).getByTestId('guide-tests')).toHaveText('Guide 2: mostly worked problems.');
  expect(asked[1]!.materials).toEqual([{ kind: 'past-exam', title: 'Midterm 2025', text: 'MATERIAL-MARKER Q1. Explain why water is polar.' }]);
  expect(asked[1]!.previous).toMatchObject({ tests: 'Guide 1: mostly worked problems.', edited: false });

  // Notes: remade once more
  await section(page).getByLabel('Notes', { exact: true }).fill('No proofs; NOTES-MARKER two essay questions.');
  await section(page).getByRole('button', { name: 'Save notes' }).click();
  await expect(section(page).getByTestId('guide-tests')).toHaveText('Guide 3: mostly worked problems.');
  expect(asked[2]!.notes).toBe('No proofs; NOTES-MARKER two essay questions.');

  // Edited by hand: kept, and a remake is told to keep the changes
  await section(page).getByRole('button', { name: 'Edit the guide' }).click();
  const edit = page.getByRole('form', { name: 'Edit the guide' });
  await edit.getByLabel('What the exam tests').fill('My own words: two essays.');
  await edit.getByLabel(/Short answers, %/).fill('150');
  await edit.getByRole('button', { name: 'Save the guide' }).click();
  await expect(edit.getByRole('alert')).toHaveText('The share of short answers must be from 0 to 100%.');
  await edit.getByLabel(/Short answers, %/).fill('60');
  await edit.getByRole('button', { name: 'Save the guide' }).click();
  await expect(section(page).getByTestId('guide-tests')).toHaveText('My own words: two essays.');
  await expect(section(page).getByTestId('guide-share')).toHaveText('About 60% of exam-style questions are short answers.');
  await expect(section(page).getByText('You’ve edited this guide: remakes keep your changes.')).toBeVisible();
  expect(asked).toHaveLength(3); // an edit isn't a reason to remake
  await section(page).getByRole('button', { name: 'Remake' }).click();
  await expect(section(page).getByTestId('guide-tests')).toHaveText('Guide 4: mostly worked problems.');
  expect(asked[3]!.previous).toMatchObject({ tests: 'My own words: two essays.', edited: true });

  // Deleting the document remakes the guide without it
  await section(page).getByRole('button', { name: 'Delete Midterm 2025' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(section(page).getByTestId('material-row')).toHaveCount(0);
  await expect(section(page).getByTestId('guide-tests')).toHaveText('Guide 5: mostly worked problems.');
  expect(asked[4]!.materials).toEqual([]);

  // The document's text and the notes went only to /ai/style
  expect([...new Set(sent.filter((s) => /MATERIAL-MARKER|NOTES-MARKER/.test(s.body)).map((s) => s.url))]).toEqual(['/ai/style']);
  expect(await problems()).toEqual([]);
});

test('the class menu opens Exam style; a failed guide says why, isn’t retried by itself, and trying again works', async ({ page }) => {
  const problems = await watchProblems(page);
  const { asked, state } = await fakeHelper(page);
  state.status = 401;
  await chemWithLecture(page);
  await section(page).getByRole('button', { name: 'Write the guide' }).click();
  await expect(section(page).getByRole('alert')).toHaveText('Sign in again to use AI.');
  await expect(section(page).getByRole('link', { name: 'Sign in for AI' })).toBeVisible();
  await expect(section(page).getByTestId('guide-none')).toBeVisible();

  // From the Classes page's menu: straight to the part, and still no second request by itself
  await page.getByRole('link', { name: '← Classes' }).click();
  await page.getByRole('button', { name: 'Menu for CHEM 101' }).click();
  await page.getByRole('link', { name: 'Exam style' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Exam style' })).toBeFocused();
  await expect(section(page).getByTestId('guide-none')).toBeVisible();
  expect(asked).toHaveLength(1); // only the one that was asked for

  state.status = 200;
  await section(page).getByRole('button', { name: 'Write the guide' }).click();
  await expect(section(page).getByTestId('guide-tests')).toHaveText('Guide 2: mostly worked problems.');

  // A file that's neither a PDF nor text is refused with a reason
  await section(page).getByLabel('Add a document (PDF or text)').setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  await expect(section(page).getByRole('alert')).toHaveText('Only PDFs and plain text files can be added for now. Save it as a PDF first.');
  expect((await problems()).filter((p) => !/status of 401/.test(p))).toEqual([]);
});
