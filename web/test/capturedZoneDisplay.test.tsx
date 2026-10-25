import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RecallStamp } from "../src/components/DailyRecall.js";
import { SearchHitRow } from "../src/components/SearchBar.js";
import type { SearchHit } from "../src/types.js";

const clock = { timeZone: "Asia/Tokyo", hour12: true };
const noop = () => {};

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    path: "notes/alpha.md",
    title: "Alpha Note",
    captured: "2026-10-18 3:38 PM",
    capturedZone: "America/New_York",
    area: "career",
    origin: "me",
    tags: ["focus"],
    match: "body",
    snippet: "The orchard and the lantern.",
    ...overrides,
  };
}

function row(overrides: Partial<SearchHit> = {}): string {
  return renderToStaticMarkup(
    <SearchHitRow
      hit={hit(overrides)}
      index={0}
      active={false}
      query="orchard"
      clock={clock}
      onHover={noop}
      onOpen={noop}
    />,
  );
}

function stamp(
  props: { captured?: string | null; capturedZone?: string | null } = {},
): string {
  return renderToStaticMarkup(
    <RecallStamp
      captured={props.captured === undefined ? "2026-10-18 3:38 PM" : props.captured}
      capturedZone={props.capturedZone === undefined ? "America/New_York" : props.capturedZone}
      clock={clock}
    />,
  );
}

describe("SearchHitRow — captured zone", () => {
  it("names the zone under the stamp converted into the chosen zone", () => {
    const markup = row();
    // 3:38 PM in New York is 4:38 AM the next morning in Tokyo.
    assert.ok(markup.includes("Oct 19, 2026 · 4:38 AM GMT+9"), "the stamp is converted");
    assert.ok(markup.includes('class="hit-zone"'), "the zone has its own slot");
    assert.ok(markup.includes(">America/New_York</span>"), "the recorded zone is named");
    assert.ok(markup.includes('title="Captured in America/New_York"'));
  });

  it("omits the zone for a date-only capture, which has no clock to convert", () => {
    const markup = row({ captured: "2026-10-18" });
    assert.ok(markup.includes("Oct 18, 2026"));
    assert.equal(markup.includes("hit-zone"), false);
  });

  it("omits the zone when the note recorded none", () => {
    const markup = row({ capturedZone: null });
    assert.ok(markup.includes("Oct 19, 2026 · 4:38 AM GMT+9"));
    assert.equal(markup.includes("hit-zone"), false);
  });

  it("keeps the undated case unchanged", () => {
    const markup = row({ captured: null, capturedZone: null });
    assert.ok(markup.includes("undated"));
    assert.equal(markup.includes("hit-zone"), false);
  });
});

describe("RecallStamp — captured zone", () => {
  it("names the zone beside the converted stamp", () => {
    const markup = stamp();
    assert.ok(markup.includes("Recorded Oct 19, 2026 · 4:38 AM GMT+9"), "the stamp is converted");
    assert.ok(markup.includes('class="recall-zone"'), "the zone has its own slot");
    assert.ok(markup.includes(">America/New_York</span>"), "the recorded zone is named");
    assert.ok(markup.includes('title="Captured in America/New_York"'));
  });

  it("omits the zone for a date-only capture", () => {
    const markup = stamp({ captured: "2026-10-18" });
    assert.ok(markup.includes("Recorded Oct 18, 2026"));
    assert.equal(markup.includes("recall-zone"), false);
  });

  it("omits the zone when the note recorded none", () => {
    const markup = stamp({ capturedZone: null });
    assert.equal(markup.includes("recall-zone"), false);
  });

  it("keeps the no-capture case unchanged", () => {
    const markup = stamp({ captured: null, capturedZone: null });
    assert.ok(markup.includes("No captured date recorded"));
    assert.equal(markup.includes("recall-zone"), false);
  });
});
