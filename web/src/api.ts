import type { TrashListing, TrashRestoreResult } from "./types";

export interface VaultError {
  error: string;
  detail?: string;
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as T & Partial<VaultError>;
  if (!response.ok) {
    throw new Error(body.detail ?? body.error ?? `Request failed (${response.status})`);
  }
  return body;
}

/** Fetch JSON, turning the API's `{ error, detail }` shape into an Error. */
export function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, { headers: { accept: "application/json" } });
}

/**
 * Send a JSON body. Writes are only accepted for loopback hosts, so a 403 here
 * is the API refusing the device rather than a malformed request; its `detail`
 * says which, and becomes the Error message.
 */
export function sendJson<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const hasBody = body !== undefined;
  return requestJson<T>(path, {
    method,
    headers: {
      accept: "application/json",
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
}

/** Whether the API wants a token, and whether this browser already has one. */
export interface SessionState {
  required: boolean;
  authenticated: boolean;
}

/**
 * The one API read that never needs the token, because it is how the dashboard
 * discovers whether to show the unlock screen at all.
 */
export function getSession(): Promise<SessionState> {
  return getJson<SessionState>("/api/session");
}

/**
 * Trades the shared token for the HttpOnly session cookie. The token is sent
 * once and never stored by the page; a rejection arrives as an Error carrying
 * the API's own detail, which the unlock screen shows as-is.
 */
export function unlockSession(token: string): Promise<SessionState> {
  return sendJson<SessionState>("/api/session", "POST", { token });
}

/**
 * Ends this browser's session: the API answers with a cookie that has already
 * expired, so the browser forgets it without the person clearing anything by
 * hand, and returns the gate's next state in the same round trip.
 */
export function lockSession(): Promise<SessionState> {
  return sendJson<SessionState>("/api/session", "DELETE");
}

/** Everything a delete kept, newest first. Needs no write permission. */
export function getTrash(): Promise<TrashListing> {
  return getJson<TrashListing>("/api/trash");
}

/**
 * Puts a trashed note back at its old path. The API refuses (409 `note_exists`)
 * when a newer note took the filename, rather than replacing it.
 */
export function restoreTrashNote(id: string): Promise<TrashRestoreResult> {
  return sendJson<TrashRestoreResult>("/api/trash/restore", "POST", { id });
}

/** Vault paths are POSIX; encode each segment so spaces and # survive. */
export function encodeNotePath(notePath: string): string {
  return notePath.split("/").map(encodeURIComponent).join("/");
}
