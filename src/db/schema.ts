// The on-device database: IndexedDB, the browser's built-in database (works in every engine,
// including real Safari and Playwright's WebKit; OPFS + SQLite didn't, see docs/PROGRESS.md).
//
// Migrations are numbered: DB_VERSION goes up by one for each change, and upgrade() runs every step
// between the user's old version and the new one, in order. Never edit a step that has shipped:
// users' devices already ran it. Add a new one.
//
// Records are stored in one of two forms (docs/SECURITY.md):
// - Plain (a Course, SlideDeck, Lecture ... as in src/types/lecture.ts): before the user sets up
//   encryption, and for data that setUp hasn't encrypted yet.
// - Sealed (the Sealed* types below): only the fields the indexes need stay readable; everything
//   else is in `enc`, AES-GCM encrypted with the data key. A record is sealed exactly when it has
//   an `enc` field.
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { Annotation } from '../types/annotation';
import type { EncryptedRecord } from '../types/crypto';
import type { Course, Exam, Lecture, Section, SlideDeck } from '../types/lecture';
import type { StudySession, StudySettings } from '../types/plan';
import type { Question, QuizAttempt } from '../types/quiz';
import type { ClassMaterial, ExamStyle } from '../types/style';

export const DB_NAME = 'honed';
export const DB_VERSION = 9;

/**
 * One row of the change log: every write, in order, with the device that made it. v2's sync ships
 * these between devices (encrypted). `data` is the whole record after a put, null after a delete.
 */
export interface ChangeRecord {
  seq?: number; // local order, given by IndexedDB
  id: string;
  deviceId: string;
  at: string;
  entity:
    | 'course'
    | 'exam'
    | 'slideDeck'
    | 'lecture'
    | 'section'
    | 'question'
    | 'quizAttempt'
    | 'studySession'
    | 'settings'
    | 'annotation'
    | 'material'
    | 'examStyle';
  entityId: string;
  op: 'put' | 'delete';
  data:
    | Course
    | Exam
    | SlideDeck
    | Lecture
    | Section
    | Question
    | QuizAttempt
    | StudySession
    | (StudySettings & { id: string })
    | Annotation
    | ClassMaterial
    | StoredExamStyle
    | null; // never file bytes
}

export interface SealedChange {
  seq?: number;
  id: string;
  at: string;
  entity: ChangeRecord['entity'];
  entityId: string;
  op: ChangeRecord['op'];
  enc: EncryptedRecord;
}

// --- Milestone 4 (#24): lectures. Readable fields as in docs/SECURITY.md ---

export interface SealedCourse {
  id: string;
  enc: EncryptedRecord;
}
export interface SealedExam {
  id: string;
  courseId: string;
  date: string;
  enc: EncryptedRecord;
}
export interface SealedSlideDeck {
  id: string;
  courseId: string;
  enc: EncryptedRecord;
}
/** A deck's PDF. Plain before setup; sealed with encryptBytes (raw bytes, not JSON). */
export interface DeckFile {
  id: string; // the deck's id
  data: Uint8Array;
}
export interface SealedDeckFile {
  id: string;
  enc: EncryptedRecord;
}
/** A deck's page text, in page order. */
export interface DeckPages {
  id: string; // the deck's id
  pages: string[];
}
export interface SealedDeckPages {
  id: string;
  enc: EncryptedRecord;
}
export interface SealedLecture {
  id: string;
  courseId: string;
  date: string;
  enc: EncryptedRecord;
}
export interface SealedSection {
  id: string;
  courseId: string;
  lectureId: string;
  deckId: string;
  nextDue: string | null; // a copy of schedule.nextDue, readable for the planner
  enc: EncryptedRecord;
}

// --- Quizzes (#40). Readable fields as in docs/SECURITY.md ---

export interface SealedQuestion {
  id: string;
  courseId: string;
  sectionId: string;
  enc: EncryptedRecord;
}
export interface SealedQuizAttempt {
  id: string;
  courseId: string;
  sectionId: string;
  enc: EncryptedRecord;
}

// --- Planning (#47) ---

export interface SealedStudySession {
  id: string;
  courseId: string;
  sectionId: string;
  enc: EncryptedRecord;
}
/** Settings records by name: "study" holds StudySettings. */
export interface SealedSettings {
  id: string;
  enc: EncryptedRecord;
}

// --- Annotations (#56) ---

export interface SealedAnnotation {
  id: string;
  courseId: string;
  deckId: string;
  enc: EncryptedRecord; // the page is inside
}

