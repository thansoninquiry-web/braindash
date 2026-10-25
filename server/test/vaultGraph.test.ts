import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWikilink, type Wikilink } from "../../shared/wikilinks.js";
import { buildGraph, noteConnections, type NoteMeta, type VaultScan } from "../src/vault.js";

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
  return {
    path: file,
    title: file.replace(/^.*\//, "").replace(/\.md$/i, ""),
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

/** The graph never touches the disk, so a scan is just its notes. */
function scanOf(notes: NoteMeta[]): VaultScan {
  return {
    vaultPath: "/vault",
    scannedAt: "2026-10-19T00:00:00.000Z",
    notes,skipped: [],unreadable: [],
    bodies: new Map(notes.map((entry) => [entry.path, ""])),
  };
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

// The index itself is tested in `wikilinks.test.ts`; this is the graph using it.
describe("wikilink resolution through the graph", () => {
  it("resolves whatever case or padding a link was written with", () => {
    const graph = buildGraph(
      scanOf([note("notes/beta.md", { title: "Beta Note" }), note("a.md", { links: ["BETA NOTE"] })]),
    );
    assert.deepEqual(graph.edges, [{ source: "a.md", target: "notes/beta.md", type: "wikilink" }]);

    const source = note("c.md", { links: ["  beta note  "] });
    const connections = noteConnections(
      scanOf([source, note("notes/beta.md", { title: "Beta Note" })]),
      source,
    );
    assert.equal(connections.outbound[0]?.path, "notes/beta.md");
  });
});

describe("buildGraph — empty and unconnected vaults", () => {
  it("returns empty everything for a vault with no notes", () => {
    assert.deepEqual(buildGraph(scanOf([])), {
      nodes: [],
      edges: [],
      isolated: [],
      unresolved: [],
      truncated: false,
    });
  });

  it("makes every note isolated when nothing connects them", () => {
    const graph = buildGraph(scanOf([note("a.md"), note("b.md")]));
    assert.deepEqual(graph.isolated, ["a.md", "b.md"]);
    assert.deepEqual(graph.edges, []);
    assert.deepEqual(graph.unresolved, []);
    assert.equal(graph.truncated, false);
  });

  it("carries each note's identity onto its node", () => {
    const graph = buildGraph(
      scanOf([note("notes/a.md", { title: "Alpha", tags: ["work"], area: "career" })]),
    );
    assert.deepEqual(graph.nodes, [
      { id: "notes/a.md", title: "Alpha", tags: ["work"], area: "career" },
    ]);
  });
});

describe("buildGraph — broken and odd links", () => {
  it("reports a broken wikilink instead of drawing it", () => {
    const graph = buildGraph(scanOf([note("a.md", { links: ["Nope"] })]));
    assert.deepEqual(graph.unresolved, ["Nope"]);
    assert.deepEqual(graph.edges, []);
    assert.deepEqual(graph.isolated, ["a.md"]);
  });

  it("dedupes and sorts unresolved targets across the vault", () => {
    const graph = buildGraph(
      scanOf([
        note("a.md", { links: ["Zed", "Amy"] }),
        note("b.md", { links: ["Amy", "  Amy  "] }),
      ]),
    );
    assert.deepEqual(graph.unresolved, ["Amy", "Zed"]);
  });

  it("never draws a note's link to itself", () => {
    const graph = buildGraph(scanOf([note("a.md", { title: "Alpha", links: ["Alpha"] })]));
    assert.deepEqual(graph.edges, []);
    assert.deepEqual(graph.unresolved, [], "a self link resolves, it is just not an edge");
    assert.deepEqual(graph.isolated, ["a.md"]);
  });

  it("draws one line for a pair linked several times", () => {
    const graph = buildGraph(
      scanOf([note("a.md", { links: ["Beta", "Beta", "b"] }), note("b.md", { title: "Beta" })]),
    );
    assert.equal(graph.edges.length, 1);
    assert.deepEqual(graph.edges[0], { source: "a.md", target: "b.md", type: "wikilink" });
  });

  it("resolves a link written as a title, a path or a slug", () => {
    const graph = buildGraph(
      scanOf([
        note("notes/beta.md", { title: "Beta Note" }),
        note("by-title.md", { links: ["Beta Note"] }),
        note("by-path.md", { links: ["notes/beta"] }),
        note("by-slug.md", { links: ["beta"] }),
        note("by-spaced-slug.md", { links: ["notes/beta", "beta"] }),
      ]),
    );
    const intoBeta = graph.edges.filter((edge) => edge.target === "notes/beta.md");
    assert.deepEqual(intoBeta.map((edge) => edge.source).sort(), [
      "by-path.md",
      "by-slug.md",
      "by-spaced-slug.md",
      "by-title.md",
    ]);
    assert.deepEqual(graph.unresolved, []);
  });
});

describe("buildGraph — shared tags", () => {
  it("draws one tag edge per pair, whichever order the notes arrive", () => {
    const graph = buildGraph(
      scanOf([note("b.md", { tags: ["work"] }), note("a.md", { tags: ["work"] })]),
    );
    assert.deepEqual(graph.edges, [{ source: "a.md", target: "b.md", type: "tag" }]);
    assert.deepEqual(graph.isolated, [], "both notes are connected now");
  });

  it("connects every pair in a tag's group", () => {
    const graph = buildGraph(
      scanOf([
        note("a.md", { tags: ["work"] }),
        note("b.md", { tags: ["work"] }),
        note("c.md", { tags: ["work"] }),
      ]),
    );
    assert.equal(graph.edges.length, 3);
    assert.deepEqual(
      graph.edges.map((edge) => pairKey(edge.source, edge.target)).sort(),
      ["a.md|b.md", "a.md|c.md", "b.md|c.md"],
    );
  });

  it("never doubles a pair that is both linked and tagged", () => {
    const graph = buildGraph(
      scanOf([
        note("a.md", { tags: ["work"], links: ["B"] }),
        note("b.md", { title: "B", tags: ["work"] }),
      ]),
    );
    assert.deepEqual(graph.edges, [{ source: "a.md", target: "b.md", type: "wikilink" }]);
  });

  it("keeps the direction of the link that made the pair", () => {
    const graph = buildGraph(
      scanOf([
        note("a.md", { title: "A", tags: ["work"] }),
        note("b.md", { title: "B", tags: ["work"], links: ["A"] }),
      ]),
    );
    assert.deepEqual(graph.edges, [{ source: "b.md", target: "a.md", type: "wikilink" }]);
  });

  it("stops at the tag-pair cap and says it truncated", () => {
    const notes = Array.from({ length: 40 }, (_, index) =>
      note(`n${String(index).padStart(2, "0")}.md`, { tags: ["big"] }),
    );
    const graph = buildGraph(scanOf(notes));
    const pairs = new Set(graph.edges.map((edge) => pairKey(edge.source, edge.target)));
    assert.equal(graph.truncated, true);
    assert.equal(pairs.size, graph.edges.length, "no duplicate lines");
    assert.ok(graph.edges.length < (40 * 39) / 2, "it stopped before every pair");
  });

  it("only ever references nodes it emitted", () => {
    const graph = buildGraph(
      scanOf([
        note("a.md", { tags: ["work"], links: ["missing"] }),
        note("b.md", { tags: ["work"] }),
      ]),
    );
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      assert.ok(ids.has(edge.source) && ids.has(edge.target), JSON.stringify(edge));
    }
  });
});

describe("noteConnections", () => {
  it("is empty for a note with no links and no tags", () => {
    const lone = note("a.md");
    assert.deepEqual(noteConnections(scanOf([lone]), lone), { outbound: [], backlinks: [] });
  });

  it("resolves what it can and reports the rest untouched", () => {
    const source = note("a.md", { links: ["Beta Note#Top|B", "Ghost"] });
    const { outbound } = noteConnections(
      scanOf([source, note("notes/beta.md", { title: "Beta Note" })]),
      source,
    );
    assert.deepEqual(outbound, [
      {
        target: "Beta Note",
        heading: "Top",
        alias: "B",
        label: "B",
        path: "notes/beta.md",
        title: "Beta Note",
      },
      { target: "Ghost", heading: null, alias: null, label: "Ghost", path: null, title: null },
    ]);
  });

  it("lists link backlinks before tag backlinks", () => {
    const source = note("a.md", { title: "A", tags: ["work"] });
    const connections = noteConnections(
      scanOf([
        source,
        note("linked.md", { title: "Zed", links: ["A"] }),
        note("tagged.md", { title: "Alpha", tags: ["work", "extra"] }),
      ]),
      source,
    );
    assert.deepEqual(
      connections.backlinks.map((entry) => [entry.title, entry.via, entry.tags]),
      [
        ["Zed", "wikilink", []],
        ["Alpha", "tag", ["work"]],
      ],
    );
  });

  it("puts a tag backlink after a link backlink even when the tag note comes first", () => {
    const source = note("a.md", { title: "A", tags: ["work"] });
    const connections = noteConnections(
      scanOf([
        source,
        note("tagged.md", { title: "Alpha", tags: ["work"] }),
        note("linked.md", { title: "Zed", links: ["A"] }),
      ]),
      source,
    );
    assert.deepEqual(
      connections.backlinks.map((entry) => entry.via),
      ["wikilink", "tag"],
      "the deliberate link outranks the shared tag whatever order the scan found them in",
    );
  });

  it("lists a note once when it both links here and shares a tag", () => {
    const source = note("a.md", { title: "A", tags: ["work"] });
    const connections = noteConnections(
      scanOf([source, note("b.md", { title: "B", tags: ["work"], links: ["A"] })]),
      source,
    );
    assert.deepEqual(connections.backlinks, [
      { path: "b.md", title: "B", via: "wikilink", tags: [] },
    ]);
  });

  it("never lists the note itself, and never a broken link", () => {
    const source = note("a.md", { title: "A", tags: ["work"], links: ["A"] });
    const connections = noteConnections(
      scanOf([source, note("b.md", { title: "B", links: ["A", "Nobody"] })]),
      source,
    );
    assert.deepEqual(connections.backlinks, [
      { path: "b.md", title: "B", via: "wikilink", tags: [] },
    ]);
  });

  it("sorts backlinks of the same kind by title", () => {
    const source = note("a.md", { title: "A" });
    const connections = noteConnections(
      scanOf([
        source,
        note("zed.md", { title: "Zed", links: ["A"] }),
        note("alpha.md", { title: "Alpha", links: ["A"] }),
      ]),
      source,
    );
    assert.deepEqual(connections.backlinks.map((entry) => entry.title), ["Alpha", "Zed"]);
  });
});
