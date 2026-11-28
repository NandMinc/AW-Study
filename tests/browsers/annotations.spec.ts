// Notes and highlights on slides (#56), through the real screens, in desktop Chrome, an Android phone
// and an iPhone (WebKit): highlight words, box part of a slide, pin a note, and find them in the same
// place after a reload and when zoomed. Explain this and Ask about this go through the real AI client;
// the test answers /ai/ itself, so nothing is spent or sent.
import { expect, test, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block' }); // Playwright's routing doesn't see a service worker's requests

/** A class with a lecture on slides 2-4 of a 4-slide PDF, opened in the viewer at slide 2. */
async function openSection(page: Page) {
  await openUnlocked(page);
  await addClass(page, 'BIO 110');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(4)));
  await form.getByLabel('Lecture date').fill('2026-11-16');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('4');
  await form.getByLabel(/Make quiz questions now/).uncheck();
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await page.getByRole('link', { name: 'Cells, slides 2–4', exact: true }).click();
  await shown(page, 2);
}

/** Waits until slide n is drawn, text layer and all. */
async function shown(page: Page, n: number) {
  await expect(page.getByTestId('slide-position')).toHaveText(`Slide ${n} of 4`);
  await expect(page.getByTestId('slide-page')).toHaveAttribute('data-rendered', String(n));
}

/** The notes panel, opened if it's closed (it starts closed on phones). */
async function panel(page: Page) {
  const aside = page.getByRole('complementary', { name: 'Notes and highlights' });
  if (!(await aside.isVisible())) await page.getByRole('button', { name: /^Notes/ }).click();
  await expect(aside).toBeVisible();
  return aside;
}

/**
 * Selects the words of one piece of the slide's text layer, as a drag over them would, until the
 * panel offers to highlight them (opening the panel on a phone resizes and redraws the slide, which
 * drops a selection made in between).
 */
async function selectWords(page: Page, words: string) {
  const group = page.getByRole('complementary', { name: 'Notes and highlights' }).getByRole('group', { name: 'Selected words' });
  await expect(async () => {
    await selectOnce(page, words);
    await expect(group).toContainText(`“${words}”`, { timeout: 1_000 });
  }).toPass();
}

async function selectOnce(page: Page, words: string) {
  await page.evaluate((w) => {
    const span = [...document.querySelectorAll('.sv-page .textLayer span')].find((s) => s.textContent === w);
    if (!span) throw new Error(`No "${w}" on the slide`);
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, words);
}

/** An element's box as fractions of the slide's box. */
async function onSlide(page: Page, selector: string, index = 0) {
  return page.evaluate(
    ([sel, i]) => {
      const pageBox = document.querySelector('.sv-page')!.getBoundingClientRect();
      const el = document.querySelectorAll(sel as string)[i as number];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - pageBox.left) / pageBox.width,
        y: (r.top - pageBox.top) / pageBox.height,
        w: r.width / pageBox.width,
        h: r.height / pageBox.height,
      };
    },
    [selector, index] as const,
  );
}

/** Where a pin points: its middle (it keeps its size on screen, so its box isn't to scale). */
async function pinPoint(page: Page) {
  const b = await onSlide(page, '[data-testid="pin"]');
  return b && { x: b.x + b.w / 2, y: b.y + b.h / 2, w: 0, h: 0 };
}

function expectNear(a: { x: number; y: number; w: number; h: number } | null, b: { x: number; y: number; w: number; h: number } | null, by = 0.01) {
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(a![k] - b![k]), k).toBeLessThan(by);
}

/** Drags on the slide between two points given as fractions of it. */
async function dragOnSlide(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('notes-layer').boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), { steps: 3 });
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 3 });
  await page.mouse.up();
}

