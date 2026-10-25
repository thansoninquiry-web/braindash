/**
 * Cloud motion preference. `auto` follows the OS reduced-motion setting, which is
 * the right default — but it is only a default: an explicit choice on this device
 * wins, because some people reduce motion for reasons unrelated to a dashboard of
 * dots they actually want to see move.
 */
export type MotionPref = "auto" | "on" | "off";

const STORAGE_KEY = "braindash.motion";

export const MOTION_OPTIONS: { id: MotionPref; label: string; hint: string }[] = [
  { id: "auto", label: "System", hint: "Follow the OS reduced-motion setting" },
  { id: "on", label: "On", hint: "The sphere always floats" },
  { id: "off", label: "Off", hint: "One still frame, still interactive" },
];

export function systemPrefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function readStoredMotion(): MotionPref {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "on" || stored === "off" ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function saveMotion(pref: MotionPref): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage can be blocked; the choice still applies for this session.
  }
}

/** Whether the cloud should animate, given the preference and the OS setting. */
export function resolveMotion(pref: MotionPref): boolean {
  return pref === "on" || (pref === "auto" && !systemPrefersReducedMotion());
}
