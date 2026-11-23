// Settings: the colours (Phone, Light or Dark: a setting for this device, src/ui/theme.ts), how you unlock (change or add the passphrase, add or remove passkeys, a new recovery
// key) and Lock now. Every change that adds a way in asks you to prove it's you first. Removing a
// passkey only asks "are you sure", and the store refuses to remove your last way in.
// Backups and storage (#18) are their own section, src/backup/BackupSettings.tsx; AI sign-in and
// Compare models are src/ui/AiSettings.tsx (#79).
import { useState, type FormEvent } from 'react';
import { BackupSettings } from '../backup/BackupSettings';
import { AccountSettings } from '../sync/AccountSettings';
import { GoogleUnlockSettings } from '../sync/GoogleUnlockSettings';
import { SyncSettings } from '../sync/SyncSettings';
import { AiSettings } from './AiSettings';
import { ThisDevice } from './ThisDevice';
import { href } from './route';
import { APP_NAME } from '../brand';
import { DAILY_MINUTES_MAX, DAILY_MINUTES_MIN } from '../db/plan';
import { newRecoveryKey, wrapWithPasskey, wrapWithPassphrase, wrapWithRecoveryKey } from '../lib/crypto';
import { createPasskey } from '../lib/passkey';
import type { Keyring } from '../types/crypto';
import { ConfirmDialog } from './ConfirmDialog';
import { hasPassphrase, passkeyEntries, passphraseProblem, unlockMessage } from './keys';
import {
  guessDeviceLabel,
  NewPassphraseFields,
  ProveItsYou,
  RecoveryKeySheet,
  usePrfSupported,
  useVault,
} from './lock-parts';
import { useStore } from './store-context';
import { savedTheme, saveTheme, THEME_LABELS, THEMES, type Theme } from './theme';
import { messageOf, useLoad } from './useLoad';

type Task = 'passphrase' | 'passkey' | 'recovery';

const WHY: Record<Task, string> = {
  passphrase: 'Changing how you unlock needs your current passphrase, a passkey or your recovery key.',
  passkey: 'Adding a passkey needs your current passphrase, a passkey or your recovery key.',
  recovery: 'Making a new recovery key needs your current passphrase, a passkey or your recovery key.',
};

export function SettingsScreen({ onLock, onReplaced = () => {} }: { onLock: () => void; onReplaced?: () => void }) {
  const vault = useVault();
  const store = useStore();
  const prf = usePrfSupported();
  const { data: keyring, error, reload } = useLoad(() => vault.getKeyring(), [vault]);
  const [task, setTask] = useState<Task | null>(null);
  const [changeKey, setChangeKey] = useState<CryptoKey | null>(null);
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const start = (next: Task) => {
    setTask(next);
    setChangeKey(null);
    setDone(null);
    setProblem(null);
  };
  const finish = async (message: string) => {
    setTask(null);
    setChangeKey(null); // the extractable key is dropped as soon as the change is made
    setDone(message);
    await reload();
  };
  const cancel = () => {
    setTask(null);
    setChangeKey(null);
  };

  if (error) return <p className="error">{error}</p>;
  if (!keyring) return <p className="muted">Loading…</p>;
  const passkeys = passkeyEntries(keyring);

  return (
    <section className="settings" aria-labelledby="settings-title">
      <h2 id="settings-title" className="page-title">
        Settings
      </h2>

      <ThemeSetting />

      <StudyTimeSetting />

      <h3>How you unlock</h3>
      <ul className="list" aria-label="Ways to unlock">
        <li className="setting-row">
          <span>Passphrase: {hasPassphrase(keyring) ? 'set' : 'none'}</span>
          <button type="button" onClick={() => start('passphrase')} disabled={task !== null}>
            {hasPassphrase(keyring) ? 'Change passphrase' : 'Add a passphrase'}
          </button>
        </li>
        {passkeys.map((p) => (
          <li key={p.id} className="setting-row" data-testid="passkey-row">
            <span>
              Passkey: {p.label} <span className="muted small">(added {p.createdAt.slice(0, 10)})</span>
            </span>
            <button
              type="button"
              onClick={() => setRemoving({ id: p.id, label: p.label })}
              disabled={task !== null}
              aria-label={`Remove passkey ${p.label}`}
            >
              Remove
            </button>
          </li>
        ))}
        {prf && (
          <li className="setting-row">
            <span>Passkeys: Face ID, Touch ID, Windows Hello or a security key</span>
            <button type="button" onClick={() => start('passkey')} disabled={task !== null}>
              Add a passkey
            </button>
          </li>
        )}
        <li className="setting-row">
          <span>Recovery key: set</span>
          <button type="button" onClick={() => start('recovery')} disabled={task !== null}>
            Make a new recovery key
          </button>
        </li>
      </ul>

      {task && !changeKey && <ProveItsYou keyring={keyring} why={WHY[task]} onProved={setChangeKey} onCancel={cancel} />}
      {task === 'passphrase' && changeKey && (
        <ChangePassphrase keyring={keyring} changeKey={changeKey} onDone={finish} onCancel={cancel} />
      )}
      {task === 'passkey' && changeKey && <AddPasskey changeKey={changeKey} onDone={finish} onCancel={cancel} />}
      {task === 'recovery' && changeKey && <NewRecoveryKey changeKey={changeKey} onDone={finish} />}

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

      <AiSettings />

      <AccountSettings />

      {keyring && <GoogleUnlockSettings keyring={keyring} onChanged={() => reload()} />}

      <SyncSettings
        onReplaced={() => {
          void reload();
          onReplaced();
        }}
      />

      <BackupSettings store={store} onRestored={() => void reload()} />

      <ThisDevice onLock={onLock} />

      <h3>Help</h3>
      <p>
        <a href={href({ name: 'tasks', tour: true })}>How {APP_NAME} works</a> <span className="muted small">(the short tour from the first run)</span>
      </p>

      {removing && (
        <ConfirmDialog
          title={`Remove the passkey “${removing.label}”?`}
          message={`It won’t unlock ${APP_NAME} any more. Your other ways to unlock keep working.`}
          confirmLabel="Remove passkey"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const { id, label } = removing;
            setRemoving(null);
            try {
              await vault.removeKeyringEntry(id);
              await finish(`Removed the passkey “${label}”.`);
            } catch (err) {
              // The store refuses ('invalid') to remove the last way in (#16)
              setProblem(isInvalid(err) ? LAST_WAY_IN : messageOf(err));
            }
          }}
        />
      )}
    </section>
  );
}

