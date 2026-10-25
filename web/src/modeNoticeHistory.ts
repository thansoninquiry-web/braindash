/**
 * The short backlog of work/home flips that arrived while notices were muted.
 *
 * Muting silences the notice, not the information: rather than dropping a flip,
 * the dashboard keeps its wording and time so the header badge can offer the
 * last few later. The backlog is per tab (`sessionStorage`, the same lifetime as
 * the mute) and is capped: this is a glance back at what was missed, not a log.
 */
import type { ModeChangeNotice } from "./modeBadge";

const STORAGE_KEY = "braindash.modeNoticeHistory";

/** Newest three flips are enough to explain "what changed while I was away?". */
export const MODE_HISTORY_LIMIT = 3;

/** A notice plus the instant the mode was resolved, for the badge's list. */
export interface ModeChangeRecord extends ModeChangeNotice {
  at: string;
}

/** The part of `Storage` this module needs. */
export type HistoryStore = Pick<Storage, "getItem" | "setItem"> | null;

function sessionStore(): HistoryStore {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Reading `sessionStorage` itself throws when storage is blocked.
    return null;
  }
}

function isRecord(value: unknown): value is ModeChangeRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ModeChangeRecord>;
  return (
    typeof candidate.label === "string" &&
    (candidate.tone === "work" || candidate.tone === "home") &&
    (candidate.source === "manual" || candidate.source === "auto" || candidate.source === "stale") &&
    typeof candidate.detail === "string" &&
    typeof candidate.at === "string" &&
    candidate.at.length > 0
  );
}

/**
 * Puts `change` at the front and drops the oldest beyond `limit`. The input is
 * not mutated, so React state and a saved copy can share the old array.
 */
export function rememberModeChange(
  history: ModeChangeRecord[],
  change: ModeChangeNotice,
  at: string,
  limit = MODE_HISTORY_LIMIT,
): ModeChangeRecord[] {
  return [{ ...change, at }, ...history].slice(0, Math.max(0, limit));
}

/**
 * A stored backlog, defensively read: malformed JSON, a non-array, or a row
 * missing a field is dropped rather than crashing the header after an upgrade.
 */
export function parseNoticeHistory(
  raw: string | null,
  limit = MODE_HISTORY_LIMIT,
): ModeChangeRecord[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord).slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

/** The last muted flips for this tab, or an empty list when nothing is stored. */
export function readNoticeHistory(store: HistoryStore = sessionStore()): ModeChangeRecord[] {
  try {
    return parseNoticeHistory(store?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return [];
  }
}

/** Saves the backlog; blocked storage only means it will not survive a reload. */
export function saveNoticeHistory(
  history: ModeChangeRecord[],
  store: HistoryStore = sessionStore(),
): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // The current tab keeps its state; only the reload copy is lost.
  }
}

