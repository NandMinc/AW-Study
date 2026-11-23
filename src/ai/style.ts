// What the style job (#121, DESIGN "The exam style guide") writes a class's guide from, cut to fit the helper's
// limits (helper/jobs.mjs LIMITS): the student's notes whole, the materials next (past exams first, then
// outlines, then practice sets and the rest), and a sample of every lecture's slides with what's left, each
// lecture an equal share. Pure: the class page (#122) gathers the texts and sends what this returns.
import type { MaterialKind, StyleGuide } from '../types/style';
import type { StyleRequest } from './backend';

export const STYLE_LIMITS = {
  /** All the text together (the helper's LIMITS.totalText). */
  totalText: 120_000,
  /** At most this share of it for the materials, so the slides always get some. */
  materialsShare: 0.6,
  materials: 20,
  lectures: 60,
  notes: 4_000,
  className: 200,
};

/** Past exams are the strongest signal (DESIGN), then outlines and syllabi, then the rest. */
const KIND_ORDER: Record<MaterialKind, number> = { 'past-exam': 0, outline: 1, practice: 2, other: 3 };

export interface StyleSources {
  className: string;
  notes: string;
  materials: { kind: MaterialKind; title: string; pageTexts: string[] }[];
  /** Each lecture's date and the text of the slides it covered. */
  lectures: { date: string; pageTexts: string[] }[];
  /** The guide as it stands (ExamStyle.guide), if there is one. */
  previous: StyleGuide | null;
}

const joined = (pages: string[]) =>
  pages
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');

/** Shares `budget` among texts so none gets more than it needs and the rest split what's left evenly. */
function share(lengths: number[], budget: number): number[] {
  const out = Array<number>(lengths.length).fill(0);
  const order = lengths.map((n, i) => ({ n, i })).sort((a, b) => a.n - b.n);
  let left = budget;
  order.forEach(({ n, i }, k) => {
    const fair = Math.floor(left / (order.length - k));
    out[i] = Math.min(n, fair);
    left -= out[i]!;
  });
  return out;
}

export function styleRequest(sources: StyleSources): StyleRequest {
  const notes = sources.notes.trim().slice(0, STYLE_LIMITS.notes);
  let left = STYLE_LIMITS.totalText - notes.length;

  // Materials, strongest signal first, each taking what it needs up to the materials' part
  let forMaterials = Math.floor(left * STYLE_LIMITS.materialsShare);
  const materials = [...sources.materials]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => KIND_ORDER[a.m.kind] - KIND_ORDER[b.m.kind] || a.i - b.i)
    .map(({ m }) => ({ kind: m.kind, title: m.title.trim().slice(0, STYLE_LIMITS.className) || 'Untitled', text: joined(m.pageTexts) }))
    .filter((m) => m.text !== '')
    .slice(0, STYLE_LIMITS.materials)
    .map((m) => {
      const text = m.text.slice(0, forMaterials);
      forMaterials -= text.length;
      return { ...m, text };
    })
    .filter((m) => m.text !== '');
  left -= materials.reduce((n, m) => n + m.text.length, 0);

  // The latest lectures, in date order, sharing the rest
  const recent = [...sources.lectures]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-STYLE_LIMITS.lectures)
    .map((l) => ({ date: l.date, text: joined(l.pageTexts) }));
  const sizes = share(
    recent.map((l) => l.text.length),
    left,
  );
  const lectures = recent.map((l, i) => ({ date: l.date, text: l.text.slice(0, sizes[i]) }));

  const previous = sources.previous
    ? { tests: sources.previous.tests, levels: sources.previous.levels, shortShare: sources.previous.shortShare, edited: sources.previous.editedAt !== null }
    : null;
  return { className: sources.className.trim().slice(0, STYLE_LIMITS.className), notes, materials, lectures, previous };
}

/** Whether there's anything to write a guide from (the helper refuses a request without any text). */
export function hasStyleText(request: StyleRequest): boolean {
  return request.notes !== '' || request.materials.length > 0 || request.lectures.some((l) => l.text.trim() !== '');
}