test('highlight words, box part of a slide and pin a note; they stay in place after a reload and when zoomed', async ({ page }) => {
  const problems = await watchProblems(page);
  const aiCalls: string[] = [];
  await page.route('**/ai/**', (route) => (aiCalls.push(route.request().url()), route.abort()));
  await openSection(page);
  const notes = await panel(page);
  await expect(notes.getByRole('heading', { name: 'On slide 2' })).toBeVisible();
  await expect(notes).toContainText('No notes or highlights on this slide yet.');

  // Highlight words: select them, pick a colour
  await selectWords(page, 'Fixture text 2');
  await expect(notes.getByRole('group', { name: 'Selected words' })).toContainText('“Fixture text 2”');
  await notes.getByRole('button', { name: 'Highlight green' }).click();
  await expect(notes.getByTestId('annotation')).toHaveCount(1);
  await expect(notes.getByTestId('annotation').first()).toContainText('“Fixture text 2”');
  await expect(page.getByTestId('mark')).toHaveCount(1);
  const words = await onSlide(page, '.textLayer span:not(:empty)', 1);
  expectNear(await onSlide(page, '[data-testid="mark"]'), words, 0.02);

  // Box part of the slide
  await notes.getByRole('button', { name: 'Box' }).click();
  await expect(notes.getByTestId('tool-hint')).toHaveText('Drag a box over part of the slide.');
  await dragOnSlide(page, [0.1, 0.5], [0.6, 0.9]);
  await shown(page, 2); // dragging with the box tool doesn't change slides
  await expect(notes.getByRole('group', { name: 'New box' })).toBeVisible();
  await notes.getByRole('button', { name: 'Highlight blue' }).click();
  await expect(notes.getByTestId('annotation')).toHaveCount(2);

  // Pin a note
  await notes.getByRole('button', { name: 'Pin a note' }).click();
  const layer = (await page.getByTestId('notes-layer').boundingBox())!;
  await page.mouse.click(layer.x + layer.width * 0.8, layer.y + layer.height * 0.2);
  const form = notes.getByRole('form', { name: 'New note' });
  await expect(form.getByRole('button', { name: 'Save note' })).toBeDisabled(); // a pinned note needs words
  await form.getByLabel('Note on slide 2').fill('Ask about the coloured bar');
  await form.getByRole('button', { name: 'Save note' }).click();
  await expect(notes.getByTestId('annotation')).toHaveCount(3);
  await expect(page.getByTestId('pin')).toHaveCount(1);
  // The panel, beside or under the slides, never runs into the page's footer (phones have none here, #110)
  const panelBox = (await notes.boundingBox())!;
  const footer = await page.locator('footer').boundingBox(); // null when hidden
  if (footer) expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(footer.y + 1);

  const before = {
    mark: await onSlide(page, '[data-testid="mark"]', 0),
    box: await onSlide(page, '[data-testid="mark"]', 1),
    pin: await pinPoint(page),
  };
  expectNear(before.box, { x: 0.1, y: 0.5, w: 0.5, h: 0.4 }, 0.02);

  // Another slide has none of them; back on slide 2 they're there
  await page.getByRole('button', { name: 'Slide 3', exact: true }).click();
  await shown(page, 3);
  await expect(page.getByTestId('mark')).toHaveCount(0);
  await expect(notes.getByTestId('annotation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Slide 2', exact: true }).click();
  await shown(page, 2);

  // After a reload (encrypted on the device, so unlocking again), all in the same place
  await reloadUnlocked(page);
  await shown(page, 2);
  const again = await panel(page);
  await expect(again.getByTestId('annotation')).toHaveCount(3);
  await expect(page.getByTestId('mark')).toHaveCount(2);
  expectNear(await onSlide(page, '[data-testid="mark"]', 0), before.mark);
  expectNear(await onSlide(page, '[data-testid="mark"]', 1), before.box);
  expectNear(await pinPoint(page), before.pin);
  expectNear(before.pin, { x: 0.8, y: 0.2, w: 0, h: 0 }, 0.02);

  // Zoomed in, the marks grow with the slide and stay on the same words
  await page.getByRole('region', { name: 'Slides' }).focus();
  await page.keyboard.press('+'); // phones have no zoom buttons (#110): a pinch, or here a key
  await expect(page.getByTestId('zoom-level')).toHaveText('125%');
  await expect(page.getByTestId('slide-page')).toHaveAttribute('data-rendered', '2');
  expectNear(await onSlide(page, '[data-testid="mark"]', 0), before.mark);
  expectNear(await onSlide(page, '[data-testid="mark"]', 1), before.box);
  await page.keyboard.press('0');
  await expect(page.getByTestId('zoom-level')).toHaveText('100%');

  // Change a colour, write a note on the highlight, delete the box
  const highlight = again.getByTestId('annotation').filter({ hasText: 'Fixture text 2' });
  await highlight.getByRole('button', { name: 'Colour pink' }).click();
  await expect(highlight.getByRole('button', { name: 'Colour pink' })).toHaveAttribute('aria-pressed', 'true');
  await highlight.getByRole('button', { name: 'Add a note' }).click();
  await highlight.getByLabel('Note').fill('Powerhouse of the cell');
  await highlight.getByRole('button', { name: 'Save note' }).click();
  // The note's textarea holds the words too, so wait for the editor to close: until it does, the rows below jump up
  // ~185 px when the save lands, and a tap on them misses (#180)
  await expect(highlight.getByRole('textbox', { name: 'Note' })).toHaveCount(0);
  await expect(highlight.locator('.ann-note')).toHaveText('Powerhouse of the cell');
  const box = again.getByTestId('annotation').filter({ hasText: 'Box' });
  await box.getByRole('button', { name: 'Delete' }).click();
  await box.getByRole('button', { name: 'Delete for good' }).click();
  await expect(again.getByTestId('annotation')).toHaveCount(2);

  await reloadUnlocked(page);
  await shown(page, 2);
  const last = await panel(page);
  await expect(last.getByTestId('annotation')).toHaveCount(2);
  await expect(last.getByTestId('annotation').filter({ hasText: 'Fixture text 2' })).toContainText('Powerhouse of the cell');

  expect(aiCalls).toEqual([]); // notes never leave the device
  expect(await problems()).toEqual([]);
});

