// A quiz whose questions are still being written in the background (#177; DESIGN.md "A quiz that isn't ready yet").
// A section is "being written" when this device sent it to the AI helper (its work state has a job for it the helper
// hasn't given up on) and its bank is still empty. The Tasks page's Quiz and the Quiz page then say when it'll be
// ready instead of making the questions a second time.
import type { StudyStore } from '../db/store';

export interface Writing {
  /** When the next study session using it starts (the job's deadline), or null if there isn't one. */
  neededBy: string | null;
}

/** The background work's margin before "needed by" (helper HELPER_BATCH_MARGIN_MS): from then on it's written straight away. */
export const ALMOST_READY_MS = 2 * 3_600_000;

/** The sections (of these, or of all) whose questions are being written now. */
export async function questionsBeingWritten(
  store: Pick<StudyStore, 'getWorkState' | 'listQuestions'>,
  sectionIds?: readonly string[],
): Promise<Map<string, Writing>> {
  const state = await store.getWorkState();
  const writing = new Map<string, Writing>();
  for (const sent of Object.values(state.sent)) {
    if (sent.failedAt || (sectionIds && !sectionIds.includes(sent.sectionId)) || writing.has(sent.sectionId)) continue;
    if ((await store.listQuestions(sent.sectionId)).length > 0) continue; // the bank has questions: the quiz can start
    writing.set(sent.sectionId, { neededBy: sent.neededBy ?? null });
  }
  return writing;
}

/** What to tell the student, for slides like "slides 51–58". */
export function writingMessage(writing: Writing, slides: string, now: Date = new Date()): { title: string; body: string } {
  const title = 'Your quiz is still being written';
  if (!writing.neededBy) return { title, body: `Questions for ${slides} will be ready within a day.` };
  const due = Date.parse(writing.neededBy);
  if (now.getTime() >= due - ALMOST_READY_MS) return { title, body: 'Almost ready: your questions are being written now.' };
  // The day and the time apart, so it reads "Thursday, 4:00 PM" in every browser (some leave the comma out)
  const at = new Date(due);
  const when = `${at.toLocaleString('en', { weekday: 'long' })}, ${at.toLocaleString('en', { hour: 'numeric', minute: '2-digit' })}`;
  return { title, body: `Questions for ${slides} will be ready for your next study session (${when}).` };
}
