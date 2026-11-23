// Playwright's `test` and `expect` for every browser test: import them from here, not from
// '@playwright/test', so each page gets the fix below.
//
// WebKit stalls under load (#81, measured Nov 20 on a 24-thread PC, all three projects, 48 workers,
// --repeat-each=4): a WebKit page sometimes stops drawing frames (one probe counted 0 a second while the
// page was visible and focused), so a click waits forever on "visible, enabled and stable": Playwright
// checks stability frame by frame. About one iPhone test a run stalled, on a different line and screen
// each time (forms, the nav bar, the viewer demo page), never in Chromium. A page that keeps asking for
// frames never stalled: 0 stalls in 6 such runs (about 1,200 iPhone tests) with a frame loop, against
// about one a run without it. So WebKit pages here keep a frame loop running. It's the test browser,
// not Honed: the app has no animation or frame loop of its own to get stuck.
import { test as base, type BrowserContext } from '@playwright/test';

export * from '@playwright/test';

/** For every page of a context: asks for the next frame on every frame, from before the page's own scripts. */
export async function keepDrawing(context: BrowserContext, browserName: string): Promise<void> {
  if (browserName !== 'webkit') return;
  await context.addInitScript(() => {
    const frame = () => requestAnimationFrame(frame);
    requestAnimationFrame(frame);
  });
}

/**
 * A default answer for the AI helper's style job (#123): making questions first brings the class's exam style guide
 * up to date (src/quiz/bank.ts guideForQuestions), so any test that makes questions asks for one. Like the helper,
 * nothing is spent or sent. A test that checks style requests routes `**\/ai/style` on its page, which wins.
 */
export async function answerStyle(context: BrowserContext): Promise<void> {
  await context.route('**/ai/style', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tests: 'Test guide: what the exam asks.', levels: ['Recognise a term.', 'Apply it once.', 'Work a full problem.'], shortShare: 0 }),
    }),
  );
}

/** Every test's own context gets both; a test that makes another context calls them itself. */
export const test = base.extend({
  context: async ({ context, browserName }, use) => {
    await keepDrawing(context, browserName);
    await answerStyle(context);
    await use(context);
  },
});
