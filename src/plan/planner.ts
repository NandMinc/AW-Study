// The planner (#47, docs/DESIGN.md "Planning the day"): today's checklist, worked out each time from
// the history (lectures, study sessions done, quiz attempts) and the daily minutes. Nothing here is
// stored and nothing here touches the store: a pure function, so every rule has a test.
//
// Days are study days ("YYYY-MM-DD", src/lib/studyDay.ts: the day starts at 4 a.m.). A lecture's
// date is a calendar day, which for a daytime lecture is its study day too.
import { studyDay } from '../lib/studyDay';
import type { Exam, Lecture, Section } from '../types/lecture';
import type { StudySession } from '../types/plan';
import type { QuizAttempt } from '../types/quiz';
import { RULES } from './rules';

export type PlanItem =
  | { kind: 'study'; sectionId: string; step: 1 | 2 | 3; minutes: number; quizSize: number; due: string; overdueDays: number }
  /** `examId`: pulled forward for that exam (#86), not the section's own schedule. */
  | { kind: 'quiz'; sectionId: string; minutes: number; quizSize: number; due: string; overdueDays: number; examId?: string }
  | { kind: 'extra'; sectionId: string; minutes: number; due: string; overdueDays: number };

/**
 * Exam practice (#87): a mixed test across the sections an exam covers, on the last days before it. Kept
 * apart from the section items (`Plan.practice`): it belongs to an exam, not one section.
 */
export interface PracticeItem {
  kind: 'practice';
  examId: string;
  courseId: string;
  /** The sections it asks about, in lecture order (the weakest ones when there are more than RULES allows). */
  sectionIds: string[];
  mcPerSection: number;
  writtenPerSection: number;
  minutes: number;
  due: string; // the first day it's offered
}

export interface Plan {
  today: PlanItem[]; // what fits today, in the order to do it (Play runs through these)
  /** Today's exam practice, soonest exam first (#87). Planned past the daily minutes, like the exam's quizzes. */
  practice: PracticeItem[];
  later: PlanItem[]; // due, but over today's minutes: rolls into the coming days
  dailyMinutes: number;
  doneMinutes: number; // studied and quizzed already today (counts against the daily minutes)
  plannedMinutes: number; // today's items
  overBudget: boolean; // the first item alone is more than what's left of today
  /** The exams whose sections took today past the daily minutes (DESIGN: allowed before an exam, and said). */
  examsOver: Exam[];
}

export interface PlanInput {
  today: string;
  dailyMinutes: number;
  lectures: Lecture[];
  sections: Section[];
  sessions: StudySession[];
  attempts: QuizAttempt[];
  timeZone: string;
  dayStartHour: number;
  /** The classes' exams (#86): from RULES.examPullDays before one, its sections are pulled forward. */
  exams?: Exam[];
}

/** `date` moved by `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Minutes a quiz of `n` questions takes, at RULES.secondsPerQuestion each, rounded up. */
export function quizMinutes(n: number): number {
  return Math.ceil((n * RULES.secondsPerQuestion) / 60);
}

/** Questions in a first-week quiz for this section: by its number of slides (RULES.firstWeekQuiz). */
export function firstWeekQuizSize(section: Pick<Section, 'firstPage' | 'lastPage'>): number {
  const { perSlide, min, max } = RULES.firstWeekQuiz;
  const slides = section.lastPage - section.firstPage + 1;
  return Math.min(max, Math.max(min, Math.round(slides * perSlide)));
}

/** A budget in thirds, whole minutes that add up (the earlier sessions get the odd minutes). */
export function thirds(budget: number): [number, number, number] {
  const base = Math.floor(budget / 3);
  const left = budget - 3 * base;
  return [base + (left > 0 ? 1 : 0), base + (left > 1 ? 1 : 0), base];
}

