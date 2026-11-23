// Compare models (Nathan's request, Nov 18): the same slides sent to Haiku, Sonnet and Opus, one after
// another (the helper runs one request per person at a time), their questions side by side with how
// long each took. Nothing is saved unless you add one model's questions to the bank.
import { useRef, useState } from 'react';
import { AI_MODELS, AiError, type AiModel, type McQuestion } from '../ai/backend';
import { questionKey } from '../db/quiz';
import { planBank, sectionSlides } from '../quiz/bank';
import type { Question } from '../types/quiz';
import { useAi } from './ai-context';
import { slidesLabel } from './classes';
import { MathText } from './MathText';
import type { Setting } from './QuizScreen';
import { useStore } from './store-context';
import { messageOf } from './useLoad';

/** Questions each model writes in a comparison: enough to judge, few enough to be quick. */
export const COMPARE_COUNT = 5;
const LETTERS = ['A', 'B', 'C', 'D'];

type Result = { state: 'waiting' } | { state: 'running' } | { state: 'done'; questions: McQuestion[]; ms: number; added?: number } | { state: 'failed'; message: string };

export function CompareModels({ setting, bank, onAdded, onClose }: { setting: Setting; bank: Question[]; onAdded: () => void; onClose: () => void }) {
  const ai = useAi();
  const store = useStore();
  // The section's first few slides with text: the same for every model
  const pages = planBank(sectionSlides(setting.section, setting.pageTexts), [])[0]?.pages ?? [];
  const [results, setResults] = useState<Partial<Record<AiModel, Result>>>({});
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    setRunning(true);
    abort.current = new AbortController();
    setResults(Object.fromEntries(AI_MODELS.map((m) => [m.id, { state: 'waiting' }])));
    for (const model of AI_MODELS) {
      setResults((r) => ({ ...r, [model.id]: { state: 'running' } }));
      const started = performance.now();
      try {
        // No mix asked for, so all multiple choice (#121); kept so for the side-by-side view
        const made = await ai.makeQuestions({ pages, count: COMPARE_COUNT, model: model.id }, abort.current.signal);
        const questions = made.filter((q): q is McQuestion => q.form === 'choice');
        setResults((r) => ({ ...r, [model.id]: { state: 'done', questions, ms: performance.now() - started } }));
      } catch (err) {
        if (err instanceof AiError && err.code === 'cancelled') break;
        setResults((r) => ({ ...r, [model.id]: { state: 'failed', message: messageOf(err) } }));
      }
    }
    abort.current = null;
    setRunning(false);
  };

  const add = async (model: AiModel) => {
    const result = results[model];
    if (result?.state !== 'done') return;
    const seen = new Set(bank.map((q) => questionKey(q.question)));
    const fresh = result.questions.filter((q) => !seen.has(questionKey(q.question)));
    try {
      if (fresh.length > 0) await store.addQuestions(setting.section.id, fresh);
      setResults((r) => ({ ...r, [model]: { ...result, added: fresh.length } }));
      onAdded();
    } catch (err) {
      setResults((r) => ({ ...r, [model]: { state: 'failed', message: messageOf(err) } }));
    }
  };

  return (
    <section className="compare stack" aria-label="Compare models">
      <h3 className="form-title">Compare models</h3>
      {pages.length === 0 ? (
        <p className="muted">These slides have no text to make questions from.</p>
      ) : (
        <p className="muted small">
          Each model writes {COMPARE_COUNT} questions from {slidesLabel(pages[0]!.page, pages.at(-1)!.page)}, one after another. That’s{' '}
          {AI_MODELS.length} AI requests. Nothing is saved unless you add a model’s questions to the bank.
        </p>
      )}
      <div className="row">
        {running ? (
          <button type="button" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => void run()} disabled={pages.length === 0}>
            {Object.keys(results).length ? 'Compare again' : 'Compare Haiku, Sonnet and Opus'}
          </button>
        )}
        <button type="button" onClick={onClose} disabled={running}>
          Close
        </button>
      </div>
      <div className="compare-grid">
        {AI_MODELS.map((model) => {
          const result = results[model.id];
          if (!result) return null;
          return (
            <article key={model.id} className="compare-model" data-testid={`compare-${model.name.toLowerCase()}`}>
              <h4>
                {model.name}{' '}
                <span className="muted small" data-testid="compare-status">
                  {result.state === 'waiting' && 'waiting'}
                  {result.state === 'running' && 'writing…'}
                  {result.state === 'done' && `${result.questions.length} question${result.questions.length === 1 ? '' : 's'} in ${(result.ms / 1_000).toFixed(1)} s`}
                  {result.state === 'failed' && 'failed'}
                </span>
              </h4>
              {result.state === 'failed' && (
                <p className="error" role="alert">
                  {result.message}
                </p>
              )}
              {result.state === 'done' && (
                <>
                  <ol className="compare-questions">
                    {result.questions.map((q, i) => (
                      <li key={i}>
                        <p className="small">
                          <strong>
                            <MathText text={q.question} />
                          </strong> <span className="muted">(slide {q.page})</span>
                        </p>
                        <ul className="compare-options small">
                          {q.options.map((o, j) => (
                            <li key={j} className={j === q.answer ? 'right' : ''}>
                              {LETTERS[j]}. <MathText text={o} />
                              {j === q.answer && ' ✓'}
                            </li>
                          ))}
                        </ul>
                        {q.explanation && (
                          <p className="muted small">
                            <MathText text={q.explanation} />
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                  {result.added === undefined ? (
                    <button type="button" onClick={() => void add(model.id)} disabled={running}>
                      Add {model.name}’s questions to the bank
                    </button>
                  ) : (
                    <p className="muted small" role="status">
                      {result.added === 0 ? 'Already in the bank.' : `Added ${result.added} to the bank.`}
                    </p>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
