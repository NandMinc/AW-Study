// The Quiz button of a section whose questions are still being written in the background (#177): it looks greyed
// out but still answers a tap (aria-disabled, not disabled, so screen readers say it's unavailable and the tap
// works), and says when the quiz will be ready, with a way to study the pages meanwhile.
import { useEffect, useRef, useState } from 'react';
import { writingMessage, type Writing } from '../reading/pending';

export function QuizWaitingButton({ writing, slides, studyHref }: { writing: Writing; slides: string; studyHref: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link-button quiz-waiting" aria-disabled="true" onClick={() => setOpen(true)}>
        Quiz
      </button>
      {open && <QuizWaitingDialog writing={writing} slides={slides} studyHref={studyHref} onClose={() => setOpen(false)} />}
    </>
  );
}

export function QuizWaitingDialog({ writing, slides, studyHref, onClose }: { writing: Writing; slides: string; studyHref: string; onClose: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const { title, body } = writingMessage(writing, slides);
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="quiz-waiting-title" aria-describedby="quiz-waiting-body" onClick={(e) => e.stopPropagation()}>
        <h2 id="quiz-waiting-title">{title}</h2>
        <p id="quiz-waiting-body">{body}</p>
        <div className="row end">
          <a className="button" href={studyHref}>
            Study the pages now
          </a>
          <button type="button" ref={okRef} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Quiz page's version (#177): the message in place of Make questions. */
export function QuizWaitingNote({ writing, slides, studyHref }: { writing: Writing; slides: string; studyHref: string }) {
  const { title, body } = writingMessage(writing, slides);
  return (
    <div className="stack" role="status" data-testid="quiz-waiting">
      <p>
        <strong>{title}</strong>
      </p>
      <p className="muted">{body}</p>
      <p>
        <a href={studyHref}>Study the pages now</a>
      </p>
    </div>
  );
}
