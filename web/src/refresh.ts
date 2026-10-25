/**
 * Unattended vault refresh: how often the dashboard re-checks the vault on its
 * own while the window is left open, and the pure schedule logic behind it.
 *
 * The check is deliberately cheap — one `/api/stats` request — because the
 * payload carries a fingerprint of the scan: the rest of the vault (notes index,
 * graph, stats) is only re-read when that fingerprint moves, so an idle
 * dashboard costs one small request per interval and repaints nothing.
 */
export type RefreshPref = "1m" | "5m" | "off";

export interface RefreshOption {
  id: RefreshPref;
  label: string;
  hint: string;
  /** Milliseconds between checks, or null when the dashboard never checks alone. */
  ms: number | null;
}

export const REFRESH_OPTIONS: RefreshOption[] = [
  {
    id: "1m",
    label: "Every minute",
    hint: "Keeps a long session current",
    ms: 60_000,
  },
  {
    id: "5m",
    label: "Every 5 minutes",
    hint: "Lighter on a large vault",
    ms: 300_000,
  },
  { id: "off", label: "Off", hint: "Refresh only when you ask", ms: null },
];

const STORAGE_KEY = "braindash.refresh";

/** The default is a gentle once-a-minute check. */
export function readStoredRefresh(): RefreshPref {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return REFRESH_OPTIONS.some((option) => option.id === stored) ? (stored as RefreshPref) : "1m";
  } catch {
    return "1m";
  }
}

export function saveRefresh(pref: RefreshPref): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage can be blocked; the choice still applies for this session.
  }
}

/** Milliseconds between checks, or null when refresh is off. */
export function resolveRefreshMs(pref: RefreshPref): number | null {
  return REFRESH_OPTIONS.find((option) => option.id === pref)?.ms ?? null;
}

/**
 * Whether a check is due. `lastCheckedAt` is a wall-clock millisecond stamp, or
 * null when this window has never checked: then it is due immediately, which is
 * how a tab that was asleep or hidden catches up as soon as it is looked at.
 */
export function isRefreshDue(
  lastCheckedAt: number | null,
  now: number,
  pref: RefreshPref,
): boolean {
  const ms = resolveRefreshMs(pref);
  if (ms === null) return false;
  if (lastCheckedAt === null) return true;
  return now - lastCheckedAt >= ms;
}

/**
 * Whether this moment should run a check. A hidden window never checks, however
 * long it has been open: the dashboard is meant to sit in F11 on a monitor, and
 * a background tab spending the vault's cache on a read nobody is looking at is
 * not gentle. Coming back into view makes it due again straight away.
 */
export function shouldCheckVault(
  context: { hidden: boolean; lastCheckedAt: number | null; now: number },
  pref: RefreshPref,
): boolean {
  if (context.hidden) return false;
  return isRefreshDue(context.lastCheckedAt, context.now, pref);
}
