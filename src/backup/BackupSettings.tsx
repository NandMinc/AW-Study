// The backups and storage part of Settings: download or share a backup, automatic backups to a
// folder (Chrome and Edge on a computer), restore, and whether the browser keeps the data.
import { useEffect, useState } from 'react';
import { APP_NAME } from '../brand';
import { messageOf } from '../ui/useLoad';
import { ago, backUpNow, canShareBackup, notifyBackupChanged, useBackupState } from './actions';
import type { BackupStore } from './backup';
import { allowFolderAgain, canUseFolder, folderAllowed, KEEP_BACKUPS, pickFolder } from './folder';
import { askToPersist, formatBytes, isStandalone, shouldSuggestHomeScreen, storageState, type StorageState } from './persist';
import { RestoreBackup } from './RestoreBackup';
import { saveFolder } from './state';
import './backup.css';

export function BackupSettings({
  store,
  onRestored,
  initialStorage,
}: {
  store: BackupStore;
  onRestored: () => void;
  initialStorage?: StorageState;
}) {
  const { state } = useBackupState();
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const folder = state?.folder ?? null;
  const share = canShareBackup();
  const folders = canUseFolder();

  useEffect(() => {
    let live = true;
    if (folder) folderAllowed(folder).then((yes) => live && setAllowed(yes));
    return () => {
      live = false;
    };
  }, [folder]);

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setDone(null);
    setProblem(null);
    try {
      const message = await action();
      if (message) setDone(message);
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = () =>
    run(async () => {
      const picked = await pickFolder();
      if (!picked) return null;
      await saveFolder(picked);
      await backUpNow(store, 'folder', picked);
      setAllowed(true);
      return `Backed up to “${picked.name}”. From now on, a new backup goes there after you study (at most once an hour).`;
    });

  const allowAgain = () =>
    run(async () => {
      if (!folder || !(await allowFolderAgain(folder))) return null;
      setAllowed(true);
      notifyBackupChanged();
      return 'Automatic backups are on again.';
    });

  const stopFolder = () =>
    run(async () => {
      await saveFolder(null);
      notifyBackupChanged();
      return 'Automatic backups stopped. The backups already in the folder stay there.';
    });

  return (
    <div className="stack backups">
      <h3>Backups</h3>
      <p className="muted small">
        A backup is encrypted like everything here: it opens only with your passphrase, a passkey or your recovery key,
        so it’s safe in OneDrive, iCloud Drive or Google Drive. Use one to move {APP_NAME} to a new device.
      </p>
      <p data-testid="last-backup">
        {state === null ? 'Checking…' : state.last ? `Last backup: ${ago(state.last.at, new Date())}.` : 'No backup yet.'}
      </p>
      <div className="row">
        <button type="button" onClick={() => run(async () => ((await backUpNow(store, 'download')) ? 'Backup downloaded.' : null))} disabled={busy}>
          Download a backup
        </button>
        {share && (
          <button type="button" onClick={() => run(async () => ((await backUpNow(store, 'share')) ? 'Backup shared.' : null))} disabled={busy}>
            Share a backup
          </button>
        )}
      </div>

      {folders && !folder && (
        <div className="stack">
          <p className="small">Back up automatically to a folder on this computer, such as one that syncs to OneDrive.</p>
          <button type="button" onClick={chooseFolder} disabled={busy}>
            Choose a folder for automatic backups
          </button>
        </div>
      )}
      {folders && folder && (
        <div className="stack">
          <p className="small">
            Automatic backups go to the folder “{folder.name}”. The newest {KEEP_BACKUPS} are kept.
          </p>
          {allowed === false && (
            <p className="warning small">The browser needs your permission again before it can write there.</p>
          )}
          <div className="row">
            {allowed === false ? (
              <button type="button" className="primary" onClick={allowAgain} disabled={busy}>
                Allow again
              </button>
            ) : (
              <button type="button" onClick={() => run(async () => ((await backUpNow(store, 'folder', folder)) ? `Backed up to “${folder.name}”.` : null))} disabled={busy}>
                Back up now
              </button>
            )}
            <button type="button" onClick={stopFolder} disabled={busy}>
              Stop automatic backups
            </button>
          </div>
        </div>
      )}

      {!restoring ? (
        <button type="button" onClick={() => setRestoring(true)} disabled={busy}>
          Restore from a backup…
        </button>
      ) : (
        <RestoreBackup
          store={store}
          replacing
          onCancel={() => setRestoring(false)}
          onRestored={() => {
            setRestoring(false);
            setDone('Backup restored.');
            onRestored();
          }}
        />
      )}

      {done && (
        <p className="done" role="status">
          {done}
        </p>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}

      <StorageSection initial={initialStorage} />
    </div>
  );
}

function StorageSection({ initial }: { initial?: StorageState }) {
  const [state, setState] = useState<StorageState | null>(initial ?? null);
  const [asking, setAsking] = useState(false);
  const refresh = () => storageState().then(setState, () => {});
  useEffect(() => {
    void refresh();
  }, []);

  const ask = async () => {
    setAsking(true);
    await askToPersist();
    await refresh();
    setAsking(false);
  };

  return (
    <div className="stack">
      <h3>Storage</h3>
      <p data-testid="storage-state">
        {state === null || state.persisted === null
          ? 'This browser doesn’t say whether it keeps the data.'
          : state.persisted
            ? 'Kept permanently: the browser won’t clear it to make space.'
            : 'The browser may clear this data if the device runs low on space.'}
        {state?.usage != null && <span className="muted small"> Using {formatBytes(state.usage)}.</span>}
      </p>
      {state?.persisted === false && (
        <button type="button" onClick={ask} disabled={asking}>
          Ask the browser to keep it
        </button>
      )}
      {shouldSuggestHomeScreen(navigator.userAgent, isStandalone()) && (
        <p className="muted small">
          On an iPhone or iPad, add {APP_NAME} to your Home Screen (Share, then Add to Home Screen) and open it from there:
          Safari is much less likely to clear its data.
        </p>
      )}
    </div>
  );
}
