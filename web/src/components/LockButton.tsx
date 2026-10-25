import { useLockAction } from "../useLockAction";

/**
 * The session lock, as the header renders it.
 *
 * It exists only where a session exists: a `BRAINDASH_TOKEN` install holds a
 * one-week cookie, and this is how the person holding the browser ends it
 * without going into the browser's own cookie settings. An install without a
 * token has nothing to drop, so it shows no button rather than a dead one.
 */

export interface LockButtonViewProps {
  lockable: boolean;
  busy: boolean;
  error: string | null;
  onLock: () => void;
}

/** The presentational half, so the markup can be checked without a fetch. */
export function LockButtonView({ lockable, busy, error, onLock }: LockButtonViewProps) {
  if (!lockable) return null;

  return (
    <span className="lock-wrap">
      <button
        type="button"
        className="icon-button lock-button"
        onClick={onLock}
        disabled={busy}
        aria-label={busy ? "Locking the dashboard" : "Lock the dashboard"}
        title="Lock · ask for the access token again"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <rect
            x="5"
            y="10.4"
            width="14"
            height="9.6"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="12" cy="15.2" r="1.2" fill="currentColor" />
        </svg>
      </button>
      {error ? (
        <span className="lock-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export default function LockButton() {
  const action = useLockAction();
  return (
    <LockButtonView
      lockable={action.lockable}
      busy={action.busy}
      error={action.error}
      onLock={action.run}
    />
  );
}
