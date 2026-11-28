// The AI parts of Settings (restyle step 4, docs/design "Settings"): whether you're signed in for AI
// (checked only when you ask: the helper's /ai/whoami, which uses no AI and sends nothing of yours),
// a Sign in for AI link, and Compare models for one of your latest sections (kept for now: the app is
// still an MVP), which opens that section's quiz screen with the comparison showing.
import { useState } from 'react';
import { AiError, type AiStatus } from '../ai/backend';
import { signInUrl } from '../ai/http';
import type { StudyStore } from '../db/store';
import type { Section } from '../types/lecture';
import { deviceTimeZone, studyDay } from '../lib/studyDay';
import { useAi } from './ai-context';
import { slidesLabel } from './classes';
import { href } from './route';
import { DAY_START_HOUR } from './settings';
import { useStore } from './store-context';
import { messageOf, useLoad } from './useLoad';

/** How many of the latest sections Compare models offers. */
export const COMPARE_CHOICES = 5;

export type CompareChoice = { section: Section; course: string; deck: string };

/** The latest sections Compare models offers, with their class and deck names. Settings loads it before drawing (#92). */
export async function loadCompareChoices(store: StudyStore, today: string): Promise<CompareChoice[]> {
  const [courses, sections] = await Promise.all([store.listCourses(today), store.listSections()]);
  const latest = [...sections].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, COMPARE_CHOICES);
  const decks = new Map((await Promise.all(courses.map((c) => store.listSlideDecks(c.id)))).flat().map((d) => [d.id, d]));
  const names = new Map(courses.map((c) => [c.id, c.name]));
  return latest.map((s) => ({ section: s, course: names.get(s.courseId) ?? 'Class', deck: decks.get(s.deckId)?.title ?? 'Slides' }));
}

export function AiSettings({ initialChoices }: { initialChoices?: { value: CompareChoice[] } }) {
  return (
    <>
      <AiSignIn />
      <CompareChoices initial={initialChoices} />
    </>
  );
}

type Check = { state: 'checking' } | { state: 'in'; status: AiStatus } | { state: 'problem'; message: string; signIn: boolean };

function AiSignIn() {
  const ai = useAi();
  const [check, setCheck] = useState<Check | null>(null);
  const run = async () => {
    setCheck({ state: 'checking' });
    try {
      setCheck({ state: 'in', status: await ai.status() });
    } catch (err) {
      const signedOut = err instanceof AiError && err.code === 'signed-out';
      setCheck({ state: 'problem', message: signedOut ? 'You’re not signed in for AI.' : messageOf(err), signIn: signedOut });
    }
  };
  return (
    <>
      <h3 id="ai-title">AI</h3>
      <div className="stack" aria-labelledby="ai-title" role="group">
        <p className="muted small">
          Making quiz questions, Explain this and Ask about this use AI, through our own helper. Quizzes themselves don’t.
        </p>
        {check?.state === 'in' && (
          <p role="status" data-testid="ai-status">
            Signed in for AI as {check.status.email}. {check.status.usedToday} of {check.status.dailyLimit} AI requests used today.
          </p>
        )}
        {check?.state === 'problem' && (
          <p className={check.signIn ? '' : 'error'} role="status" data-testid="ai-status">
            {check.message}
          </p>
        )}
        <div className="row">
          <button type="button" onClick={() => void run()} disabled={check?.state === 'checking'}>
            {check?.state === 'checking' ? 'Checking…' : 'Check AI sign-in'}
          </button>
          <a className="button" href={signInUrl()} target="_blank" rel="noopener">
            Sign in for AI
          </a>
        </div>
      </div>
    </>
  );
}

function CompareChoices({ initial }: { initial?: { value: CompareChoice[] } }) {
  const store = useStore();
  const today = studyDay(new Date(), deviceTimeZone(), DAY_START_HOUR);
  const { data, error } = useLoad(() => loadCompareChoices(store, today), [store, today], initial);

  return (
    <>
      <h3 id="compare-title">Compare models</h3>
      <p className="muted small">See what Haiku, Sonnet and Opus write from the same slides, side by side. Pick one of your latest lectures:</p>
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="muted small">Nothing to compare yet: say what a lecture covered first.</p>}
      {data && data.length > 0 && (
        <ul className="list" aria-labelledby="compare-title">
          {data.map(({ section, course, deck }) => (
            <li key={section.id}>
              <a href={href({ name: 'quiz', courseId: section.courseId, sectionId: section.id, compare: true })}>
                {course}: {deck}, {slidesLabel(section.firstPage, section.lastPage)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
