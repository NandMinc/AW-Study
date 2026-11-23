// The planner's rules, one by one (DESIGN "Planning the day"). Times are in UTC with the day starting
// at 4 a.m., so a study day is simply the date of a time between 04:00 and the next 04:00.
import { describe, expect, it } from 'vitest';
import type { Exam, Lecture, Section } from '../types/lecture';
import type { StudySession } from '../types/plan';
import type { QuizAttempt } from '../types/quiz';
import { addDays, afterScore, examCovers, examQuizDue, examsInRunUp, firstWeekQuizSize, planDay, practiceMinutes, quizMinutes, thirds, type PlanInput } from './planner';

let n = 0;
const at = (day: string, hour = 12) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

function lecture(date: string, minutes = 50): Lecture {
  return { id: `l${++n}`, courseId: 'c', date, minutes, createdAt: at(date), updatedAt: at(date) };
}
function section(l: Lecture, budget = l.minutes): Section {
  return {
    id: `s${++n}`,
    courseId: 'c',
    lectureId: l.id,
    deckId: 'd',
    firstPage: 1,
    lastPage: 10,
    schedule: { budgetMinutes: budget, studiedMinutes: 0, nextDue: null, extraMinutes: 0 },
    createdAt: at(l.date),
    updatedAt: at(l.date),
  };
}
function studied(s: Section, day: string, step: 1 | 2 | 3 | null, minutes = 15, hour = 12): StudySession {
  return {
    id: `x${++n}`,
    courseId: 'c',
    sectionId: s.id,
    kind: step ? 'first-week' : 'extra',
    step,
    startedAt: at(day, hour),
    finishedAt: at(day, hour),
    minutes,
    createdAt: at(day, hour),
  };
}
function quizzed(s: Section, day: string, score: number, asked = 10, hour = 13): QuizAttempt {
  const right = Math.round(score * asked);
  return {
    id: `a${++n}`,
    courseId: 'c',
    sectionId: s.id,
    startedAt: at(day, hour),
    finishedAt: at(day, hour),
    answers: [],
    right,
    asked,
    score: right / asked,
    createdAt: at(day, hour),
  };
}

function plan(today: string, parts: { lectures: Lecture[]; sections: Section[]; sessions?: StudySession[]; attempts?: QuizAttempt[]; exams?: Exam[] }, dailyMinutes = 60) {
  const input: PlanInput = {
    today,
    dailyMinutes,
    lectures: parts.lectures,
    sections: parts.sections,
    sessions: parts.sessions ?? [],
    attempts: parts.attempts ?? [],
    timeZone: 'UTC',
    dayStartHour: 4,
    exams: parts.exams,
  };
  return planDay(input);
}
// Quiz minutes are by level since #123 (RULES.levels: 20 s, 45 s, 2 min a question, in the section's stage):
// e.g. 5 questions learning 5 min, new or exam 6; 3 known or learning 4 (with the anchor), exam 5; 8 new 11;
// 10 new 13; 15 new 21.
const summary = (items: ReturnType<typeof planDay>['today']) =>
  items.map((i) => `${i.kind}${i.kind === 'study' ? i.step : ''}:${i.sectionId}:${i.minutes}${'quizSize' in i ? `/${i.quizSize}q` : ''}`);

