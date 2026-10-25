import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickDaily, scanVault, searchNotes, type VaultScan } from "../src/vault.js";

let root = "";
let scan: VaultScan;

async function write(relative: string, body: string): Promise<string> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
  return file;
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-index-"));
  await write(
    "notes/alpha.md",
    [
      "---",
      "title: Alpha Planning",
      "area: career",
      "origin: me",
      "captured: 2026-10-18 3:38 PM",
      "captured_zone: America/New_York",
      "tags: [planning, Work]",
      "---",
      "# A different heading",
      "",
      "Body mentions the orchard once.",
      "",
      "[[Beta note]]",
      "[[Beta note|alias]]",
      "[[Beta note#Detail]]",
      "[[Missing note]]",
      "",
      "#inline-tag",
    ].join("\n"),
  );
  await write(
    "notes/beta-note.md",
    ["# Beta Note", "", "The orchard appears here too. Some text about work.", "", "[[Alpha Planning]]"].join("\n"),
  );
  await write(
    "notes/gamma.md",
    [
      "---",
      "created: 2026-10-17",
      "captured_zone: Mars/Olympus_Mons",
      "area: nowhere",
      "origin: robot",
      "tags:",
      "  - planning",
      "---",
      "Orchard thoughts, nothing much. #planning",
    ].join("\n"),
  );
  // No frontmatter, no heading: the title has to come from the file name.
  await write("archive/2026-10-19-daily-log.md", "A quiet day with no heading and no frontmatter.");
  await write("deep/a/b/C.MD", "# Uppercase Note");
  await write("notes/long.md", `${"filler ".repeat(80)}needleword at the end.`);
  // Everything below is outside the index.
  await write(".obsidian/config.md", "hidden");
  await write("node_modules/pkg/readme.md", "dependency");
  await write("_assets/cover.md", "asset");
  await write("notes/readme.txt", "not markdown");
  await write("notes/.hidden.md", "dotfile");
  await fs.mkdir(path.join(root, "empty-vault"), { recursive: true });

  scan = await scanVault(root);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("scanVault — the index", () => {
  it("lists only markdown notes inside the vault, sorted by path", () => {
    assert.deepEqual(
      scan.notes.map((note) => note.path),
      [
        "archive/2026-10-19-daily-log.md",
        "deep/a/b/C.MD",
        "notes/alpha.md",
        "notes/beta-note.md",
        "notes/gamma.md",
        "notes/long.md",
      ],
    );
    assert.equal(scan.vaultPath, path.resolve(root));
  });

  it("keeps dependency, asset, editor and dotfile folders out", () => {
    const paths = scan.notes.map((note) => note.path).join(" ");
    for (const hidden of [".obsidian", "node_modules", "_assets", "readme.txt", ".hidden.md"]) {
      assert.ok(!paths.includes(hidden), `${hidden} must not be indexed`);
    }
  });

  it("prefers a frontmatter title, then the first heading, then the file name", () => {
    const byPath = new Map(scan.notes.map((note) => [note.path, note]));
    assert.equal(byPath.get("notes/alpha.md")?.title, "Alpha Planning");
    assert.equal(byPath.get("notes/beta-note.md")?.title, "Beta Note");
    assert.equal(byPath.get("deep/a/b/C.MD")?.title, "Uppercase Note");
    assert.equal(byPath.get("notes/gamma.md")?.title, "Gamma");
    assert.equal(byPath.get("archive/2026-10-19-daily-log.md")?.title, "Daily Log");
  });

  it("falls back to a created date and rejects unknown areas and origins", () => {
    const gamma = scan.notes.find((note) => note.path === "notes/gamma.md");
    assert.equal(gamma?.captured, "2026-10-17", "created: stands in for captured:");
    assert.equal(gamma?.area, null, "an unknown area is not guessed");
    assert.equal(gamma?.origin, null, "an unknown origin is not guessed");
    assert.equal(gamma?.capturedZone, null, "an unknown zone is treated as absent");
    assert.equal(gamma?.links.length, 0);
  });

  it("accepts a recorded capture zone and keeps a bad one out", () => {
    const alpha = scan.notes.find((note) => note.path === "notes/alpha.md");
    assert.equal(alpha?.capturedZone, "America/New_York");
    const gamma = scan.notes.find((note) => note.path === "notes/gamma.md");
    assert.equal(gamma?.capturedZone, null);
  });

  it("normalises frontmatter and inline tags, without duplicates", () => {
    const alpha = scan.notes.find((note) => note.path === "notes/alpha.md");
    assert.deepEqual(alpha?.tags, ["planning", "work", "inline-tag"]);
    // The inline tag repeats the frontmatter one; it is still listed once.
    const gamma = scan.notes.find((note) => note.path === "notes/gamma.md");
    assert.deepEqual(gamma?.tags, ["planning"]);
  });

  it("records one parsed link per target, keeping the first spelling", () => {
    const alpha = scan.notes.find((note) => note.path === "notes/alpha.md");
    assert.deepEqual(
      alpha?.links.map((link) => link.target),
      ["Beta note", "Missing note"],
      "the alias and heading spellings collapse into the target",
    );
    // The bare `[[Beta note]]` came first, so it supplies the parts; the later
    // alias and heading are deduped rather than queued as more rows.
    assert.deepEqual(alpha?.links[0], {
      target: "Beta note",
      heading: null,
      alias: null,
      label: "Beta note",
    });
  });

  it("keeps the note bodies alongside the metadata", () => {
    assert.equal(scan.bodies.size, scan.notes.length);
    for (const note of scan.notes) assert.ok(scan.bodies.has(note.path), `${note.path} has a body`);
    assert.ok(scan.bodies.get("notes/alpha.md")?.startsWith("---"), "raw markdown, frontmatter intact");
  });

  it("measures each note's size, words and keywords from the file", async () => {
    for (const note of scan.notes) {
      assert.ok(note.words > 0, `${note.path} has words`);
      assert.ok(note.bytes > 0, `${note.path} has a size`);
    }
    const alpha = scan.notes.find((note) => note.path === "notes/alpha.md");
    const onDisk = await fs.stat(path.join(root, "notes/alpha.md"));
    assert.equal(alpha?.bytes, onDisk.size);
    assert.ok(alpha?.keywords.length && alpha.keywords.length <= 6, "a bounded keyword list");
    assert.ok(!alpha?.keywords.includes("planning"), "frontmatter never becomes a keyword");
    const long = scan.notes.find((note) => note.path === "notes/long.md");
    assert.equal(long?.keywords[0], "filler", "the most repeated prose word leads");
  });

  it("scans an empty vault to nothing", async () => {
    const empty = await scanVault(path.join(root, "empty-vault"));
    assert.deepEqual(empty.notes, []);
    assert.equal(empty.bodies.size, 0);
  });

  it("fails loudly when the vault folder does not exist", async () => {
    await assert.rejects(() => scanVault(path.join(root, "no-such-vault")));
  });
});

