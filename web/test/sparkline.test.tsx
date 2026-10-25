import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import Sparkline from "../src/components/Sparkline.js";

function html(props: Parameters<typeof Sparkline>[0]): string {
  return renderToStaticMarkup(<Sparkline {...props} />);
}

const labels = [
  "MON, OCT 19, 2026 · 3 captures",
  "TUE, OCT 20, 2026 · 1 capture",
  "WED, OCT 21, 2026 · 0 captures",
];

describe("Sparkline hover labels", () => {
  it("gives every bucket a hit band whose title names its date and count", () => {
    const markup = html({ values: [3, 1, 0], labels, label: "Captures · 30d" });
    assert.equal((markup.match(/class="sparkline-hit"/g) ?? []).length, 3);
    assert.equal((markup.match(/<title>/g) ?? []).length, 3);
    for (const label of labels) assert.ok(markup.includes(label), label);
  });

  it("omits the bands when there are no labels to show", () => {
    const markup = html({ values: [3, 1, 0], label: "Captures · 30d" });
    assert.equal(markup.includes("sparkline-hit"), false);
    assert.equal(markup.includes("<title>"), false);
  });

  it("omits the bands when the labels do not line up with the values", () => {
    const markup = html({ values: [3, 1, 0], labels: labels.slice(0, 2), label: "Captures · 30d" });
    assert.equal(markup.includes("sparkline-hit"), false);
  });

  it("keeps the empty line for a series too short to draw", () => {
    const markup = html({ values: [3], labels: labels.slice(0, 1), label: "Captures · 30d" });
    assert.ok(markup.includes('class="sparkline-empty"'));
    assert.equal(markup.includes("<svg"), false);
  });

  it("follows the app's motion setting rather than animating unconditionally", () => {
    const still = html({ values: [3, 1, 0], label: "Captures · 30d" });
    assert.ok(still.includes('class="sparkline"'), "the still frame has no animation class");
    assert.equal(still.includes("is-animated"), false);

    const moving = html({ values: [3, 1, 0], label: "Captures · 30d", animate: true });
    assert.ok(moving.includes('class="sparkline is-animated"'), "motion on animates the line");
  });
});