describe('pieces', () => {
  it('thirds add up, earlier sessions getting the odd minutes', () => {
    expect(thirds(50)).toEqual([17, 17, 16]);
    expect(thirds(51)).toEqual([17, 17, 17]);
    expect(thirds(1)).toEqual([1, 0, 0]);
  });

  it('the score table', () => {
    expect(afterScore(0.95, 7)).toEqual({ gap: 18, size: 3, extraMinutes: 0 }); // 2.5 x 7 = 17.5
    expect(afterScore(0.9, 1)).toEqual({ gap: 3, size: 3, extraMinutes: 0 }); // at least 3 days
    expect(afterScore(0.8, 7)).toEqual({ gap: 11, size: 5, extraMinutes: 0 }); // 1.5 x 7 = 10.5
    expect(afterScore(0.6, 18)).toEqual({ gap: 2, size: 8, extraMinutes: 10 });
    expect(afterScore(0.2, 18)).toEqual({ gap: 1, size: 10, extraMinutes: 20 });
    expect(quizMinutes(5)).toBe(4); // 200 seconds
  });

  it('a first-week quiz is sized by the section: 10 for 20 slides, half a question a slide, 5 to 15', () => {
    const pages = (firstPage: number, lastPage: number) => firstWeekQuizSize({ firstPage, lastPage });
    expect(pages(21, 40)).toBe(10); // the default
    expect(pages(1, 24)).toBe(12);
    expect(pages(1, 15)).toBe(8); // 7.5 rounds up
    expect(pages(1, 6)).toBe(5); // never under 5
    expect(pages(1, 60)).toBe(15); // never over 15
  });
});

describe('a new section’s first week', () => {
  const l = lecture('2026-11-16');
  const s = section(l);

  it('three sessions on days 1, 3 and 7, a third of the budget each, one at a time', () => {
    expect(plan('2026-11-16', { lectures: [l], sections: [s] }).today).toEqual([]); // the lecture day itself
    expect(summary(plan('2026-11-17', { lectures: [l], sections: [s] }).today)).toEqual([`study1:${s.id}:17/5q`]);
    const one = [studied(s, '2026-11-17', 1)];
    expect(plan('2026-11-18', { lectures: [l], sections: [s], sessions: one }).today).toEqual([]);
    expect(summary(plan('2026-11-19', { lectures: [l], sections: [s], sessions: one }).today)).toEqual([`study2:${s.id}:17/5q`]);
    const two = [...one, studied(s, '2026-11-19', 2)];
    expect(plan('2026-11-22', { lectures: [l], sections: [s], sessions: two }).today).toEqual([]);
    expect(summary(plan('2026-11-23', { lectures: [l], sections: [s], sessions: two }).today)).toEqual([`study3:${s.id}:16/5q`]);
  });

  it('a late session pushes the next one by its spacing', () => {
    const late = [studied(s, '2026-11-17', 1), studied(s, '2026-11-21', 2)]; // day 3's on day 5
    expect(plan('2026-11-23', { lectures: [l], sections: [s], sessions: late }).today).toEqual([]); // not day 7...
    const p = plan('2026-11-25', { lectures: [l], sections: [s], sessions: late }); // ...but 4 days after day 5
    expect(summary(p.today)).toEqual([`study3:${s.id}:16/5q`]);
    expect(p.today[0]!.due).toBe('2026-11-25');
  });

  it('a lecture entered late is still studied from step 1, shown as overdue', () => {
    const old = lecture('2026-11-01');
    const os = section(old);
    const p = plan('2026-11-18', { lectures: [old], sections: [os] });
    expect(summary(p.today)).toEqual([`study1:${os.id}:17/5q`]);
    expect(p.today[0]!.overdueDays).toBe(16);
  });

  it('a study session after midnight counts for the day before (the day starts at 4 a.m.)', () => {
    const night = [studied(s, '2026-11-18', 1, 15, 2)]; // 2 a.m. on the 18th = still the 17th
    expect(summary(plan('2026-11-19', { lectures: [l], sections: [s], sessions: night }).today)).toEqual([`study2:${s.id}:17/5q`]);
  });
});

