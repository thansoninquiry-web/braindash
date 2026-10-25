import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import TrailRow from "../src/components/TrailRow.js";
import type { NoteSummary } from "../src/types.js";

const clock = { timeZone: "Asia/Tokyo", hour12: true };
const noop = () => {};

function entry(overrides: Partial<NoteSummary> = {}): NoteSummary {
  return {
    path: "notes/alpha.md",
    title: "Alpha Note",
    captured: "2026-10-18 3:38 PM",
    capturedZone: "America/New_York",
    nextReview: null,
    origin: "me",
    area: "career",
    words: 6,
    bytes: 861,
    keywords: [],
    tags: [],
    ...overrides,
  };
}

function row(overrides: Partial<NoteSummary> = {}): string {
  return renderToStaticMarkup(<TrailRow entry={entry(overrides)} clock={clock} onOpen={noop} />);
}

describe("TrailRow — captured zone", () => {
  it("shows the origin in the row, not only in the hover title", () => {
    const markup = row();
    assert.ok(markup.includes('class="trail-row has-zone"'), "the row marks that it has a zone");
    assert.ok(markup.includes('class="trail-zone"'), "the zone has its own visible line");
    assert.ok(markup.includes(">captured in America/New_York</span>"), "the origin is readable");
    assert.ok(markup.includes('title="Captured in America/New_York"'));
  });

  it("keeps the hover title naming the path and the origin", () => {
    const markup = row();
    assert.ok(markup.includes('title="Open notes/alpha.md · captured in America/New_York"'));
  });

  it("omits the zone for a date-only capture, which has no clock to convert", () => {
    const markup = row({ captured: "2026-10-18" });
    assert.ok(markup.includes("OCT 18"));
    assert.equal(markup.includes("trail-zone"), false);
    assert.equal(markup.includes("has-zone"), false);
  });

  it("omits the zone when the note recorded none", () => {
    const markup = row({ capturedZone: null });
    assert.ok(markup.includes("OCT 19"), "the stamp is still converted into the chosen zone");
    assert.equal(markup.includes("trail-zone"), false);
  });

  it("keeps the undated row working", () => {
    const markup = row({ captured: null, capturedZone: null });
    assert.ok(markup.includes("UNDATED"));
    assert.equal(markup.includes("trail-zone"), false);
  });
});