/** What comes after a quiz score (DESIGN's table): the next gap, the next quiz's size, extra study. */
export function afterScore(score: number, lastGap: number): { gap: number; size: number; extraMinutes: number } {
  for (const band of RULES.scoreBands) {
    if (score >= band.from) {
      const gap = band.gap === 'fixed' ? band.days : Math.max(band.atLeast, Math.round(band.times * lastGap));
      return { gap, size: band.size, extraMinutes: band.extraMinutes };
    }
  }
  throw new Error('unreachable: the last band starts at 0');
}

/** Everything the planner knows about one section: its due items, its last score and its next quiz's size. */
export function sectionItems(input: PlanInput, section: Section, lecture: Lecture): { items: PlanItem[]; lastScore: number | null; quizSize: number } {
  const day = (iso: string) => studyDay(new Date(iso), input.timeZone, input.dayStartHour);
  const sessions = input.sessions.filter((s) => s.sectionId === section.id);
  const attempts = input.attempts.filter((a) => a.sectionId === section.id).sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  const last = attempts.at(-1) ?? null;
  const items: PlanItem[] = [];
  const due = (date: string) => ({ due: date, overdueDays: Math.max(0, daysBetween(date, input.today)) });

  // The first week: three sessions, on days 1, 3 and 7, but never closer than their spacing to the one before
  const doneOn = [1, 2, 3].map((step) =>
    sessions
      .filter((s) => s.kind === 'first-week' && s.step === step)
      .map((s) => day(s.finishedAt))
      .sort()[0],
  );
  const minutes = thirds(section.schedule.budgetMinutes);
  const offsets = RULES.firstWeekDays;
  let firstWeekDone: string | null = null;
  for (let i = 0; i < 3; i++) {
    if (doneOn[i]) {
      firstWeekDone = i === 2 ? doneOn[i]! : null;
      continue;
    }
    const earliest = addDays(lecture.date, offsets[i]!);
    const afterPrevious = i > 0 ? addDays(doneOn[i - 1]!, offsets[i]! - offsets[i - 1]!) : earliest;
    const date = earliest > afterPrevious ? earliest : afterPrevious;
    if (date <= input.today) {
      items.push({ kind: 'study', sectionId: section.id, step: (i + 1) as 1 | 2 | 3, minutes: minutes[i]!, quizSize: firstWeekQuizSize(section), ...due(date) });
    }
    break; // one step at a time
  }

  // After the first week: quizzes, each score setting the next date and size
  let size = firstWeekQuizSize(section);
  if (firstWeekDone) {
    let gap = RULES.firstGapDays;
    let next = addDays(firstWeekDone, gap);
    for (const a of attempts) {
      const on = day(a.finishedAt);
      if (on <= firstWeekDone) continue; // the first week's own quizzes
      const after = afterScore(a.score, gap);
      gap = after.gap;
      size = after.size;
      next = addDays(on, gap);
    }
    if (next <= input.today) items.push({ kind: 'quiz', sectionId: section.id, minutes: quizMinutes(size), quizSize: size, ...due(next) });
  }

  // Extra study after a low score, the day after it, until done (a newer low score asks again)
  if (last) {
    const { extraMinutes } = afterScore(last.score, RULES.firstGapDays);
    const doneSince = sessions.some((s) => s.kind === 'extra' && s.finishedAt > last.finishedAt);
    const date = addDays(day(last.finishedAt), 1);
    if (extraMinutes > 0 && !doneSince && date <= input.today) {
      items.push({ kind: 'extra', sectionId: section.id, minutes: extraMinutes, ...due(date) });
    }
  }
  return { items, lastScore: last ? last.score : null, quizSize: size };
}