describe('after the first week: quizzes by score', () => {
  const l = lecture('2026-11-01');
  const s = section(l);
  const week = [studied(s, '2026-11-02', 1), studied(s, '2026-11-04', 2), studied(s, '2026-11-08', 3)];
  const weekQuizzes = [quizzed(s, '2026-11-08', 0.9)]; // the last session's own quiz doesn't move the schedule
  const parts = (attempts: QuizAttempt[] = [], sessions: StudySession[] = []) => ({
    lectures: [l],
    sections: [s],
    sessions: [...week, ...sessions],
    attempts: [...weekQuizzes, ...attempts],
  });

  it('the first quiz is 7 days after the first week, 5 questions', () => {
    expect(plan('2026-11-14', parts()).today).toEqual([]);
    expect(summary(plan('2026-11-15', parts()).today)).toEqual([`quiz:${s.id}:5/5q`]);
    expect(plan('2026-11-20', parts()).today[0]!.overdueDays).toBe(5); // missed days roll forward
  });

  it('a bigger section gets bigger first-week quizzes, and so does its first quiz after (no score yet)', () => {
    const big = { ...section(l), firstPage: 1, lastPage: 30 };
    expect(summary(plan('2026-11-02', { lectures: [l], sections: [big] }).today)).toEqual([`study1:${big.id}:17/15q`]);
    const done = [studied(big, '2026-11-02', 1), studied(big, '2026-11-04', 2), studied(big, '2026-11-08', 3)];
    expect(summary(plan('2026-11-15', { lectures: [l], sections: [big], sessions: done }).today)).toEqual([`quiz:${big.id}:21/15q`]);
    const after = [quizzed(big, '2026-11-15', 1)]; // then the score table takes over
    expect(summary(plan('2026-12-03', { lectures: [l], sections: [big], sessions: done, attempts: after }).today)).toEqual([`quiz:${big.id}:4/3q`]);
  });

  it('90% or more: 2.5x the gap, 3 questions; 70-89%: 1.5x, 5 questions', () => {
    const great = parts([quizzed(s, '2026-11-15', 1)]); // gap 7 → 18 days: Dec 3
    expect(plan('2026-12-02', great).today).toEqual([]);
    expect(summary(plan('2026-12-03', great).today)).toEqual([`quiz:${s.id}:4/3q`]);
    const good = parts([quizzed(s, '2026-11-15', 0.8), quizzed(s, '2026-11-26', 0.8)]); // 7 → 11 → 17: Dec 13
    expect(plan('2026-12-12', good).today).toEqual([]);
    expect(summary(plan('2026-12-13', good).today)).toEqual([`quiz:${s.id}:5/5q`]);
  });

  it('50-69%: again in 2 days, 8 questions, and 10 minutes of extra study first', () => {
    const p = parts([quizzed(s, '2026-11-15', 0.6)]);
    expect(summary(plan('2026-11-16', p).today)).toEqual([`extra:${s.id}:10`]);
    expect(summary(plan('2026-11-17', p).today)).toEqual([`extra:${s.id}:10`, `quiz:${s.id}:11/8q`]);
    const studiedExtra = parts([quizzed(s, '2026-11-15', 0.6)], [studied(s, '2026-11-16', null, 10)]);
    expect(summary(plan('2026-11-17', studiedExtra).today)).toEqual([`quiz:${s.id}:11/8q`]);
  });

  it('under 50%: tomorrow, 10 questions, 20 minutes extra, until the score recovers', () => {
    const p = parts([quizzed(s, '2026-11-15', 0.3)]);
    expect(summary(plan('2026-11-16', p).today)).toEqual([`extra:${s.id}:20`, `quiz:${s.id}:13/10q`]);
    const again = parts([quizzed(s, '2026-11-15', 0.3), quizzed(s, '2026-11-16', 0.4)], [studied(s, '2026-11-16', null, 20, 10)]);
    expect(summary(plan('2026-11-17', again).today)).toEqual([`extra:${s.id}:20`, `quiz:${s.id}:13/10q`]); // still weak: again
    const recovered = parts([quizzed(s, '2026-11-15', 0.3), quizzed(s, '2026-11-16', 0.9)], [studied(s, '2026-11-16', null, 20, 10)]);
    expect(plan('2026-11-17', recovered).today).toEqual([]); // 0.9 after a 1-day gap: at least 3 days
    expect(summary(plan('2026-11-19', recovered).today)).toEqual([`quiz:${s.id}:4/3q`]);
  });

  it('a low score in the first week asks for extra study the next day too', () => {
    const l2 = lecture('2026-11-16');
    const s2 = section(l2);
    const p = { lectures: [l2], sections: [s2], sessions: [studied(s2, '2026-11-17', 1)], attempts: [quizzed(s2, '2026-11-17', 0.4)] };
    expect(summary(plan('2026-11-18', p).today)).toEqual([`extra:${s2.id}:20`]);
  });
});

