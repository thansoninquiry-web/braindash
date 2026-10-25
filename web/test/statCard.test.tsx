import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import StatCard from "../src/components/StatCard.js";

function html(props: Parameters<typeof StatCard>[0]): string {
  return renderToStaticMarkup(<StatCard {...props} />);
}

describe("StatCard liveness", () => {
  it("keeps a plain card when motion is off", () => {
    const markup = html({ label: "Notes indexed", value: "41", caption: "34 dated" });
    assert.ok(markup.includes('class="metric"'), "no animation class");
    assert.equal(markup.includes("is-animated"), false);
    assert.ok(markup.includes('class="metric-scan"'), "the scan layer is still present");
    assert.ok(markup.includes('aria-hidden="true"'), "the scan is decorative");
  });

  it("adds the scan, the tick and an animated sparkline when motion is on", () => {
    const markup = html({
      label: "Captures · 30d",
      value: "34",
      caption: "Latest: Alpha",
      spark: [3, 1, 0],
      animate: true,
    });
    assert.ok(markup.includes('class="metric is-animated"'));
    assert.ok(markup.includes('class="metric-scan"'));
    assert.ok(markup.includes('class="sparkline is-animated"'));
  });
});
