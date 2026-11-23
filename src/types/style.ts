// The shared contract for each class's exam style (#120, docs/DESIGN.md "Exam style and question levels"): the
// class's other documents (materials), the student's notes about the exam, and the exam style guide the AI keeps
// from them and the slides. The storage (src/db/), the helper's style job (#121) and the class page (#122) code
// against these. Change them only in their own small PR, announced in those issues.
//
// Plain JSON except a material's bytes (Uint8Array), which only addMaterial and getMaterialFile carry. Times are
// ISO 8601 strings in UTC. Ids are crypto.randomUUID() strings. "Course" is the code's word for a class.

/** What a material is, picked by the student: a past exam is the strongest signal for the guide. */
export type MaterialKind = 'outline' | 'past-exam' | 'practice' | 'other';

/**
 * The file types a material can be. Others are listed in DESIGN "File types to support" until they're worked
 * through there.
 */
export type MaterialType = 'application/pdf' | 'text/plain';

/** A document of the class's other than its slides: an outline or syllabus, a past exam, a practice set... */
export interface ClassMaterial {
  id: string;
  courseId: string;
  title: string; // 1-200 characters; starts as the file name without its extension
  fileName: string;
  kind: MaterialKind;
  type: MaterialType;
  pageCount: number; // a PDF's pages; 1 for a text file
  byteSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassMaterialInput {
  courseId: string;
  title: string;
  fileName: string;
  kind: MaterialKind;
  type: MaterialType;
  /** The file. At most 100 MB (a PDF) or 5 MB (a text file). */
  data: Uint8Array;
  /** Its text per page, read on the device (a PDF's with extractPageText; a text file's is one page). */
  pageTexts: string[];
}

/** The guide's content: what the AI writes and the student may edit. */
export interface StyleGuideContent {
  /** What the exam tests: topics that matter most, kinds of questions, formats, notation. 1-3,000 characters. */
  tests: string;
  /** What levels 1, 2 and 3 look like in this class, in that order. 1-600 characters each. */
  levels: [string, string, string];
  /** Of this class's level-3 questions, the share that should be short answers, 0 to 1 (a recall class: high). */
  shortShare: number;
}

/** What a guide was made from, to know when it's out of date. */
export interface StyleGuideSource {
  lectureIds: string[]; // the lectures whose slides it saw
  materialIds: string[]; // the materials it saw
  notesAt: string | null; // the notes' updatedAt it saw (null: no notes then)
}

export interface StyleGuide extends StyleGuideContent {
  madeAt: string; // when the AI last made it
  from: StyleGuideSource;
  /** When the student last edited it by hand; a remake is told to keep their changes. null: never edited. */
  editedAt: string | null;
}

/** A class's exam style: one per class, made empty when first asked for. */
export interface ExamStyle {
  courseId: string;
  /** The student's notes about the exam ("no proofs, formula sheet given"). 0-4,000 characters. */
  notes: string;
  notesAt: string | null; // when the notes last changed; null: never written
  guide: StyleGuide | null; // null until the AI first makes one
  updatedAt: string | null; // null: nothing saved yet
}

/**
 * The store methods for exam styles. Part of StudyStore (src/db/store.ts), with its rules: 'locked' while locked,
 * 'invalid' (with a user-ready message) or 'not-found' as appropriate. Deleting a class deletes its exam style and
 * materials (with their files) too.
 */
export interface ExamStyleStore {
  /** The class's exam style; an empty one (no notes, no guide) if nothing was saved. 'not-found' for no such class. */
  getExamStyle(courseId: string): Promise<ExamStyle>;
  /** Replaces the notes (trimmed; empty is allowed). Sets notesAt. */
  setStyleNotes(courseId: string, notes: string): Promise<ExamStyle>;
  /** Saves a guide the AI made, with what it was made from. Keeps editedAt, so later remakes still keep edits. */
  saveMadeGuide(courseId: string, guide: StyleGuideContent, from: StyleGuideSource): Promise<ExamStyle>;
  /** The student's edit of the guide. Sets editedAt. 'invalid' if there's no guide yet. */
  editStyleGuide(courseId: string, guide: StyleGuideContent): Promise<ExamStyle>;

  /** The class's materials, by title. */
  listMaterials(courseId: string): Promise<ClassMaterial[]>;
  /** Stores the file and its text. 'invalid' for another type, a PDF that isn't one, an empty file, or too big. */
  addMaterial(input: ClassMaterialInput): Promise<ClassMaterial>;
  updateMaterial(id: string, edit: { title: string; kind: MaterialKind }): Promise<ClassMaterial>;
  deleteMaterial(id: string): Promise<void>;
  getMaterialFile(id: string): Promise<Uint8Array>;
  getMaterialText(id: string): Promise<string[]>;
}
