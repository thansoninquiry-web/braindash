import type { WorkingMode } from "./types";

/** The SSE endpoint the dashboard keeps open for mode changes. */
export const MODE_STREAM_URL = "/api/mode/stream";

/** Named event the server sends; a comment heartbeat carries no event at all. */
export const MODE_STREAM_EVENT = "mode";

/**
 * One SSE `data:` frame as a working mode, or null when it is not usable. The
 * server is the only writer, so this is a shape guard rather than a schema: it
 * exists so a truncated frame during a reconnect cannot blank a working badge or
 * put a half-written mode into the header.
 */
export function parseModeFrame(data: string): WorkingMode | null {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<WorkingMode>;
    if (candidate.mode !== "work" && candidate.mode !== "home") return null;
    if (typeof candidate.source !== "string" || typeof candidate.checkedAt !== "string") return null;
    const schedule = candidate.schedule;
    if (
      !schedule ||
      typeof schedule !== "object" ||
      (schedule.mode !== "work" && schedule.mode !== "home") ||
      typeof schedule.timeZone !== "string" ||
      !Array.isArray(schedule.days) ||
      typeof schedule.start !== "string" ||
      typeof schedule.end !== "string"
    ) {
      return null;
    }
    return candidate as WorkingMode;
  } catch {
    return null;
  }
}
