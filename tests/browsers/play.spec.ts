// The Tasks page (#77) and Play (#47) through the real screens, in desktop Chrome, an Android phone and
// an iPhone (WebKit), on a clock the test controls (Wednesday Nov 18, 2026, 10:00 in Los Angeles).
// /ai/ is answered by the test, like the helper (service workers off so Playwright sees it).
import { expect, test, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, navBar, openClass, pdfFile, toClasses, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });

async function fakeHelper(page: Page) {
  await page.route('**/ai/questions', async (route) => {
    const body = route.request().postDataJSON() as { pages: { page: number }[]; count: number };
    const questions = Array.from({ length: body.count }, (_, i) => ({
      question: `Question ${i + 1} about slide ${body.pages[i % body.pages.length]!.page}?`,
      options: [`Right ${i + 1}`, `Wrong ${i + 1}`, `Other ${i + 1}`, `Else ${i + 1}`],
      answer: 0,
      page: body.pages[i % body.pages.length]!.page,
      explanation: 'Because the slide says so.',
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
  });
}

/** A class with yesterday's 30-minute lecture on slides 2-4, back on Tasks (the home page). */
async function lectureYesterday(page: Page, className: string, minutes = 30) {
  await addClass(page, className);
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel(/Upload the slides|Or upload a new PDF/).setInputFiles(pdfFile(`${className}.pdf`, numberedSlides(4)));
  await form.getByLabel('Lecture date').fill('2026-11-17');
  await form.getByLabel('Minutes').fill(String(minutes));
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('4');
  await form.getByLabel(/Make quiz questions now/).uncheck(); // Play makes them, in its own test
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toHaveCount(1);
  await page.getByRole('link', { name: '← Classes' }).click();
  await navBar(page).getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T10:00:00-08:00') });
  await fakeHelper(page);
});

const classes = (page: Page) => page.getByTestId('task-class');
const classNamed = (page: Page, name: string) => classes(page).filter({ hasText: name });
const statusOf = (page: Page, name: string) => classNamed(page, name).getByTestId('task-status');

/** Answers a quiz of `count` questions, all right. */
async function answerAll(page: Page, count: number) {
  for (let n = 1; n <= count; n++) {
    await expect(page.getByTestId('quiz-position')).toHaveText(`Question ${n} of ${count}`);
    await page.getByRole('group', { name: 'Answers' }).getByRole('button', { name: /Right/ }).click();
    await page.getByTestId('quiz-feedback').getByRole('button', { name: n < count ? 'Next question' : 'See your score' }).click();
  }
  await expect(page.getByTestId('quiz-score')).toHaveText(`${count} of ${count} right (100%)`);
}

test('yesterday’s lecture is on today’s list; Start runs its session, offers the quiz at 80%, and ticks it off', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await lectureYesterday(page, 'BIO 110');

  // Day 1 of the first week: one row for the class, New, nothing done; no times on the page
  await expect(classes(page)).toHaveCount(1);
  await expect(statusOf(page, 'BIO 110')).toHaveText('New');
  await expect(page.getByTestId('tasks-progress')).toHaveAttribute('value', '0');
  await expect(page.getByText(/\bmin\b/)).toHaveCount(0);

  // "Stop for now" changes nothing
  await page.getByRole('link', { name: 'Start' }).click();
  await expect(page.getByTestId('study-timer')).toHaveText('10:00 left');
  await page.getByRole('link', { name: 'Stop for now' }).click();
  await expect(classes(page)).toHaveCount(1);

  // The session: slides with a timer; the quiz is offered at 80% (8 of 10 minutes)
  await page.getByRole('link', { name: 'Start' }).click();
  await expect(page.getByTestId('play-position')).toHaveText('1 of 1');
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 2 of 4');
  await expect(page.getByTestId('study-prompt')).toBeHidden();
  await page.clock.fastForward('07:50');
  await expect(page.getByTestId('study-prompt')).toBeHidden();
  await page.clock.fastForward('00:15');
  await expect(page.getByTestId('study-prompt')).toContainText('Time for the quiz');
  await expect(page.getByTestId('study-timer')).toHaveText(/^1:5\d left$/);
  await page.getByRole('button', { name: 'I’m ready for the quiz' }).click();

  // No questions yet: make them right here, and the quiz starts (3 slides: 5 questions)
  await page.getByRole('button', { name: 'Make questions' }).click();
  await answerAll(page, 5);
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByTestId('play-done')).toContainText('1 of 1 item done');

  // Home: still on the list, ticked; the bar is full and Start is gone
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByText('All done for today.')).toBeVisible();
  await expect(statusOf(page, 'BIO 110').getByRole('img', { name: 'Done' })).toBeVisible();
  await expect(page.getByTestId('tasks-progress')).toHaveAttribute('value', '1');
  await expect(page.getByRole('link', { name: 'Start' })).toHaveCount(0);
  await reloadUnlocked(page);
  await expect(page.getByText('All done for today.')).toBeVisible();
  expect(await problems()).toEqual([]);
});

