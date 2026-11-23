// The Tasks page's day (#72, docs/design/README.md "Tasks"): today's checklist grouped by class, in
// the user's saved order, with each class's status and the progress bar. Pure, like the planner.
//
// Today's list is the plan as it stood at the start of the day (the history before today), so it
// doesn't reshuffle while you work, and what you finish stays on it, ticked, instead of disappearing.
// A lecture is done when its quiz is done (Nathan, Nov 19): slide time alone never ticks anything.
import { studyDay } from '../lib/studyDay';
import { daysBetween, planDay, quizMinutes, type PlanInput, type PlanItem, type PracticeItem } from './planner';
import type { Exam } from '../types/lecture';
import { RULES } from './rules';

export type ClassStatus = 'exam-soon' | 'new' | 'review' | 'done';

export interface TaskItem {
  item: PlanItem;
  done: boolean;
  /** Minutes on this section's slides today (finished sessions). */
  studiedMinutes: number;
}

export interface ClassTasks {
  courseId: string;
  status: ClassStatus;
  items: TaskItem[]; // in the planner's order
}

export interface TasksDay {
  classes: ClassTasks[]; // the saved order first, then the rest in the planner's order
  /** 0 to 1: how much of today's work is done (see `progress`). 1 when there's nothing today. */
  progress: number;
  overBudget: boolean;
  /** Exams whose sections took today past the daily minutes (#86): the page says so. */
  examsOver: Exam[];
  /** Today's exam practice (#87), from the plan at the start of the day like the rest; done once a practice
   * for that exam is saved today. Not in the progress bar. */
  practice: { item: PracticeItem; done: boolean }[];
}

export interface TasksInput extends PlanInput {
  /** StudySettings.classOrder. */
  classOrder: string[];
  /** Each course's next exam on or after today ("YYYY-MM-DD"), if any. */
  nextExam: Record<string, string | null | undefined>;
}

/** Status words as the Tasks page shows them (12 characters at most; 'done' is a checkmark). */
export const STATUS_TEXT: Record<Exclude<ClassStatus, 'done'>, string> = {
  'exam-soon': 'Exam soon',
  new: 'New',
  review: 'Review',
};

export function tasksForDay(input: TasksInput): TasksDay {
  const day = (iso: string) => studyDay(new Date(iso), input.timeZone, input.dayStartHour);
  const before = <T extends { finishedAt: string }>(list: T[]) => list.filter((x) => day(x.finishedAt) < input.today);
  const todays = <T extends { finishedAt: string; sectionId: string }>(list: T[], sectionId: string) =>
    list.filter((x) => x.sectionId === sectionId && day(x.finishedAt) === input.today);

  const plan = planDay({ ...input, sessions: before(input.sessions), attempts: before(input.attempts) });
  const courseOf = new Map(input.sections.map((s) => [s.id, s.courseId]));

  const byCourse = new Map<string, TaskItem[]>();
  for (const item of plan.today) {
    const courseId = courseOf.get(item.sectionId);
    if (!courseId) continue;
    const sessions = todays(input.sessions, item.sectionId);
    const done =
      item.kind === 'extra' ? sessions.some((s) => s.kind === 'extra') : todays(input.attempts, item.sectionId).length > 0;
    const studiedMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
    byCourse.set(courseId, [...(byCourse.get(courseId) ?? []), { item, done, studiedMinutes }]);
  }

  const rank = (courseId: string) => {
    const i = input.classOrder.indexOf(courseId);
    return i === -1 ? input.classOrder.length : i;
  };
  const courseIds = [...byCourse.keys()]; // the planner's order, from Map insertion
  const ordered = courseIds.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i);

  const classes = ordered.map(({ id }) => {
    const items = byCourse.get(id)!;
    return { courseId: id, items, status: statusOf(items, input.nextExam[id] ?? null, input.today) };
  });
  const practice = plan.practice.map((item) => ({
    item,
    done: input.attempts.some((a) => a.examId === item.examId && day(a.finishedAt) === input.today),
  }));
  return { classes, progress: progress(classes.flatMap((c) => c.items)), overBudget: plan.overBudget, examsOver: plan.examsOver, practice };
}

/** Done when every item is; otherwise an exam within RULES.examSoonDays, then anything new, then review. */
export function statusOf(items: TaskItem[], nextExam: string | null, today: string): ClassStatus {
  if (items.every((t) => t.done)) return 'done';
  if (nextExam !== null) {
    const days = daysBetween(today, nextExam);
    if (days >= 0 && days <= RULES.examSoonDays) return 'exam-soon';
  }
  if (items.some((t) => t.item.kind === 'study' && t.item.step === 1)) return 'new';
  return 'review';
}

/**
 * The progress bar. Each item weighs its study minutes plus its quiz's time. A done item counts in
 * full; an unfinished one counts its slide time today, up to RULES.slidesCountUpTo of its study part,
 * so the bar creeps while you read but only fills when the quizzes are done.
 */
export function progress(items: TaskItem[]): number {
  let total = 0;
  let done = 0;
  for (const t of items) {
    const study = t.item.kind === 'quiz' ? 0 : t.item.minutes;
    const quiz = t.item.kind === 'extra' ? 0 : t.item.kind === 'quiz' ? t.item.minutes : quizMinutes(t.item.quizSize);
    const weight = study + quiz;
    total += weight;
    done += t.done ? weight : Math.min(t.studiedMinutes, study) * RULES.slidesCountUpTo;
  }
  return total === 0 ? 1 : done / total;
}
