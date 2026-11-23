// The quiz side of StudyStore (#40): each section's question bank, and the quizzes taken on it. Built
// on the store's own helpers like lectures.ts, so the same rules hold: sealed per docs/SECURITY.md
// once set up, refused while locked, writes inside `exclusive()`, every write in the change log.
// Attempts are only ever added: deleting a lecture or class (lectures.ts) is the only way they go.
import type { Exam, Section } from '../types/lecture';
import type { ChoiceQuestion, Level, OptionIndex, Question, QuestionInput, QuizAttempt, QuizStore, ShortAnswer, ShortQuestion, WrittenAnswer } from '../types/quiz';
import { writeRows, type StoreContext } from './lectures';
import { StoreError } from './store';

export const QUESTION_MAX = 1_000;
export const OPTION_MAX = 500;
export const EXPLANATION_MAX = 2_000;
export const QUESTIONS_PER_CALL = 100;
export const QUESTIONS_PER_SECTION = 500;
const ANSWERS_MAX = 500;
export const WRITTEN_MAX = 20;
export const POINTS_MAX = 6;
export const POINT_MAX = 500;
export const WRITTEN_ANSWER_MAX = 4_000;
export const FEEDBACK_MAX = 400;
export const SHORT_POINTS_MAX = 3;
export const SHORT_TYPED_MAX = 1_000;
const SHORT_MAX = 50;
const DAY_MS = 86_400_000;

const invalid = (message: string) => new StoreError('invalid', message);

/** How two questions are compared for repeats: case, spacing and end punctuation don't count. */
export function questionKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[\s?.!:]+$/, '').trim();
}

const isLevel = (v: unknown): v is Level => v === 1 || v === 2 || v === 3;
const isOption = (v: unknown): v is OptionIndex => v === 0 || v === 1 || v === 2 || v === 3;
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

function text(value: unknown, max: number, what: string, { empty = false } = {}): string {
  if (typeof value !== 'string') throw invalid(`${what} is missing.`);
  const clean = value.trim();
  if (!clean && !empty) throw invalid(`${what} can’t be empty.`);
  if (clean.length > max) throw invalid(`${what} can be at most ${max.toLocaleString('en')} characters.`);
  return clean;
}

/** A question as stored before #120 had no form or level: it's multiple choice at level 2. */
export function withDefaults(q: Question): Question {
  const old = q as Question & { form?: string; level?: unknown };
  if (old.form === 'short') return q;
  return { ...q, form: 'choice', level: isLevel(old.level) ? old.level : 2 } as ChoiceQuestion;
}

type Made<Q> = Omit<Q, 'id' | 'courseId' | 'sectionId' | 'deckId' | 'createdAt'>;

/** A question from the AI, checked and cleaned for this section (throws 'invalid' with a reason). */
function checkQuestion(q: QuestionInput, section: Section, n: number): Made<ChoiceQuestion> | Made<ShortQuestion> {
  const which = `Question ${n}`;
  if (typeof q !== 'object' || q === null) throw invalid(`${which} is missing.`);
  if (!Number.isInteger(q.page) || q.page < section.firstPage || q.page > section.lastPage) {
    throw invalid(`${which} names slide ${String(q.page)}, outside slides ${section.firstPage}–${section.lastPage}.`);
  }
  const question = text(q.question, QUESTION_MAX, `${which}’s text`);
  const explanation = text(q.explanation ?? '', EXPLANATION_MAX, `${which}’s explanation`, { empty: true });
  if (q.form === 'short') {
    if (q.level !== undefined && q.level !== 3) throw invalid(`${which} is a short answer, so it must be level 3.`);
    if (!Array.isArray(q.points) || q.points.length < 1 || q.points.length > SHORT_POINTS_MAX) {
      throw invalid(`${which} needs 1 to ${SHORT_POINTS_MAX} points a full answer makes.`);
    }
    const points = q.points.map((p, i) => text(p, POINT_MAX, `${which}’s point ${i + 1}`));
    return { form: 'short', level: 3, page: q.page, question, points, explanation };
  }
  if (q.form !== undefined && q.form !== 'choice') throw invalid(`${which} must be multiple choice or a short answer.`);
  if (q.level !== undefined && !isLevel(q.level)) throw invalid(`${which}’s level must be 1, 2 or 3.`);
  if (!Array.isArray(q.options) || q.options.length !== 4) throw invalid(`${which} needs exactly four options.`);
  const options = q.options.map((o, i) => text(o, OPTION_MAX, `${which}’s option ${i + 1}`)) as ChoiceQuestion['options'];
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) throw invalid(`${which}’s four options must all be different.`);
  if (!isOption(q.answer)) throw invalid(`${which}’s answer must be one of its four options.`);
  return { form: 'choice', level: q.level ?? 2, page: q.page, question, options, answer: q.answer, explanation };
}

