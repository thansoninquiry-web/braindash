#!/usr/bin/env node
/**
 * Working-mode switch: records whether the person at this machine is at work
 * (away, do not block on questions) or at home (here, questions are fine).
 *
 *   npm run mode            # show the current mode and what the schedule suggests
 *   npm run mode work       # at work: work autonomously, log assumptions
 *   npm run mode home       # at home: normal collaboration
 *   npm run mode clear      # forget the override, follow the schedule
 *   npm run mode status     # same as bare `npm run mode`
 *
 * State and history are machine-local under `.freebuff/` (untracked): the mode is
 * a fact about this desk, not about the repository. The rules that read it live in
 * AGENTS.md; the reasoning lives in docs/working-mode.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".freebuff");
const STATE = path.join(DIR, "working-mode");
const LOG = path.join(DIR, "mode-log.md");

/** Assumption (docs/working-mode.md): Mon–Fri 08:30–17:30, America/New_York. */
export const SCHEDULE = {
  timeZone: "America/New_York",
  days: [1, 2, 3, 4, 5],
  start: "08:30",
  end: "17:30",
};

/** A state file with no `until` goes stale after this long. */
const STALE_HOURS = 12;
/** How long "at work" is assumed to last, so a forgotten override expires. */
const WORK_WINDOW_HOURS = 9;

const MODES = ["work", "home"];
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function minutes(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Clock time in the schedule's zone, independent of where this runs. */
export function zonedNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAYS[get("weekday")] ?? 0;
  const minutesOfDay = Number(get("hour")) * 60 + Number(get("minute"));
  return { weekday, minutesOfDay };
}

/** What the schedule alone would say: `work` during office hours, else `home`. */
export function scheduleSuggestion(date = new Date()) {
  const { weekday, minutesOfDay } = zonedNow(date);
  const inDay = SCHEDULE.days.includes(weekday);
  const inHours = minutesOfDay >= minutes(SCHEDULE.start) && minutesOfDay < minutes(SCHEDULE.end);
  return inDay && inHours ? "work" : "home";
}

function stamp(date, options = {}) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE.timeZone,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
    ...options,
  }).format(date);
}

function ageHours(iso, date = new Date()) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (date.getTime() - then) / 3_600_000;
}

/**
 * Parses `key: value` lines; tolerant of a hand-edited file. Takes the path so
 * the API can read the same format (and the tests can point at a scratch file).
 */
export function readState(file = STATE) {
  if (!existsSync(file)) return null;
  // A hand-edited or half-written file must degrade to the schedule, not throw:
  // the CLI and the dashboard both read this.
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const state = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([a-zA-Z]+):\s*(.*)$/.exec(line.trim());
    if (match) state[match[1].toLowerCase()] = match[2];
  }
  if (!MODES.includes(state.mode)) return null;
  return state;
}

/** Explicit state wins while it is fresh; otherwise the schedule decides. */
export function resolveMode(state, date = new Date()) {
  const suggested = scheduleSuggestion(date);
  if (!state) return { mode: suggested, source: "schedule", state: null, stale: false };
  const expired = state.until ? Date.parse(state.until) <= date.getTime() : false;
  const stale = expired || ageHours(state.since ?? "", date) > STALE_HOURS;
  if (stale) return { mode: suggested, source: "schedule (override stale)", state, stale: true };
  return { mode: state.mode, source: "explicit override", state, stale: false };
}

function logSwitch(previous, next, note) {
  mkdirSync(DIR, { recursive: true });
  if (!existsSync(LOG)) {
    writeFileSync(LOG, "# Working-mode log\n\nMachine-local history of `npm run mode`.\n\n", "utf8");
  }
  const from = previous?.mode ?? "none";
  const suffix = note ? ` · ${note}` : "";
  appendFileSync(LOG, `- ${stamp(new Date(), { year: "numeric" })} · ${from} → ${next}${suffix}\n`, "utf8");
}

function setMode(mode, note = "") {
  const previous = readState();
  const now = new Date();
  // `until` is a coarse "expect me back by" stamp, not a schedule boundary: it
  // exists so a forgotten `work` override cannot hold for days.
  const until = new Date(now.getTime() + WORK_WINDOW_HOURS * 3_600_000);
  const lines = [
    `mode: ${mode}`,
    `since: ${now.toISOString()}`,
    ...(mode === "work" ? [`until: ${until.toISOString()}`] : []),
    ...(note ? [`note: ${note}`] : []),
  ];
  mkdirSync(DIR, { recursive: true });
  writeFileSync(STATE, `${lines.join("\n")}\n`, "utf8");
  logSwitch(previous, mode, note);
  report(readState(), { mode, source: "just set", state: readState(), stale: false });
}

function clearMode() {
  const previous = readState();
  if (existsSync(STATE)) rmSync(STATE);
  logSwitch(previous, "schedule", "override cleared");
  report(null, resolveMode(null));
}

function report(state, resolved) {
  const suggested = scheduleSuggestion();
  console.log("working mode");
  console.log(`  mode       ${state ? resolved.mode.toUpperCase() : "(none — following the schedule)"}`);
  console.log(`  source     ${resolved.source}`);
  if (state?.since) {
    const when = new Date(state.since);
    const hours = ageHours(state.since);
    const age = Number.isFinite(hours) ? ` (${hours < 1 ? "<1h" : `${Math.round(hours)}h`} ago)` : "";
    console.log(`  since      ${stamp(when)}${age}`);
  }
  if (state?.until) console.log(`  until      ${stamp(new Date(state.until))}`);
  if (state?.note) console.log(`  note       ${state.note}`);
  console.log(`  schedule   ${suggested} now — Mon–Fri ${SCHEDULE.start}–${SCHEDULE.end} ${SCHEDULE.timeZone}`);
  console.log(`  file       ${path.relative(ROOT, STATE)}${resolved.stale ? " (stale — ignored)" : ""}`);
  if (resolved.mode === "work") {
    console.log("\n  AT WORK: do not ask questions. Choose, record the choice in docs/DECISIONS.md, finish, hand over.");
  } else {
    console.log("\n  AT HOME: questions are fine. Assume, ask, or act — but never block on trivia.");
  }
}

function usage() {
  console.log("usage: npm run mode [work|home|clear|status] [note]");
  console.log("  work    at work: autonomous, no blocking questions, log assumptions");
  console.log("  home    at home: normal collaboration");
  console.log("  clear   delete the override and follow the schedule");
  console.log("  status  print the current mode (default)");
}

// The helpers above are imported by the API (`server/src/workingMode.ts`), so the
// command line only runs when this file was executed, not imported.
const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  const [command = "status", ...rest] = process.argv.slice(2);
  const note = rest.join(" ").trim();

  if (command === "status") {
    report(readState(), resolveMode(readState()));
  } else if (command === "work" || command === "home") {
    setMode(command, note);
  } else if (command === "clear") {
    clearMode();
  } else if (command === "help" || command === "-h" || command === "--help") {
    usage();
  } else {
    console.error(`unknown mode: ${command}`);
    usage();
    process.exit(1);
  }
}
