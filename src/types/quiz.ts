// The shared contract for quizzes (#40, docs/DESIGN.md "Study sessions and quizzes"): each section's
// question bank and the quiz attempts made on it. The storage (src/db/quiz.ts), the screens and the
// planner (milestone 5, which reads the attempts) code against these. Change them only in their own
// small PR, announced in the task issues.
//
// Plain JSON. Times are ISO 8601 strings in UTC. Ids are crypto.randomUUID() strings.

export type OptionIndex = 0 | 1 | 2 | 3;

/**
 * How hard a question is (#120, DESIGN "Exam style and question levels"): 1 recognise, 2 apply, 3 exam-style.
 * It's also the question's weight in the score.
 */
export type Level = 1 | 2 | 3;

/** What every question in a section's bank has. Made by AI once, kept, then quizzed many times. */
interface QuestionBase {
  id: string;
  courseId: string;
  sectionId: string;
  deckId: string;
  page: number; // the slide it comes from: within its section's range
  question: string; // 1-1,000 characters
  level: Level;
  explanation: string; // 0-2,000 characters
  createdAt: string;
}

/**
 * A multiple-choice question, marked on the device. Questions saved before #120 are these, at level 2: the store
 * reads them so, and code that meets a question without `form` treats it as one (`isChoice`).
 */
export interface ChoiceQuestion extends QuestionBase {
  form: 'choice';
  options: [string, string, string, string]; // four different, non-empty, 1-500 characters each
  answer: OptionIndex; // the right option
}

/**
 * A short-answer question (#120): always level 3, answered in at most about two sentences, marked by the AI
 * against its points at the end of a quiz (all of a quiz's short answers in one request).
 */
export interface ShortQuestion extends QuestionBase {
  form: 'short';
  level: 3;
  points: string[]; // 1-3, what a full answer says, 1-500 characters each
}

export type Question = ChoiceQuestion | ShortQuestion;

/** Whether a question is multiple choice (true for one saved before #120, which has no `form`). */
export const isChoice = (q: Question): q is ChoiceQuestion => q.form !== 'short';

/**
 * A question as the AI hands it over. Without `form` it's multiple choice; without `level` it's level 2 (what
 * the AI gave before #120). A short one must be level 3 if a level is given.
 */
export type QuestionInput =
  | (Pick<ChoiceQuestion, 'page' | 'question' | 'options' | 'answer' | 'explanation'> & { form?: 'choice'; level?: Level })
  | (Pick<ShortQuestion, 'page' | 'question' | 'points'> & { form: 'short'; level?: 3; explanation?: string });

/** One multiple-choice answer in an attempt. */
export interface QuizAnswer {
  questionId: string;
  chosen: OptionIndex; // index into the question's options as stored (screens may show them shuffled)
  right: boolean; // worked out by the store, never taken from the screen
  ms: number; // time taken to answer, 0 or more
  /** The question's level when it was asked (#120): its weight in the score. Absent on attempts saved before: level 2. */
  level?: Level;
}

/**
 * One short answer in an attempt (#120): to a banked ShortQuestion, marked by the AI's grade-many job. Like a
 * multiple-choice answer it counts as one question, worth mark / outOf, weighted by its level (3).
 */
export interface ShortAnswer {
  questionId: string;
  typed: string; // what was typed, 0-1,000 characters
  mark: number; // a whole number, 0 to outOf
  outOf: number; // the question's points when it was asked (1-3), worked out by the store
  feedback: string; // 0-400 characters
  ms: number; // time taken to answer, 0 or more
  level: 3;
}

/**
 * A short answer in exam practice (#87): the question as the AI wrote it at practice time (not banked),
 * what was typed, and the mark the AI's grade job gave it. It counts as one question worth
 * mark / points.length.
 */