/** A short answer from exam practice, checked and cleaned for this section (throws 'invalid' with a reason). */
function checkWritten(w: WrittenAnswer, section: Section, n: number): WrittenAnswer {
  const which = `Short answer ${n}`;
  if (typeof w !== 'object' || w === null) throw invalid(`${which} is missing.`);
  if (!Number.isInteger(w.page) || w.page < section.firstPage || w.page > section.lastPage) {
    throw invalid(`${which} names slide ${String(w.page)}, outside slides ${section.firstPage}–${section.lastPage}.`);
  }
  const question = text(w.question, QUESTION_MAX, `${which}’s question`);
  if (!Array.isArray(w.points) || w.points.length < 1 || w.points.length > POINTS_MAX) {
    throw invalid(`${which} needs 1 to ${POINTS_MAX} points a full answer makes.`);
  }
  const points = w.points.map((p, i) => text(p, POINT_MAX, `${which}’s point ${i + 1}`));
  const answer = text(w.answer, WRITTEN_ANSWER_MAX, `${which}’s answer`, { empty: true });
  if (!Number.isInteger(w.mark) || w.mark < 0 || w.mark > points.length) {
    throw invalid(`${which}’s mark must be a whole number from 0 to ${points.length}.`);
  }
  const feedback = text(w.feedback ?? '', FEEDBACK_MAX, `${which}’s feedback`, { empty: true });
  const ms = Number.isFinite(w.ms) && w.ms >= 0 ? Math.min(Math.round(w.ms), DAY_MS) : 0;
  return { question, points, page: w.page, answer, mark: w.mark, feedback, ms };
}