describe("searchNotes — ranking", () => {
  it("ignores an empty or whitespace query", () => {
    assert.deepEqual(searchNotes(scan, ""), []);
    assert.deepEqual(searchNotes(scan, "   \n\t "), []);
  });

  it("ranks title matches above tags, and tags above a mention in the body", () => {
    // Beta's body links to "Alpha Planning", so it matches too — last.
    const hits = searchNotes(scan, "planning");
    assert.deepEqual(
      hits.map((hit) => [path.basename(hit.path), hit.match]),
      [
        ["alpha.md", "title"],
        ["gamma.md", "tag"],
        ["beta-note.md", "body"],
      ],
    );
  });

  it("ranks tag matches above body matches", () => {
    const hits = searchNotes(scan, "work");
    assert.deepEqual(
      hits.map((hit) => [path.basename(hit.path), hit.match]),
      [
        ["alpha.md", "tag"],
        ["beta-note.md", "body"],
      ],
    );
  });

  it("finds a frontmatter-only match and says so", () => {
    const hits = searchNotes(scan, "area: career");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.path, "notes/alpha.md");
    assert.equal(hits[0]?.match, "frontmatter");
  });

  it("breaks ties alphabetically by title", () => {
    const hits = searchNotes(scan, "orchard");
    assert.deepEqual(
      hits.map((hit) => hit.title),
      ["Alpha Planning", "Beta Note", "Gamma"],
    );
    assert.ok(hits.every((hit) => hit.match === "body"));
  });

  it("is case-insensitive in every field", () => {
    assert.deepEqual(searchNotes(scan, "ALPHA").map((hit) => hit.path), searchNotes(scan, "alpha").map((hit) => hit.path));
    assert.deepEqual(searchNotes(scan, "WORK").map((hit) => hit.path), searchNotes(scan, "work").map((hit) => hit.path));
    assert.deepEqual(
      searchNotes(scan, "ORCHARD").map((hit) => hit.path),
      searchNotes(scan, "orchard").map((hit) => hit.path),
    );
  });

  it("treats several words as one literal phrase", () => {
    const hits = searchNotes(scan, "orchard appears");
    assert.deepEqual(hits.map((hit) => hit.path), ["notes/beta-note.md"], "no implicit AND per word");
  });

  it("carries the note's metadata onto the hit", () => {
    const [hit] = searchNotes(scan, "planning");
    assert.equal(hit?.captured, "2026-10-18 3:38 PM");
    assert.equal(hit?.capturedZone, "America/New_York");
    assert.equal(hit?.area, "career");
    assert.equal(hit?.origin, "me");
    assert.deepEqual(hit?.tags, ["planning", "work", "inline-tag"]);
  });

  it("snippets the body around the match, with ellipses only where it cuts", () => {
    const beta = searchNotes(scan, "orchard").find((hit) => hit.path === "notes/beta-note.md");
    assert.ok(beta?.snippet.includes("orchard"));
    assert.ok(!beta?.snippet.startsWith("…"), "a match near the start needs no leading cut");

    const long = searchNotes(scan, "needleword")[0];
    assert.ok(long?.snippet.startsWith("…"), "a match deep in the note is marked as an excerpt");
    assert.ok(long?.snippet.includes("needleword"));
  });

  it("marks a cut at the end of a long body", () => {
    const body = `openingword ${"filler ".repeat(40)}tail`;
    const single: VaultScan = {
      ...scan,
      notes: [{ ...scan.notes[0]!, path: "synthetic.md", title: "Synthetic" }],
      bodies: new Map([["synthetic.md", body]]),
    };
    const [hit] = searchNotes(single, "openingword");
    assert.ok(hit?.snippet.startsWith("openingword"), "the match is not cut off at the front");
    assert.ok(hit?.snippet.endsWith("…"), "the cut at the end is marked");
  });

  it("honours the limit after ranking", () => {
    const all = searchNotes(scan, "orchard");
    assert.deepEqual(searchNotes(scan, "orchard", 1), all.slice(0, 1));
    assert.deepEqual(searchNotes(scan, "orchard", 0), []);
    assert.deepEqual(searchNotes(scan, "orchard", -3), []);
  });

  it("still answers when a body is missing from the index", () => {
    const withoutBodies: VaultScan = { ...scan, bodies: new Map() };
    const [hit] = searchNotes(withoutBodies, "Gamma");
    assert.equal(hit?.path, "notes/gamma.md");
    assert.equal(hit?.snippet, "");
  });

  it("leaves the scan untouched", () => {
    const before = scan.notes.map((note) => note.path);
    searchNotes(scan, "orchard");
    assert.deepEqual(scan.notes.map((note) => note.path), before);
  });
});

