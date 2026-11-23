// Each class's exam style (#120, src/types/style.ts, DESIGN "Exam style and question levels"): its other documents
// (materials: the record, its file, its text, stored like a slide deck's) and its exam style (the student's notes
// and the AI's guide, one record per class, stored under examStyleId(the class)). Built on the store's helpers like
// lectures.ts, so the same rules hold: sealed per docs/SECURITY.md once set up, refused while locked, writes inside
// `exclusive()`, every write in the change log. Deleting a class deletes all of it (lectures.ts deleteCourse).
import type { Course } from '../types/lecture';
import type {
  ClassMaterial,
  ExamStyle,
  ExamStyleStore,
  MaterialKind,
  MaterialType,
  StyleGuide,
  StyleGuideContent,
  StyleGuideSource,
} from '../types/style';
import { isPdf, writeRows, type StoreContext } from './lectures';
import { examStyleId, type MaterialFile, type MaterialPages, type StoredExamStyle } from './schema';
import { StoreError } from './store';

export const MATERIAL_TITLE_MAX = 200;
export const MAX_MATERIAL_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_MATERIAL_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_MATERIAL_PAGES = 2000;
export const NOTES_MAX = 4_000;
export const GUIDE_TESTS_MAX = 3_000;
export const GUIDE_LEVEL_MAX = 600;
const SOURCE_IDS_MAX = 2_000;

const KINDS: readonly MaterialKind[] = ['outline', 'past-exam', 'practice', 'other'];
const TYPES: readonly MaterialType[] = ['application/pdf', 'text/plain'];

const invalid = (message: string) => new StoreError('invalid', message);
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

function text(value: unknown, max: number, what: string, { empty = false } = {}): string {
  if (typeof value !== 'string') throw invalid(`${what} is missing.`);
  const clean = value.trim();
  if (!clean && !empty) throw invalid(`${what} can’t be empty.`);
  if (clean.length > max) throw invalid(`${what} can be at most ${max.toLocaleString('en')} characters.`);
  return clean;
}

function checkKind(kind: unknown): MaterialKind {
  if (!KINDS.includes(kind as MaterialKind)) throw invalid('Pick what the document is: an outline, a past exam, practice, or other.');
  return kind as MaterialKind;
}

/** The guide's content, checked and cleaned (throws 'invalid' with a reason). */
function checkGuide(g: StyleGuideContent): StyleGuideContent {
  if (typeof g !== 'object' || g === null) throw invalid('The exam style guide is missing.');
  const tests = text(g.tests, GUIDE_TESTS_MAX, 'What the exam tests');
  if (!Array.isArray(g.levels) || g.levels.length !== 3) throw invalid('The guide needs what each of the three levels looks like.');
  const levels = g.levels.map((l, i) => text(l, GUIDE_LEVEL_MAX, `Level ${i + 1}`)) as StyleGuideContent['levels'];
  if (typeof g.shortShare !== 'number' || !Number.isFinite(g.shortShare) || g.shortShare < 0 || g.shortShare > 1) {
    throw invalid('The share of short answers must be from 0 to 1.');
  }
  return { tests, levels, shortShare: g.shortShare };
}

function checkSource(from: StyleGuideSource): StyleGuideSource {
  const ids = (list: unknown, what: string) => {
    if (!Array.isArray(list) || list.length > SOURCE_IDS_MAX || !list.every((id) => typeof id === 'string')) throw invalid(`The guide’s ${what} aren’t valid.`);
    return [...new Set(list as string[])];
  };
  if (typeof from !== 'object' || from === null) throw invalid('What the guide was made from is missing.');
  if (from.notesAt !== null && !isIso(from.notesAt)) throw invalid('The guide’s notes time isn’t valid.');
  return { lectureIds: ids(from.lectureIds, 'lectures'), materialIds: ids(from.materialIds, 'documents'), notesAt: from.notesAt };
}

/** A text file's bytes as text, refusing anything that isn't UTF-8 text. */
function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw invalid('That file isn’t plain text.');
  }
}