// --- Exam style (#120): class materials and each class's exam style. Readable fields as in docs/SECURITY.md ---

export interface SealedMaterial {
  id: string;
  courseId: string;
  enc: EncryptedRecord;
}
/** A material's file. Plain before setup; sealed with encryptBytes (raw bytes), like a deck's PDF. */
export interface MaterialFile {
  id: string; // the material's id
  data: Uint8Array;
}
/** A material's text, per page (a text file: one page). */
export interface MaterialPages {
  id: string; // the material's id
  pages: string[];
}
/** A class's exam style as stored, under examStyleId(its class): one per class, the same id on every device. */
export type StoredExamStyle = ExamStyle & { id: string };
/**
 * The id a class's exam style is stored under. Not the class's own id: sync finds a record's latest change by its
 * id alone, so sharing the class's id made the class's changes and its style's overrule each other.
 */
export const examStyleId = (courseId: string) => `style-${courseId}`;
export interface SealedExamStyle {
  id: string;
  enc: EncryptedRecord;
}

export interface HonedSchema extends DBSchema {
  // deviceId (string), keyring (Keyring), keycheck (EncryptedRecord), migration ('running'),
  // remembered (RememberedKey, #99), sync (SyncState, #105)
  meta: { key: string; value: { key: string; value: unknown } };
  changes: { key: number; value: ChangeRecord | SealedChange; indexes: { byId: string; byEntity: string } };
  courses: { key: string; value: Course | SealedCourse };
  exams: { key: string; value: Exam | SealedExam; indexes: { byCourse: string } };
  slideDecks: { key: string; value: SlideDeck | SealedSlideDeck; indexes: { byCourse: string } };
  deckFiles: { key: string; value: DeckFile | SealedDeckFile };
  deckPages: { key: string; value: DeckPages | SealedDeckPages };
  lectures: { key: string; value: Lecture | SealedLecture; indexes: { byCourse: string } };
  sections: {
    key: string;
    value: Section | SealedSection;
    indexes: { byCourse: string; byLecture: string; byDeck: string };
  };
  questions: { key: string; value: Question | SealedQuestion; indexes: { byCourse: string; bySection: string } };
  quizAttempts: { key: string; value: QuizAttempt | SealedQuizAttempt; indexes: { byCourse: string; bySection: string } };
  studySessions: { key: string; value: StudySession | SealedStudySession; indexes: { byCourse: string; bySection: string } };
  settings: { key: string; value: (StudySettings & { id: string }) | SealedSettings };
  annotations: { key: string; value: Annotation | SealedAnnotation; indexes: { byCourse: string; byDeck: string } };
  materials: { key: string; value: ClassMaterial | SealedMaterial; indexes: { byCourse: string } };
  materialFiles: { key: string; value: MaterialFile | SealedDeckFile };
  materialPages: { key: string; value: MaterialPages | SealedDeckPages };
  examStyles: { key: string; value: StoredExamStyle | SealedExamStyle };
}

export type HonedDb = IDBPDatabase<HonedSchema>;
export type RecordStore =
  | 'changes'
  | 'courses'
  | 'exams'
  | 'slideDecks'
  | 'deckFiles'
  | 'deckPages'
  | 'lectures'
  | 'sections'
  | 'questions'
  | 'quizAttempts'
  | 'studySessions'
  | 'settings'
  | 'annotations'
  | 'materials'
  | 'materialFiles'
  | 'materialPages'
  | 'examStyles';
/** Every store of records (everything but meta): what setUp seals and backups (#18) copy. */
export const RECORD_STORES: RecordStore[] = [
  'changes',
  'courses',
  'exams',
  'slideDecks',
  'deckFiles',
  'deckPages',
  'lectures',
  'sections',
  'questions',
  'quizAttempts',
  'studySessions',
  'settings',
  'annotations',
  'materials',
  'materialFiles',
  'materialPages',
  'examStyles',
];

/** Milestone 2's flashcard stores and change-log entities, dropped by step 4. */
const FLASHCARD_STORES = ['decks', 'notes', 'cards', 'reviews'];
const FLASHCARD_ENTITIES = new Set(['deck', 'note', 'card', 'review']);

/** Deletes the change-log rows of these entities (their `entity` is readable even when sealed). */
async function dropChanges(tx: IDBPTransaction<unknown, string[], 'versionchange'>, entities: Set<string>) {
  let cursor = await tx.objectStore('changes').openCursor();
  while (cursor) {
    if (entities.has((cursor.value as { entity: string }).entity)) await cursor.delete();
    cursor = await cursor.continue();
  }
}