describe("pickDaily — seeding", () => {
  it("returns nothing for an empty vault", () => {
    assert.equal(pickDaily({ ...scan, notes: [] }, "2026-10-19"), null);
  });

  it("seeds from the date, not from the order notes arrived in", () => {
    const key = "2026-10-19";
    const shuffled = pickDaily({ ...scan, notes: [...scan.notes].reverse() }, key);
    assert.deepEqual(shuffled, pickDaily(scan, key));
  });

  it("wraps negative and oversized skip counts", () => {
    const key = "2026-10-19";
    const total = scan.notes.length;
    const pick = (skip: number) => pickDaily(scan, key, skip)?.path;
    const turns = total * 7;
    assert.equal(pick(-1), pick(total - 1), "one step back is the last note");
    assert.equal(pick(turns), pick(0), "a whole number of turns comes back round");
    assert.equal(pick(-turns), pick(0));
    assert.equal(pick(turns + 1), pick(1));
  });

  it("has one note to give in a single-note vault", () => {
    const single = { ...scan, notes: [scan.notes[0]!] };
    for (const key of ["2026-10-19", "2026-10-20", "2027-01-01"]) {
      for (const skip of [0, 1, -3]) {
        assert.equal(pickDaily(single, key, skip)?.path, scan.notes[0]?.path);
      }
    }
  });

  it("carries the note's own metadata into the pick", () => {
    const key = "2026-10-19";
    const pick = pickDaily(scan, key);
    const note = scan.notes.find((entry) => entry.path === pick?.path);
    assert.ok(note);
    assert.equal(pick?.title, note.title);
    assert.equal(pick?.tags, note.tags);
    assert.equal(pick?.area, note.area);
    assert.equal(pick?.captured, note.captured);
    assert.equal(pick?.capturedZone, note.capturedZone);
  });

  it("gives the same answer twice for the same day", () => {
    assert.deepEqual(pickDaily(scan, "2026-10-19"), pickDaily(scan, "2026-10-19"));
  });
});