describe('each item’s stage: which levels its quiz asks (#123)', () => {
  const l = lecture('2026-11-01');
  const s = section(l);
  const week = [studied(s, '2026-11-02', 1), studied(s, '2026-11-04', 2), studied(s, '2026-11-08', 3)];
  const stageOn = (today: string, attempts: QuizAttempt[] = [], sessions = week) => {
    const item = plan(today, { lectures: [l], sections: [s], sessions, attempts }).today.find((i) => i.kind !== 'extra');
    return item && 'stage' in item ? item.stage : null;
  };

  it('first-week sessions are new; the first quiz after (no score yet) too', () => {
    expect(stageOn('2026-11-02', [], [])).toBe('new');
    expect(stageOn('2026-11-15')).toBe('new');
  });

  it('after quizzes: new under 70%, learning, known after two at 90% or more', () => {
    expect(stageOn('2026-11-17', [quizzed(s, '2026-11-15', 0.5)])).toBe('new'); // 50-69%: again 2 days later
    expect(stageOn('2026-12-03', [quizzed(s, '2026-11-15', 1)])).toBe('learning');
    const twice = [quizzed(s, '2026-11-15', 1), quizzed(s, '2026-12-03', 0.9)]; // 18 → 45 days: Jan 17
    expect(stageOn('2027-01-17', twice)).toBe('known');
  });

  it('a quiz item’s minutes follow its stage’s levels', () => {
    const item = plan('2027-01-17', { lectures: [l], sections: [s], sessions: week, attempts: [quizzed(s, '2026-11-15', 1), quizzed(s, '2026-12-03', 0.9)] }).today[0]!;
    expect(item).toMatchObject({ kind: 'quiz', quizSize: 3, stage: 'known', minutes: 4 }); // 20 + 45 + 120 s
  });
});