const LAST_WAY_IN = 'Keep at least one passphrase or passkey: without one you couldn’t unlock. Add another first.';

function isInvalid(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'invalid';
}

function ChangePassphrase({
  keyring,
  changeKey,
  onDone,
  onCancel,
}: {
  keyring: Keyring;
  changeKey: CryptoKey;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const vault = useVault();
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const had = hasPassphrase(keyring);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const why = passphraseProblem(passphrase, repeat);
    if (why) return setProblem(why);
    setBusy(true);
    try {
      await vault.replaceKeyringEntries('passphrase', await wrapWithPassphrase(changeKey, passphrase));
      onDone(had ? 'Passphrase changed. The old one no longer works.' : 'Passphrase added.');
    } catch (err) {
      setProblem(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <h3>{had ? 'New passphrase' : 'Add a passphrase'}</h3>
      <NewPassphraseFields
        label="New passphrase"
        passphrase={passphrase}
        repeat={repeat}
        onPassphrase={setPassphrase}
        onRepeat={setRepeat}
      />
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save passphrase'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

function AddPasskey({
  changeKey,
  onDone,
  onCancel,
}: {
  changeKey: CryptoKey;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const vault = useVault();
  const [label, setLabel] = useState(() => guessDeviceLabel());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const name = label.trim() || 'Passkey';
    setBusy(true);
    setProblem(null);
    try {
      const made = await createPasskey({ userName: `${APP_NAME} (${name})` });
      await vault.addKeyringEntry(await wrapWithPasskey(changeKey, { ...made, label: name }));
      onDone(`Added the passkey “${name}”.`);
    } catch (err) {
      setProblem(unlockMessage(err, 'passkey'));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={add}>
      <label htmlFor="passkey-label">Name this passkey</label>
      <input id="passkey-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Waiting for your passkey…' : 'Create passkey'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

/** Makes the new key, shows it, and only replaces the old one once the new one is confirmed. */
function NewRecoveryKey({ changeKey, onDone }: { changeKey: CryptoKey; onDone: (message: string) => void }) {
  const vault = useVault();
  const { data: recoveryKey, error } = useLoad(() => newRecoveryKey(), []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (error) return <p className="error">{error}</p>;
  if (!recoveryKey) return <p className="muted">Making a new recovery key…</p>;

  const save = async () => {
    setBusy(true);
    try {
      await vault.replaceKeyringEntries('recovery', await wrapWithRecoveryKey(changeKey, recoveryKey));
      onDone('New recovery key saved. The old one no longer works.');
    } catch (err) {
      setProblem(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h3>Your new recovery key</h3>
      <RecoveryKeySheet recoveryKey={recoveryKey} onSaved={save} saveLabel="I’ve saved it: replace the old key" busy={busy} />
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Phone (follows the phone's light or dark setting, the default), Light or Dark, for this device. */
function ThemeSetting() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const choose = (next: Theme) => {
    saveTheme(next);
    setTheme(next);
  };
  return (
    <>
      <h3 id="theme-title">Colours</h3>
      <div className="segmented" role="group" aria-labelledby="theme-title">
        {THEMES.map((t) => (
          <button key={t} type="button" aria-pressed={theme === t} onClick={() => choose(t)}>
            {THEME_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="muted small">Phone follows your phone’s light or dark setting. This is kept on this device only.</p>
    </>
  );
}

/** The daily study minutes the planner fills (moved here from the Tasks page, which shows no times, #77). */
function StudyTimeSetting() {
  const store = useStore();
  const { data, error } = useLoad(() => store.getStudySettings(), [store]);
  const [value, setValue] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;
  const shown = value ?? String(data.dailyMinutes);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const saved = await store.saveStudySettings({ dailyMinutes: Number(shown) });
      setMessage({ text: `Saved: ${saved.dailyMinutes} minutes a day.`, problem: false });
    } catch (err) {
      setMessage({ text: messageOf(err), problem: true });
    }
  };
  return (
    <>
      <h3 id="study-time-title">Study time</h3>
      <form className="row" noValidate onSubmit={save} aria-labelledby="study-time-title">
        <label className="inline">
          Minutes a day
          <input type="number" inputMode="numeric" min={DAILY_MINUTES_MIN} max={DAILY_MINUTES_MAX} value={shown} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button type="submit">Save</button>
      </form>
      {message && (
        <p className={message.problem ? 'error' : 'muted small'} role={message.problem ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      <p className="muted small">How much the planner puts on each day’s Tasks.</p>
    </>
  );
}
