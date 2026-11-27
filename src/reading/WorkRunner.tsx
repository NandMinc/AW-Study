// Runs AI work in the background while Honed is unlocked and on screen (#168, 5c; ./work.ts): a little after
// unlocking, every few minutes, and when the page comes back into view or online. Does nothing (and sends
// nothing) on a device without an account. Problems are kept in the work state; a round that fails in an
// unexpected way is simply tried again next time.
import { useEffect, useRef } from 'react';
import { useStore } from '../ui/store-context';
import { workOnce } from './work';

export const WORK_EVERY_MS = 3 * 60_000;
/** The first round waits a little, so unlocking and sync come first. */
export const WORK_FIRST_AFTER_MS = 15_000;

export function WorkRunner({ onFiled }: { onFiled: () => void }) {
  const store = useStore();
  const filed = useRef(onFiled);
  filed.current = onFiled;

  useEffect(() => {
    let stopped = false;
    let running = false;
    const round = async () => {
      if (stopped || running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const result = await workOnce(store);
        if (result && result.filed > 0 && !stopped) filed.current();
      } catch {
        // Unexpected (a network or parsing failure): the next round tries again
      } finally {
        running = false;
      }
    };
    const first = setTimeout(() => void round(), WORK_FIRST_AFTER_MS);
    const timer = setInterval(() => void round(), WORK_EVERY_MS);
    const again = () => void round();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('online', again);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('online', again);
    };
  }, [store]);

  return null;
}
