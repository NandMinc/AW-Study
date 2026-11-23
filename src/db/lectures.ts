// The lecture side of StudyStore (#24, milestone 4): classes ("courses"), exams, slide decks (the
// PDF and its page text), lectures and sections. Built on the store's own helpers (src/db/store.ts),
// so the same rules hold: records sealed per docs/SECURITY.md once set up, every method refused
// while locked, writes read-compute-encrypt-write inside `exclusive()`, every write in the change
// log (never the PDF bytes).
import type {
  Course,
  CourseInput,
  CourseSummary,
  Exam,
  ExamInput,
  Lecture,
  LectureStore,
  LectureWithSections,
  Section,
  SlideDeck,
} from '../types/lecture';
import { examStyleId, type ChangeRecord, type DeckFile, type DeckPages, type HonedDb, type RecordStore } from './schema';
import { StoreError } from './store';
import type { EncryptedRecord } from '../types/crypto';

export const COURSE_NAME_MAX = 100;
export const EXAM_TITLE_MAX = 100;
export const DECK_TITLE_MAX = 200;
export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 2000;
export const MAX_SECTIONS_PER_LECTURE = 20;
export const MAX_MEETINGS = 21;
const EXAM_KINDS = ['midterm', 'final', 'test'] as const;

type Row = Record<string, unknown>;

/** What lectures.ts needs from the store (all defined in makeStore). */
export interface StoreContext {
  db: HonedDb;
  clock: () => Date;
  newId: () => string;
  seal(name: RecordStore, plain: Row): Promise<Row>;
  open<T>(name: RecordStore, stored: unknown): Promise<T>;
  openAll<T>(name: RecordStore, rows: unknown[]): Promise<T[]>;
  change(entity: ChangeRecord['entity'], op: ChangeRecord['op'], entityId: string, data: ChangeRecord['data']): Promise<Row>;
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  requireOpen(): void;
  /** Where a deck's sealed file comes from when it isn't on this device (#108: the sync server), or null. */
  fileSource?: () => FileSource | null;
  /** Called when a deck's files came from elsewhere, so they're never sent back up (#108). */
  filesHere?: (deckId: string) => Promise<void>;
}

/** Gives a deck's file sealed exactly as another device stores it, or null if there's none (#108). */
export type FileSource = (deckId: string, kind: 'pdf' | 'pages') => Promise<EncryptedRecord | null>;

// --- Validation (messages are shown to the user as they are) ---

const invalid = (message: string) => new StoreError('invalid', message);

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

const isMinutes = (value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 600;

function cleanText(value: unknown, max: number, what: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw invalid(`${what} can’t be empty.`);
  if (text.length > max) throw invalid(`${what} can be at most ${max} characters.`);
  return text;
}

function checkCourse(input: CourseInput): CourseInput {
  const name = cleanText(input.name, COURSE_NAME_MAX, 'A class name');
  if (!Array.isArray(input.meetings) || input.meetings.length > MAX_MEETINGS) throw invalid('Too many lecture times.');
  const meetings = input.meetings.map((m) => {
    if (!Number.isInteger(m.day) || m.day < 0 || m.day > 6) throw invalid('A lecture time needs a day of the week.');
    if (typeof m.start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.start)) {
      throw invalid('Lecture start times look like 10:30.');
    }
    if (!isMinutes(m.minutes)) throw invalid('A lecture lasts between 1 and 600 minutes.');
    return { day: m.day, start: m.start, minutes: m.minutes };
  });
  const termStart = input.termStart ?? null;
  const termEnd = input.termEnd ?? null;
  if (termStart !== null && !isDate(termStart)) throw invalid('The term start isn’t a valid date.');
  if (termEnd !== null && !isDate(termEnd)) throw invalid('The term end isn’t a valid date.');
  if (termStart && termEnd && termEnd < termStart) throw invalid('The term ends before it starts.');
  return { name, meetings, termStart, termEnd };
}

export function isPdf(data: Uint8Array): boolean {
  // Every PDF starts with "%PDF-"
  return data.length >= 5 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46 && data[4] === 0x2d;
}

/** Shares `minutes` between sections by page count, in whole minutes that add up exactly. */
export function shareBudget(minutes: number, pages: number[]): number[] {
  const total = pages.reduce((a, b) => a + b, 0);
  const exact = pages.map((p) => (minutes * p) / total);
  const shares = exact.map(Math.floor);
  let left = minutes - shares.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) {
    if (left-- <= 0) break;
    shares[i]! += 1;
  }
  return shares;
}