export interface WrittenAnswer {
  question: string; // 1-1,000 characters
  points: string[]; // 1-6, what a full answer says, 1-500 characters each
  page: number; // the slide it's about: within the section's range
  answer: string; // what was typed, 0-4,000 characters
  mark: number; // a whole number, 0 to points.length
  feedback: string; // the grade's feedback, 0-400 characters
  ms: number; // time taken to answer, 0 or more
}

/**
 * One quiz on one section, saved when it ends. Attempts are only ever added, never changed: they are
 * the history the schedule learns from (DESIGN). The score comes from the answers alone.
 *
 * Exam practice (#87) saves one attempt per section it covered, with `examId` set; its short answers
 * are in `written`. Both are absent on ordinary quizzes and on every attempt saved before #87.
 */
export interface QuizAttempt {
  id: string;
  courseId: string;
  sectionId: string;
  startedAt: string;
  finishedAt: string;
  answers: QuizAnswer[]; // in the order asked; each question at most once
  /** Exam practice only: the exam it was practice for (of the same class). */
  examId?: string;
  /** Exam practice only: the short answers, in the order asked. */
  written?: WrittenAnswer[];
  /** Short answers to banked questions (#120), in the order asked. Absent when there were none. */
  short?: ShortAnswer[];
  /**
   * Not weighted, for "7 of 10 right": multiple-choice answers right, plus each short and written answer's
   * mark / points; rounded to 2 places.
   */
  right: number;
  asked: number; // answers.length + short.length + written.length, at least 1
  /**
   * 0 to 1, what moves the schedule. Weighted by level (#120): Σ level × how right ÷ Σ level, where how right is
   * 1 or 0 for multiple choice and mark / points for a short or written answer; exam practice's written answers
   * count as level 3. Attempts saved before #120 keep the score they were saved with (right / asked: every
   * question counted alike, as level 2).
   */
  score: number;
  createdAt: string;
}

export interface QuizAttemptInput {
  sectionId: string;
  startedAt: string;
  finishedAt: string;
  answers: { questionId: string; chosen: OptionIndex; ms: number }[];
  examId?: string;
  written?: WrittenAnswer[];
  /** Short answers to this section's banked short questions, with the AI's marks (#120). */
  short?: { questionId: string; typed: string; mark: number; feedback: string; ms: number }[];
}

/**
 * The store methods for quizzes. Part of StudyStore (src/db/store.ts), with its rules: 'locked' while
 * locked, 'invalid' (with a user-ready message) or 'not-found' as appropriate. Deleting a lecture or a
 * class deletes its sections' questions and attempts too.
 */
export interface QuizStore {
  /** A section's bank, oldest first. Every question has its `form` and `level` (older ones read as choice, level 2). */
  listQuestions(sectionId: string): Promise<Question[]>;
  /**
   * Adds questions to a section's bank, all or none. 'invalid' if any is malformed (see Question; a short
   * question at a level other than 3), names a slide outside the section, or repeats a question already in the
   * bank; at most 100 per call and 500 per section.
   */
  addQuestions(sectionId: string, questions: QuestionInput[]): Promise<Question[]>;
  /** Removes a bad question from the bank. Attempts that asked it keep their record of it. */
  deleteQuestion(id: string): Promise<void>;
  /**
   * Saves a finished quiz, marking each multiple-choice answer against the stored question and recording each
   * answer's level, then the weighted score (see QuizAttempt). 'invalid' if it has no answers of any kind, an
   * exam that isn't this class's, a written answer out of shape (see WrittenAnswer: its slide outside the
   * section, a mark that isn't a whole number in range), or a short answer to a question that isn't one of this
   * section's short questions, answered twice, or with a mark that isn't a whole number from 0 to its points.
   */
  recordQuizAttempt(input: QuizAttemptInput): Promise<QuizAttempt>;
  /** Attempts, newest first: one section's, or every section's (for the planner). */
  listQuizAttempts(sectionId?: string): Promise<QuizAttempt[]>;
}
