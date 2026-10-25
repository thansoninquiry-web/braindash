import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import DependencyHealthCard from "../src/components/DependencyHealth.js";
import type { DependencyHealth, DepsPackage } from "../src/types.js";

function pkg(name: string, overrides: Partial<DepsPackage> = {}): DepsPackage {
  return {
    name,
    current: "1.0.0",
    wanted: "1.1.0",
    latest: "1.1.0",
    dependent: "web",
    ...overrides,
  };
}

function health(overrides: Partial<DependencyHealth> = {}): DependencyHealth {
  return {
    ok: true,
    checkedAt: "2026-10-21T05:00:00.000Z",
    behind: 0,
    newer: 0,
    stale: [],
    majors: [],
    error: null,
    cached: false,
    ...overrides,
  };
}

function html(deps: DependencyHealth | null, loading = false): string {
  return renderToStaticMarkup(
    <DependencyHealthCard
      deps={deps}
      loading={loading}
      checkedLabel={deps ? "Checked 1:00 AM" : ""}
      onRecheck={() => {}}
    />,
  );
}

describe("DependencyHealthCard — behind the ranges", () => {
  it("leads with the count and names the packages that are behind", () => {
    const markup = html(
      health({ behind: 2, newer: 1, stale: [pkg("vite", { current: "6.3.4", wanted: "6.4.4" }), pkg("react")] }),
    );
    assert.match(markup, /data-state="behind"/);
    assert.match(markup, /<span class="dep-count">2<\/span>/);
    assert.match(markup, /packages behind/);
    assert.match(markup, /The lockfile is behind a range package.json already allows\./);
    assert.match(markup, /vite/);
    assert.match(markup, /6\.3\.4 → 6\.4\.4/);
    assert.match(markup, /1 newer major outside the declared ranges/);
  });

  it("shows at most three rows and counts the rest", () => {
    const stale = ["a", "b", "c", "d", "e"].map((name) => pkg(name));
    const markup = html(health({ behind: 5, stale }));
    assert.equal((markup.match(/class="dep-name"/g) ?? []).length, 3);
    assert.match(markup, /\+2 more/);
  });

  it("says missing, not a version, when the lockfile has no current entry", () => {
    const markup = html(health({ behind: 1, stale: [pkg("vite", { current: null })] }));
    assert.match(markup, /missing → 1\.1\.0/);
  });

  it("pluralises the unit and the major note", () => {
    const single = html(health({ behind: 1, newer: 1, stale: [pkg("vite")] }));
    assert.match(single, /package behind/);
    assert.doesNotMatch(single, /packages behind/);
    assert.match(single, /1 newer major outside/);
    assert.doesNotMatch(single, /1 newer majors/);
  });
});

describe("DependencyHealthCard — the quiet states", () => {
  it("confirms a lockfile that matches every range", () => {
    const markup = html(health());
    assert.match(markup, /data-state="clean"/);
    assert.match(markup, /<span class="dep-count">0<\/span>/);
    assert.match(markup, /Lockfile matches every declared range\./);
    assert.equal(markup.includes("dep-list"), false);
    assert.equal(markup.includes("newer major"), false);
  });

  it("reports npm failing without hiding the card", () => {
    const markup = html(health({ ok: false, error: "npm outdated failed (exit 1)" }));
    assert.match(markup, /data-state="unavailable"/);
    assert.match(markup, /<span class="dep-count">—<\/span>/);
    assert.match(markup, /npm outdated failed \(exit 1\)/);
  });

  it("waits visibly before the first answer, with Recheck disabled", () => {
    const markup = html(null, true);
    assert.match(markup, /data-state="pending"/);
    assert.match(markup, /Comparing the lockfile with what the registry allows/);
    assert.match(markup, /Rechecking…/);
    assert.match(markup, /<button[^>]*disabled/);
  });

  it("offers a working Recheck once an answer is in", () => {
    const markup = html(health(), false);
    assert.equal(markup.includes("disabled"), false);
    assert.match(markup, /Checked 1:00 AM/);
    assert.match(markup, />Recheck</);
  });
});
