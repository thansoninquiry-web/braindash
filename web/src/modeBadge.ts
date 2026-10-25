/**
 * The header badge for the working mode. Kept pure so the wording can be tested
 * without a DOM, and so the component only decides layout — the dashboard and
 * `npm run mode` describe the same state because both read the same resolver.
 */
import type { WorkingMode } from "./types";

/** How the mode was decided. `—` is the pre-answer state, not a decision. */
export type ModeSource = "manual" | "auto" | "stale" | "—";

export interface ModeBadge {
  /** Short label in the header: WORK, HOME, or MODE when nothing answered. */
  label: string;
  /** Why this is the mode: manual, auto, or stale. */
  source: ModeSource;
  tone: "work" | "home" | "unknown";
  /** Full sentence for the tooltip and screen readers. */
  detail: string;
}

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayName(day: number): string {
  return WEEK[day] ?? "?";
}

/** "Mon–Fri 08:30–17:30 America/New_York", collapsing a run of weekdays. */
export function describeSchedule(schedule: WorkingMode["schedule"]): string {
  const days = [...new Set(schedule.days)].sort((a, b) => a - b);
  let when = "No days";
  if (days.length === 7) {
    when = "Every day";
  } else if (days.length > 1 && days.every((day, index) => index === 0 || day === (days[index - 1] ?? -2) + 1)) {
    when = `${dayName(days[0] ?? 0)}–${dayName(days[days.length - 1] ?? 0)}`;
  } else if (days.length === 1) {
    when = dayName(days[0] ?? 0);
  } else if (days.length > 1) {
    when = days.map(dayName).join(", ");
  }
  return `${when} ${schedule.start}–${schedule.end} ${schedule.timeZone}`;
}

/**
 * Turns the API payload into the badge. `stamp` formats an ISO instant in the
 * clock's own zone, so the tooltip matches the clock beside it.
 */
export function modeBadge(
  mode: WorkingMode | null,
  stamp: (iso: string) => string = (iso) => iso,
): ModeBadge {
  if (!mode) {
    return {
      label: "Mode",
      source: "—",
      tone: "unknown",
      detail:
        "Working mode unavailable — the dashboard could not read /api/mode. Run npm run mode to check it.",
    };
  }

  const manual = mode.source.startsWith("explicit");
  const since = mode.since ? stamp(mode.since) : null;
  const until = mode.until ? stamp(mode.until) : null;
  const parts: string[] = [
    mode.mode === "work"
      ? "At work — the dashboard finishes tasks without asking."
      : "At the desk — questions are welcome.",
  ];

  if (manual) {
    parts.push(`Set by hand${since ? ` at ${since}` : ""}${until ? `, until ${until}` : ""}.`);
    if (mode.schedule.mode !== mode.mode) {
      parts.push(`The schedule alone would say ${mode.schedule.mode}.`);
    }
  } else if (mode.stale) {
    parts.push(
      `The last override${until ? ` ended at ${until}` : " expired"}; the weekly schedule took over.`,
    );
  } else {
    parts.push("Inferred from the weekly schedule.");
  }

  parts.push(`Schedule: ${describeSchedule(mode.schedule)}.`);
  if (mode.note) parts.push(`Note: ${mode.note}`);

  return {
    label: mode.mode === "work" ? "Work" : "Home",
    source: manual ? "manual" : mode.stale ? "stale" : "auto",
    tone: mode.mode,
    detail: parts.join(" "),
  };
}

/** The mode as the browser tab can show it, before any DOM work. */
export interface TabIdentity {
  /**
   * Mode first, then its provenance: an unfocused, truncated tab keeps the mode
   * (`Work (manual) · Bra…`), and a short tab still answers "why is it like this?".
   */
  title: string;
  /**
   * A data URL for `link[rel="icon"]`: the letter and fill carry the mode, a
   * corner marker carries the provenance (filled = manual, ring = stale).
   */
  icon: string;
  tone: ModeBadge["tone"];
  source: ModeSource;
}

/** A filled tile with a dark glyph stays legible at 16px and when desaturated. */
const TAB_STYLE: Record<ModeBadge["tone"], { glyph: string; fill: string }> = {
  work: { glyph: "W", fill: "#ff9a4d" },
  home: { glyph: "H", fill: "#5fd0b8" },
  unknown: { glyph: "B", fill: "#7d857b" },
};

/**
 * Corner marker for the provenance. A filled dot reads at 16 px on every tile;
 * a ring reads as "the override lapsed" without needing colour, and the schedule
 * (the ordinary case) gets no mark at all so the letter stays uncluttered.
 */
function provenanceMark(source: ModeSource): string {
  if (source === "manual") {
    return `<circle cx="26" cy="6" r="3.4" fill="#06090b"/>`;
  }
  if (source === "stale") {
    return `<circle cx="26" cy="6" r="3" fill="none" stroke="#06090b" stroke-width="1.7"/>`;
  }
  return "";
}

function tabIcon(tone: ModeBadge["tone"], source: ModeSource): string {
  const { glyph, fill } = TAB_STYLE[tone];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="${fill}"/>` +
    `<text x="16" y="23" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="20" font-weight="700" fill="#06090b">${glyph}</text>` +
    provenanceMark(source) +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The tab title and favicon for a mode. Work and home get different letters and
 * fills, so the answer survives a colour-blind or monochrome tab strip; the
 * provenance rides along in the title and as a corner mark, so the tab says as
 * much as the header badge. Before `/api/mode` answers it stays neutral.
 */
export function tabIdentity(mode: WorkingMode | null): TabIdentity {
  if (!mode) {
    return { title: "BrainDash", tone: "unknown", source: "—", icon: tabIcon("unknown", "—") };
  }
  const badge = modeBadge(mode);
  return {
    title: `${badge.label} (${badge.source}) · BrainDash`,
    tone: mode.mode,
    source: badge.source,
    icon: tabIcon(mode.mode, badge.source),
  };
}

/** A mid-session mode flip, worded for the brief in-page notice. */
export interface ModeChangeNotice {
  label: string;
  tone: "work" | "home";
  source: ModeBadge["source"];
  detail: string;
}

/**
 * Returns a notice only when an already-known mode changes. The first answer is
 * the dashboard's starting state, not a transition, and a failed `/api/mode`
 * poll must not look like a switch to the user.
 */
export function modeChangeNotice(
  previous: WorkingMode | null,
  next: WorkingMode | null,
): ModeChangeNotice | null {
  if (!previous || !next || previous.mode === next.mode) return null;
  const badge = modeBadge(next);
  const behavior =
    next.mode === "work"
      ? "The dashboard finishes tasks without asking."
      : "Questions are welcome.";
  const reason = next.source.startsWith("explicit")
    ? "Set by hand."
    : next.stale
      ? "The last override expired; the weekly schedule took over."
      : "Inferred from the weekly schedule.";
  return {
    label: badge.label,
    tone: next.mode,
    source: badge.source,
    detail: `${behavior} ${reason}`,
  };
}
