// The shared contract for quizzes (#40, docs/DESIGN.md "Study sessions and quizzes"): each section's
// question bank and the quiz attempts made on it. The storage (src/db/quiz.ts), the screens and the
// planner (milestone 5, which reads the attempts) code against these. Change them only in their own
// small PR, announced in the task issues.
//
// Plain JSON. Times are ISO 8601 strings in UTC. Ids are crypto.randomUUID() strings.

export type OptionIndex = 0 | 1 | 2 | 3;

/** A multiple-choice question in a section's bank. Made by AI once, kept, then quizzed many times. */
export interface Question {
  id: string;
  courseId: string;
  sectionId: string;
  deckId: string;
  page: number; // the slide it comes from: within its section's range
  question: string; // 1-1,000 characters
  options: [string, string, string, string]; // four different, non-empty, 1-500 characters each
  answer: OptionIndex; // the right option
  explanation: string; // 0-2,000 characters
  createdAt: string;
}

/** A question as the AI hands it over (src/ai/backend.ts McQuestion has this shape). */
export type QuestionInput = Pick<Question, 'page' | 'question' | 'options' | 'answer' | 'explanation'>;

/** One answer in an attempt. */
export interface QuizAnswer {
  questionId: string;
  chosen: OptionIndex; // index into the question's options as stored (screens may show them shuffled)
  right: boolean; // worked out by the store, never taken from the screen
  ms: number; // time taken to answer, 0 or more
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
  /** Multiple-choice answers right, plus each short answer's mark / points.length; rounded to 2 places. */
  right: number;
  asked: number; // answers.length + written.length, at least 1
  score: number; // right / asked, 0 to 1
  createdAt: string;
}

export interface QuizAttemptInput {
  sectionId: string;
  startedAt: string;
  finishedAt: string;
  answers: { questionId: string; chosen: OptionIndex; ms: number }[];
  examId?: string;
  written?: WrittenAnswer[];
}

/**
 * The store methods for quizzes. Part of StudyStore (src/db/store.ts), with its rules: 'locked' while
 * locked, 'invalid' (with a user-ready message) or 'not-found' as appropriate. Deleting a lecture or a
 * class deletes its sections' questions and attempts too.
 */
export interface QuizStore {
  /** A section's bank, oldest first. */
  listQuestions(sectionId: string): Promise<Question[]>;
  /**
   * Adds questions to a section's bank, all or none. 'invalid' if any is malformed (see Question), names
   * a slide outside the section, or repeats a question already in the bank; at most 100 per call and
   * 500 per section.
   */
  addQuestions(sectionId: string, questions: QuestionInput[]): Promise<Question[]>;
  /** Removes a bad question from the bank. Attempts that asked it keep their record of it. */
  deleteQuestion(id: string): Promise<void>;
  /**
   * Saves a finished quiz, marking each multiple-choice answer against the stored question. 'invalid' if
   * it has no answers of either kind, an exam that isn't this class's, or a short answer out of shape
   * (see WrittenAnswer: its slide outside the section, a mark that isn't a whole number in range).
   */
  recordQuizAttempt(input: QuizAttemptInput): Promise<QuizAttempt>;
  /** Attempts, newest first: one section's, or every section's (for the planner). */
  listQuizAttempts(sectionId?: string): Promise<QuizAttempt[]>;
}
