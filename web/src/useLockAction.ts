/**
 * The lock action both entry points share: the header button and the palette
 * row. Busy and failure live here so the palette can run the action and still
 * leave its error somewhere on screen — the header button is always mounted and
 * renders it.
 */
import { useCallback, useState } from "react";
import { useSessionLock } from "./sessionLock";

export interface LockAction {
  /** A token is configured, so locking is offered at all. */
  lockable: boolean;
  busy: boolean;
  /** The API's own message when the session could not be dropped. */
  error: string | null;
  run: () => void;
}

const FAILED = "The session could not be locked. The browser may still be signed in.";

export function useLockAction(): LockAction {
  const { required, lock } = useSessionLock();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void lock()
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : FAILED);
      })
      .finally(() => {
        setBusy(false);
      });
  }, [busy, lock]);

  return { lockable: required, busy, error, run };
}