export async function openHonedDb(name: string = DB_NAME): Promise<HonedDb> {
  const db = await openDB<HonedSchema>(name, DB_VERSION, {
    upgrade(typed, oldVersion, _newVersion, tx) {
      // Steps 1-3 made stores that are gone now (step 4), so they talk to the database untyped
      const db = typed as unknown as IDBPDatabase;
      // Step 1 (Nov 18, 2026): the first schema
      if (oldVersion < 1) {
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('decks', { keyPath: 'id' });
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex('byDeck', 'deckId');
        const cards = db.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('byDeck', 'deckId');
        cards.createIndex('byNote', 'noteId');
        const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('byCard', 'cardId');
        reviews.createIndex('byTime', 'reviewedAt');
        db.createObjectStore('changes', { keyPath: 'seq', autoIncrement: true });
      }
      // Step 2 (Nov 18, 2026, #16): records may now be sealed (encrypted, with an `enc` field). No
      // stores change; the version goes up so that an old milestone 2 tab, which would read sealed
      // records as plain ones and write plain ones among them, can no longer open the database.
      // Step 3 (Nov 18, 2026, #24): the lecture stores.
      if (oldVersion < 3) {
        db.createObjectStore('courses', { keyPath: 'id' });
        db.createObjectStore('exams', { keyPath: 'id' }).createIndex('byCourse', 'courseId');
        db.createObjectStore('slideDecks', { keyPath: 'id' }).createIndex('byCourse', 'courseId');
        db.createObjectStore('deckFiles', { keyPath: 'id' });
        db.createObjectStore('deckPages', { keyPath: 'id' });
        db.createObjectStore('lectures', { keyPath: 'id' }).createIndex('byCourse', 'courseId');
        const sections = db.createObjectStore('sections', { keyPath: 'id' });
        sections.createIndex('byCourse', 'courseId');
        sections.createIndex('byLecture', 'lectureId');
        sections.createIndex('byDeck', 'deckId');
      }
      // Step 4 (Nov 18, 2026, #26): flashcards are out (docs/DESIGN.md). Their stores go, and so do
      // their rows in the change log: milestone 2's data was only ever test cards.
      if (oldVersion < 4) {
        for (const name of FLASHCARD_STORES) db.deleteObjectStore(name);
        void dropChanges(tx as unknown as IDBPTransaction<unknown, string[], 'versionchange'>, FLASHCARD_ENTITIES);
      }
      // Step 5 (Nov 18, 2026, #40): each section's question bank, and the quizzes taken on it
      if (oldVersion < 5) {
        for (const name of ['questions', 'quizAttempts']) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('byCourse', 'courseId');
          store.createIndex('bySection', 'sectionId');
        }
      }
      // Step 6 (Nov 18, 2026, #47): study sessions done (the planner's history), and settings
      if (oldVersion < 6) {
        const sessions = db.createObjectStore('studySessions', { keyPath: 'id' });
        sessions.createIndex('byCourse', 'courseId');
        sessions.createIndex('bySection', 'sectionId');
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      // Step 7 (Nov 18, 2026, #56): notes and highlights on a deck's slides
      if (oldVersion < 7) {
        const annotations = db.createObjectStore('annotations', { keyPath: 'id' });
        annotations.createIndex('byCourse', 'courseId');
        annotations.createIndex('byDeck', 'deckId');
      }
      // Step 8 (Nov 20, 2026, #105): sync looks change-log rows up by the change's id (have we got it?) and
      // by the record's id (which change of it is the latest?). Both fields are already readable.
      if (oldVersion < 8) {
        const changes = tx.objectStore('changes') as unknown as IDBObjectStore;
        changes.createIndex('byId', 'id');
        changes.createIndex('byEntity', 'entityId');
      }
      // Step 9 (Nov 22, 2026, #120): each class's other documents (materials: the record, its file, its text) and
      // its exam style (notes and the AI's guide; one per class, under examStyleId)
      if (oldVersion < 9) {
        db.createObjectStore('materials', { keyPath: 'id' }).createIndex('byCourse', 'courseId');
        db.createObjectStore('materialFiles', { keyPath: 'id' });
        db.createObjectStore('materialPages', { keyPath: 'id' });
        db.createObjectStore('examStyles', { keyPath: 'id' });
      }
    },
  });
  // Another tab opened a newer version of the app: close, so its upgrade isn't blocked. This tab
  // then needs a reload, which the service worker's update brings anyway.
  db.addEventListener('versionchange', () => db.close());
  return db;
}
