import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyOutdated,
  markdown,
  parseOutdated,
  renderReport,
  type OutdatedEntry,
} from "../../scripts/check-deps.mjs";

/** The shape `npm outdated --json --long` prints for one dependency. */
function row(overrides: Partial<OutdatedEntry> = {}): OutdatedEntry {
  return {
    name: "vite",
    current: "6.0.0",
    wanted: "6.0.0",
    latest: "6.0.0",
    type: "devDependencies",
    dependent: "web",
    ...overrides,
  };
}

describe("check-deps — reading npm's report", () => {
  it("reads a single row and an array of rows for one name", () => {
    const entries = parseOutdated(
      JSON.stringify({
        vite: row({ name: "unknown", dependent: "web" }),
        "@types/node": [
          row({ name: "unknown", dependent: "server", current: "22.20.5", wanted: "22.20.5", latest: "26.6.5" }),
          row({ name: "unknown", dependent: "web", current: "22.20.5", wanted: "22.20.5", latest: "26.6.5" }),
        ],
      }),
    );
    assert.deepEqual(
      entries.map((entry) => [entry.name, entry.dependent, entry.wanted]),
      [
        ["vite", "web", "6.0.0"],
        ["@types/node", "server", "22.20.5"],
        ["@types/node", "web", "22.20.5"],
      ],
    );
  });

  it("skips npm warnings printed before the JSON", () => {
    const entries = parseOutdated(
      "npm warn EBADENGINE package engine mismatch\n" + JSON.stringify({ vite: row() }),
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.name, "vite");
  });

  it("is empty for an empty object and for output with no payload", () => {
    assert.deepEqual(parseOutdated("{}"), []);
    assert.deepEqual(parseOutdated(""), []);
    assert.deepEqual(parseOutdated("npm error something went wrong"), []);
  });

  it("rejects malformed JSON instead of guessing", () => {
    assert.throws(() => parseOutdated("{not json"), /did not print JSON/);
  });
});

describe("check-deps — what counts as drift", () => {
  it("is clean when every entry matches its declared range", () => {
    const report = classifyOutdated([row(), row({ name: "react", dependent: "web" })]);
    assert.deepEqual(report, { inRange: [], outOfRange: [] });
  });

  it("treats a lockfile behind its range as in-range drift", () => {
    const report = classifyOutdated([row({ current: "6.3.4", wanted: "6.4.4", latest: "6.4.4" })]);
    assert.equal(report.inRange.length, 1);
    assert.equal(report.inRange[0]?.current, "6.3.4");
    assert.deepEqual(report.outOfRange, []);
  });

  it("treats a missing current version as in-range drift", () => {
    const report = classifyOutdated([row({ current: undefined })]);
    assert.equal(report.inRange.length, 1, "npm ci installed it but the lockfile disagrees");
    assert.deepEqual(report.outOfRange, []);
  });

  it("leaves a newer version outside the range as informational only", () => {
    const report = classifyOutdated([
      row({ name: "@types/node", current: "22.20.5", wanted: "22.20.5", latest: "26.6.5" }),
    ]);
    assert.deepEqual(report.inRange, []);
    assert.equal(report.outOfRange.length, 1);
    assert.equal(report.outOfRange[0]?.latest, "26.6.5");
  });

  it("classifies each workspace's row separately", () => {
    const report = classifyOutdated([
      row({ name: "typescript", dependent: "server", current: "5.7.3", wanted: "5.9.3" }),
      row({ name: "typescript", dependent: "web", current: "5.9.3", wanted: "5.9.3", latest: "7.0.2" }),
    ]);
    assert.deepEqual(report.inRange.map((entry) => entry.dependent), ["server"]);
    assert.deepEqual(report.outOfRange.map((entry) => entry.dependent), ["web"]);
  });

  it("drops a row with no wanted version rather than reading it as drift", () => {
    assert.deepEqual(classifyOutdated([row({ wanted: undefined })]), { inRange: [], outOfRange: [] });
  });

  it("sorts by name, then by workspace, whatever order npm answered in", () => {
    const report = classifyOutdated([
      row({ name: "vite", dependent: "web", current: "5.0.0" }),
      row({ name: "@types/node", dependent: "web", current: "22.0.0" }),
      row({ name: "@types/node", dependent: "server", current: "22.0.0" }),
    ]);
    assert.deepEqual(
      report.inRange.map((entry) => [entry.name, entry.dependent]),
      [
        ["@types/node", "server"],
        ["@types/node", "web"],
        ["vite", "web"],
      ],
    );
  });
});

describe("check-deps — what a person reads", () => {
  it("says plainly that there is no drift", () => {
    const text = renderReport({ inRange: [], outOfRange: [] });
    assert.match(text, /No dependency drift/);
    assert.doesNotMatch(text, /\|/);
  });

  it("names the stale entries and the fix, with counts in the right number", () => {
    const text = renderReport({
      inRange: [row({ current: "6.3.4", wanted: "6.4.4" })],
      outOfRange: [],
    });
    assert.match(text, /1 lockfile entry is behind/);
    assert.match(text, /vite {2}6\.3\.4 -> 6\.4\.4 {2}\[web\]/);
    assert.match(text, /npm update/);
    assert.doesNotMatch(text, /outside the declared ranges/);
  });

  it("pluralises counts and shows a missing current version as such", () => {
    const text = renderReport({
      inRange: [row({ current: undefined }), row({ name: "@types/node", current: "22.0.0", wanted: "22.1.0" })],
      outOfRange: [],
    });
    assert.match(text, /2 lockfile entries are behind/);
    assert.match(text, /\(missing\) -> 6\.0\.0/);
  });

  it("reports informational updates without calling them failures", () => {
    const text = renderReport({
      inRange: [],
      outOfRange: [row({ wanted: "6.4.4", latest: "8.3.4" })],
    });
    assert.match(text, /Lockfile is in date with every declared range/);
    assert.match(text, /1 newer version outside the declared ranges \(informational\)/);
    assert.match(text, /6\.4\.4 -> 8\.3\.4/);
    assert.doesNotMatch(text, /npm update/);
  });

  it("writes a Markdown summary with both tables", () => {
    const summary = markdown({
      inRange: [row({ current: "6.3.4", wanted: "6.4.4", latest: "6.4.4" })],
      outOfRange: [
        row({ name: "express", current: "4.22.3", wanted: "4.22.3", latest: "5.3.0", dependent: "server" }),
      ],
    });
    assert.match(summary, /## Dependency drift/);
    assert.match(summary, /\*\*1 in-range\*\* — the lockfile is stale:/);
    assert.match(summary, /\| `vite` \| 6\.3\.4 \| 6\.4\.4 \| 6\.4\.4 \| web \|/);
    assert.match(summary, /\*\*1 outside the declared ranges\*\* — informational:/);
    assert.match(summary, /\| `express` \| 4\.22\.3 \| 4\.22\.3 \| 5\.3\.0 \| server \|/);
  });

  it("writes a short summary when nothing moved", () => {
    const summary = markdown({ inRange: [], outOfRange: [] });
    assert.match(summary, /Every lockfile entry matches its declared range/);
    assert.doesNotMatch(summary, /\| ---/);
  });
});
