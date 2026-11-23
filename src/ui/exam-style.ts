// The class page's Exam style (#122, DESIGN "Exam style and question levels"): what a document probably is, when a
// class's guide is out of date, and making it. The texts are gathered here from the store and cut to fit by
// styleRequest (src/ai/style.ts); the AI writes the guide (makeStyleGuide); the store keeps it with what it was
// made from, so the next check knows what's new.
import type { AiBackend } from '../ai/backend';
import { hasStyleText, styleRequest, type StyleSources } from '../ai/style';
import type { StudyStore } from '../db/store';
import type { ClassMaterial, ExamStyle, MaterialKind, StyleGuideSource } from '../types/style';

export const KIND_NAMES: Record<MaterialKind, string> = {
  outline: 'Outline or syllabus',
  'past-exam': 'Past exam',
  practice: 'Practice or assignment',
  other: 'Other',
};
export const KINDS = Object.keys(KIND_NAMES) as MaterialKind[];
/** Shorter, for the four buttons that pick one (they must fit a phone's width). */
export const KIND_SHORT: Record<MaterialKind, string> = { outline: 'Outline', 'past-exam': 'Past exam', practice: 'Practice', other: 'Other' };

/** The levels' names, as DESIGN gives them. */
export const LEVEL_NAMES = ['Recognise', 'Apply', 'Exam-style'] as const;

/** A guess at what a document is from its file name; the student can change it. */
export function guessKind(fileName: string): MaterialKind {
  const name = fileName.toLowerCase();
  if (/(exam|midterm|mid-term|final|quiz|test)/.test(name)) return 'past-exam';
  if (/(outline|syllabus|schedule|overview)/.test(name)) return 'outline';
  if (/(practice|assignment|homework|problem|exercise|worksheet|tutorial|\bhw|\bps\s?\d)/.test(name)) return 'practice';
  return 'other';
}

/** The file types a document may be, by its name (DESIGN "File types to support" has the rest). */
export function documentType(file: { name: string; type: string }): 'application/pdf' | 'text/plain' | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'application/pdf';
  if (file.type === 'text/plain' || file.type === 'text/markdown' || /\.(txt|md|markdown|text)$/.test(name)) return 'text/plain';
  return null;
}

/** Remake once this many of the class's lectures are new to the guide (DESIGN). */
export const UNSEEN_LECTURES_FOR_REMAKE = 2;

export interface Staleness {
  /** Documents added or removed since the guide was made. */
  materialsChanged: boolean;
  notesChanged: boolean;
  /** Lectures (with slides) the guide hasn't seen. */
  unseenLectures: number;
}

/** What has changed since the guide was made; null with no guide. */
export function staleness(style: ExamStyle, lectureIds: string[], materials: Pick<ClassMaterial, 'id'>[]): Staleness | null {
  const guide = style.guide;
  if (!guide) return null;
  const seenMaterials = new Set(guide.from.materialIds);
  const now = new Set(materials.map((m) => m.id));
  const materialsChanged = now.size !== seenMaterials.size || [...now].some((id) => !seenMaterials.has(id));
  const seenLectures = new Set(guide.from.lectureIds);
  return {
    materialsChanged,
    notesChanged: style.notesAt !== guide.from.notesAt,
    unseenLectures: lectureIds.filter((id) => !seenLectures.has(id)).length,
  };
}

/**
 * Whether the class page makes (or remakes) the guide by itself: only after the student's own changes to what it's
 * for, a document or the notes. Opening a class never sends anything: slides alone are sent only when questions are
 * made (which can be turned off), so new lectures wait for `shouldRemake` before the next questions, or Remake.
 */
export function remakeOnPage(style: ExamStyle, materials: Pick<ClassMaterial, 'id'>[]): boolean {
  const stale = staleness(style, [], materials);
  if (!stale) return style.notes !== '' || materials.length > 0;
  return stale.materialsChanged || stale.notesChanged;
}

/**
 * Whether to make the guide again before making questions (DESIGN; #123 calls it): a document or the notes changed,
 * or 2 or more lectures are new to it. With no guide yet: once there's anything to make one from (`hasText`).
 */
export function shouldRemake(style: ExamStyle, lectureIds: string[], materials: Pick<ClassMaterial, 'id'>[], hasText: boolean): boolean {
  const stale = staleness(style, lectureIds, materials);
  if (!stale) return hasText;
  return stale.materialsChanged || stale.notesChanged || stale.unseenLectures >= UNSEEN_LECTURES_FOR_REMAKE;
}

/**
 * The texts a class's guide is made from, and what they were. A document or deck whose text isn't on this device
 * (added on another device, not synced here yet) is left out, and so isn't counted as seen: it counts once it's here.
 */
export async function gatherStyleSources(store: StudyStore, courseId: string): Promise<{ sources: StyleSources; from: StyleGuideSource }> {
  const [course, style, materials, lectures] = await Promise.all([
    store.getCourse(courseId),
    store.getExamStyle(courseId),
    store.listMaterials(courseId),
    store.listLectures(courseId),
  ]);
  const readable = async <T>(read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch {
      return null;
    }
  };

  const materialTexts = await Promise.all(materials.map(async (m) => ({ m, pages: await readable(() => store.getMaterialText(m.id)) })));
  const deckPages = new Map<string, string[] | null>();
  const pagesOf = async (deckId: string) => {
    if (!deckPages.has(deckId)) deckPages.set(deckId, await readable(() => store.getSlideDeckPages(deckId)));
    return deckPages.get(deckId)!;
  };
  const lectureTexts: { id: string; date: string; pageTexts: string[] }[] = [];
  for (const { lecture, sections } of lectures) {
    const pageTexts: string[] = [];
    let any = false;
    for (const s of sections) {
      const pages = await pagesOf(s.deckId);
      if (!pages) continue;
      any = true;
      pageTexts.push(...pages.slice(s.firstPage - 1, s.lastPage));
    }
    if (any) lectureTexts.push({ id: lecture.id, date: lecture.date, pageTexts });
  }

  const read = materialTexts.filter((x): x is { m: ClassMaterial; pages: string[] } => x.pages !== null);
  return {
    sources: {
      className: course?.name ?? '',
      notes: style.notes,
      materials: read.map(({ m, pages }) => ({ kind: m.kind, title: m.title, pageTexts: pages })),
      lectures: lectureTexts.map(({ date, pageTexts }) => ({ date, pageTexts })),
      previous: style.guide,
    },
    from: { lectureIds: lectureTexts.map((l) => l.id), materialIds: read.map(({ m }) => m.id), notesAt: style.notesAt },
  };
}

/** Lectures that count for staleness: those whose slides' text is on this device (as gatherStyleSources reads). */
export async function lecturesWithText(store: StudyStore, courseId: string): Promise<string[]> {
  return (await gatherStyleSources(store, courseId)).from.lectureIds;
}

/**
 * Makes (or remakes) the class's guide and saves it. Null when there's nothing to make it from (no notes, documents
 * or slides yet). AI errors are thrown as they are (AiError), for the page to show.
 */
export async function makeGuide(store: StudyStore, ai: AiBackend, courseId: string, signal?: AbortSignal): Promise<ExamStyle | null> {
  const { sources, from } = await gatherStyleSources(store, courseId);
  const request = styleRequest(sources);
  if (!hasStyleText(request)) return null;
  const guide = await ai.makeStyleGuide(request, signal);
  return store.saveMadeGuide(courseId, guide, from);
}
