import { capturedZoneLabel } from "./clock";

/**
 * The tooltip for one index-trail row.
 *
 * The visible stamp is a day converted into the zone chosen in Settings. Naming
 * the zone the note recorded makes that conversion's origin visible instead of
 * leaving the reader to guess where the date came from. A date-only stamp and a
 * note with no recorded zone get the plain "open" tooltip, because there was no
 * conversion to explain.
 */
export function trailTooltip(path: string, captured: string | null, capturedZone: string | null): string {
  const zone = capturedZoneLabel(captured, capturedZone);
  return zone ? `Open ${path} · captured in ${zone}` : `Open ${path}`;
}