test('Explain this and Ask about this send only the words and nearby slides, and keep the answer as a note', async ({ page }) => {
  const problems = await watchProblems(page);
  const sent: { job: string; body: Record<string, unknown> }[] = [];
  await page.route('**/ai/explain', async (route) => {
    sent.push({ job: 'explain', body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'It means the third fixture.' }) });
  });
  await page.route('**/ai/ask', async (route) => {
    sent.push({ job: 'ask', body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'Because slides are numbered.' }) });
  });
  await openSection(page);
  await page.getByRole('button', { name: 'Slide 3', exact: true }).click();
  await shown(page, 3);
  const notes = await panel(page);

  // Explain the selected words, then keep the explanation: a highlight with it as its note
  await selectWords(page, 'Fixture text 3');
  await notes.getByRole('button', { name: 'Explain this' }).click();
  await expect(notes.getByTestId('ai-answer')).toHaveText('It means the third fixture.');
  expect(sent).toHaveLength(1);
  expect(sent[0]!.body.selection).toBe('Fixture text 3');
  expect((sent[0]!.body.slides as { page: number }[]).map((s) => s.page)).toEqual([2, 3, 4]);
  expect(JSON.stringify(sent[0]!.body)).not.toContain('%PDF');
  // Ask about the whole slide straight away (the kept note may still be saving: it mustn't close the
  // new question); the question and answer are pinned as a note
  await notes.getByRole('button', { name: 'Keep as note' }).click();
  // Enter, not a click: when the kept note lands, the panel grows and scrolls, and on a slow WebKit a
  // click aimed a moment earlier hit the toolbar beside the button (#81). The key goes to the button itself.
  await notes.getByRole('button', { name: 'Ask about this slide' }).press('Enter');
  await expect(notes.getByTestId('annotation')).toHaveCount(1);
  await expect(notes.getByTestId('annotation')).toContainText('It means the third fixture.');
  await expect(page.getByTestId('mark')).toHaveCount(1);
  await notes.getByLabel('Your question').fill('Why is this slide 3?');
  await notes.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(notes.getByTestId('ai-answer')).toHaveText('Because slides are numbered.');
  expect(sent[1]).toMatchObject({ job: 'ask', body: { question: 'Why is this slide 3?', selection: '' } });
  await notes.getByRole('button', { name: 'Keep as note' }).click();
  await expect(notes.getByTestId('annotation')).toHaveCount(2);
  await expect(page.getByTestId('pin')).toHaveCount(1);
  await expect(notes.getByTestId('annotation').nth(1)).toContainText('Why is this slide 3?');

  // Ask about a saved highlight: the answer is added to its note
  const highlight = notes.getByTestId('annotation').first();
  await highlight.getByRole('button', { name: 'Ask about this' }).click();
  await notes.getByLabel('Your question').fill('More?');
  await notes.getByRole('button', { name: 'Ask', exact: true }).click();
  expect((await expect(notes.getByTestId('ai-answer')).toBeVisible(), sent[2]!.body.selection)).toBe('Fixture text 3');
  await notes.getByRole('button', { name: 'Keep as note' }).click();
  await expect(highlight).toContainText(/It means the third fixture\..*More\?/s); // added to, not replaced
  await expect(notes.getByTestId('annotation')).toHaveCount(2);

  // A lapsed sign-in says so, with a way to sign in
  await page.unroute('**/ai/explain');
  await page.route('**/ai/explain', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Not signed in.' }) }));
  await highlight.getByRole('button', { name: 'Explain this' }).click();
  await expect(notes.getByRole('alert')).toContainText('Sign in again to use AI.');
  await expect(notes.getByRole('link', { name: 'Sign in for AI' })).toHaveAttribute('href', /^\/ai\/signin\?then=%2F%23%2F/);

  expect((await problems()).filter((p) => !/status of 401/.test(p))).toEqual([]);
});

