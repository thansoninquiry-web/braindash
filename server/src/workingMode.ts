import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEDULE, readState, resolveMode, scheduleSuggestion, type Mode } from "../../scripts/mode.mjs";

// The compiled entry sits deeper (server/dist/server/src); the launcher pins
// this so the built server reads the same `.freebuff/` as the source server.
const ROOT = path.resolve(
  process.env.BRAINDASH_ROOT?.trim() || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);

/** The folder `npm run mode` writes into; the mode stream watches it. */
export const MODE_STATE_DIR = path.join(ROOT, ".freebuff");

/**
 * The machine-local working mode, as the header badge shows it. Read from the
 * same file and resolved by the same code as `npm run mode`, so the dashboard
 * can never disagree with the CLI about whether someone is at the desk.
 */
export interface WorkingMode {
  mode: Mode;
  /** Why this mode: "explicit override", "schedule", or a stale-override note. */
  source: string;
  /** True when an override expired and the weekly schedule took over. */
  stale: boolean;
  /** ISO timestamps of the ignored/stale override, when one exists. */
  since: string | null;
  until: string | null;
  note: string | null;
  /** What the weekly calendar alone says right now, for the tooltip. */
  schedule: {
    mode: Mode;
    timeZone: string;
    /** ISO weekdays, 0 = Sunday. */
    days: number[];
    start: string;
    end: string;
  };
  /** When this answer was computed (ISO), so the client can spot a dead poll. */
  checkedAt: string;
}

interface Options {
  /** Repo root holding `.freebuff/`; overridden by tests. */
  root?: string;
  now?: Date;
}

/** Reads and resolves the mode; never throws, so the API cannot 500 on a bad file. */
export function readWorkingMode({ root = ROOT, now = new Date() }: Options = {}): WorkingMode {
  const state = readState(path.join(root, ".freebuff", "working-mode"));
  const resolved = resolveMode(state, now);
  return {
    mode: resolved.mode,
    source: resolved.source,
    stale: resolved.stale,
    since: state?.since ?? null,
    until: state?.until ?? null,
    note: state?.note ?? null,
    schedule: {
      mode: scheduleSuggestion(now),
      timeZone: SCHEDULE.timeZone,
      days: [...SCHEDULE.days],
      start: SCHEDULE.start,
      end: SCHEDULE.end,
    },
    checkedAt: now.toISOString(),
  };
}