test('a class row opens to its lectures: the name opens the slides, Quiz the quiz, and a done quiz is ticked', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await lectureYesterday(page, 'CHEM 101');
  await lectureYesterday(page, 'PHYS 150');

  // Closed at first; tapping anywhere on the row opens it, and again closes it
  const chem = classNamed(page, 'CHEM 101');
  const toggle = chem.getByRole('button', { name: /^CHEM 101/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(chem.getByTestId('task-lecture')).toHaveCount(0);
  await chem.getByTestId('task-status').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(chem.getByTestId('task-lecture')).toHaveText(['Nov 17 lectureQuiz']);
  await toggle.click();
  await expect(chem.getByTestId('task-lecture')).toHaveCount(0);

  // The lecture's name opens its slides
  await toggle.click();
  await chem.getByRole('link', { name: 'Nov 17 lecture' }).click();
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 2 of 4');
  await page.goBack();

  // Its quiz, from here: once done, a tick replaces Quiz, the class is done and the bar moves
  await classNamed(page, 'CHEM 101').getByRole('button', { name: /^CHEM 101/ }).click();
  await classNamed(page, 'CHEM 101').getByRole('link', { name: 'Quiz' }).click();
  await page.getByRole('button', { name: 'Make questions' }).click();
  await page.getByRole('button', { name: /Start the quiz/ }).click();
  await answerAll(page, 10);
  await page.evaluate(() => (location.hash = '#/')); // the quiz is full-screen: no nav bar
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
  const chemAgain = classNamed(page, 'CHEM 101');
  await chemAgain.getByRole('button', { name: /^CHEM 101/ }).click();
  await expect(chemAgain.getByRole('img', { name: 'Quiz done' })).toBeVisible();
  await expect(chemAgain.getByRole('link', { name: 'Quiz' })).toHaveCount(0);
  await expect(statusOf(page, 'CHEM 101').getByRole('img', { name: 'Done' })).toBeVisible();
  await expect(statusOf(page, 'PHYS 150')).toHaveText('New');
  const value = Number(await page.getByTestId('tasks-progress').getAttribute('value'));
  expect(value).toBeGreaterThan(0.3); // one of two equal classes, its quiz done (its slides weren't read)
  expect(value).toBeLessThan(0.6);
  expect(await problems()).toEqual([]);
});

test('classes are reordered by dragging the handle or with the arrow keys; the order is kept, and Start follows it', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await lectureYesterday(page, 'ART 100');
  await lectureYesterday(page, 'ECON 200');
  await lectureYesterday(page, 'MATH 300');
  const order = () => classes(page).getByTestId('task-name').allInnerTexts();
  await expect(classes(page)).toHaveCount(3);
  const first = await order();

  // Drag the last class to the top by its handle
  const last = first[2]!;
  const handle = classNamed(page, last).getByRole('button', { name: `Move ${last} (hold and drag, or use the arrow keys)` });
  const top = await classes(page).first().boundingBox();
  const from = (await handle.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, top!.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect.poll(order).toEqual([last, first[0], first[1]]);
  await expect(page.getByTestId('order-saved')).toHaveText(`Order saved: ${last}, ${first[0]}, ${first[1]}.`);

  // The arrow keys move a class too
  await classNamed(page, first[0]!).getByRole('button', { name: /^Move/ }).press('ArrowDown');
  await expect.poll(order).toEqual([last, first[1], first[0]]);
  await expect(page.getByTestId('order-saved')).toHaveText(`Order saved: ${last}, ${first[1]}, ${first[0]}.`);

  // Kept after a reload, and Start goes in that order
  await reloadUnlocked(page);
  await expect.poll(order).toEqual([last, first[1], first[0]]);
  await page.getByRole('link', { name: 'Start' }).click();
  await expect(page.getByTestId('play-position')).toHaveText('1 of 3');
  await expect(page.getByRole('heading', { level: 2 })).toContainText(last);
  expect(await problems()).toEqual([]);
});

test('nothing today: the penguin', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await expect(page.getByTestId('penguin')).toBeVisible(); // no classes at all
  await expect(page.getByTestId('tasks-empty')).toContainText('Nothing to study yet');
  await addClass(page, 'GEO 120');
  await page.getByRole('link', { name: '← Classes' }).click();
  await navBar(page).getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByTestId('penguin')).toBeVisible(); // a class, but no lecture yet
  await expect(classes(page)).toHaveCount(0);
  expect(await problems()).toEqual([]);
});

