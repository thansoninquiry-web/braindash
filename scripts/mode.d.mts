/**
 * Types for `mode.mjs`, which the API imports so the dashboard and
 * `npm run mode` can never disagree about the current working mode.
 */
export type Mode = "work" | "home";

export interface ModeState {
  mode: Mode;
  /** ISO timestamp of the switch. */
  since?: string;
  /** ISO timestamp the override stops counting; absent for `home`. */
  until?: string;
  note?: string;
}

export interface ResolvedMode {
  mode: Mode;
  /** "explicit override", "schedule", or "schedule (override stale)". */
  source: string;
  state: ModeState | null;
  stale: boolean;
}

export const SCHEDULE: {
  timeZone: string;
  /** ISO weekday numbers, 0 = Sunday. */
  days: number[];
  /** "HH:MM", inclusive. */
  start: string;
  /** "HH:MM", exclusive. */
  end: string;
};

export function zonedNow(date?: Date): { weekday: number; minutesOfDay: number };
export function scheduleSuggestion(date?: Date): Mode;
export function readState(file?: string): ModeState | null;
export function resolveMode(state: ModeState | null, date?: Date): ResolvedMode;
