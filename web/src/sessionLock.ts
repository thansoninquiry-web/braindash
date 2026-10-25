/**
 * What the dashboard is allowed to know about the gate's session.
 *
 * The gate owns the cookie question, so the header cannot end the session by
 * itself; it asks through this context. Two facts and one verb — whether a
 * token installs a session at all, and how to drop it — so a no-token install
 * never shows a control that would do nothing.
 */
import { createContext, useContext } from "react";

export interface SessionLock {
  /** A token is configured, so this browser is holding a session worth ending. */
  required: boolean;
  /** Clears the cookie and re-renders the unlock screen; rejects if the API refused. */
  lock: () => Promise<void>;
}

/**
 * The default is "no session": the component tree outside a gate (tests, a
 * future embed) must not grow a lock button for a cookie that does not exist.
 */
export const SessionLockContext = createContext<SessionLock>({
  required: false,
  lock: async () => {},
});

export function useSessionLock(): SessionLock {
  return useContext(SessionLockContext);
}
