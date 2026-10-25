import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseModeFrame } from "../src/modeStream.ts";

const payload = {
  mode: "work",
  source: "explicit override",
  stale: false,
  since: "2026-10-21T11:00:00.000Z",
  until: "2026-10-21T20:00:00.000Z",
  note: null,
  schedule: {
    mode: "home",
    timeZone: "America/New_York",
    days: [1, 2, 3, 4, 5],
    start: "08:30",
    end: "17:30",
  },
  checkedAt: "2026-10-21T11:00:01.000Z",
};

const frame = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ ...payload, ...overrides });

describe("parseModeFrame", () => {
  it("reads a complete payload", () => {
    const mode = parseModeFrame(frame());
    assert.ok(mode);
    assert.equal(mode.mode, "work");
    assert.equal(mode.source, "explicit override");
    assert.equal(mode.schedule.timeZone, "America/New_York");
  });

  it("refuses a frame that is not JSON at all", () => {
    assert.equal(parseModeFrame(""), null);
    assert.equal(parseModeFrame("{"), null);
    assert.equal(parseModeFrame("null"), null);
    assert.equal(parseModeFrame('"work"'), null);
  });

  it("refuses a mode the badge cannot render", () => {
    assert.equal(parseModeFrame(frame({ mode: "away" })), null);
    assert.equal(parseModeFrame(frame({ mode: null })), null);
  });

  it("refuses a payload with no schedule to explain it", () => {
    assert.equal(parseModeFrame(frame({ schedule: null })), null);
    assert.equal(parseModeFrame(frame({ schedule: { ...payload.schedule, timeZone: 7 } })), null);
    assert.equal(parseModeFrame(frame({ schedule: { ...payload.schedule, days: "weekdays" } })), null);
    assert.equal(parseModeFrame(frame({ schedule: { ...payload.schedule, start: 830 } })), null);
  });

  it("refuses a payload with no source or stamp", () => {
    assert.equal(parseModeFrame(frame({ source: 42 })), null);
    assert.equal(parseModeFrame(frame({ checkedAt: undefined })), null);
  });
});
