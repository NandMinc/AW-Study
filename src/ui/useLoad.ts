// Loads something from the store for a screen: { data, error, reload }. A newer load always wins,
// so a slow old answer never overwrites a newer one.
import { useCallback, useEffect, useRef, useState } from 'react';

// `initial` is a value already loaded by the screen (Settings loads its sections' data before it draws, so
// nothing moves under a tap afterwards, #92): shown at once, and loaded again on mount as usual.
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], initial?: { value: T }) {
  const [data, setData] = useState<T | undefined>(initial ? initial.value : undefined);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const value = await run();
      if (ticket === latest.current) {
        setData(value);
        setError(null);
      }
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [run]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, reload };
}

/** The message to show for a failed action. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
