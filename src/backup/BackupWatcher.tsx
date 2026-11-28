// Runs while the app is unlocked: writes the automatic folder backup when one is due (checked now,
// every few minutes, and when the page is hidden), and shows a gentle banner when a backup is
// overdue or the folder needs permission again.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { href } from '../ui/route';
import { messageOf } from '../ui/useLoad';
import { ago, backUpNow, preferredDelivery, useBackupState } from './actions';
import type { BackupStore } from './backup';
import { allowFolderAgain, autoBackupDue, folderAllowed, reminderDue } from './folder';
import './backup.css';

const CHECK_EVERY_MS = 5 * 60 * 1000;

export function BackupWatcher({ store }: { store: BackupStore }) {
  const { state } = useBackupState();
  const [latest, setLatest] = useState(0);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const running = useRef(false);

  // Check now, every few minutes and when the page is hidden (the user leaving after studying)
  useEffect(() => {
    if (!state) return;
    let live = true;
    const check = async () => {
      if (running.current || store.status() !== 'unlocked') return;
      running.current = true;
      try {
        const newest = await store.latestChange();
        if (live) setLatest(newest);
        const folder = state.folder;
        if (!folder) return;
        const ok = await folderAllowed(folder);
        if (live) setAllowed(ok);
        if (ok && autoBackupDue({ now: new Date(), lastAt: state.last?.at ?? null, lastUpTo: state.last?.upTo ?? 0, latest: newest })) {
          await backUpNow(store, 'folder', folder);
        }
      } catch (err) {
        if (live) setProblem(`Automatic backup failed: ${messageOf(err)}`);
      } finally {
        running.current = false;
      }
    };
    void check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onHide = () => document.visibilityState === 'hidden' && void check();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [state, store]);

  if (!state || dismissed) return null;

  if (problem) {
    return (
      <Banner onDismiss={() => setDismissed(true)} message={problem} />
    );
  }

  if (state.folder && allowed === false) {
    return (
      <Banner onDismiss={() => setDismissed(true)} message={`Automatic backups are paused: the browser needs your permission for “${state.folder.name}” again.`}>
        <button type="button" className="primary" onClick={async () => setAllowed(await allowFolderAgain(state.folder!))}>
          Allow
        </button>
      </Banner>
    );
  }

  const due =
    !state.folder &&
    reminderDue({ now: new Date(), lastAt: state.last?.at ?? null, since: state.since, lastUpTo: state.last?.upTo ?? 0, latest });
  if (!due) return null;

  return (
    <Banner
      onDismiss={() => setDismissed(true)}
      message={state.last ? `Your last backup was ${ago(state.last.at, new Date())}.` : 'You haven’t made a backup yet.'}
    >
      <button
        type="button"
        className="primary"
        onClick={() =>
          backUpNow(store, preferredDelivery()).then(
            () => setDismissed(true),
            (err: unknown) => setProblem(messageOf(err)),
          )
        }
      >
        Back up now
      </button>
      <a className="button" href={href({ name: 'settings' })}>
        Settings
      </a>
    </Banner>
  );
}

/**
 * The message, then its actions kept together on the right: the main one filled, the others outlined pills like
 * every other button, Not now last (#182: they were a pill, plain text and an underlined link side by side).
 */
function Banner({ message, children, onDismiss }: { message: string; children?: ReactNode; onDismiss: () => void }) {
  return (
    <div className="banner" role="status" data-testid="backup-banner">
      <span className="banner-text">{message}</span>
      <div className="banner-actions">
        {children}
        <button type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