export function styleMethods(ctx: StoreContext): ExamStyleStore {
  const { db, open, openAll, seal, change, exclusive, requireOpen } = ctx;
  const iso = () => ctx.clock().toISOString();

  const getCourseOrThrow = async (id: string): Promise<Course> => {
    const row = typeof id === 'string' ? await db.get('courses', id) : undefined;
    if (!row) throw new StoreError('not-found', 'That class no longer exists.');
    return open<Course>('courses', row);
  };

  const getMaterialOrThrow = async (id: string): Promise<ClassMaterial> => {
    const row = typeof id === 'string' ? await db.get('materials', id) : undefined;
    if (!row) throw new StoreError('not-found', 'That document no longer exists.');
    return open<ClassMaterial>('materials', row);
  };

  /** The stored exam style, or an empty one. */
  const style = async (courseId: string): Promise<StoredExamStyle> => {
    const id = examStyleId(courseId);
    const row = await db.get('examStyles', id);
    if (row) return open<StoredExamStyle>('examStyles', row);
    return { id, courseId, notes: '', notesAt: null, guide: null, updatedAt: null };
  };
  const shown = ({ id: _id, ...rest }: StoredExamStyle): ExamStyle => rest;

  const saveStyle = async (next: StoredExamStyle): Promise<ExamStyle> => {
    const [row, log] = await Promise.all([seal('examStyles', { ...next }), change('examStyle', 'put', next.id, next)]);
    await writeRows(db, [{ store: 'examStyles', row }], [], [log]);
    return shown(next);
  };

  /** A material's file or text isn't here: gone, or it came from another device and its files haven't (#108). */
  const missingFile = async (id: string) =>
    (await db.get('materials', id)) === undefined
      ? new StoreError('not-found', 'That document no longer exists.')
      : ctx.fileSource?.()
        ? new StoreError('not-found', 'This document was added on another device and hasn’t reached the server yet. Open Honed on that device (with sync on), then try again.')
        : new StoreError('not-found', 'This document was added on another device. Turn on sync (Settings) to bring it here.');

  /** A material's file from elsewhere (the sync server), opened here so a wrong or changed one is refused, then kept. */
  const fromElsewhere = async <T>(id: string, kind: 'pdf' | 'pages'): Promise<T | null> => {
    const source = ctx.fileSource?.();
    if (!source || (await db.get('materials', id)) === undefined) return null;
    const enc = await source(id, kind);
    if (!enc) return null;
    const store = kind === 'pdf' ? 'materialFiles' : 'materialPages';
    const row = { id, enc };
    let opened: T;
    try {
      opened = await open<T>(store, row);
    } catch {
      throw new StoreError('invalid', 'The document from the server can’t be opened with this device’s key.');
    }
    await db.put(store, row as never);
    if (kind === 'pdf') await ctx.filesHere?.(id);
    return opened;
  };

  return {
    // --- The exam style ---

    async getExamStyle(courseId) {
      requireOpen();
      await getCourseOrThrow(courseId);
      return shown(await style(courseId));
    },

    setStyleNotes: (courseId, notes) =>
      exclusive(async () => {
        requireOpen();
        await getCourseOrThrow(courseId);
        const clean = text(notes, NOTES_MAX, 'Your notes', { empty: true });
        const now = iso();
        return saveStyle({ ...(await style(courseId)), notes: clean, notesAt: now, updatedAt: now });
      }),

    saveMadeGuide: (courseId, guide, from) =>
      exclusive(async () => {
        requireOpen();
        await getCourseOrThrow(courseId);
        const content = checkGuide(guide);
        const source = checkSource(from);
        const current = await style(courseId);
        const now = iso();
        const made: StyleGuide = { ...content, madeAt: now, from: source, editedAt: current.guide?.editedAt ?? null };
        return saveStyle({ ...current, guide: made, updatedAt: now });
      }),

    editStyleGuide: (courseId, guide) =>
      exclusive(async () => {
        requireOpen();
        await getCourseOrThrow(courseId);
        const current = await style(courseId);
        if (!current.guide) throw invalid('There’s no exam style guide to edit yet.');
        const now = iso();
        return saveStyle({ ...current, guide: { ...current.guide, ...checkGuide(guide), editedAt: now }, updatedAt: now });
      }),

    // --- Materials ---

    async listMaterials(courseId) {
      requireOpen();
      const list = await openAll<ClassMaterial>('materials', await db.getAllFromIndex('materials', 'byCourse', courseId));
      return list.sort((a, b) => a.title.localeCompare(b.title) || a.createdAt.localeCompare(b.createdAt));
    },

    addMaterial: (input) =>
      exclusive(async () => {
        requireOpen();
        await getCourseOrThrow(input?.courseId);
        const kind = checkKind(input.kind);
        if (!TYPES.includes(input.type)) throw invalid('Only PDFs and plain text files can be added for now.');
        if (!(input.data instanceof Uint8Array) || input.data.length === 0) throw invalid('That file is empty.');
        let pageTexts: string[];
        if (input.type === 'application/pdf') {
          if (input.data.length > MAX_MATERIAL_PDF_BYTES) throw invalid('That PDF is over 100 MB.');
          if (!isPdf(input.data)) throw invalid('That file isn’t a PDF.');
          if (!Array.isArray(input.pageTexts) || input.pageTexts.length === 0) throw invalid('That PDF has no pages.');
          if (input.pageTexts.length > MAX_MATERIAL_PAGES) throw invalid(`PDFs can have at most ${MAX_MATERIAL_PAGES} pages.`);
          if (!input.pageTexts.every((t) => typeof t === 'string')) throw invalid('Bad page text.');
          pageTexts = input.pageTexts;
        } else {
          if (input.data.length > MAX_MATERIAL_TEXT_BYTES) throw invalid('That text file is over 5 MB.');
          // The text is the file's own: worked out here, never taken from the caller
          pageTexts = [decodeText(input.data)];
        }
        const fileName = String(input.fileName ?? '').slice(0, 255);
        const title = text(input.title?.trim() || fileName.replace(/\.[^.]{1,8}$/, ''), MATERIAL_TITLE_MAX, 'A document title');
        const now = iso();
        const material: ClassMaterial = {
          id: ctx.newId(),
          courseId: input.courseId,
          title,
          fileName,
          kind,
          type: input.type,
          pageCount: pageTexts.length,
          byteSize: input.data.length,
          createdAt: now,
          updatedAt: now,
        };
        const file: MaterialFile = { id: material.id, data: input.data };
        const pages: MaterialPages = { id: material.id, pages: pageTexts };
        const [row, fileRow, pagesRow, log] = await Promise.all([
          seal('materials', { ...material }),
          seal('materialFiles', { ...file }),
          seal('materialPages', { ...pages }),
          change('material', 'put', material.id, material),
        ]);
        await writeRows(
          db,
          [
            { store: 'materials', row },
            { store: 'materialFiles', row: fileRow },
            { store: 'materialPages', row: pagesRow },
          ],
          [],
          [log],
        );
        return material;
      }),

    updateMaterial: (id, edit) =>
      exclusive(async () => {
        requireOpen();
        const current = await getMaterialOrThrow(id);
        const next: ClassMaterial = {
          ...current,
          title: text(edit?.title, MATERIAL_TITLE_MAX, 'A document title'),
          kind: checkKind(edit?.kind),
          updatedAt: iso(),
        };
        const [row, log] = await Promise.all([seal('materials', { ...next }), change('material', 'put', id, next)]);
        await writeRows(db, [{ store: 'materials', row }], [], [log]);
        return next;
      }),

    deleteMaterial: (id) =>
      exclusive(async () => {
        requireOpen();
        await getMaterialOrThrow(id);
        await writeRows(
          db,
          [],
          [
            { store: 'materials', id },
            { store: 'materialFiles', id },
            { store: 'materialPages', id },
          ],
          [await change('material', 'delete', id, null)],
        );
      }),

    async getMaterialFile(id) {
      requireOpen();
      const row = await db.get('materialFiles', id);
      if (!row) {
        const got = await fromElsewhere<MaterialFile>(id, 'pdf');
        if (got) return got.data;
        throw await missingFile(id);
      }
      return (await open<MaterialFile>('materialFiles', row)).data;
    },

    async getMaterialText(id) {
      requireOpen();
      const row = await db.get('materialPages', id);
      if (!row) {
        const got = await fromElsewhere<MaterialPages>(id, 'pages');
        if (got) return got.pages;
        throw await missingFile(id);
      }
      return (await open<MaterialPages>('materialPages', row)).pages;
    },
  };
}
