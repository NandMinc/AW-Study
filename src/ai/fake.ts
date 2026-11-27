// A stand-in AiBackend for tests and for building screens: answers instantly from the slide text,
// sends nothing anywhere, costs nothing. It records every request, and can be told to fail.
import type { Level } from '../types/quiz';
import type { StyleGuideContent } from '../types/style';
import {
  AiError,
  type AiBackend,
  type AiErrorCode,
  type AiStatus,
  type AskRequest,
  type ExplainRequest,
  type GradeManyRequest,
  type GradeRequest,
  type MadeQuestion,
  type MakeQuestionsRequest,
  type PageReadingResult,
  type ReadPageRequest,
  type StyleRequest,
  type WrittenQuestion,
  type WrittenRequest,
} from './backend';

export type FakeCall =
  | { job: 'status' }
  | { job: 'makeQuestions'; request: MakeQuestionsRequest }
  | { job: 'makeWrittenQuestions'; request: WrittenRequest }
  | { job: 'gradeAnswer'; request: GradeRequest }
  | { job: 'gradeMany'; request: GradeManyRequest }
  | { job: 'makeStyleGuide'; request: StyleRequest }
  | { job: 'explain'; request: ExplainRequest }
  | { job: 'ask'; request: AskRequest }
  | { job: 'readPage'; request: ReadPageRequest };

export class FakeAiBackend implements AiBackend {
  readonly calls: FakeCall[] = [];
  /** Set to make the next calls fail with this error code. */
  failWith: AiErrorCode | null = null;

  async status(): Promise<AiStatus> {
    this.record({ job: 'status' });
    return { email: 'student@example.com', usedToday: this.calls.filter((c) => c.job !== 'status').length, dailyLimit: 200 };
  }

  /** `count` questions over the slides with text: with a `mix`, its levels and short answers in that order; without, level 2. */
  async makeQuestions(request: MakeQuestionsRequest): Promise<MadeQuestion[]> {
    this.record({ job: 'makeQuestions', request });
    const pages = request.pages.filter((p) => p.text.trim() !== '');
    if (pages.length === 0) throw new AiError('unavailable', 'Nothing to ask about.');
    const kinds: (Level | 'short')[] = request.mix
      ? [...request.mix.choice.flatMap((n, i) => Array<Level>(n).fill((i + 1) as Level)), ...Array<'short'>(request.mix.short).fill('short')]
      : Array<Level>(request.count).fill(2);
    return kinds.map((kind, i): MadeQuestion => {
      const page = pages[i % pages.length]!;
      const fact = firstWords(page.text);
      if (kind === 'short') {
        return { form: 'short', level: 3, question: `Question ${i + 1}: explain slide ${page.page} in a sentence.`, points: [fact.toLowerCase()], page: page.page, explanation: `It says “${fact}”.` };
      }
      return {
        form: 'choice',
        level: kind,
        question: `Question ${i + 1}: which is on slide ${page.page}?`,
        options: [fact, `Not ${fact}`, `Neither (${i + 1})`, `Both (${i + 1})`],
        answer: 0,
        page: page.page,
        explanation: `Slide ${page.page} says “${fact}”.`,
      };
    });
  }

  async makeWrittenQuestions(request: WrittenRequest): Promise<WrittenQuestion[]> {
    this.record({ job: 'makeWrittenQuestions', request });
    const pages = request.pages.filter((p) => p.text.trim() !== '');
    if (pages.length === 0) throw new AiError('unavailable', 'Nothing to ask about.');
    return Array.from({ length: request.count }, (_, i) => {
      const page = pages[i % pages.length]!;
      const fact = firstWords(page.text);
      return { question: `Explain what slide ${page.page} says (${i + 1}).`, points: [fact.toLowerCase()], page: page.page };
    });
  }

  async gradeAnswer(request: GradeRequest) {
    this.record({ job: 'gradeAnswer', request });
    const answer = request.answer.toLowerCase();
    const mark = request.points.filter((p) => answer.includes(p.toLowerCase())).length;
    return { mark, outOf: request.points.length, feedback: mark === request.points.length ? 'All there.' : 'Some points are missing.' };
  }

  /** Like gradeAnswer, one per item: a point is made when the answer contains it. */
  async gradeMany(request: GradeManyRequest) {
    this.record({ job: 'gradeMany', request });
    return request.items.map((item) => {
      const answer = item.answer.toLowerCase();
      const mark = item.points.filter((p) => answer.includes(p.toLowerCase())).length;
      return { mark, outOf: item.points.length, feedback: mark === item.points.length ? 'All there.' : 'Some points are missing.' };
    });
  }

  async makeStyleGuide(request: StyleRequest): Promise<StyleGuideContent> {
    this.record({ job: 'makeStyleGuide', request });
    const pastExams = request.materials.filter((m) => m.kind === 'past-exam').length;
    return {
      tests: `${request.className}'s exam, from ${pastExams} past exam${pastExams === 1 ? '' : 's'} and ${request.lectures.length} lecture${request.lectures.length === 1 ? '' : 's'}.`,
      levels: ['Recall a term.', 'Apply an idea.', 'Explain why.'],
      shortShare: 0.3,
    };
  }

  async explain(request: ExplainRequest) {
    this.record({ job: 'explain', request });
    return `An explanation of “${request.selection}”.`;
  }

  async ask(request: AskRequest) {
    this.record({ job: 'ask', request });
    return `An answer to “${request.question}”.`;
  }

  async readPage(request: ReadPageRequest): Promise<PageReadingResult> {
    this.record({ job: 'readPage', request });
    return { model: 'claude-haiku-5-5', reading: { pictureText: 'Words from the picture.', figures: [{ label: 'Figure 1', description: 'A fake figure.' }], kinds: ['diagram'], decorativeOnly: false } };
  }

  private record(call: FakeCall) {
    this.calls.push(call);
    if (this.failWith) throw new AiError(this.failWith, `Fake failure: ${this.failWith}.`);
  }
}

function firstWords(text: string): string {
  return text.trim().split(/\s+/).slice(0, 6).join(' ');
}
