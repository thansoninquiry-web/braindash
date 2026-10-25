/**
 * Clock preferences: which zone the time is shown in, and whether it is 12- or
 * 24-hour. Both are local to this browser profile; nothing is written to the vault.
 *
 * `timeZone: ""` means "system zone", resolved at format time rather than stored,
 * so a laptop that changes zone (travel, DST) keeps showing the right wall clock.
 */
export interface ClockPrefs {
  /** IANA zone such as "America/New_York", or "" for the system zone. */
  timeZone: string;
  hour12: boolean;
}

const TZ_KEY = "braindash.timeZone";
const HOUR_KEY = "braindash.hour12";

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function readStoredTimeZone(): string {
  try {
    return window.localStorage.getItem(TZ_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveTimeZone(timeZone: string): void {
  try {
    window.localStorage.setItem(TZ_KEY, timeZone);
  } catch {
    // Storage can be blocked; the choice still applies for this session.
  }
}

/** 12-hour is the default: the dashboard is a clock, not a log file. */
export function readStoredHour12(): boolean {
  try {
    const stored = window.localStorage.getItem(HOUR_KEY);
    return stored === null ? true : stored !== "24";
  } catch {
    return true;
  }
}

export function saveHour12(hour12: boolean): void {
  try {
    window.localStorage.setItem(HOUR_KEY, hour12 ? "12" : "24");
  } catch {
    // As above.
  }
}

/** The zone actually used for formatting, with "" resolved to the system zone. */
export function activeTimeZone(prefs: ClockPrefs): string {
  return prefs.timeZone || systemTimeZone();
}

/** The local calendar day as YYYY-MM-DD, with no zone conversion. */
function systemDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The calendar day at `date` in `zone`, as YYYY-MM-DD. */
function dayKeyInZone(date: Date, zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: string) => parts.find((piece) => piece.type === type)?.value ?? "";
    const year = part("year");
    const month = part("month");
    const day = part("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // An unsupported stored zone falls back to the system calendar below.
  }
  return systemDayKey(date);
}

/**
 * The calendar day in the chosen zone, as YYYY-MM-DD.
 *
 * "Today" is a local idea: at 23:30 in New York it is already tomorrow in
 * Tokyo. Daily recall seeds its pick from this key, so it has to come from the
 * same zone the clock is showing rather than the server's clock.
 */
export function zoneDayKey(date: Date, prefs: ClockPrefs): string {
  return dayKeyInZone(date, prefs.timeZone || systemTimeZone());
}

/** `2026-10-19` shifted by whole days, immune to DST because it stays in UTC. */
export function shiftDayKey(key: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match?.[1] || !match[2] || !match[3]) return key;
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12),
  );
  const year = String(shifted.getUTCFullYear());
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatClockTime(date: Date, prefs: ClockPrefs): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: prefs.timeZone || undefined,
    hour12: prefs.hour12,
    hour: prefs.hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatClockDate(date: Date, prefs: ClockPrefs): string {
  return date
    .toLocaleDateString("en-US", {
      timeZone: prefs.timeZone || undefined,
      weekday: "short",
      month: "short",
      day: "2-digit",
    })
    .toUpperCase();
}

/** "EDT", "EST", "UTC" — the real abbreviation for the chosen zone. */
export function timeZoneAbbreviation(date: Date, prefs: ClockPrefs): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: prefs.timeZone || undefined,
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((piece) => piece.type === "timeZoneName");
    return (part?.value ?? "LOCAL").toUpperCase();
  } catch {
    return "LOCAL";
  }
}

/** A captured stamp as the vault records it: a wall clock with no zone. */
export interface CapturedStamp {
  year: number;
  month: number;
  day: number;
  /** null when the note only records a date. */
  hour: number | null;
  minute: number | null;
}

const CAPTURED_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?/;

function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * Parses the wall clock the vault stores, e.g. `2026-10-18 3:38 PM`, `2026-10-18
 * 15:38` or a bare `2026-10-18`. Returns null for anything unparseable so the
 * caller can fall back to showing the raw string.
 */
export function parseCapturedStamp(value: string | null | undefined): CapturedStamp | null {
  if (!value) return null;
  const match = CAPTURED_PATTERN.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealDate(year, month, day)) return null;
  if (!match[4] || !match[5]) return { year, month, day, hour: null, minute: null };
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return null;
  const meridiem = match[6]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return { year, month, day, hour, minute };
}

