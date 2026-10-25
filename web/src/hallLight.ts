/**
 * Time-of-day lighting for the empty hall behind the vault core.
 *
 * The room has one window at the far end and a row of ceiling strips, so it
 * should not look identical at noon and at 3 AM. The model here is deliberately
 * a wall clock rather than a solar calculator: the hall is the room the screen
 * is in, so it follows this device's local time (not the zone chosen in
 * Settings, which is a display preference for the notes), and dawn and dusk are
 * fixed local hours. A smoothstep ramp over two hours means the change is
 * gradual: sampled once a minute, each step is far below what an eye can catch.
 *
 * Everything derived here feeds CSS/SVG opacities in the hall, so the rules stay
 * a pure function that can be checked without a browser.
 */
export type HallPhase = "night" | "dawn" | "day" | "dusk";

export interface HallLighting {
  /** 0 at deep night, 1 in full day. */
  level: number;
  /** Multiplier for the ceiling strip plates. */
  strips: number;
  /** Multiplier for the doorway glow, the floor sheen and the light pool. */
  glow: number;
  /** Opacity of the black veil laid over the whole room at night. */
  veil: number;
  phase: HallPhase;
}

/** Local wall-clock hours, in minutes since midnight. */
export const DAWN_START = 5 * 60;
export const DAWN_END = 7 * 60;
export const DUSK_START = 18 * 60;
export const DUSK_END = 21 * 60;

/** The strip lights stay faintly on overnight; the room never goes black. */
export const NIGHT_STRIPS = 0.28;
/** The doorway keeps half its day glow, so it is still the way out. */
export const NIGHT_GLOW = 0.5;
/** How much black settles over the room at the darkest hour. */
export const NIGHT_VEIL = 0.16;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Slow at both ends, so the light never switches, it arrives. */
const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Local time as fractional minutes since midnight; seconds keep it moving. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/**
 * Lighting for a local wall-clock time. `minutes` accepts anything, including
 * negatives and values past midnight, and wraps into a day, so a caller doing
 * arithmetic across midnight cannot produce an out-of-range level.
 */
export function hallLightingAt(minutes: number): HallLighting {
  const safe = Number.isFinite(minutes) ? minutes : 0;
  const clock = ((safe % 1440) + 1440) % 1440;

  let level: number;
  let phase: HallPhase;
  if (clock < DAWN_START) {
    level = 0;
    phase = "night";
  } else if (clock < DAWN_END) {
    // Dawn lifts the room from night to day.
    level = smoothstep((clock - DAWN_START) / (DAWN_END - DAWN_START));
    phase = "dawn";
  } else if (clock < DUSK_START) {
    level = 1;
    phase = "day";
  } else if (clock < DUSK_END) {
    // Dusk is the same curve run backwards.
    level = 1 - smoothstep((clock - DUSK_START) / (DUSK_END - DUSK_START));
    phase = "dusk";
  } else {
    level = 0;
    phase = "night";
  }

  return {
    level,
    strips: NIGHT_STRIPS + (1 - NIGHT_STRIPS) * level,
    glow: NIGHT_GLOW + (1 - NIGHT_GLOW) * level,
    veil: NIGHT_VEIL * (1 - level),
    phase,
  };
}
