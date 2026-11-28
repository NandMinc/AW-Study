// Settings' "This device" (#99): whether this device remembers the unlock (docs/SECURITY.md, "Remembering
// a device"), forgetting it without locking, and Lock now (which forgets it too).
import { useState } from 'react';
import { APP_NAME } from '../brand';
import type { RememberedKey } from '../types/crypto';
import { useVault } from './lock-parts';
import { useLoad } from './useLoad';

export function ThisDevice({ onLock, initial }: { onLock: () => void; initial?: { value: RememberedKey | null } }) {
  const vault = useVault();
  const { data: remembered, reload } = useLoad(() => vault.getRemembered(), [vault], initial);
  const [forgot, setForgot] = useState(false);

  const forget = async () => {
    await vault.forget();
    setForgot(true);
    reload();
  };

  return (
    <>
      <h3 id="this-device-title">This device</h3>
      <div className="stack" role="group" aria-labelledby="this-device-title">
        {remembered ? (
          <>
            <p className="small" data-testid="remember-status">
              This device remembers your unlock, so {APP_NAME} opens without asking. Anyone who can use this device can open it too.
            </p>
            <div className="row">
              <button type="button" onClick={() => void forget()}>
                Forget the unlock on this device
              </button>
            </div>
          </>
        ) : (
          remembered === null && (
            <p className="small" data-testid="remember-status">
              {forgot ? 'Forgotten. ' : ''}This device asks for your passkey, passphrase or recovery key each time {APP_NAME} opens.
              To have it remembered, lock and unlock with “Remember this device” ticked.
            </p>
          )
        )}
        <p className="muted small">Lock now locks {APP_NAME} and forgets the unlock: the next open asks again.</p>
        <div className="row">
          <button type="button" onClick={onLock}>
            Lock now
          </button>
        </div>
      </div>
    </>
  );
}
