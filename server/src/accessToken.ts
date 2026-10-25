/**
 * Optional shared-token access for the dashboard.
 *
 * The API is loopback-only by default, but the Vite dev server is not: it binds
 * every interface so a phone on the LAN can open the dashboard. When
 * `BRAINDASH_TOKEN` is set, every API route refuses read access until the caller
 * presents that token, so the LAN view is no longer an unauthenticated copy of
 * the vault. Unset, nothing changes — a single-machine install has nothing to
 * protect the API from.
 *
 * Two ways in, both checked here:
 *  - `Authorization: Bearer <token>` — curl, scripts, a probe;
 *  - the `braindash_token` cookie, set by `POST /api/session` from the unlock
 *    screen, holding the token's SHA-256 rather than the token itself. A cookie
 *    is what makes the browser work at all: `EventSource` cannot send a header.
 *
 * The cookie is `HttpOnly` (page scripts cannot read it) and `SameSite=Strict`
 * (another site cannot make the browser send it). Comparisons are constant-time.
 * This is a shared secret for a trusted network, not an account system: there is
 * no per-user identity, no rate limiting and, over plain HTTP, no transport
 * encryption — `npm run dev:https` exists for that.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/** Cookie name; also the name the unlock screen's response sets. */
export const TOKEN_COOKIE = "braindash_token";

/** A week, so a phone does not ask for the token every time it is picked up. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** SHA-256 hex of a token. What the cookie stores instead of the secret. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two strings of any length. Both sides are hashed
 * first so `timingSafeEqual` never sees different lengths (it throws), and an
 * empty or oversized value cannot be distinguished by timing.
 */
export function sameToken(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

/**
 * One cookie out of a `Cookie` header, or null. Duplicates resolve to the first
 * occurrence, which is what a browser sends when a path-scoped cookie shadows a
 * broader one; the value is returned as written (the session cookie is hex, so
 * no decoding is needed and a malformed percent-encoding cannot throw here).
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    return pair.slice(index + 1).trim() || null;
  }
  return null;
}

/** The raw token presented as `Authorization: Bearer`, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return null;
  const value = rest.join(" ").trim();
  return value || null;
}

/**
 * Whether this request may read the API once `token` is configured. Either the
 * header carries the token itself, or the cookie carries its hash — both are
 * compared in constant time, and nothing is compared when neither is present.
 */
export function isAuthorized(req: Request, token: string): boolean {
  const presented = bearerToken(req);
  if (presented) return sameToken(presented, token);
  const cookie = readCookie(req.headers.cookie, TOKEN_COOKIE);
  if (!cookie) return false;
  return sameToken(cookie, hashToken(token));
}

/** The `Set-Cookie` value that unlocks this browser for a week. */
export function sessionCookie(token: string): string {
  return (
    `${TOKEN_COOKIE}=${hashToken(token)}; Path=/; HttpOnly; SameSite=Strict; ` +
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  );
}

/** The `Set-Cookie` value that forgets the session immediately. */
export function clearedCookie(): string {
  return `${TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
