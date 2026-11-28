// Settings' Sync (#105): turn sync on for this device, see when it last synced, sync now, turn it off. Turning
// it on when the account already has data made under another key asks before replacing this device's data.
import { useState } from 'react';
import { APP_NAME } from '../brand';
import type { SyncState } from '../db/sync';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useVault } from '../ui/lock-parts';
import { useStore } from '../ui/store-context';
import { useLoad } from '../ui/useLoad';
import { accountStatus } from './client';
import { joinWithKey, startSync, stopSync, syncOnce, type AccountKeyring } from './engine';
import { JoinUnlock } from './JoinUnlock';

export function SyncSettings({ onReplaced, initial }: { onReplaced: () => void; initial?: { value: SyncState | null } }) {
  const store = useStore();
  const vault = useVault();
  const { data: state, reload } = useLoad(() => store.getSyncState(), [store], initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [replacing, setReplacing] = useState<{ account: AccountKeyring; email: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      const done = await work();
      if (done) setMessage({ text: done, error: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const turnOn = () =>
    run(async () => {
      const account = await accountStatus();
      if (!account.signedIn) throw new Error('Sign in with Google first (Account, above).');
      const result = await startSync(store, account.email);
      if (result.started) return 'Sync is on. This device’s classes, lectures, quizzes and notes now sync with your account.';
      setReplacing({ account: result.account, email: account.email });
      return null;
    });

  return (
    <>
      <h3 id="sync-title">Sync</h3>
      <div className="stack" role="group" aria-labelledby="sync-title">
        {state ? (
          <>
            <p data-testid="sync-state">
              Syncing with {state.email}.{' '}
              {state.lastSyncAt ? `Last synced ${new Date(state.lastSyncAt).toLocaleString()}.` : 'Not synced yet.'}
            </p>
            {state.lastError && (
              <p className="error" data-testid="sync-error">
                {state.lastError}
              </p>
            )}
            <p className="muted small">Classes, lectures, quizzes, notes and settings sync. Slide PDFs stay on the device they were added on for now.</p>
            <div className="row">
              <button type="button" onClick={() => void run(async () => (await syncOnce(store), 'Synced.'))} disabled={busy}>
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              <button type="button" onClick={() => setConfirmOff(true)} disabled={busy}>
                Turn off sync on this device
              </button>
            </div>
          </>
        ) : (
          state === null &&
          !replacing && (
            <>
              <p className="small">
                Keep your classes, lectures, quizzes and notes the same on all your devices. They’re encrypted before they leave this device: the
                server can’t read them{' '}
                <span className="muted">(unless you’ve turned on Google unlock)</span>.
              </p>
              <div className="row">
                <button type="button" onClick={() => void turnOn()} disabled={busy}>
                  {busy ? 'Turning on…' : 'Turn on sync'}
                </button>
              </div>
            </>
          )
        )}
        {replacing && (
          <div className="stack" data-testid="sync-replace">
            <p>
              <strong>Your account already has {APP_NAME} data from another device.</strong> This device’s own data was set up separately, so to
              sync, it’s replaced with your account’s: what’s only on this device will be gone. Download a backup first if you need it.
            </p>
            <JoinUnlock
              keyring={replacing.account.keyring}
              confirmLabel="Replace this device’s data"
              onOpened={async ({ key, remembered }) => {
                await joinWithKey(store, replacing.email, replacing.account, key);
                if (remembered) await vault.remember(remembered);
                setReplacing(null);
                setMessage({ text: 'This device now has your account’s data and syncs with it.', error: false });
                await reload();
                onReplaced();
              }}
            />
            <div className="row">
              <button type="button" onClick={() => setReplacing(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {message && (
          <p className={message.error ? 'error' : 'done'} role="status" data-testid="sync-message">
            {message.text}
          </p>
        )}
      </div>
      {confirmOff && (
        <ConfirmDialog
          title="Turn off sync on this device?"
          message="Your data stays on this device, but changes here won’t reach your other devices, or theirs this one."
          confirmLabel="Turn off sync"
          onCancel={() => setConfirmOff(false)}
          onConfirm={() => {
            setConfirmOff(false);
            void run(async () => (await stopSync(store), 'Sync is off on this device.'));
          }}
        />
      )}
    </>
  );
}