/** The exams whose run-up (RULES.examPullDays before, up to the day before) includes `today`, soonest first. */
export function examsInRunUp(exams: readonly Exam[], today: string): Exam[] {
  return exams
    .filter((e) => {
      const days = daysBetween(today, e.date);
      return days >= 1 && days <= RULES.examPullDays;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Whether `exam` covers this lecture: the lectures it lists, or (null) every lecture of its class up to its date. */
export function examCovers(exam: Exam, lecture: Lecture): boolean {
  if (exam.courseId !== lecture.courseId) return false;
  return exam.lectureIds ? exam.lectureIds.includes(lecture.id) : lecture.date <= exam.date;
}

/**
 * When a section covered by `exam` needs its next exam quiz (#86), or null when it has had enough:
 * with none in the run-up yet, at once (from the run-up's start, or the day after the lecture); after
 * one, halfway from it to the exam (at least a day later, by the day before at the latest).
 */
export function examQuizDue(exam: Exam, lecture: Lecture, quizDays: readonly string[]): string | null {
  const start = addDays(exam.date, -RULES.examPullDays);
  const last = addDays(exam.date, -1);
  const inRunUp = quizDays.filter((d) => d >= start && d < exam.date).sort();
  if (inRunUp.length >= RULES.examQuizzes) return null;
  if (inRunUp.length === 0) {
    const afterLecture = addDays(lecture.date, 1);
    const due = afterLecture > start ? afterLecture : start;
    return due <= last ? due : null;
  }
  const previous = inRunUp.at(-1)!;
  const due = addDays(previous, Math.max(1, Math.floor(daysBetween(previous, exam.date) / 2)));
  return due <= last ? due : null;
}

/** Minutes an exam practice of this many sections takes (RULES.examPractice). */
export function practiceMinutes(sections: number): number {
  const { mcPerSection, writtenPerSection, minutesPerWritten } = RULES.examPractice;
  return quizMinutes(sections * mcPerSection) + sections * writtenPerSection * minutesPerWritten;
}

/**
 * Today's exam practice (#87): for each exam 1 to RULES.examPracticeDays days away, unless one was done
 * since its first day, across the sections it covers (the weakest RULES.examPractice.maxSections, never
 * quizzed counting as weakest), in lecture order.
 */
export function practiceFor(input: PlanInput): PracticeItem[] {
  const day = (iso: string) => studyDay(new Date(iso), input.timeZone, input.dayStartHour);
  const lectures = new Map(input.lectures.map((l) => [l.id, l]));
  const items: PracticeItem[] = [];
  const soonestFirst = [...(input.exams ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const exam of soonestFirst) {
    const days = daysBetween(input.today, exam.date);
    if (days < 1 || days > RULES.examPracticeDays) continue;
    const from = addDays(exam.date, -RULES.examPracticeDays);
    if (input.attempts.some((a) => a.examId === exam.id && day(a.finishedAt) >= from)) continue;
    const covered = input.sections.flatMap((s) => {
      const lecture = lectures.get(s.lectureId);
      return lecture && examCovers(exam, lecture) ? [{ section: s, lecture }] : [];
    });
    if (covered.length === 0) continue;
    const lastScore = (id: string) =>
      input.attempts.filter((a) => a.sectionId === id).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0]?.score ?? -1;
    const inOrder = (a: (typeof covered)[number], b: (typeof covered)[number]) =>
      a.lecture.date.localeCompare(b.lecture.date) || a.section.firstPage - b.section.firstPage || a.section.id.localeCompare(b.section.id);
    const chosen = [...covered]
      .sort((a, b) => lastScore(a.section.id) - lastScore(b.section.id) || inOrder(a, b))
      .slice(0, RULES.examPractice.maxSections)
      .sort(inOrder);
    items.push({
      kind: 'practice',
      examId: exam.id,
      courseId: exam.courseId,
      sectionIds: chosen.map((c) => c.section.id),
      mcPerSection: RULES.examPractice.mcPerSection,
      writtenPerSection: RULES.examPractice.writtenPerSection,
      minutes: practiceMinutes(chosen.length),
      due: from,
    });
  }
  return items;
}

/** Today's checklist. */
export function planDay(input: PlanInput): Plan {
  const day = (iso: string) => studyDay(new Date(iso), input.timeZone, input.dayStartHour);
  const lectures = new Map(input.lectures.map((l) => [l.id, l]));
  const runUp = examsInRunUp(input.exams ?? [], input.today);
  const candidates: { item: PlanItem; lastScore: number | null; lectureDate: string; exam: Exam | null }[] = [];
  for (const section of input.sections) {
    const lecture = lectures.get(section.lectureId);
    if (!lecture) continue;
    const { items, lastScore, quizSize } = sectionItems(input, section, lecture);
    const exam = runUp.find((e) => examCovers(e, lecture)) ?? null;
    // An exam soon (#86): quizzed at least twice in its run-up, unless today already ends in a quiz
    if (exam && !items.some((i) => i.kind !== 'extra')) {
      const quizDays = input.attempts.filter((a) => a.sectionId === section.id).map((a) => day(a.finishedAt));
      const due = examQuizDue(exam, lecture, quizDays);
      if (due && due <= input.today) {
        items.push({ kind: 'quiz', sectionId: section.id, minutes: quizMinutes(quizSize), quizSize, due, overdueDays: daysBetween(due, input.today), examId: exam.id });
      }
    }
    for (const item of items) candidates.push({ item, lastScore, lectureDate: lecture.date, exam });
  }

  // Priority (DESIGN): an exam soon (the soonest first, weakest first, never quizzed counting as weakest),
  // then the lowest recent scores, then new lectures, then the most overdue
  const kindOrder = { extra: 0, study: 1, quiz: 2 } as const;
  const weak = (s: number | null) => s !== null && s < RULES.weakScore;
  candidates.sort((a, b) => {
    if ((a.exam === null) !== (b.exam === null)) return a.exam ? -1 : 1;
    if (a.exam && b.exam) {
      const byExam = a.exam.date.localeCompare(b.exam.date) || a.exam.id.localeCompare(b.exam.id);
      if (byExam !== 0) return byExam;
      if (a.item.sectionId !== b.item.sectionId && a.lastScore !== b.lastScore) return (a.lastScore ?? -1) - (b.lastScore ?? -1);
    }
    const aw = weak(a.lastScore);
    const bw = weak(b.lastScore);
    if (aw !== bw) return aw ? -1 : 1;
    if (aw && bw && a.lastScore !== b.lastScore) return a.lastScore! - b.lastScore!;
    const aNew = a.item.kind === 'study';
    const bNew = b.item.kind === 'study';
    if (!aw && aNew !== bNew) return aNew ? -1 : 1;
    if (a.item.sectionId === b.item.sectionId) return kindOrder[a.item.kind] - kindOrder[b.item.kind];
    return (
      b.item.overdueDays - a.item.overdueDays ||
      a.lectureDate.localeCompare(b.lectureDate) ||
      kindOrder[a.item.kind] - kindOrder[b.item.kind] ||
      a.item.sectionId.localeCompare(b.item.sectionId)
    );
  });

  // What today already holds counts against its minutes
  const doneMinutes =
    input.sessions.filter((s) => day(s.finishedAt) === input.today).reduce((sum, s) => sum + s.minutes, 0) +
    input.attempts.filter((a) => day(a.finishedAt) === input.today && !input.sessions.some((s) => s.sectionId === a.sectionId && day(s.finishedAt) === input.today)).reduce((sum, a) => sum + quizMinutes(a.asked), 0);
  let left = Math.max(0, input.dailyMinutes - doneMinutes);
  const today: PlanItem[] = [];
  const later: PlanItem[] = [];
  let overBudget = false;
  const examsOver = new Map<string, Exam>();
  for (const { item, exam } of candidates) {
    if (exam && item.minutes > left) {
      today.push(item); // before an exam, its sections are planned past the daily minutes
      examsOver.set(exam.id, exam);
      left = 0;
    } else if (item.minutes <= left) {
      today.push(item);
      left -= item.minutes;
    } else if (today.length === 0 && doneMinutes === 0) {
      today.push(item); // one big item still gets done, and the screen says it's over
      overBudget = true;
      left = 0;
    } else later.push(item);
  }
  return {
    today,
    later,
    dailyMinutes: input.dailyMinutes,
    doneMinutes,
    plannedMinutes: today.reduce((sum, i) => sum + i.minutes, 0),
    practice: practiceFor(input),
    overBudget,
    examsOver: [...examsOver.values()],
  };
}
