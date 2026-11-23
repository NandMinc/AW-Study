// The Tasks page's day (#72): grouped by class in the saved order, fixed at the start of the day,
// ticked by quizzes, statuses, and the progress bar. UTC, the day starting at 4 a.m.
import { describe, expect, it } from 'vitest';
import type { Lecture, Section } from '../types/lecture';
import type { StudySession } from '../types/plan';
import type { QuizAttempt } from '../types/quiz';
import { progress, STATUS_TEXT, tasksForDay, type TasksInput } from './tasks';

let n = 0;
const at = (day: string, hour = 12) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

function lecture(courseId: string, date: string, minutes = 50): Lecture {
  return { id: `l${++n}`, courseId, date, minutes, createdAt: at(date), updatedAt: at(date) };
}
function section(l: Lecture): Section {
  return {
    id: `s${++n}`,
    courseId: l.courseId,
    lectureId: l.id,
    deckId: 'd',
    firstPage: 1,
    lastPage: 10, // a 5-question first-week quiz (4 minutes)
    schedule: { budgetMinutes: l.minutes, studiedMinutes: 0, nextDue: null, extraMinutes: 0 },
    createdAt: at(l.date),
    updatedAt: at(l.date),
  };
}
function studied(s: Section, day: string, step: 1 | 2 | 3 | null, minutes = 15): StudySession {
  const t = at(day);
  return { id: `x${++n}`, courseId: s.courseId, sectionId: s.id, kind: step ? 'first-week' : 'extra', step, startedAt: t, finishedAt: t, minutes, createdAt: t };
}
function quizzed(s: Section, day: string, score: number, asked = 10): QuizAttempt {
  const t = at(day, 13);
  const right = Math.round(score * asked);
  return { id: `a${++n}`, courseId: s.courseId, sectionId: s.id, startedAt: t, finishedAt: t, answers: [], right, asked, score: right / asked, createdAt: t };
}

// Biology: yesterday's lecture, so a first-week session today (17 min + a 5-question quiz).
// History: its first week done long ago, so a review quiz is due today (5 questions, 4 min).
// Art: its lecture is today, so nothing until tomorrow.
const TODAY = '2026-11-17';
const bioL = lecture('bio', '2026-11-16');
const bio = section(bioL);
const histL = lecture('hist', '2026-11-01');
const hist = section(histL);
const artL = lecture('art', TODAY);
const art = section(artL);
const histWeek = [studied(hist, '2026-11-02', 1), studied(hist, '2026-11-04', 2), studied(hist, '2026-11-08', 3)];

function day(extra: Partial<TasksInput> = {}) {
  return tasksForDay({
    today: TODAY,
    dailyMinutes: 300,
    lectures: [bioL, histL, artL],
    sections: [bio, hist, art],
    sessions: histWeek,
    attempts: [],
    timeZone: 'UTC',
    dayStartHour: 4,
    classOrder: [],
    nextExam: {},
    ...extra,
  });
}
const shape = (d: ReturnType<typeof day>) => d.classes.map((c) => `${c.courseId}:${c.status}:${c.items.map((t) => (t.done ? '✓' : '·')).join('')}`);

describe('grouped by class', () => {
  it('one group per class with something today, in the planner’s order; a class with nothing isn’t listed', () => {
    expect(shape(day())).toEqual(['bio:new:·', 'hist:review:·']); // new lectures come first
  });

  it('the saved order comes first; classes not in it follow in the planner’s order; unknown ids are ignored', () => {
    expect(shape(day({ classOrder: ['hist', 'bio'] }))).toEqual(['hist:review:·', 'bio:new:·']);
    expect(shape(day({ classOrder: ['gone', 'hist'] }))).toEqual(['hist:review:·', 'bio:new:·']);
    expect(shape(day({ classOrder: ['bio'] }))).toEqual(['bio:new:·', 'hist:review:·']);
  });
});