export function quizMethods(ctx: StoreContext): QuizStore {
  const { db, open, openAll, seal, change, exclusive, requireOpen } = ctx;
  const iso = () => ctx.clock().toISOString();

  const getSection = async (id: string): Promise<Section> => {
    const row = await db.get('sections', id);
    if (!row) throw new StoreError('not-found', 'That part of the lecture no longer exists.');
    return open<Section>('sections', row);
  };

  const bank = async (sectionId: string) =>
    (await openAll<Question>('questions', await db.getAllFromIndex('questions', 'bySection', sectionId))).map(withDefaults);
  const oldestFirst = (a: Question, b: Question) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

  return {
    async listQuestions(sectionId) {
      requireOpen();
      return (await bank(sectionId)).sort(oldestFirst);
    },

    addQuestions: (sectionId, inputs) =>
      exclusive(async () => {
        requireOpen();
        const section = await getSection(sectionId);
        if (!Array.isArray(inputs) || inputs.length === 0) throw invalid('No questions to add.');
        if (inputs.length > QUESTIONS_PER_CALL) throw invalid(`At most ${QUESTIONS_PER_CALL} questions at a time.`);
        const existing = await bank(sectionId);
        if (existing.length + inputs.length > QUESTIONS_PER_SECTION) {
          throw invalid(`A section’s bank holds at most ${QUESTIONS_PER_SECTION} questions.`);
        }
        const seen = new Set(existing.map((q) => questionKey(q.question)));
        // A millisecond apart, so a batch lists in the order it was made (oldest first)
        const start = ctx.clock().getTime();
        const made: Question[] = inputs.map((input, i) => {
          const q = checkQuestion(input, section, i + 1);
          const key = questionKey(q.question);
          if (seen.has(key)) throw invalid(`Question ${i + 1} is already in this section’s bank.`);
          seen.add(key);
          const createdAt = new Date(start + i).toISOString();
          return { id: ctx.newId(), courseId: section.courseId, sectionId, deckId: section.deckId, ...q, createdAt } as Question;
        });
        const [rows, logs] = await Promise.all([
          Promise.all(made.map((q) => seal('questions', { ...q }))),
          Promise.all(made.map((q) => change('question', 'put', q.id, q))),
        ]);
        await writeRows(db, rows.map((row) => ({ store: 'questions' as const, row })), [], logs);
        return made;
      }),

    deleteQuestion: (id) =>
      exclusive(async () => {
        requireOpen();
        if (!(await db.get('questions', id))) throw new StoreError('not-found', 'That question is already gone.');
        await writeRows(db, [], [{ store: 'questions', id }], [await change('question', 'delete', id, null)]);
      }),

    recordQuizAttempt: (input) =>
      exclusive(async () => {
        requireOpen();
        const section = await getSection(input?.sectionId);
        if (!isIso(input.startedAt) || !isIso(input.finishedAt) || input.finishedAt < input.startedAt) {
          throw invalid('The quiz’s start and end times aren’t valid.');
        }
        if (!Array.isArray(input.answers)) throw invalid('The quiz’s answers are missing.');
        if (input.written !== undefined && !Array.isArray(input.written)) throw invalid('The quiz’s short answers aren’t valid.');
        if (input.short !== undefined && !Array.isArray(input.short)) throw invalid('The quiz’s short answers aren’t valid.');
        const writtenIn = input.written ?? [];
        const shortIn = input.short ?? [];
        if (input.answers.length + writtenIn.length + shortIn.length === 0) throw invalid('A quiz needs at least one answer.');
        if (shortIn.length > SHORT_MAX) throw invalid(`A quiz can have at most ${SHORT_MAX} short answers.`);
        if (input.answers.length > ANSWERS_MAX) throw invalid(`A quiz can have at most ${ANSWERS_MAX} answers.`);
        if (writtenIn.length > WRITTEN_MAX) throw invalid(`A quiz can have at most ${WRITTEN_MAX} short answers.`);
        if (input.examId !== undefined) {
          const row = typeof input.examId === 'string' ? await db.get('exams', input.examId) : undefined;
          const exam = row ? await open<Exam>('exams', row) : null;
          if (!exam || exam.courseId !== section.courseId) throw invalid('That exam isn’t one of this class’s.');
        }
        const written = writtenIn.map((w, i) => checkWritten(w, section, i + 1));
        const questions = new Map((await bank(section.id)).map((q) => [q.id, q]));
        const seenIds = new Set<string>();
        const answers = input.answers.map((a, i) => {
          const q = questions.get(a?.questionId);
          if (!q) throw invalid(`Answer ${i + 1} is to a question that isn’t in this section’s bank.`);
          if (seenIds.has(q.id)) throw invalid('A question can only be answered once in a quiz.');
          seenIds.add(q.id);
          if (q.form !== 'choice') throw invalid(`Answer ${i + 1} is to a short-answer question, so it needs a typed answer.`);
          if (!isOption(a.chosen)) throw invalid(`Answer ${i + 1} must be one of the four options.`);
          const ms = Number.isFinite(a.ms) && a.ms >= 0 ? Math.min(Math.round(a.ms), DAY_MS) : 0;
          // The store marks it: the score comes from the stored answer, never from the screen
          return { questionId: q.id, chosen: a.chosen, right: a.chosen === q.answer, ms, level: q.level };
        });
        const short: ShortAnswer[] = shortIn.map((s, i) => {
          const which = `Short answer ${i + 1}`;
          const q = questions.get(s?.questionId);
          if (!q || q.form !== 'short') throw invalid(`${which} is to a question that isn’t one of this section’s short-answer questions.`);
          if (seenIds.has(q.id)) throw invalid('A question can only be answered once in a quiz.');
          seenIds.add(q.id);
          const outOf = q.points.length;
          if (!Number.isInteger(s.mark) || s.mark < 0 || s.mark > outOf) throw invalid(`${which}’s mark must be a whole number from 0 to ${outOf}.`);
          const typed = text(s.typed, SHORT_TYPED_MAX, `${which}’s answer`, { empty: true });
          const feedback = text(s.feedback ?? '', FEEDBACK_MAX, `${which}’s feedback`, { empty: true });
          const ms = Number.isFinite(s.ms) && s.ms >= 0 ? Math.min(Math.round(s.ms), DAY_MS) : 0;
          return { questionId: q.id, typed, mark: s.mark, outOf, feedback, ms, level: 3 };
        });
        // Each answer counts as one question: right or wrong, or a short or written answer's share of its points.
        // `right` isn't weighted ("7 of 10 right"); the score is weighted by level (DESIGN "Exam style and
        // question levels"), and exam practice's written answers count as level 3.
        const parts: { level: Level; got: number }[] = [
          ...answers.map((a) => ({ level: a.level, got: a.right ? 1 : 0 })),
          ...short.map((s) => ({ level: s.level, got: s.mark / s.outOf })),
          ...written.map((w) => ({ level: 3 as const, got: w.mark / w.points.length })),
        ];
        const right = Math.round(parts.reduce((sum, p) => sum + p.got, 0) * 100) / 100;
        const asked = parts.length;
        const weight = parts.reduce((sum, p) => sum + p.level, 0);
        const score = parts.reduce((sum, p) => sum + p.level * p.got, 0) / weight;
        const attempt: QuizAttempt = {
          id: ctx.newId(),
          courseId: section.courseId,
          sectionId: section.id,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          answers,
          ...(input.examId !== undefined && { examId: input.examId }),
          ...(input.written !== undefined && { written }),
          ...(short.length > 0 && { short }),
          right,
          asked,
          score,
          createdAt: iso(),
        };
        const [row, log] = await Promise.all([seal('quizAttempts', { ...attempt }), change('quizAttempt', 'put', attempt.id, attempt)]);
        await writeRows(db, [{ store: 'quizAttempts', row }], [], [log]);
        return attempt;
      }),

    async listQuizAttempts(sectionId) {
      requireOpen();
      const rows = sectionId ? await db.getAllFromIndex('quizAttempts', 'bySection', sectionId) : await db.getAll('quizAttempts');
      return (await openAll<QuizAttempt>('quizAttempts', rows)).sort(
        (a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
    },
  };
}