test('dragging across words selects them instead of turning the slide', async ({ page }) => {
  const problems = await watchProblems(page);
  await openSection(page);
  // With the panel closed (it starts closed on phones), selecting opens it, but only once the press
  // ends: opening it mid-drag would resize and redraw the slide, dropping the selection
  const toggle = page.getByRole('button', { name: /^Notes/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  await expect(page.getByRole('complementary', { name: 'Notes and highlights' })).toBeHidden();
  await expect(page.getByTestId('slide-page')).toHaveAttribute('data-rendered', '2');
  // Closing the panel widens the slide and redraws it (data-rendered already says 2): wait until its
  // size holds, or the words measured below are replaced mid-drag and the selection is lost
  let last = '';
  await expect
    .poll(async () => {
      const b = await page.getByTestId('slide-page').boundingBox();
      const now = JSON.stringify(b);
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [150] })
    .toBe(true);
  await expect(page.locator('.sv-page .textLayer span', { hasText: 'Fixture text 2' })).toBeVisible();
  const words = page.locator('.sv-page .textLayer span', { hasText: 'Fixture text 2' });
  const box = (await words.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  const slide = (await page.getByTestId('slide-page').boundingBox())!;
  const end = Math.min(slide.x + slide.width - 4, box.x + box.width + 40); // past the words, still on the slide
  await page.mouse.move(end, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(end - box.x).toBeGreaterThan(60); // longer than a swipe
  await expect(page.getByRole('group', { name: 'Selected words' })).toContainText('Fixture te'); // where a drag stops varies
  await shown(page, 2);
  expect(await problems()).toEqual([]);
});

test('on a phone the Slides page is just the slides; on a computer nothing moves when you leave the section (#110)', async ({ page }, info) => {
  const problems = await watchProblems(page);
  await openSection(page);
  const bar = (name: string) => page.getByRole('button', { name, exact: true });
  if (info.project.name !== 'desktop') {
    // No header (name, Lock), no footer, no step or zoom buttons, no section label
    await expect(page.getByRole('banner')).toBeHidden();
    await expect(page.getByRole('contentinfo')).toBeHidden();
    for (const name of ['Previous slide', 'Next slide', 'Zoom in', 'Zoom out']) await expect(bar(name)).toBeHidden();
    await expect(page.getByTestId('slide-range')).toBeHidden();
    // Still there for screen readers: the deck's name and where you are
    await expect(page.getByRole('heading', { name: /Cells/ })).toHaveCount(1);
    await expect(page.getByTestId('slide-position')).toHaveText('Slide 2 of 4');
    // The back link and Notes share one line, and the slides and thumbnails fit on the screen
    const back = (await page.getByRole('link', { name: '← BIO 110' }).boundingBox())!;
    const notes = (await page.getByRole('button', { name: /^Notes/ }).boundingBox())!;
    expect(Math.abs(back.y + back.height / 2 - (notes.y + notes.height / 2))).toBeLessThan(4);
    expect(notes.x).toBeGreaterThan(back.x + back.width);
    const thumbs = (await page.getByRole('list', { name: 'All slides' }).boundingBox())!;
    expect(thumbs.y + thumbs.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    // Other pages keep their header and footer
    await page.getByRole('link', { name: '← BIO 110' }).click();
    await expect(page.getByRole('banner')).toBeVisible();
  } else {
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    // Leaving the section changes the label but not its width, so nothing after it moves or wraps
    const label = page.getByTestId('slide-range');
    const before = { label: (await label.boundingBox())!.width, zoom: await bar('Zoom out').boundingBox() };
    await page.getByRole('button', { name: 'Slide 1', exact: true }).click();
    await shown(page, 1);
    await expect(page.getByTestId('slide-range')).toHaveText('Outside this section: slides 2–4');
    expect((await label.boundingBox())!.width).toBeCloseTo(before.label, 0); // within half a pixel
    const zoom = (await bar('Zoom out').boundingBox())!;
    expect(zoom.x).toBeCloseTo(before.zoom!.x, 0);
    expect(zoom.y).toBeCloseTo(before.zoom!.y, 0);
  }
  expect(await problems()).toEqual([]);
});

test('a box with no words in it can be explained and asked about: its picture goes to the AI (#175)', async ({ page }) => {
  const problems = await watchProblems(page);
  const sent: { job: string; body: Record<string, unknown> }[] = [];
  for (const job of ['explain', 'ask']) {
    await page.route(`**/ai/${job}`, async (route) => {
      sent.push({ job, body: route.request().postDataJSON() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: `The ${job} answer.` }) });
    });
  }
  await openSection(page);
  await page.getByRole('button', { name: 'Slide 3', exact: true }).click();
  await shown(page, 3);
  const notes = await panel(page);
  // A box over an empty part of the slide (below the words), saved
  await notes.getByRole('button', { name: 'Box' }).click();
  await dragOnSlide(page, [0.1, 0.5], [0.9, 0.75]);
  await expect(notes.getByRole('group', { name: 'New box' })).toContainText('A box on slide 3');
  await notes.getByRole('button', { name: 'Highlight blue' }).click();
  const box = notes.getByTestId('annotation').filter({ hasText: 'Box' });
  // Its Explain works (it used to be greyed out), and sends the box's picture
  await expect(box.getByRole('button', { name: 'Explain this' })).toBeEnabled();
  await box.getByRole('button', { name: 'Explain this' }).click();
  await expect(notes.getByTestId('ai-answer')).toHaveText('The explain answer.');
  const explained = sent[0]!.body as { selection: string; image: string; slides: { page: number }[] };
  expect(explained.selection).toBe('');
  expect(Buffer.from(explained.image, 'base64url').subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  expect(explained.slides.map((s) => s.page)).toEqual([2, 3, 4]);
  // Its Ask is about the box, not the whole slide
  await box.getByRole('button', { name: 'Ask about this' }).click();
  await expect(notes.getByRole('heading', { name: 'Ask about this', exact: true })).toBeVisible();
  await notes.getByLabel('Your question').fill('What goes here?');
  await notes.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(notes.getByTestId('ai-answer')).toHaveText('The ask answer.');
  expect((sent[1]!.body as { image?: string }).image).toBeTruthy();
  expect(await problems()).toEqual([]);
});
