/**
 * `dust` is the one colour deliberately outside the accent's hue family: a pale,
 * muted complement (~170° away) that sits behind the notes. Reusing the accent
 * made the ~150-particle field read as a dimmer copy of the nodes instead of its
 * own depth layer; a second hue is what separates the two. The spacing is held
 * in CIEDE2000 rather than hue degrees, because low-saturation pastels 120° apart
 * can still look alike: every spark stays ≥ 25 ΔE2000 from its own node shades,
 * and the five stay ≥ 10 apart from each other (web/test/themes.test.ts).
 */
export const THEMES = [
  {
    // HUD lime on near-black, sampled from docs/reference/jarvis.png.
    id: "jarvis",
    label: "Jarvis",
    accent: "#d7e04f",
    bright: "#f3f79c",
    dim: "#8d9a2f",
    rgb: "215 224 79",
    career: "#e8ee8c",
    life: "#c4cf4a",
    ideas: "#9fae35",
    unset: "#4c5124",
    dust: "#bdb3d6",
  },
  {
    id: "orange",
    label: "Orange",
    accent: "#ff8a3d",
    bright: "#ffb877",
    dim: "#b6682c",
    rgb: "255 138 61",
    career: "#ff8a3d",
    life: "#c2703a",
    ideas: "#ffb25e",
    unset: "#714223",
    dust: "#a1c7dc",
  },
  {
    id: "amber",
    label: "Amber",
    accent: "#f0b24a",
    bright: "#ffd391",
    dim: "#ab7a2c",
    rgb: "240 178 74",
    career: "#f0b24a",
    life: "#c98f2f",
    ideas: "#ffce7a",
    unset: "#5f4a25",
    dust: "#a8b7d5",
  },
  {
    id: "crimson",
    label: "Crimson",
    accent: "#e8554f",
    bright: "#ff948c",
    dim: "#a33a35",
    rgb: "232 85 79",
    career: "#e8554f",
    life: "#b4403c",
    ideas: "#ff7f78",
    unset: "#833432",
    dust: "#a3cbc9",
  },
  {
    id: "ice",
    label: "Ice",
    accent: "#63c8e8",
    bright: "#a9e7fb",
    dim: "#3a8ba6",
    rgb: "99 200 232",
    career: "#63c8e8",
    life: "#3f9bb8",
    ideas: "#97e2f5",
    unset: "#2b5360",
    dust: "#d9b6a4",
  },
] as const;

export type Theme = (typeof THEMES)[number];
export type ThemeId = Theme["id"];

const STORAGE_KEY = "braindash.theme";
const MODE_KEY = "braindash.themeMode";
// Orange is the house default; the other four are opt-in.
const FALLBACK: Theme = THEMES.find((theme) => theme.id === "orange") ?? THEMES[0];

export type ThemeMode = "auto" | "manual";
export type ColorScheme = "light" | "dark" | null;

export const THEME_MODE_OPTIONS: { id: ThemeMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Follow the OS light/dark setting, then the clock" },
  { id: "manual", label: "Manual", hint: "Always use the accent picked on this device" },
];

/**
 * What Auto resolves to. The OS preference picks the tone of the palette — a light
 * desktop wants the bright pair, a dark one the calm pair — and the clock picks
 * within it, so the HUD still shifts as the day moves. The canvas itself stays
 * near-black either way: this is an accent choice, not a light/dark skin.
 */
const AUTO_BY_SCHEME: Record<"light" | "dark", Record<HourBucket, ThemeId>> = {
  light: { dawn: "amber", day: "jarvis", dusk: "amber", night: "jarvis" },
  dark: { dawn: "amber", day: "orange", dusk: "crimson", night: "ice" },
};

type HourBucket = "dawn" | "day" | "dusk" | "night";

/** 05–11 dawn, 11–17 day, 17–21 dusk, 21–05 night. */
export function hourBucket(date: Date): HourBucket {
  const hour = date.getHours();
  if (hour < 5) return "night";
  if (hour < 11) return "dawn";
  if (hour < 17) return "day";
  if (hour < 21) return "dusk";
  return "night";
}

/** `null` when the runtime cannot report a preference, which is the fallback path. */
export function systemColorScheme(): ColorScheme {
  if (typeof window.matchMedia !== "function") return null;
  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    return null;
  } catch {
    return null;
  }
}

/**
 * The accent Auto would pick right now, or `null` when no signal is available —
 * then the saved manual accent is used instead of guessing.
 */
export function autoThemeId(date: Date = new Date(), scheme: ColorScheme = systemColorScheme()): ThemeId | null {
  if (Number.isNaN(date.getTime())) return null;
  if (scheme === null) return AUTO_BY_SCHEME.dark[hourBucket(date)];
  return AUTO_BY_SCHEME[scheme][hourBucket(date)];
}

/** Auto when it can decide, otherwise the accent saved on this device. */
export function resolveTheme(
  mode: ThemeMode,
  manual: ThemeId,
  date: Date = new Date(),
  scheme: ColorScheme = systemColorScheme(),
): ThemeId {
  if (mode === "manual") return getTheme(manual).id;
  return autoThemeId(date, scheme) ?? getTheme(manual).id;
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    return stored === "manual" ? "manual" : "auto";
  } catch {
    return "auto";
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage can be blocked; the mode still applies for this session.
  }
}

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function getTheme(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? FALLBACK;
}

/** Reads the saved theme, tolerating private-mode / disabled storage. */
export function readStoredTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : FALLBACK.id;
  } catch {
    return FALLBACK.id;
  }
}

function applyPalette(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-bright", theme.bright);
  root.style.setProperty("--accent-dim", theme.dim);
  root.style.setProperty("--accent-rgb", theme.rgb);
  root.style.setProperty("--node-career", theme.career);
  root.style.setProperty("--node-life", theme.life);
  root.style.setProperty("--node-ideas", theme.ideas);
  // Untagged nodes keep the weight of a neutral grey but take the accent's hue
  // (mixed into the canvas at the tone that lands near 0.075 relative luminance).
  root.style.setProperty("--node-unset", theme.unset);
  // Spark field: a pale complement of the accent, so it reads as its own layer.
  root.style.setProperty("--node-dust", theme.dust);
}

/** Paints a palette without changing what is stored. */
export function applyTheme(id: ThemeId): void {
  applyPalette(getTheme(id));
}

/** Applies a theme and remembers it as the manual choice on this device. */
export function saveTheme(id: ThemeId): void {
  applyPalette(getTheme(id));
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage can be blocked; the theme still applies for this session.
  }
}

/** Call before the first render so a saved theme never flashes the default. */
export function initTheme(mode: ThemeMode = readStoredThemeMode()): ThemeId {
  const id = resolveTheme(mode, readStoredTheme());
  applyPalette(getTheme(id));
  return id;
}
