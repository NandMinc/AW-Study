// The planner's numbers, in one place so they can be tuned (DESIGN, "Planning the day"; the open
// question "Tuning numbers"). Every quiz and session is recorded, so later these can be fitted to how
// each person actually does.
export const RULES = {
  /** A new section's three first-week sessions, in days after the lecture. */
  firstWeekDays: [1, 3, 7],
  /** Questions in each first-week session's quiz (and the first quiz after, which has no score to size it):
   * this many a slide of the section, rounded, between min and max. 20 slides make the default 10 (Nathan,
   * Nov 19: "10 by default, more or fewer with how much was covered"). */
  firstWeekQuiz: { perSlide: 0.5, min: 5, max: 15 },
  /** Days from the last first-week session to the first quiz after it. */
  firstGapDays: 7,
  /** A quiz counts as this many seconds a question when fitting the day. */
  secondsPerQuestion: 40,
  /** The Tasks page says "Exam soon" for a class with an exam this many days away or fewer (#72). */
  examSoonDays: 7,
  /** On the Tasks page's progress bar, slide time counts for up to this much of an item's study part;
   * the rest comes when its quiz is done (#72). */
  slidesCountUpTo: 0.8,
  /** Exams (milestone 9, #86): from this many days before one, every section it covers is pulled forward
   * so it's quizzed at least `examQuizzes` times before the day, even past the daily minutes. */
  examPullDays: 10,
  examQuizzes: 2,
  /** Exam practice (#87): offered on this many days before an exam (2: two days and one day before), once.
   * It asks about up to `maxSections` of the sections the exam covers (the weakest), each with
   * `mcPerSection` multiple-choice and `writtenPerSection` short-answer questions; a short answer counts
   * as `minutesPerWritten` minutes. */
  examPracticeDays: 2,
  examPractice: { maxSections: 10, mcPerSection: 2, writtenPerSection: 1, minutesPerWritten: 3 },
  /** Below this, a section counts as weak: it comes first, and gets extra study. */
  weakScore: 0.7,
  /**
   * Question levels (#123, DESIGN "Exam style and question levels"), each list for levels 1, 2 and 3 (recognise,
   * apply, exam-style). A section's bank holds them in `bankShares`. A quiz asks them in its section's stage's
   * shares: new (first week, or the last score under weakScore), learning, known (the last `knownQuizzes` scores
   * all at least `knownScore`, and no exam-style question missed in the last), exam (in an exam's run-up). A
   * known quiz always has one exam-style question (the anchor). `seconds` is each level's time in the day's plan.
   * `shortAnswers`: whether banks get short-answer questions (off until the quiz screen asks them, #124).
   */
  levels: {
    bankShares: [0.25, 0.35, 0.4],
    stageShares: {
      new: [0.15, 0.35, 0.5],
      learning: [0.25, 0.5, 0.25],
      known: [0.6, 0.3, 0.1],
      exam: [0.15, 0.35, 0.5],
    },
    knownScore: 0.9,
    knownQuizzes: 2,
    seconds: [20, 45, 120],
    shortAnswers: false,
  },
  /** DESIGN's score table, highest band first: what a quiz's score sets for the next one. (The 90% band's
   * 3-day minimum never bites while gaps are whole days: 2.5 x 1 day already rounds to 3.) */
  scoreBands: [
    { from: 0.9, gap: 'times', times: 2.5, atLeast: 3, size: 3, extraMinutes: 0 },
    { from: 0.7, gap: 'times', times: 1.5, atLeast: 1, size: 5, extraMinutes: 0 },
    { from: 0.5, gap: 'fixed', days: 2, size: 8, extraMinutes: 10 },
    { from: 0, gap: 'fixed', days: 1, size: 10, extraMinutes: 20 },
  ] as const satisfies readonly ScoreBand[],
};

export type ScoreBand =
  | { from: number; gap: 'times'; times: number; atLeast: number; size: number; extraMinutes: number }
  | { from: number; gap: 'fixed'; days: number; size: number; extraMinutes: number };
