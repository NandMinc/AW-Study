// A class's three-dots menu on the Classes page (docs/design "Classes"): the parts of its page (what
// lectures covered, the class details, exams, the uploaded files, the exam style, #122) and deleting the class. A small
// list under the button: Escape, a tap outside, or picking an item closes it.
import { useEffect, useId, useRef, useState } from 'react';
import { href, type ClassPart } from './route';

const ITEMS: { part: ClassPart; label: string }[] = [
  { part: 'lectures', label: 'What lectures covered' },
  { part: 'details', label: 'Class details' },
  { part: 'exams', label: 'Exams' },
  { part: 'files', label: 'Files' },
  { part: 'style', label: 'Exam style' },
];

export function ClassMenu({ courseId, name, onDelete }: { courseId: string; name: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="class-menu" ref={box}>
      <button
        ref={button}
        type="button"
        className="dots"
        aria-label={`Menu for ${name}`}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <g fill="currentColor">
            <circle cx="5" cy="12" r="2.4" />
            <circle cx="12" cy="12" r="2.4" />
            <circle cx="19" cy="12" r="2.4" />
          </g>
        </svg>
      </button>
      {open && (
        <ul className="class-menu-list" id={listId} aria-label={`${name} menu`}>
          {ITEMS.map(({ part, label }) => (
            <li key={part}>
              <a href={href({ name: 'class', courseId, part })} onClick={() => setOpen(false)}>
                {label}
              </a>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="danger-text"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete class
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
