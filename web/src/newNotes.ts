/**
 * The arrival animation for notes a scan has just found.
 *
 * The cloud is rebuilt from every scan, so a note that was not in the previous
 * index has no earlier position to move from. Instead it flies out of the bulge
 * into the arm its slot belongs to, with a ring of its area colour expanding
 * around it. The rules live here so the "new note, not a whole import" decision
 * and the curve can be checked without a browser.
 */

/** More than this at once is an import or a vault switch, not a capture. */
export const MAX_FLARE_NOTES = 8;

/** Seconds from the core to the note's place in its arm. */
export const FLARE_SECONDS = 1.6;

/**
 * Paths present now and absent from the previous index, in the order the cloud
 * lays them out. `previous` null means the first scan has not been seen yet:
 * every note would look new, so nothing flares. Placeholder particles carry a
 * null path and are ignored.
 */
export function addedNotePaths(
  previous: ReadonlySet<string> | null,
  current: readonly (string | null)[],
): string[] {
  if (!previous) return [];
  const added: string[] = [];
  const seen = new Set<string>();
  for (const path of current) {
    if (!path || previous.has(path) || seen.has(path)) continue;
    seen.add(path);
    added.push(path);
  }
  return added;
}

/** A handful of notes is a capture; a crowd is a rescan and must not sparkle. */
export function shouldFlare(added: readonly string[]): boolean {
  return added.length > 0 && added.length <= MAX_FLARE_NOTES;
}

export interface FlareProgress {
  /** 0 at the core, 1 in place. */
  progress: number;
  /** Eased travel fraction, so the note leaves quickly and settles gently. */
  eased: number;
  /** 1 at the start, 0 at the end; scales the brightness of the flare. */
  spark: number;
}

/**
 * The flare's position on its arc. `startedAt` and `now` are seconds on the
 * draw loop's own clock, which restarts when the particle list is rebuilt —
 * exactly when a flare begins.
 */
export function flareProgress(
  startedAt: number,
  now: number,
  duration = FLARE_SECONDS,
): FlareProgress {
  const raw = duration <= 0 ? 1 : (now - startedAt) / duration;
  const progress = Math.min(1, Math.max(0, raw));
  const remaining = 1 - progress;
  return {
    progress,
    eased: 1 - remaining ** 3,
    spark: remaining ** 2,
  };
}
