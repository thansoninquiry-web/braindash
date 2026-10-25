/**
 * Whether the dashboard may render, from the API's session answer.
 *
 * Kept out of the component so the rule is testable without a DOM: a token
 * install is closed until the cookie is presented, and an install without a
 * token is open before the first render ever asks.
 */
import type { SessionState } from "./api";

/** `checking` is the only state that renders neither the dashboard nor the form. */
export type AccessState = "checking" | "locked" | "open";

/**
 * `null` means the session answer has not arrived yet. Anything else is the
 * server's verdict: `required` alone is not enough to lock a browser that is
 * already authenticated, and `required: false` never locks.
 */
export function accessState(session: SessionState | null): AccessState {
  if (!session) return "checking";
  return session.required && !session.authenticated ? "locked" : "open";
}

/**
 * The token worth sending: trimmed, or null when the field is blank. Trimming
 * matters because a pasted token usually arrives with a trailing newline.
 */
export function usableToken(value: string): string | null {
  const token = value.trim();
  return token.length > 0 ? token : null;
}