/** A zone `Intl` accepts, or undefined so formatting falls back to the system zone. */
function usableZone(zone: string | null | undefined): string | undefined {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/** Milliseconds that `zone` is ahead of UTC at that instant. */
function zoneOffsetMs(date: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((piece) => piece.type === type)?.value ?? "0");
  const asUTC = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour") % 24,
    part("minute"),
    part("second"),
  );
  return asUTC - date.getTime();
}

/**
 * The instant a wall clock in `zone` refers to. Two passes, because the offset
 * itself depends on the instant being solved for (the hour around a DST change).
 */
function zonedInstant(stamp: CapturedStamp, zone: string): Date {
  const wallClock = Date.UTC(
    stamp.year,
    stamp.month - 1,
    stamp.day,
    stamp.hour ?? 0,
    stamp.minute ?? 0,
  );
  const firstOffset = zoneOffsetMs(new Date(wallClock), zone);
  const secondOffset = zoneOffsetMs(new Date(wallClock - firstOffset), zone);
  return new Date(wallClock - secondOffset);
}

/**
 * The zone a captured stamp is read in, and the zone it is displayed in.
 *
 * Date-only stamps are calendar facts, not instants: they keep the day they were
 * written on whatever zone is selected, formatted at noon UTC so no conversion
 * can push them over a day boundary. Stamps with a time are wall clocks recorded
 * on the machine that wrote them, so they are read in `recordedZone` (the system
 * zone by default) and then shown in the selected zone.
 */
function capturedView(stamp: CapturedStamp, prefs: ClockPrefs, recordedZone: string) {
  const hasTime = stamp.hour !== null;
  const zone = hasTime ? usableZone(prefs.timeZone) : "UTC";
  const origin = hasTime ? usableZone(recordedZone) ?? systemTimeZone() : "UTC";
  const date = hasTime
    ? zonedInstant(stamp, origin)
    : new Date(Date.UTC(stamp.year, stamp.month - 1, stamp.day, 12));
  return { date, zone, hasTime };
}

/**
 * The instant a captured stamp refers to, read in the note's recorded zone (or
 * the machine's when it has none). Date-only stamps are calendar facts, so they
 * resolve at noon UTC and stay on their written day; useful for ordering rows.
 */
export function capturedInstant(
  value: string | null | undefined,
  recordedZone: string = systemTimeZone(),
): Date | null {
  const stamp = parseCapturedStamp(value);
  if (!stamp) return null;
  if (stamp.hour === null) return new Date(Date.UTC(stamp.year, stamp.month - 1, stamp.day, 12));
  try {
    return zonedInstant(stamp, usableZone(recordedZone) ?? systemTimeZone());
  } catch {
    return null;
  }
}

/**
 * A zone-free date key (`2026-10-19`) as `MON, OCT 19, 2026`.
 *
 * Rendered at noon UTC in UTC: a date key is a calendar fact, and formatting one
 * parsed at local midnight would show the day before for viewers behind UTC.
 */
export function formatDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealDate(year, month, day)) return null;
  return new Date(Date.UTC(year, month - 1, day, 12))
    .toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .toUpperCase();
}

