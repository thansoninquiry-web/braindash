/**
 * How a note's `next_review` sits against a day, for the review queue's rows.
 *
 * A review date is a calendar fact, not an instant: the server filters the queue
 * with the same `YYYY-MM-DD` comparison, and this only turns it into the words a
 * row shows. Kept out of the component so the off-by-one edge is testable.
 */

export interface ReviewStatus {
  /** `due-today` is the day itself; `overdue` is past it; `scheduled` is future. */
  state: "due-today" | "overdue" | "scheduled";
  /** Whole days past the date: 0 today, positive when late, negative when early. */
  days: number;
  /** Row label, e.g. `Due today` or `3 days overdue`. */
  label: string;
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since the epoch for a real `YYYY-MM-DD`, or null for anything else. */
function dayIndex(key: string): number | null {
  const match = DAY_KEY.exec(key.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // UTC noon keeps DST out of the difference and cannot roll a date over.
  const utc = Date.UTC(year, month - 1, day, 12);
  const probe = new Date(utc);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.round(utc / 86_400_000);
}

/** Status for a row, or null when either date is missing or malformed. */
export function reviewStatus(
  nextReview: string | null | undefined,
  todayKey: string,
): ReviewStatus | null {
  const due = nextReview ? dayIndex(nextReview) : null;
  const today = dayIndex(todayKey);
  if (due === null || today === null) return null;
  const days = today - due;
  if (days < 0) return { state: "scheduled", days, label: "Scheduled" };
  if (days === 0) return { state: "due-today", days, label: "Due today" };
  return {
    state: "overdue",
    days,
    label: days === 1 ? "1 day overdue" : `${days} days overdue`,
  };
}