describe('fixed at the start of the day, ticked by quizzes', () => {
  it('slide time alone ticks nothing; the quiz does, and the item stays on the list', () => {
    const read = day({ sessions: [...histWeek, studied(bio, TODAY, 1, 17)] });
    expect(shape(read)).toEqual(['bio:new:·', 'hist:review:·']); // still there, not done
    expect(read.classes[0]!.items[0]!.studiedMinutes).toBe(17);
    const quizzedToo = day({ sessions: [...histWeek, studied(bio, TODAY, 1, 17)], attempts: [quizzed(bio, TODAY, 0.8)] });
    expect(shape(quizzedToo)).toEqual(['bio:done:✓', 'hist:review:·']);
  });

  it('a review quiz done today is ticked, and the class is done', () => {
    expect(shape(day({ attempts: [quizzed(hist, TODAY, 0.9)] }))).toEqual(['bio:new:·', 'hist:done:✓']);
  });

  it('yesterday’s work isn’t today’s: it changes today’s list, it doesn’t tick it', () => {
    const yesterday = day({ sessions: [...histWeek, studied(bio, '2026-11-16', 1)], attempts: [quizzed(bio, '2026-11-16', 1)] });
    expect(shape(yesterday)).toEqual(['hist:review:·']); // session 1 was done yesterday; session 2 is on day 3
  });

  it('extra study after a low score is done by an extra session today', () => {
    const low = [quizzed(hist, '2026-11-16', 0.3)]; // under 50%: 20 min extra from the next day, and a quiz
    expect(shape(day({ attempts: low }))).toEqual(['hist:review:··', 'bio:new:·']); // a weak section comes first
    expect(shape(day({ attempts: low, sessions: [...histWeek, studied(hist, TODAY, null, 20)] }))).toEqual(['hist:review:✓·', 'bio:new:·']);
  });
});

describe('exam practice (#87)', () => {
  // History's final is the day after tomorrow: practice is offered today
  const final = { id: 'final', courseId: 'hist', title: 'Final', kind: 'final' as const, date: '2026-11-19', lectureIds: null, createdAt: at('2026-10-01'), updatedAt: at('2026-10-01') };
  const practiced = (when: string): QuizAttempt => ({ ...quizzed(hist, when, 0.8), examId: final.id });

  it('on the list from the start of the day, ticked once a practice for that exam is saved today', () => {
    const before = day({ exams: [final] });
    expect(before.practice.map((p) => [p.item.examId, p.item.sectionIds, p.done])).toEqual([['final', [hist.id], false]]);
    const after = day({ exams: [final], attempts: [practiced(TODAY)] });
    expect(after.practice.map((p) => p.done)).toEqual([true]); // still there, ticked
    expect(shape(after)).toEqual(['hist:done:✓', 'bio:new:·']); // and, as a quiz on its section, ticks History's review (DESIGN)
    expect(day({ exams: [final], attempts: [quizzed(hist, TODAY, 0.9)] }).practice.map((p) => p.done)).toEqual([false]); // a plain quiz isn't practice
  });

  it('a practice done yesterday, in its 2 days, takes it off today’s list; one from before them doesn’t', () => {
    const tomorrow = { ...final, date: '2026-11-18' }; // its practice days are Nov 16 and 17
    expect(day({ exams: [tomorrow], attempts: [practiced('2026-11-16')] }).practice).toEqual([]);
    expect(day({ exams: [final], attempts: [practiced('2026-11-16')] }).practice.map((p) => p.done)).toEqual([false]); // Nov 19's start on the 17th
  });
});

describe('statuses', () => {
  it('“Exam soon” within 7 days, before New and Review; done comes before all', () => {
    expect(shape(day({ nextExam: { hist: '2026-11-24', bio: '2026-11-25' } }))).toEqual(['bio:new:·', 'hist:exam-soon:·']); // 7 and 8 days
    expect(shape(day({ nextExam: { bio: TODAY } }))).toEqual(['bio:exam-soon:·', 'hist:review:·']);
    expect(shape(day({ nextExam: { hist: TODAY }, attempts: [quizzed(hist, TODAY, 1)] }))).toEqual(['bio:new:·', 'hist:done:✓']);
  });

  it('the words fit the page: 12 characters at most', () => {
    for (const text of Object.values(STATUS_TEXT)) expect(text.length).toBeLessThanOrEqual(12);
  });
});

describe('the progress bar', () => {
  // bio: 17 min of slides + a 4-minute quiz = 21; hist: a 4-minute quiz. 25 in all.
  it('starts empty, creeps with slide time (up to 80% of it), and fills only with the quizzes', () => {
    expect(day().progress).toBe(0);
    expect(day({ sessions: [...histWeek, studied(bio, TODAY, 1, 10)] }).progress).toBeCloseTo(8 / 25); // 10 min x 0.8
    expect(day({ sessions: [...histWeek, studied(bio, TODAY, 1, 40)] }).progress).toBeCloseTo(13.6 / 25); // at most 17 x 0.8
    expect(day({ sessions: [...histWeek, studied(bio, TODAY, 1, 17)], attempts: [quizzed(bio, TODAY, 1)] }).progress).toBeCloseTo(21 / 25);
    expect(day({ sessions: [...histWeek, studied(bio, TODAY, 1, 17)], attempts: [quizzed(bio, TODAY, 1), quizzed(hist, TODAY, 1)] }).progress).toBe(1);
  });

  it('nothing today is a full bar', () => {
    expect(progress([])).toBe(1);
  });
});
