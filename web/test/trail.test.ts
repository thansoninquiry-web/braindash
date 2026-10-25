import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trailTooltip } from "../src/trail.js";

describe("trailTooltip", () => {
  it("names the zone a timed capture was recorded in", () => {
    assert.equal(
      trailTooltip("notes/zoned.md", "2026-10-18 3:38 PM", "America/New_York"),
      "Open notes/zoned.md · captured in America/New_York",
    );
  });

  it("stays plain for a date-only capture, which has no clock to convert", () => {
    assert.equal(
      trailTooltip("notes/day.md", "2026-10-18", "America/New_York"),
      "Open notes/day.md",
    );
  });

  it("stays plain when the note recorded no zone or no capture", () => {
    assert.equal(trailTooltip("notes/machine.md", "2026-10-18 3:38 PM", null), "Open notes/machine.md");
    assert.equal(trailTooltip("notes/none.md", null, null), "Open notes/none.md");
  });
});
