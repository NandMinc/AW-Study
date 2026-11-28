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

/** The app's PBKDF2 rounds for a passphrase (src/lib/crypto.ts PBKDF2_ITERATIONS), and what the tests use instead. */
export const REAL_ROUNDS = 600_000;
export const TEST_ROUNDS = 1_000;

/**
 * Cheaper passphrases (#192): inside the test browser, PBKDF2 at the app's 600,000 rounds runs 1,000 instead. Setting
 * up or unlocking was ~1.5 s of every iPhone test (WebKit is slow at it) and ~0.3 s elsewhere, in nearly every test.
 * The app is unchanged and what it stores still says 600,000; only this browser's WebCrypto is wrapped, so setup
 * and unlock stay consistent. Every context in one test must match: a keyring or backup made at 1,000 rounds won't
 * open in a context with the real count (it fails loudly, as a wrong passphrase). lock.spec.ts keeps the real rounds
 * (`test.use({ realKdf: true })`), so the real cost is still tested on every device.
 */
export async function fastKdf(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ([real, cheap]) => {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) return;
      const cheaper = <T,>(algorithm: T): T => {
        const a = algorithm as { name?: string; iterations?: number };
        return a && typeof a === 'object' && a.name === 'PBKDF2' && a.iterations === real ? ({ ...a, iterations: cheap } as T) : algorithm;
      };
      const deriveKey = subtle.deriveKey.bind(subtle);
      const deriveBits = subtle.deriveBits.bind(subtle);
      subtle.deriveKey = ((algorithm, ...rest) => deriveKey(cheaper(algorithm), ...rest)) as typeof subtle.deriveKey;
      subtle.deriveBits = ((algorithm, ...rest) => deriveBits(cheaper(algorithm), ...rest)) as typeof subtle.deriveBits;
    },
    [REAL_ROUNDS, TEST_ROUNDS] as const,
  );
}

/**
 * Every test's own context gets keepDrawing, answerStyle and (unless the test uses `realKdf`) fastKdf; a test that
 * makes another context calls them itself, with the same choice of rounds.
 */
export const test = base.extend<{ realKdf: boolean }>({
  realKdf: [false, { option: true }],
  context: async ({ context, browserName, realKdf }, use) => {
    await keepDrawing(context, browserName);
    await answerStyle(context);
    if (!realKdf) await fastKdf(context);
    await use(context);
  },
});