test('the daily minutes, in Settings, decide what fits today; the rest waits', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await lectureYesterday(page, 'CHEM 101');
  await lectureYesterday(page, 'PHYS 150');
  await expect(classes(page)).toHaveCount(2);

  // Ten minutes a day: one session fits, the other waits
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'Study time' });
  await expect(form.getByLabel('Minutes a day')).toHaveValue('60');
  await form.getByLabel('Minutes a day').fill('5');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('10 to 600');
  await form.getByLabel('Minutes a day').fill('10');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved: 10 minutes a day.');
  await navBar(page).getByRole('link', { name: 'Tasks' }).click();
  await expect(classes(page)).toHaveCount(1);
  await reloadUnlocked(page);
  await expect(classes(page)).toHaveCount(1);
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('form', { name: 'Study time' }).getByLabel('Minutes a day')).toHaveValue('10');
  expect(await problems()).toEqual([]);
});

test('before an exam its class comes first, even past the daily minutes, and the page says why (#86)', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await lectureYesterday(page, 'CHEM 101', 60);
  await lectureYesterday(page, 'PHYS 150', 60);

  // PHYS 150 has a midterm in 5 days (today is Nov 18)
  await toClasses(page);
  await openClass(page, 'PHYS 150');
  await page.getByRole('button', { name: 'Add an exam' }).click();
  const examForm = page.getByRole('form', { name: 'New exam' });
  await examForm.getByLabel('Title (optional)').fill('Midterm 1');
  await examForm.getByLabel('Exam date').fill('2026-11-23');
  await examForm.getByRole('button', { name: 'Add exam' }).click();
  await expect(page.getByTestId('exam-row')).toContainText('Midterm 1');
  await page.getByRole('link', { name: '← Classes' }).click();

  // Ten minutes a day: PHYS 150's 20-minute session is still planned, and CHEM 101 waits
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  const form = page.getByRole('form', { name: 'Study time' });
  await form.getByLabel('Minutes a day').fill('10');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved: 10 minutes a day.');
  await navBar(page).getByRole('link', { name: 'Tasks' }).click();
  await expect(classes(page)).toHaveCount(1);
  await expect(classNamed(page, 'PHYS 150')).toBeVisible();
  await expect(statusOf(page, 'PHYS 150')).toHaveText('Exam soon');
  await expect(page.getByTestId('exam-note')).toHaveText('More than your daily time today, to get you ready for PHYS 150’s Midterm 1 (in 5 days).');
  expect(await problems()).toEqual([]);
});

test('a quiz whose questions are being written in the background looks greyed out and says when it’ll be ready (#177)', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await lectureYesterday(page, 'CHEM 101');
  // The background round sent the section to the AI helper (as WorkRunner does): its job is in this device's work state
  const ids = await page.evaluate(
    () =>
      new Promise<{ course: string; section: string; deck: string }>((resolve, reject) => {
        const open = indexedDB.open('honed');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['courses', 'sections', 'slideDecks', 'meta'], 'readwrite');
          const keys = (store: string) => new Promise<string[]>((ok) => (tx.objectStore(store).getAllKeys().onsuccess = (e) => ok((e.target as IDBRequest).result as string[])));
          void Promise.all([keys('courses'), keys('sections'), keys('slideDecks')]).then(([[course], [section], [deck]]) => {
            const job = { sectionId: section, deckId: deck, pages: [2, 3, 4], sentAt: '2026-11-18T17:00:00.000Z', neededBy: '2026-11-19T12:00:00.000Z' };
            tx.objectStore('meta').put({ key: 'work', value: { sent: { 'w-test': job }, problem: null, lastRound: null } });
            tx.oncomplete = () => resolve({ course: course!, section: section!, deck: deck! });
          });
        };
      }),
  );
  await reloadUnlocked(page);
  const chem = classNamed(page, 'CHEM 101');
  await chem.getByTestId('task-status').click();
  // Greyed out, but a tap still answers
  const quiz = chem.getByRole('button', { name: 'Quiz' });
  await expect(quiz).toHaveAttribute('aria-disabled', 'true');
  await quiz.click({ force: true }); // Playwright waits forever on aria-disabled; a person can still tap it
  const dialog = page.getByRole('dialog', { name: 'Your quiz is still being written' });
  await expect(dialog).toContainText(/Questions for slides 2–4 will be ready for your next study session \(Thursday, 4:00\s?AM\)\./);
  await expect(dialog.getByRole('link', { name: 'Study the pages now' })).toHaveAttribute('href', `#/class/${ids.course}/slides/${ids.deck}/2-4`);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);

  // The Quiz page says the same instead of making the questions a second time
  await page.evaluate((h) => (location.hash = h), `#/class/${ids.course}/quiz/${ids.section}`);
  await expect(page.getByTestId('quiz-waiting')).toContainText('Your quiz is still being written');
  await expect(page.getByRole('button', { name: 'Make questions' })).toHaveCount(0);
  expect(await problems()).toEqual([]);
});
