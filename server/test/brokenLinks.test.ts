import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWikilink, type Wikilink } from "../../shared/wikilinks.js";
import {
  buildBrokenLinkReport,
  buildGraph,
  type NoteMeta,
  type VaultScan,
} from "../src/vault.js";

/** A fixture written as the inside of a link (`Target#Heading|Alias`). */
function wikilink(raw: string): Wikilink {
  return parseWikilink(raw) ?? { target: raw, heading: null, alias: null, label: raw };
}

/** A note with sensible defaults; a real scan fills the same shape. */
function note(
  file: string,
  overrides: Partial<Omit<NoteMeta, "links">> & { links?: Array<string | Wikilink> } = {},
): NoteMeta {
  const { links = [], ...rest } = overrides;
  const title = file.replace(/^.*\//, "").replace(/\.md$/i, "");
  return {
    path: file,
    title: title.replace(/\b\w/g, (character) => character.toUpperCase()),
    captured: null,
    capturedZone: null,
    nextReview: null,
    origin: null,
    area: null,
    words: 10,
    bytes: 100,
    keywords: [],
    tags: [],
    links: links.map((link) => (typeof link === "string" ? wikilink(link) : link)),
    frontmatter: "",
    ...rest,
  };
}

/** The report never touches the disk, so a scan is just its notes. */
function scanOf(notes: NoteMeta[]): VaultScan {
  return {
    vaultPath: "/vault",
    scannedAt: "2026-10-19T00:00:00.000Z",
    notes,skipped: [],unreadable: [],
    bodies: new Map(notes.map((entry) => [entry.path, ""])),
  };
}

describe("buildBrokenLinkReport — grouping by the alias each note wrote", () => {
  it("is empty for a vault with nothing broken", () => {
    assert.deepEqual(buildBrokenLinkReport(scanOf([])), { total: 0, groups: [] });
    assert.deepEqual(
      buildBrokenLinkReport(scanOf([note("a.md", { links: ["a"] })])),
      { total: 0, groups: [] },
      "a self link resolves, so it is not broken",
    );
  });

  it("puts two different misspellings under the label both notes show", () => {
    const report = buildBrokenLinkReport(
      scanOf([
        note("a.md", { links: ["Missing Note|roadmap"] }),
        note("b.md", { links: ["Other Ghost|roadmap"] }),
      ]),
    );

    assert.equal(report.total, 2);
    assert.equal(report.groups.length, 1);
    assert.deepEqual(report.groups[0], {
      label: "roadmap",
      targets: ["Missing Note", "Other Ghost"],
      notes: [
        { path: "a.md", title: "A", target: "Missing Note", alias: "roadmap" },
        { path: "b.md", title: "B", target: "Other Ghost", alias: "roadmap" },
      ],
    });
  });

  it("uses the written target when the link has no alias", () => {
    const report = buildBrokenLinkReport(
      scanOf([note("a.md", { links: ["Ghost", "Phantom"] })]),
    );
    assert.deepEqual(
      report.groups.map((group) => [group.label, group.targets]),
      [
        ["Ghost", ["Ghost"]],
        ["Phantom", ["Phantom"]],
      ],
      "equal counts fall back to the label alphabetically",
    );
    assert.equal(report.total, 2);
  });

  it("folds labels that differ only by case and keeps the first spelling", () => {
    const report = buildBrokenLinkReport(
      scanOf([
        note("b.md", { links: ["Beta|Road Map"] }),
        note("a.md", { links: ["Alpha|road map"] }),
      ]),
    );
    assert.equal(report.groups.length, 1);
    assert.equal(report.groups[0]?.label, "Road Map", "the scan reached b.md first");
    assert.deepEqual(report.groups[0]?.targets, ["Alpha", "Beta"]);
    assert.deepEqual(
      report.groups[0]?.notes.map((entry) => entry.title),
      ["A", "B"],
      "notes are ordered by title, not scan order",
    );
  });

  it("reports one target under two aliases in both groups", () => {
    const report = buildBrokenLinkReport(
      scanOf([
        note("a.md", { links: ["Same Target|first"] }),
        note("b.md", { links: ["Same Target|second"] }),
      ]),
    );
    assert.deepEqual(
      report.groups.map((group) => [group.label, group.targets]),
      [
        ["first", ["Same Target"]],
        ["second", ["Same Target"]],
      ],
    );
    assert.equal(report.total, 2);
  });

  it("leaves links that resolve out of the report", () => {
    const report = buildBrokenLinkReport(
      scanOf([
        note("notes/beta.md", { title: "Beta Note" }),
        note("a.md", { links: ["Beta Note", "beta", "Ghost"] }),
      ]),
    );
    assert.deepEqual(
      report.groups.map((group) => group.targets),
      [["Ghost"]],
    );
    assert.equal(report.total, 1);
  });

  it("does not count the same target twice in one note", () => {
    const report = buildBrokenLinkReport(
      scanOf([note("a.md", { links: ["Ghost", "Ghost|spooky"] })]),
    );
    assert.equal(report.total, 1);
    assert.equal(report.groups[0]?.label, "Ghost");
  });

  it("counts a titled link once per note and sorts the queue by weight", () => {
    const report = buildBrokenLinkReport(
      scanOf([
        note("a.md", { links: ["one|Alpha"] }),
        note("b.md", { links: ["two|Alpha", "Beta"] }),
        note("c.md", { links: ["three|Alpha", "Beta"] }),
      ]),
    );
    assert.deepEqual(
      report.groups.map((group) => [group.label, group.notes.length]),
      [
        ["Alpha", 3],
        ["Beta", 2],
      ],
    );
    assert.equal(report.total, 5);
  });
});

describe("buildBrokenLinkReport — agrees with the graph", () => {
  it("reports exactly the graph's unresolved targets, aliases or not", () => {
    const scan = scanOf([
      note("notes/beta.md", { title: "Beta Note" }),
      note("a.md", { links: ["Beta Note", "Missing", "Road Map|plan", "Deep#Heading"] }),
      note("b.md", { links: ["roadmap|Plan", "Missing"] }),
    ]);

    const report = buildBrokenLinkReport(scan);
    const reported = new Set(report.groups.flatMap((group) => group.targets));
    const graph = buildGraph(scan);

    assert.deepEqual([...reported].sort(), graph.unresolved);
    assert.equal(report.total, report.groups.reduce((sum, group) => sum + group.notes.length, 0));
  });
});