/** `Oct 18, 2026 · 3:38 PM EDT`, in the chosen zone and hour cycle. */
export function formatCapturedStamp(
  value: string | null,
  prefs: ClockPrefs,
  recordedZone: string = systemTimeZone(),
): string | null {
  const stamp = parseCapturedStamp(value);
  if (!stamp) return null;
  let view: { date: Date; zone: string | undefined; hasTime: boolean };
  try {
    view = capturedView(stamp, prefs, recordedZone);
  } catch {
    // An unknown recorded zone still formats the written wall clock.
    view = { date: new Date(Date.UTC(stamp.year, stamp.month - 1, stamp.day, 12)), zone: "UTC", hasTime: stamp.hour !== null };
  }
  const dateLabel = view.date.toLocaleDateString("en-US", {
    timeZone: view.zone,
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  if (!view.hasTime) return dateLabel;
  const timeLabel = view.date.toLocaleTimeString("en-US", {
    timeZone: view.zone,
    hour12: prefs.hour12,
    hour: prefs.hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
  });
  const abbreviation = timeZoneAbbreviation(view.date, { timeZone: view.zone ?? "", hour12: prefs.hour12 });
  return `${dateLabel} · ${timeLabel} ${abbreviation}`;
}

/**
 * The zone a timed capture was recorded in, for display beside the converted
 * stamp. Null for a date-only stamp (a calendar fact with no clock to convert)
 * and for a note that recorded no zone, so the label never implies a conversion
 * that did not happen.
 */
export function capturedZoneLabel(
  value: string | null | undefined,
  recordedZone: string | null | undefined,
): string | null {
  if (!recordedZone) return null;
  const stamp = parseCapturedStamp(value);
  if (!stamp || stamp.hour === null) return null;
  return recordedZone;
}

/**
 * The calendar day a captured stamp lands on, in the chosen zone, as
 * YYYY-MM-DD. Date-only stamps keep their written day; timed stamps move with
 * the zone, so a capture at 11:30 PM in Tokyo counts as the 19th there and the
 * 18th in New York.
 */
export function capturedDayKey(
  value: string | null | undefined,
  prefs: ClockPrefs,
  recordedZone: string = systemTimeZone(),
): string | null {
  const stamp = parseCapturedStamp(value);
  if (!stamp) return null;
  try {
    const view = capturedView(stamp, prefs, recordedZone);
    return dayKeyInZone(view.date, view.zone ?? systemTimeZone());
  } catch {
    return null;
  }
}

export interface CapturePoint {
  /** Calendar day in the chosen zone, YYYY-MM-DD. */
  date: string;
  count: number;
}

/** A captured stamp plus the zone the note recorded for it, if any. */
export interface CapturedEntry {
  captured: string | null | undefined;
  zone?: string | null;
}

/**
 * Captures per day over the last `days` calendar days of the chosen zone,
 * oldest first. The server can only bucket by its own clock, so the dashboard
 * derives the sparkline here, where the zone is known.
 */
export function buildCaptureSeries(
  entries: Iterable<string | null | undefined | CapturedEntry>,
  prefs: ClockPrefs,
  days = 30,
  now = new Date(),
  recordedZone: string = systemTimeZone(),
): CapturePoint[] {
  if (!Number.isFinite(days) || days <= 0) return [];
  const endKey = zoneDayKey(now, prefs);
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i -= 1) buckets.set(shiftDayKey(endKey, -i), 0);
  for (const entry of entries) {
    const { captured, zone } =
      typeof entry === "string" || entry == null
        ? { captured: entry, zone: null }
        : entry;
    // A note's own zone wins, but a typo in one note must not discard the
    // timestamp; it falls back to the caller's recorded zone.
    const origin = zone && usableZone(zone) ? zone : recordedZone;
    const key = capturedDayKey(captured, prefs, origin);
    if (key && buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets].map(([date, count]) => ({ date, count }));
}

/** `OCT 18` for tight rows such as the index trail. */
export function formatCapturedDay(
  value: string | null,
  prefs: ClockPrefs,
  recordedZone: string = systemTimeZone(),
): string | null {
  const stamp = parseCapturedStamp(value);
  if (!stamp) return null;
  try {
    const view = capturedView(stamp, prefs, recordedZone);
    return view.date
      .toLocaleDateString("en-US", { timeZone: view.zone, month: "short", day: "2-digit" })
      .toUpperCase();
  } catch {
    return null;
  }
}

/** An ISO timestamp in the chosen zone and hour cycle. */
export function formatTimestamp(value: string, prefs: ClockPrefs): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    timeZone: prefs.timeZone || undefined,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: prefs.hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12: prefs.hour12,
    timeZoneName: "short",
  });
}

const FALLBACK_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

/**
 * Every zone the runtime knows, plus the short list. `supportedValuesOf` omits
 * some zones people actually want (notably `UTC`), so the fallbacks are merged in
 * rather than used only when the API is missing.
 */
export function listTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = new Set<string>(FALLBACK_ZONES);
  try {
    for (const zone of intl.supportedValuesOf?.("timeZone") ?? []) zones.add(zone);
  } catch {
    // The fallback list alone is still usable.
  }
  return [...zones].sort();
}
