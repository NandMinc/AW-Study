// Loads what the planner needs (src/plan/planner.ts) and the names the screens show with it, for the
// Tasks page and Play (both use `tasks`, src/plan/tasks.ts: by class, in the saved order). Everything is read fresh each time: nothing the planner works out is stored.
import type { StudyStore } from '../db/store';
import { deviceTimeZone, studyDay } from '../lib/studyDay';
import { planDay, type Plan, type PlanItem, type PracticeItem } from '../plan/planner';
import { progress, tasksForDay, type TasksDay } from '../plan/tasks';
import type { Course, Exam, Lecture, Section, SlideDeck } from '../types/lecture';
import { slidesLabel } from './classes';
import type { StartProgress } from './getting-started';
import { DAY_START_HOUR } from './settings';

export interface ItemPlace {
  course: Course;
  section: Section;
  deck: SlideDeck;
  lecture: Lecture;
}

export interface Planning {
  today: string;
  plan: Plan;
  /** Today by class, as the Tasks page shows it and Play runs it (only items with a place). */
  tasks: TasksDay;
  /** StudySettings.classOrder as saved (the Tasks page keeps classes not shown today in their place). */
  classOrder: string[];
  place: (sectionId: string) => ItemPlace | undefined;
  /** Today's exam practice (#87), with its exam and class; only the sections that can be placed. */
  practice: { item: PracticeItem; done: boolean; exam: Exam; course: Course }[];
  /** How far along the first run is (#136): classes, lectures, any study, where to add a lecture. */
  start: StartProgress;
  /** Courses with at least one lecture: whether there's anything to plan at all. */
  hasLectures: boolean;
}

export async function loadPlanning(store: StudyStore, now = new Date()): Promise<Planning> {
  const timeZone = deviceTimeZone();
  const today = studyDay(now, timeZone, DAY_START_HOUR);
  const courses = await store.listCourses(today);
  const [perCourse, sections, attempts, sessions, settings] = await Promise.all([
    Promise.all(
      courses.map(async (c) => ({ lectures: await store.listLectures(c.id), decks: await store.listSlideDecks(c.id), exams: await store.listExams(c.id) })),
    ),
    store.listSections(),
    store.listQuizAttempts(),
    store.listStudySessions(),
    store.getStudySettings(),
  ]);
  const lectures = perCourse.flatMap((p) => p.lectures.map((l) => l.lecture));
  const decks = new Map(perCourse.flatMap((p) => p.decks).map((d) => [d.id, d]));
  const courseById = new Map<string, Course>(courses.map((c) => [c.id, c]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const lectureById = new Map(lectures.map((l) => [l.id, l]));
  const exams = perCourse.flatMap((p) => p.exams);
  const input = { today, dailyMinutes: settings.dailyMinutes, lectures, sections, sessions, attempts, exams, timeZone, dayStartHour: DAY_START_HOUR };
  const plan = planDay(input);
  const nextExam = Object.fromEntries(courses.map((c) => [c.id, c.nextExam?.date ?? null]));
  const place = (sectionId: string): ItemPlace | undefined => {
    const section = sectionById.get(sectionId);
    const course = section && courseById.get(section.courseId);
    const deck = section && decks.get(section.deckId);
    const lecture = section && lectureById.get(section.lectureId);
    return section && course && deck && lecture ? { course, section, deck, lecture } : undefined;
  };
  const day = tasksForDay({ ...input, classOrder: settings.classOrder, nextExam });
  const classes = day.classes
    .map((c) => ({ ...c, items: c.items.filter((t) => place(t.item.sectionId)) }))
    .filter((c) => c.items.length > 0);
  const examById = new Map(exams.map((e) => [e.id, e]));
  const practice = day.practice.flatMap(({ item, done }) => {
    const exam = examById.get(item.examId);
    const course = courseById.get(item.courseId);
    const sectionIds = item.sectionIds.filter((id) => place(id));
    return exam && course && sectionIds.length > 0 ? [{ item: { ...item, sectionIds }, done, exam, course }] : [];
  });
  return {
    today,
    plan,
    practice,
    tasks: { ...day, classes, progress: progress(classes.flatMap((c) => c.items)) },
    classOrder: settings.classOrder,
    hasLectures: lectures.length > 0,
    start: {
      classes: courses.length,
      lectures: lectures.length,
      studied: sessions.length > 0 || attempts.length > 0,
      courseId: (courses[perCourse.findIndex((p) => p.lectures.length === 0)] ?? courses[0])?.id ?? null,
    },
    place,
  };
}

/** "Study: PHIL 201 · Unit 4, slides 1–19" and its details line. */
export function describeItem(item: PlanItem, place: ItemPlace): { title: string; detail: string } {
  const where = `${place.course.name} · ${place.deck.title}, ${slidesLabel(place.section.firstPage, place.section.lastPage)}`;
  const late = item.overdueDays > 0 ? ` · ${item.overdueDays} day${item.overdueDays === 1 ? '' : 's'} late` : '';
  switch (item.kind) {
    case 'study':
      return { title: `Study ${where}`, detail: `${item.minutes} min, then a ${item.quizSize}-question quiz · session ${item.step} of 3${late}` };
    case 'quiz':
      return { title: `Quiz: ${where}`, detail: `${item.quizSize} questions, about ${item.minutes} min${late}` };
    case 'extra':
      return { title: `Extra study: ${where}`, detail: `${item.minutes} min, after a low quiz score${late}` };
  }
}
