/**
 * Whether the brief mode-change notice is silenced. This is a **session**
 * choice: it lives in `sessionStorage`, so it survives a reload of the tab it
 * was made in and disappears when that tab closes. A mute is a "not right now",
 * not a preference — hiding tomorrow's work/home flip in a new window would be
 * the wrong kind of quiet.
 *
 * Storage is injected so the rules can be tested without a DOM. Blocked storage
 * (private windows, a locked-down webview) simply means the choice does not
 * outlive the page.
 */
const STORAGE_KEY = "braindash.modeNoticeMuted";

/** The part of `Storage` this module needs. */
export type MuteStore = Pick<Storage, "getItem" | "setItem"> | null;

function sessionStore(): MuteStore {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Reading `sessionStorage` itself throws when storage is blocked.
    return null;
  }
}

/** Muted today in this tab? Defaults to false: notices are on unless asked off. */
export function readNoticeMuted(store: MuteStore = sessionStore()): boolean {
  try {
    return store?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Records the choice for the rest of this tab's life. */
export function saveNoticeMuted(muted: boolean, store: MuteStore = sessionStore()): void {
  try {
    store?.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // The session keeps working from React state; only the reload is lost.
  }
}