describe('fitting the day', () => {
  // A weak section (last score 40%), a new lecture's day 1, and an ordinary quiz 3 days overdue
  const lw = lecture('2026-11-01');
  const weak = section(lw);
  const ln = lecture('2026-11-17', 60);
  const fresh = section(ln);
  const lo = lecture('2026-10-01');
  const ok = section(lo);
  const history = {
    lectures: [lw, ln, lo],
    sections: [ok, fresh, weak],
    sessions: [
      studied(weak, '2026-11-02', 1),
      studied(weak, '2026-11-04', 2),
      studied(weak, '2026-11-08', 3),
      studied(ok, '2026-10-02', 1),
      studied(ok, '2026-10-04', 2),
      studied(ok, '2026-10-08', 3),
    ],
    attempts: [quizzed(weak, '2026-11-17', 0.4), quizzed(ok, '2026-10-15', 0.8), quizzed(ok, '2026-10-26', 0.8)],
  }; // ok: 7 → 11 → 17 days after Oct 26 = Nov 12, so 6 days overdue on the 18th

  it('weakest first, then new lectures, then the most overdue', () => {
    const p = plan('2026-11-18', history, 120);
    expect(summary(p.today)).toEqual([`extra:${weak.id}:20`, `quiz:${weak.id}:13/10q`, `study1:${fresh.id}:20/5q`, `quiz:${ok.id}:5/5q`]);
    expect(p.plannedMinutes).toBe(58);
    expect(p.later).toEqual([]);
  });

  it('never more than the daily minutes: what doesn’t fit rolls on', () => {
    const p = plan('2026-11-18', history, 35); // 30 before #123's quiz times: the weak quiz is now 13 minutes
    expect(summary(p.today)).toEqual([`extra:${weak.id}:20`, `quiz:${weak.id}:13/10q`]);
    expect(summary(p.later)).toEqual([`study1:${fresh.id}:20/5q`, `quiz:${ok.id}:5/5q`]);
    expect(p.overBudget).toBe(false);
  });

  it('what’s already done today uses up the minutes', () => {
    const p = plan('2026-11-18', { ...history, sessions: [...history.sessions, studied(ok, '2026-11-18', null, 25, 9)] }, 30);
    expect(p.doneMinutes).toBe(25);
    expect(p.today.map((i) => i.minutes)).toEqual([5]); // only the 5-minute quiz fits in the 5 left
  });

  it('one item bigger than the whole day is still planned, and says so', () => {
    const big = lecture('2026-11-17', 300);
    const bs = section(big);
    const p = plan('2026-11-18', { lectures: [big], sections: [bs] }, 60);
    expect(summary(p.today)).toEqual([`study1:${bs.id}:100/5q`]);
    expect(p.overBudget).toBe(true);
  });

  it('sections whose lecture is gone are left out', () => {
    expect(plan('2026-11-18', { lectures: [], sections: [weak] }).today).toEqual([]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('exams pull their sections forward (#86)', () => {
  function exam(date: string, lectureIds: string[] | null = null, courseId = 'c'): Exam {
    return { id: `e${++n}`, courseId, title: 'Midterm 1', kind: 'midterm', date, lectureIds, createdAt: at('2026-10-01'), updatedAt: at('2026-10-01') };
  }
  // Two sections long past their first week, with nothing of their own due in late November:
  // strong (95%, then 95%: next Dec 17) and middling (95%, then 75%: next Nov 29)
  const firstWeek = (s: Section) => [studied(s, '2026-10-02', 1), studied(s, '2026-10-04', 2), studied(s, '2026-10-08', 3)];
  const la = lecture('2026-10-01');
  const strong = section(la);
  const lb = lecture('2026-10-01');
  const middling = section(lb);
  const base = {
    lectures: [la, lb],
    sections: [strong, middling],
    sessions: [...firstWeek(strong), ...firstWeek(middling)],
    attempts: [quizzed(strong, '2026-10-15', 0.95), quizzed(strong, '2026-11-02', 0.95), quizzed(middling, '2026-10-15', 0.95), quizzed(middling, '2026-11-02', 0.75)],
  };
  const midterm = exam('2026-11-28'); // every lecture up to it; its run-up starts Nov 18

  it('in the run-up, its sections are quizzed the exam’s way (#123: stage exam), and timed so', () => {
    const p = plan('2026-11-18', { ...base, exams: [midterm] });
    expect(p.today.map((i) => ('stage' in i ? i.stage : null))).toEqual(['exam', 'exam']);
    expect(plan('2026-11-17', { ...base, attempts: [...base.attempts] }).today).toEqual([]); // nothing due before it
  });

  it('nothing before the run-up; from 10 days before, each section it covers gets a quiz, weakest first', () => {
    expect(plan('2026-11-17', { ...base, exams: [midterm] }).today).toEqual([]);
    const p = plan('2026-11-18', { ...base, exams: [midterm] });
    expect(summary(p.today)).toEqual([`quiz:${middling.id}:6/5q`, `quiz:${strong.id}:5/3q`]); // each at its own next size
    expect(p.today.every((i) => i.kind === 'quiz' && i.examId === midterm.id)).toBe(true);
    expect(plan('2026-11-18', base).today).toEqual([]); // the same day without the exam
  });

  it('the second quiz comes halfway to the exam; after two, no more; nothing on the day', () => {
    const once = { ...base, exams: [midterm], attempts: [...base.attempts, quizzed(strong, '2026-11-18', 0.95)] };
    expect(summary(plan('2026-11-22', once).today)).toEqual([`quiz:${middling.id}:6/5q`]); // 4 days overdue
    expect(summary(plan('2026-11-23', once).today)).toEqual([`quiz:${middling.id}:6/5q`, `quiz:${strong.id}:5/3q`]); // Nov 18 + 5
    const twice = { ...once, attempts: [...once.attempts, quizzed(strong, '2026-11-23', 0.95)] };
    expect(summary(plan('2026-11-25', twice).today)).toEqual([`quiz:${middling.id}:6/5q`]);
    expect(plan('2026-11-28', { ...base, exams: [midterm] }).today).toEqual([]);
  });

  it('only the lectures an exam lists, and only its own class', () => {
    expect(summary(plan('2026-11-18', { ...base, exams: [exam('2026-11-28', [la.id])] }).today)).toEqual([`quiz:${strong.id}:5/3q`]);
    expect(plan('2026-11-18', { ...base, exams: [exam('2026-11-28', null, 'other')] }).today).toEqual([]);
  });

  it('a section that already ends in a quiz today gets no second one, but still comes first', () => {
    // A lecture on Nov 17 has its first session (and its quiz) on the 18th; one never quizzed comes before the scored ones
    const lc = lecture('2026-11-17');
    const fresh = section(lc);
    const p = plan('2026-11-18', { ...base, lectures: [...base.lectures, lc], sections: [...base.sections, fresh], exams: [midterm] });
    expect(summary(p.today)).toEqual([`study1:${fresh.id}:17/5q`, `quiz:${middling.id}:6/5q`, `quiz:${strong.id}:5/3q`]);
  });

  it('planned past the daily minutes, and the plan says which exam did it; other work waits', () => {
    const lo = lecture('2026-11-17', 30);
    const other = { ...section(lo), courseId: 'other' };
    const p = plan('2026-11-18', { ...base, lectures: [...base.lectures, { ...lo, courseId: 'other' }], sections: [...base.sections, other], exams: [midterm] }, 5);
    expect(summary(p.today)).toEqual([`quiz:${middling.id}:6/5q`, `quiz:${strong.id}:5/3q`]);
    expect(p.examsOver.map((e) => e.id)).toEqual([midterm.id]);
    expect(summary(p.later)).toEqual([`study1:${other.id}:10/5q`]);
    expect(plan('2026-11-18', { ...base, exams: [midterm] }, 60).examsOver).toEqual([]); // within the minutes: nothing to say
  });

  it('the pieces: which exams are close, what they cover, when the next exam quiz is due', () => {
    const soon = exam('2026-11-20');
    const later = exam('2026-11-28');
    expect(examsInRunUp([later, soon, exam('2026-11-18'), exam('2026-11-29')], '2026-11-18')).toEqual([soon, later]);
    expect(examCovers(exam('2026-11-28'), lecture('2026-11-28'))).toBe(true);
    expect(examCovers(exam('2026-11-28'), lecture('2026-11-29'))).toBe(false);
    expect(examQuizDue(midterm, la, [])).toBe('2026-11-18');
    expect(examQuizDue(midterm, lecture('2026-11-21'), [])).toBe('2026-11-22'); // the day after a lecture in the run-up
    expect(examQuizDue(midterm, lecture('2026-11-27'), [])).toBeNull(); // too late: the exam is the next day
    expect(examQuizDue(midterm, la, ['2026-11-02'])).toBe('2026-11-18'); // before the run-up doesn't count
    expect(examQuizDue(midterm, la, ['2026-11-26'])).toBe('2026-11-27'); // at least a day later
    expect(examQuizDue(midterm, la, ['2026-11-27'])).toBeNull(); // by the day before at the latest
    expect(examQuizDue(midterm, la, ['2026-11-19', '2026-11-24'])).toBeNull();
  });
});

describe('exam practice on the last 2 days (#87)', () => {
  function exam(date: string, lectureIds: string[] | null = null, courseId = 'c'): Exam {
    return { id: `e${++n}`, courseId, title: 'Final', kind: 'final', date, lectureIds, createdAt: at('2026-10-01'), updatedAt: at('2026-10-01') };
  }
  const practiced = (e: Exam, s: Section, day: string): QuizAttempt => ({ ...quizzed(s, day, 0.8), examId: e.id });
  const l1 = lecture('2026-10-01');
  const l2 = lecture('2026-10-08');
  const later = section(l2);
  const earlier = section(l1);
  const base = { lectures: [l1, l2], sections: [later, earlier] };
  const final = exam('2026-12-10');

  it('offered 2 days and 1 day before, across the sections it covers in lecture order; not before, not on the day', () => {
    expect(plan('2026-12-07', { ...base, exams: [final] }).practice).toEqual([]);
    const p = plan('2026-12-08', { ...base, exams: [final] });
    expect(p.practice).toEqual([
      { kind: 'practice', examId: final.id, courseId: 'c', sectionIds: [earlier.id, later.id], mcPerSection: 2, writtenPerSection: 1, minutes: 9, due: '2026-12-08' },
    ]);
    expect(plan('2026-12-09', { ...base, exams: [final] }).practice.map((i) => i.due)).toEqual(['2026-12-08']);
    expect(plan('2026-12-10', { ...base, exams: [final] }).practice).toEqual([]);
    expect(plan('2026-12-08', base).practice).toEqual([]);
  });

  it('once: done when a practice for that exam was saved since its first day (not one from before)', () => {
    const early = [practiced(final, earlier, '2026-12-01')];
    expect(plan('2026-12-09', { ...base, exams: [final], attempts: early }).practice).toHaveLength(1);
    const done = [practiced(final, earlier, '2026-12-08')];
    expect(plan('2026-12-09', { ...base, exams: [final], attempts: done }).practice).toEqual([]);
    const otherExam = [practiced(exam('2026-12-20'), earlier, '2026-12-08')];
    expect(plan('2026-12-09', { ...base, exams: [final], attempts: otherExam }).practice).toHaveLength(1);
    const plainQuiz = [quizzed(earlier, '2026-12-08', 0.9)];
    expect(plan('2026-12-09', { ...base, exams: [final], attempts: plainQuiz }).practice).toHaveLength(1);
  });

  it('only the lectures it covers, of its own class; none when it covers nothing', () => {
    expect(plan('2026-12-08', { ...base, exams: [exam('2026-12-10', [l2.id])] }).practice[0]!.sectionIds).toEqual([later.id]);
    expect(plan('2026-12-08', { ...base, exams: [exam('2026-12-10', null, 'other')] }).practice).toEqual([]);
  });

  it('at most 10 sections: the weakest, never quizzed counting as weakest, still in lecture order', () => {
    const ls = Array.from({ length: 12 }, (_, i) => lecture(addDays('2026-10-01', i)));
    const ss = ls.map((l) => section(l));
    // The first two lectures are the strongest; the third has never been quizzed
    const attempts = ss.flatMap((s, i) => (i === 2 ? [] : [quizzed(s, '2026-11-20', i < 2 ? 1 : 0.5)]));
    const p = plan('2026-12-08', { lectures: ls, sections: ss, attempts, exams: [final] });
    expect(p.practice[0]!.sectionIds).toEqual(ss.slice(2).map((s) => s.id));
    expect(p.practice[0]!.minutes).toBe(practiceMinutes(10));
    expect(practiceMinutes(10)).toBe(Math.ceil((20 * 40) / 60) + 30); // 20 questions at 40 s, 10 short answers at 3 min
  });

  it('two exams close together: one practice each, soonest first, kept apart from the day’s items', () => {
    const quiz = exam('2026-12-09');
    const p = plan('2026-12-08', { ...base, exams: [final, quiz] });
    expect(p.practice.map((i) => i.examId)).toEqual([quiz.id, final.id]);
    // Practice isn't among today's section items or their minutes
    expect(p.today.length).toBeGreaterThan(0);
    expect(p.today.every((i) => base.sections.some((s) => s.id === i.sectionId))).toBe(true);
    expect(p.plannedMinutes).toBe(p.today.reduce((sum, i) => sum + i.minutes, 0));
  });
});
