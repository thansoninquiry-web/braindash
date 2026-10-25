import { capturedZoneLabel, formatCapturedDay, type ClockPrefs } from "../clock";
import { exactBytes, formatBytes } from "../format";
import { trailTooltip } from "../trail";
import type { NoteSummary } from "../types";

interface TrailRowProps {
  entry: NoteSummary;
  clock: ClockPrefs;
  onOpen: () => void;
}

/**
 * One index-trail row.
 *
 * The stamp is a day converted into the clock zone chosen in Settings. A note
 * that recorded its own capture zone shows that origin on a second line, so the
 * conversion's source is visible while the row is focused or read aloud — not
 * only inside the hover tooltip. Date-only captures and notes without a
 * recorded zone have no conversion to explain and stay one line.
 */
export default function TrailRow({ entry, clock, onOpen }: TrailRowProps) {
  const zone = capturedZoneLabel(entry.captured, entry.capturedZone);

  return (
    <button
      type="button"
      className={`trail-row${zone ? " has-zone" : ""}`}
      onClick={onOpen}
      title={trailTooltip(entry.path, entry.captured, entry.capturedZone)}
    >
      <span className="trail-stamp">
        {formatCapturedDay(entry.captured, clock, entry.capturedZone ?? undefined) ?? "UNDATED"}
      </span>
      <span className="trail-title">{entry.title}</span>
      <span className="trail-size" title={exactBytes(entry.bytes)}>
        {formatBytes(entry.bytes)}
      </span>
      <span className="trail-arrow" aria-hidden="true">
        ↗
      </span>
      {zone ? (
        <span className="trail-zone" title={`Captured in ${zone}`}>
          {`captured in ${zone}`}
        </span>
      ) : null}
    </button>
  );
}