const pagesOf = (s: Pick<Section, 'firstPage' | 'lastPage'>) => s.lastPage - s.firstPage + 1;
const bySectionOrder = (a: Section, b: Section) => a.deckId.localeCompare(b.deckId) || a.firstPage - b.firstPage;

/** Writes the given puts/deletes and their change rows in one transaction (also used by quiz.ts). */
export async function writeRows(
  db: HonedDb,
  puts: { store: RecordStore; row: Row }[],
  deletes: { store: RecordStore; id: string }[],
  logs: Row[],
) {
  const stores = [...new Set([...puts.map((p) => p.store), ...deletes.map((d) => d.store), 'changes' as const])];
  const tx = db.transaction(stores, 'readwrite');
  for (const { store, id } of deletes) await tx.objectStore(store).delete(id);
  for (const { store, row } of puts) await tx.objectStore(store).put(row as never);
  for (const log of logs) await tx.objectStore('changes').add(log as never);
  await tx.done;
}

export function lectureMethods(ctx: StoreContext): LectureStore {
  const { db, seal, open, openAll, change, exclusive, requireOpen } = ctx;
  const iso = () => ctx.clock().toISOString();

  const write = (puts: { store: RecordStore; row: Row }[], deletes: { store: RecordStore; id: string }[], logs: Row[]) =>
    writeRows(db, puts, deletes, logs);

  /** A deck's PDF or page text isn't here: gone, or the deck came from another device (#105) and its file hasn't. */
  const missingFile = async (id: string) =>
    (await db.get('slideDecks', id)) === undefined
      ? new StoreError('not-found', 'That slide deck no longer exists.')
      : ctx.fileSource?.()
        ? new StoreError('not-found', 'These slides were added on another device and haven’t reached the server yet. Open Honed on that device (with sync on), then try again.')
        : new StoreError('not-found', 'These slides were added on another device. Turn on sync (Settings) to bring them here.');

  /**
   * A deck's file from elsewhere (#108): fetched sealed, opened here (so a file sealed with another key, or
   * changed, is refused: its additional data names the store and the deck), then kept as it came.
   */
  const fromElsewhere = async <T>(id: string, kind: 'pdf' | 'pages'): Promise<T | null> => {
    const source = ctx.fileSource?.();
    if (!source || (await db.get('slideDecks', id)) === undefined) return null;
    const enc = await source(id, kind);
    if (!enc) return null;
    const store = kind === 'pdf' ? 'deckFiles' : 'deckPages';
    const row = { id, enc };
    let opened: T;
    try {
      opened = await open<T>(store, row);
    } catch {
      throw new StoreError('invalid', 'The slides from the server can’t be opened with this device’s key.');
    }
    await db.put(store, row as never);
    if (kind === 'pdf') await ctx.filesHere?.(id);
    return opened;
  };

  const getCourseOrThrow = async (id: string): Promise<Course> => {
    const row = await db.get('courses', id);
    if (!row) throw new StoreError('not-found', 'That class no longer exists.');
    return open<Course>('courses', row);
  };

  const getDeckOrThrow = async (id: string): Promise<SlideDeck> => {
    const row = await db.get('slideDecks', id);
    if (!row) throw new StoreError('not-found', 'That slide deck no longer exists.');
    return open<SlideDeck>('slideDecks', row);
  };

  const checkExam = async (input: ExamInput): Promise<ExamInput> => {
    const title = cleanText(input.title, EXAM_TITLE_MAX, 'An exam title');
    if (!EXAM_KINDS.includes(input.kind)) throw invalid('An exam is a midterm, a final or a test.');
    if (!isDate(input.date)) throw invalid('The exam date isn’t a valid date.');
    await getCourseOrThrow(input.courseId);
    let lectureIds: string[] | null = null;
    if (input.lectureIds !== null) {
      if (!Array.isArray(input.lectureIds)) throw invalid('Bad list of lectures.');
      const own = new Set(await db.getAllKeysFromIndex('lectures', 'byCourse', input.courseId));
      if (!input.lectureIds.every((id) => own.has(id))) throw invalid('An exam can only cover lectures of its own class.');
      lectureIds = [...new Set(input.lectureIds)];
    }
    return { courseId: input.courseId, title, kind: input.kind, date: input.date, lectureIds };
  };

  /** Puts for a lecture's sections with budgets re-shared from `minutes`. */
  const reshare = (sections: Section[], minutes: number, stamp: string): Section[] => {
    const budgets = shareBudget(minutes, sections.map(pagesOf));
    return sections.map((s, i) => ({ ...s, schedule: { ...s.schedule, budgetMinutes: budgets[i]! }, updatedAt: stamp }));
  };

  const lectureWithSections = async (lectureRow: unknown): Promise<LectureWithSections> => {
    const lecture = await open<Lecture>('lectures', lectureRow);
    const rows = await db.getAllFromIndex('sections', 'byLecture', lecture.id);
    return { lecture, sections: (await openAll<Section>('sections', rows)).sort(bySectionOrder) };
  };

  return {
    // --- Classes ---

    async listCourses(today) {
      requireOpen();
      const courses = await openAll<Course>('courses', await db.getAll('courses'));
      const summaries: CourseSummary[] = [];
      for (const course of courses) {
        const [lectureCount, deckCount, examRows] = await Promise.all([
          db.countFromIndex('lectures', 'byCourse', course.id),
          db.countFromIndex('slideDecks', 'byCourse', course.id),
          db.getAllFromIndex('exams', 'byCourse', course.id),
        ]);
        // The exam dates are readable, so only the soonest upcoming exam is decrypted
        const upcoming = examRows
          .filter((e) => (e as { date: string }).date >= today)
          .sort((a, b) => (a as { date: string }).date.localeCompare((b as { date: string }).date))[0];
        summaries.push({ ...course, lectureCount, deckCount, nextExam: upcoming ? await open<Exam>('exams', upcoming) : null });
      }
      return summaries.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getCourse(id) {
      requireOpen();
      const row = await db.get('courses', id);
      return row ? open<Course>('courses', row) : null;
    },

    createCourse: (input) =>
      exclusive(async () => {
        requireOpen();
        const now = iso();
        const course: Course = { id: ctx.newId(), ...checkCourse(input), createdAt: now, updatedAt: now };
        const [row, log] = await Promise.all([seal('courses', { ...course }), change('course', 'put', course.id, course)]);
        await write([{ store: 'courses', row }], [], [log]);
        return course;
      }),

    updateCourse: (id, input) =>
      exclusive(async () => {
        requireOpen();
        const clean = checkCourse(input);
        const next: Course = { ...(await getCourseOrThrow(id)), ...clean, updatedAt: iso() };
        const [row, log] = await Promise.all([seal('courses', { ...next }), change('course', 'put', id, next)]);
        await write([{ store: 'courses', row }], [], [log]);
        return next;
      }),

    deleteCourse: (id) =>
      exclusive(async () => {
        requireOpen();
        await getCourseOrThrow(id);
        const [examIds, deckIds, lectureIds, sectionIds, questionIds, attemptIds, sessionIds, annotationIds, materialIds, style] = await Promise.all([
          db.getAllKeysFromIndex('exams', 'byCourse', id),
          db.getAllKeysFromIndex('slideDecks', 'byCourse', id),
          db.getAllKeysFromIndex('lectures', 'byCourse', id),
          db.getAllKeysFromIndex('sections', 'byCourse', id),
          db.getAllKeysFromIndex('questions', 'byCourse', id),
          db.getAllKeysFromIndex('quizAttempts', 'byCourse', id),
          db.getAllKeysFromIndex('studySessions', 'byCourse', id),
          db.getAllKeysFromIndex('annotations', 'byCourse', id),
          db.getAllKeysFromIndex('materials', 'byCourse', id),
          db.get('examStyles', examStyleId(id)),
        ]);
        const deletes = [
          ...questionIds.map((i) => ({ store: 'questions' as const, id: i })),
          ...attemptIds.map((i) => ({ store: 'quizAttempts' as const, id: i })),
          ...sessionIds.map((i) => ({ store: 'studySessions' as const, id: i })),
          ...annotationIds.map((i) => ({ store: 'annotations' as const, id: i })),
          ...sectionIds.map((i) => ({ store: 'sections' as const, id: i })),
          ...lectureIds.map((i) => ({ store: 'lectures' as const, id: i })),
          ...examIds.map((i) => ({ store: 'exams' as const, id: i })),
          ...deckIds.flatMap((i) => [
            { store: 'slideDecks' as const, id: i },
            { store: 'deckFiles' as const, id: i },
            { store: 'deckPages' as const, id: i },
          ]),
          // Its other documents and exam style (#120)
          ...materialIds.flatMap((i) => [
            { store: 'materials' as const, id: i },
            { store: 'materialFiles' as const, id: i },
            { store: 'materialPages' as const, id: i },
          ]),
          ...(style ? [{ store: 'examStyles' as const, id: examStyleId(id) }] : []),
          { store: 'courses' as const, id },
        ];
        const logs = await Promise.all([
          ...questionIds.map((i) => change('question', 'delete', i, null)),
          ...attemptIds.map((i) => change('quizAttempt', 'delete', i, null)),
          ...sessionIds.map((i) => change('studySession', 'delete', i, null)),
          ...annotationIds.map((i) => change('annotation', 'delete', i, null)),
          ...sectionIds.map((i) => change('section', 'delete', i, null)),
          ...lectureIds.map((i) => change('lecture', 'delete', i, null)),
          ...examIds.map((i) => change('exam', 'delete', i, null)),
          ...deckIds.map((i) => change('slideDeck', 'delete', i, null)),
          ...materialIds.map((i) => change('material', 'delete', i, null)),
          ...(style ? [change('examStyle', 'delete', examStyleId(id), null)] : []),
          change('course', 'delete', id, null),
        ]);
        await write([], deletes, logs);
      }),

    // --- Exams ---

    async listExams(courseId) {
      requireOpen();
      const exams = await openAll<Exam>('exams', await db.getAllFromIndex('exams', 'byCourse', courseId));
      return exams.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    },

    addExam: (input) =>
      exclusive(async () => {
        requireOpen();
        const now = iso();
        const exam: Exam = { id: ctx.newId(), ...(await checkExam(input)), createdAt: now, updatedAt: now };
        const [row, log] = await Promise.all([seal('exams', { ...exam }), change('exam', 'put', exam.id, exam)]);
        await write([{ store: 'exams', row }], [], [log]);
        return exam;
      }),

    updateExam: (id, input) =>
      exclusive(async () => {
        requireOpen();
        const old = await db.get('exams', id);
        if (!old) throw new StoreError('not-found', 'That exam no longer exists.');
        const next: Exam = { ...(await open<Exam>('exams', old)), ...(await checkExam(input)), updatedAt: iso() };
        const [row, log] = await Promise.all([seal('exams', { ...next }), change('exam', 'put', id, next)]);
        await write([{ store: 'exams', row }], [], [log]);
        return next;
      }),

    deleteExam: (id) =>
      exclusive(async () => {
        requireOpen();
        if (!(await db.get('exams', id))) throw new StoreError('not-found', 'That exam no longer exists.');
        await write([], [{ store: 'exams', id }], [await change('exam', 'delete', id, null)]);
      }),

    // --- Slide decks ---

    async listSlideDecks(courseId) {
      requireOpen();
      const decks = await openAll<SlideDeck>('slideDecks', await db.getAllFromIndex('slideDecks', 'byCourse', courseId));
      return decks.sort((a, b) => a.title.localeCompare(b.title));
    },

    addSlideDeck: (input) =>
      exclusive(async () => {
        requireOpen();
        await getCourseOrThrow(input.courseId);
        if (!(input.data instanceof Uint8Array) || input.data.length === 0) throw invalid('That file is empty.');
        if (input.data.length > MAX_PDF_BYTES) throw invalid('That PDF is over 100 MB.');
        if (!isPdf(input.data)) throw invalid('That file isn’t a PDF.');
        if (!Array.isArray(input.pageTexts) || input.pageTexts.length === 0) throw invalid('That PDF has no pages.');
        if (input.pageTexts.length > MAX_PDF_PAGES) throw invalid(`PDFs can have at most ${MAX_PDF_PAGES} pages.`);
        if (!input.pageTexts.every((t) => typeof t === 'string')) throw invalid('Bad page text.');
        const fileName = String(input.fileName ?? '').slice(0, 255);
        const title = cleanText(input.title?.trim() || fileName.replace(/\.pdf$/i, ''), DECK_TITLE_MAX, 'A deck title');
        const now = iso();
        const deck: SlideDeck = {
          id: ctx.newId(),
          courseId: input.courseId,
          title,
          fileName,
          pageCount: input.pageTexts.length,
          byteSize: input.data.length,
          createdAt: now,
          updatedAt: now,
        };
        const file: DeckFile = { id: deck.id, data: input.data };
        const pages: DeckPages = { id: deck.id, pages: input.pageTexts };
        const [deckRow, fileRow, pagesRow, log] = await Promise.all([
          seal('slideDecks', { ...deck }),
          seal('deckFiles', { ...file }),
          seal('deckPages', { ...pages }),
          change('slideDeck', 'put', deck.id, deck),
        ]);
        await write(
          [
            { store: 'slideDecks', row: deckRow },
            { store: 'deckFiles', row: fileRow },
            { store: 'deckPages', row: pagesRow },
          ],
          [],
          [log],
        );
        return deck;
      }),

    renameSlideDeck: (id, title) =>
      exclusive(async () => {
        requireOpen();
        const clean = cleanText(title, DECK_TITLE_MAX, 'A deck title');
        const next: SlideDeck = { ...(await getDeckOrThrow(id)), title: clean, updatedAt: iso() };
        const [row, log] = await Promise.all([seal('slideDecks', { ...next }), change('slideDeck', 'put', id, next)]);
        await write([{ store: 'slideDecks', row }], [], [log]);
        return next;
      }),

    deleteSlideDeck: (id) =>
      exclusive(async () => {
        requireOpen();
        await getDeckOrThrow(id);
        const used = await db.countFromIndex('sections', 'byDeck', id);
        if (used > 0) {
          throw invalid(`This deck is used by ${used} lecture section${used === 1 ? '' : 's'}: delete those lectures first.`);
        }
        const annotationIds = await db.getAllKeysFromIndex('annotations', 'byDeck', id);
        await write(
          [],
          [
            { store: 'slideDecks', id },
            { store: 'deckFiles', id },
            { store: 'deckPages', id },
            ...annotationIds.map((a) => ({ store: 'annotations' as const, id: a })),
          ],
          await Promise.all([
            ...annotationIds.map((a) => change('annotation', 'delete', a, null)),
            change('slideDeck', 'delete', id, null),
          ]),
        );
      }),

    async getSlideDeckFile(id) {
      requireOpen();
      const row = await db.get('deckFiles', id);
      if (!row) {
        const got = await fromElsewhere<DeckFile>(id, 'pdf');
        if (got) return got.data;
        throw await missingFile(id);
      }
      return (await open<DeckFile>('deckFiles', row)).data;
    },

    async getSlideDeckPages(id) {
      requireOpen();
      const row = await db.get('deckPages', id);
      if (!row) {
        const got = await fromElsewhere<DeckPages>(id, 'pages');
        if (got) return got.pages;
        throw await missingFile(id);
      }
      return (await open<DeckPages>('deckPages', row)).pages;
    },

    // --- Lectures and sections ---

    async listLectures(courseId) {
      requireOpen();
      const rows = await db.getAllFromIndex('lectures', 'byCourse', courseId);
      const lectures = await Promise.all(rows.map(lectureWithSections));
      return lectures.sort(
        (a, b) => b.lecture.date.localeCompare(a.lecture.date) || b.lecture.createdAt.localeCompare(a.lecture.createdAt),
      );
    },

    async getLecture(id) {
      requireOpen();
      const row = await db.get('lectures', id);
      return row ? lectureWithSections(row) : null;
    },

    recordLecture: (input) =>
      exclusive(async () => {
        requireOpen();
        await getCourseOrThrow(input.courseId);
        if (!isDate(input.date)) throw invalid('The lecture date isn’t a valid date.');
        if (!isMinutes(input.minutes)) throw invalid('A lecture lasts between 1 and 600 minutes.');
        if (!Array.isArray(input.sections) || input.sections.length === 0) throw invalid('Say which slides were covered.');
        if (input.sections.length > MAX_SECTIONS_PER_LECTURE) throw invalid('Too many slide ranges for one lecture.');
        for (const s of input.sections) {
          const deck = await getDeckOrThrow(s.deckId);
          if (deck.courseId !== input.courseId) throw invalid('Those slides belong to another class.');
          if (!Number.isInteger(s.firstPage) || !Number.isInteger(s.lastPage) || s.firstPage < 1 || s.lastPage < s.firstPage) {
            throw invalid('A slide range goes from a first slide to a later (or the same) one.');
          }
          if (s.lastPage > deck.pageCount) throw invalid(`“${deck.title}” has only ${deck.pageCount} slides.`);
        }
        const now = iso();
        const lecture: Lecture = {
          id: ctx.newId(),
          courseId: input.courseId,
          date: input.date,
          minutes: input.minutes,
          createdAt: now,
          updatedAt: now,
        };
        const sections = reshare(
          input.sections.map((s) => ({
            id: ctx.newId(),
            courseId: input.courseId,
            lectureId: lecture.id,
            deckId: s.deckId,
            firstPage: s.firstPage,
            lastPage: s.lastPage,
            schedule: { budgetMinutes: 0, studiedMinutes: 0, nextDue: null, extraMinutes: 0 },
            createdAt: now,
            updatedAt: now,
          })),
          input.minutes,
          now,
        );
        const [lectureRow, lectureLog, ...rest] = await Promise.all([
          seal('lectures', { ...lecture }),
          change('lecture', 'put', lecture.id, lecture),
          ...sections.flatMap((s) => [seal('sections', { ...s }), change('section', 'put', s.id, s)]),
        ]);
        const puts: { store: RecordStore; row: Row }[] = [{ store: 'lectures', row: lectureRow }];
        const logs = [lectureLog];
        for (let i = 0; i < rest.length; i += 2) {
          puts.push({ store: 'sections', row: rest[i]! });
          logs.push(rest[i + 1]!);
        }
        await write(puts, [], logs);
        return { lecture, sections: [...sections].sort(bySectionOrder) };
      }),

    updateLecture: (id, edit) =>
      exclusive(async () => {
        requireOpen();
        const row = await db.get('lectures', id);
        if (!row) throw new StoreError('not-found', 'That lecture no longer exists.');
        if (!isDate(edit.date)) throw invalid('The lecture date isn’t a valid date.');
        if (!isMinutes(edit.minutes)) throw invalid('A lecture lasts between 1 and 600 minutes.');
        const { lecture, sections } = await lectureWithSections(row);
        const stamp = iso();
        const next: Lecture = { ...lecture, date: edit.date, minutes: edit.minutes, updatedAt: stamp };
        const nextSections = reshare(sections, edit.minutes, stamp);
        const [lectureRow, lectureLog, ...rest] = await Promise.all([
          seal('lectures', { ...next }),
          change('lecture', 'put', id, next),
          ...nextSections.flatMap((s) => [seal('sections', { ...s }), change('section', 'put', s.id, s)]),
        ]);
        const puts: { store: RecordStore; row: Row }[] = [{ store: 'lectures', row: lectureRow }];
        const logs = [lectureLog];
        for (let i = 0; i < rest.length; i += 2) {
          puts.push({ store: 'sections', row: rest[i]! });
          logs.push(rest[i + 1]!);
        }
        await write(puts, [], logs);
        return { lecture: next, sections: nextSections.sort(bySectionOrder) };
      }),

    deleteLecture: (id) =>
      exclusive(async () => {
        requireOpen();
        if (!(await db.get('lectures', id))) throw new StoreError('not-found', 'That lecture no longer exists.');
        const sectionIds = await db.getAllKeysFromIndex('sections', 'byLecture', id);
        // Its sections' question banks, quiz attempts and study sessions go with them
        const [questionIds, attemptIds, sessionIds] = await Promise.all([
          Promise.all(sectionIds.map((s) => db.getAllKeysFromIndex('questions', 'bySection', s))).then((l) => l.flat()),
          Promise.all(sectionIds.map((s) => db.getAllKeysFromIndex('quizAttempts', 'bySection', s))).then((l) => l.flat()),
          Promise.all(sectionIds.map((s) => db.getAllKeysFromIndex('studySessions', 'bySection', s))).then((l) => l.flat()),
        ]);
        const logs = await Promise.all([
          ...questionIds.map((q) => change('question', 'delete', q, null)),
          ...attemptIds.map((a) => change('quizAttempt', 'delete', a, null)),
          ...sessionIds.map((x) => change('studySession', 'delete', x, null)),
          ...sectionIds.map((s) => change('section', 'delete', s, null)),
          change('lecture', 'delete', id, null),
        ]);
        await write(
          [],
          [
            ...questionIds.map((q) => ({ store: 'questions' as const, id: q })),
            ...attemptIds.map((a) => ({ store: 'quizAttempts' as const, id: a })),
            ...sessionIds.map((x) => ({ store: 'studySessions' as const, id: x })),
            ...sectionIds.map((s) => ({ store: 'sections' as const, id: s })),
            { store: 'lectures', id },
          ],
          logs,
        );
      }),

    async listSections(courseId) {
      requireOpen();
      const rows = courseId ? await db.getAllFromIndex('sections', 'byCourse', courseId) : await db.getAll('sections');
      return (await openAll<Section>('sections', rows)).sort(
        (a, b) => a.courseId.localeCompare(b.courseId) || a.lectureId.localeCompare(b.lectureId) || bySectionOrder(a, b),
      );
    },
  };
}
