import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { getSession, lockSession, unlockSession, type SessionState } from "../api";
import { accessState, usableToken, type AccessState } from "../access";
import { SessionLockContext } from "../sessionLock";

/**
 * The unlock screen and the container that decides whether to show it.
 *
 * The dashboard mounts only after `/api/session` says this browser is allowed
 * in, so a LAN visitor without the token never gets as far as the header, the
 * note list or a single vault read — the shell that is served is only the app
 * bundle, and the data behind it stays locked at the API.
 */

export interface AccessGateViewProps {
  /** `checking` renders a placeholder, `locked` the form, `open` nothing. */
  state: AccessState;
  busy: boolean;
  error: string | null;
  onUnlock: (value: string) => void;
}

/**
 * The presentational half, so the markup can be rendered in tests without a
 * fetch. The input is local state: the token is not lifted until submit, and it
 * is never written to storage.
 */
export function AccessGateView({ state, busy, error, onUnlock }: AccessGateViewProps) {
  const [value, setValue] = useState("");

  if (state === "open") return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onUnlock(value);
  };

  return (
    <main className="access-gate">
      <section className="access-gate-card" aria-labelledby="access-gate-title">
        <p className="access-gate-eyebrow">BrainDash</p>
        <h1 id="access-gate-title" className="access-gate-title">
          {state === "checking" ? "Checking access…" : "Access token required"}
        </h1>
        <p className="access-gate-copy">
          This dashboard is shared on the local network. Enter the token set as{" "}
          <code>BRAINDASH_TOKEN</code> on the machine running it.
        </p>
        {state === "locked" ? (
          <form className="access-gate-form" onSubmit={submit}>
            <label className="access-gate-label" htmlFor="access-token">
              Access token
            </label>
            <input
              id="access-token"
              className="access-gate-input"
              name="token"
              type="password"
              autoComplete="current-password"
              autoFocus
              spellCheck={false}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
            <button className="access-gate-submit" type="submit" disabled={busy}>
              {busy ? "Checking…" : "Unlock"}
            </button>
            {error ? (
              <p className="access-gate-error" role="alert">
                {error}
              </p>
            ) : (
              <p className="access-gate-hint">This browser remembers the token for a week.</p>
            )}
          </form>
        ) : (
          <p className="access-gate-wait" role="status">
            Asking the API whether this browser is allowed in…
          </p>
        )}
      </section>
    </main>
  );
}

/**
 * Asks once per page load, then gets out of the way. A failed answer is treated
 * as "open": an unreachable API is not a lock, and the dashboard's own
 * connection error says more than a token form ever could.
 */
export default function AccessGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getSession()
      .then((next) => {
        if (live) setSession(next);
      })
      .catch(() => {
        if (live) setSession({ required: false, authenticated: false });
      });
    return () => {
      live = false;
    };
  }, []);

  const state = accessState(session);

  /**
   * The dashboard's lock: the API clears the cookie, and the answer it returns
   * is the gate's next state, so the dashboard unmounts in the same tick the
   * session ends. Nothing rendered from the vault survives the click.
   */
  const lock = useCallback(async () => {
    const next = await lockSession();
    setSession(next);
    setError(null);
  }, []);

  const sessionLock = useMemo(
    () => ({ required: session?.required ?? false, lock }),
    [session, lock],
  );

  async function unlock(value: string) {
    const token = usableToken(value);
    if (!token) {
      setError("Enter the token from the API's environment.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setSession(await unlockSession(token));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That access token was not accepted.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "open") {
    return (
      <SessionLockContext.Provider value={sessionLock}>{children}</SessionLockContext.Provider>
    );
  }
  return <AccessGateView state={state} busy={busy} error={error} onUnlock={unlock} />;
}
