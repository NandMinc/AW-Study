// A class's exam style guide (#122, DESIGN "The exam style guide"): when it needs making or remaking, what it's
// made from, and making it with the AI's style job (#121). The class page's Exam style calls these, and so can
// making questions (#123: the first section's questions wait for the guide). The store and the AI are passed in.
//
// Remade when a document is added or removed, when the notes change, and when the guide hasn't seen
// GUIDE_UNSEEN_LECTURES or more of the class's lectures: one request each time, about once a week for most classes.
import type { AiBackend } from '../ai/backend';
import { hasStyleText, styleRequest, type StyleSources } from '../ai/style';
import type { StudyStore } from '../db/store';
import type { LectureWithSections } from '../types/lecture';
import type { ClassMaterial, ExamStyle, StyleGuideSource } from '../types/style';

/** Lectures the guide hasn't seen before it's remade (DESIGN: "2 or more"). */
export const GUIDE_UNSEEN_LECTURES = 2;

export type GuideNeed =
  | { kind: 'none' } // up to date, or nothing to make one from
  | { kind: 'first' } // no guide yet
  | { kind: 'materials' } // a document was added or removed
  | { kind: 'notes' } // the notes changed
  | { kind: 'lectures'; unseen: number }; // lectures it hasn't seen

/** Whether the guide needs (re)making, and why. `lectureIds` and `materialIds` are the class's now. */
export function guideNeed(style: ExamStyle, lectureIds: readonly string[], materialIds: readonly string[]): GuideNeed {
  const guide = style.guide;
  if (!guide) {
    const anything = lectureIds.length > 0 || materialIds.length > 0 || style.notes.trim() !== '';
    return anything ? { kind: 'first' } : { kind: 'none' };
  }
  const seenMaterials = new Set(guide.from.materialIds);
  if (materialIds.length !== seenMaterials.size || materialIds.some((id) => !seenMaterials.has(id))) return { kind: 'materials' };
  if (style.notesAt !== guide.from.notesAt) return { kind: 'notes' };
  const seenLectures = new Set(guide.from.lectureIds);
  const unseen = lectureIds.filter((id) => !seenLectures.has(id)).length;
  return unseen >= GUIDE_UNSEEN_LECTURES ? { kind: 'lectures', unseen } : { kind: 'none' };
}

/** What the class page says about a need. */
export function describeNeed(need: GuideNeed): string {
  switch (need.kind) {
    case 'none':
      return '';
    case 'first':
      return 'There’s no exam style guide yet.';
    case 'materials':
      return 'The documents have changed since the guide was made.';
    case 'notes':
      return 'Your notes have changed since the guide was made.';
    case 'lectures':
      return `The guide hasn’t seen the last ${need.unseen} lectures.`;
  }
}

export type GuideStore = Pick<
  StudyStore,
  'getCourse' | 'getExamStyle' | 'listLectures' | 'listMaterials' | 'getSlideDeckPages' | 'getMaterialText' | 'saveMadeGuide'
>;

/** Each lecture's slide text: the pages of every section it covered. */
export function lectureTexts(lectures: readonly LectureWithSections[], deckPages: ReadonlyMap<string, string[]>): StyleSources['lectures'] {
  return lectures.map(({ lecture, sections }) => ({
    date: lecture.date,
    pageTexts: sections.flatMap((s) => (deckPages.get(s.deckId) ?? []).slice(s.firstPage - 1, s.lastPage)),
  }));
}

/**
 * Everything the guide is made from, and the record of it. A deck or document whose text can't be read now (a
 * synced one not downloaded, and offline) is left out of the text, but still counts as seen, so the guide isn't
 * remade over and over for it.
 */
export async function gatherSources(store: GuideStore, courseId: string): Promise<{ sources: StyleSources; from: StyleGuideSource }> {
  const [course, style, lectures, materials] = await Promise.all([
    store.getCourse(courseId),
    store.getExamStyle(courseId),
    store.listLectures(courseId),
    store.listMaterials(courseId),
  ]);
  if (!course) throw new Error('That class no longer exists.');
  const deckIds = [...new Set(lectures.flatMap((l) => l.sections.map((s) => s.deckId)))];
  const deckPages = new Map<string, string[]>();
  for (const id of deckIds) deckPages.set(id, await store.getSlideDeckPages(id).catch(() => []));
  const materialTexts: StyleSources['materials'] = [];
  for (const m of materials) materialTexts.push({ kind: m.kind, title: m.title, pageTexts: await store.getMaterialText(m.id).catch(() => []) });
  return {
    sources: { className: course.name, notes: style.notes, materials: materialTexts, lectures: lectureTexts(lectures, deckPages), previous: style.guide },
    from: { lectureIds: lectures.map((l) => l.lecture.id), materialIds: materials.map((m: ClassMaterial) => m.id), notesAt: style.notesAt },
  };
}

/**
 * Makes (or remakes) the class's guide with the AI and saves it. Null when there's no text to make it from yet
 * (slides that are pictures only, no documents, no notes): nothing is sent then.
 */
export async function makeGuide(store: GuideStore, ai: AiBackend, courseId: string, signal?: AbortSignal): Promise<ExamStyle | null> {
  const { sources, from } = await gatherSources(store, courseId);
  const request = styleRequest(sources);
  if (!hasStyleText(request)) return null;
  const guide = await ai.makeStyleGuide(request, signal);
  return store.saveMadeGuide(courseId, guide, from);
}

/** The guide brought up to date if it needs it (one AI request), or as it is. */
export async function refreshGuide(store: GuideStore, ai: AiBackend, courseId: string, signal?: AbortSignal): Promise<ExamStyle> {
  const [style, lectures, materials] = await Promise.all([store.getExamStyle(courseId), store.listLectures(courseId), store.listMaterials(courseId)]);
  const need = guideNeed(
    style,
    lectures.map((l) => l.lecture.id),
    materials.map((m) => m.id),
  );
  if (need.kind === 'none') return style;
  return (await makeGuide(store, ai, courseId, signal)) ?? style;
}
