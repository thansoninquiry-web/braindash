import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildWikilinkIndex,
  findWikilinks,
  parseWikilink,
  resolveWikilink,
  wikilinkTargets,
  type WikilinkNote,
} from "../../shared/wikilinks.js";
import { readNote } from "../src/vault.js";

/** A note as the resolver sees it: a path and the title an author would write. */
function note(file: string, title = file.replace(/^.*\//, "").replace(/\.md$/i, "")): WikilinkNote {
  return { path: file, title };
}

describe("buildWikilinkIndex — the keys a note answers to", () => {
  it("answers to a title, a vault path and a file slug", () => {
    const index = buildWikilinkIndex([note("notes/the-state-of-things.md", "The State Of Things")]);
    for (const key of [
      "the state of things",
      "notes/the-state-of-things",
      "the-state-of-things",
    ]) {
      assert.equal(index.get(key), "notes/the-state-of-things.md", key);
    }
    assert.equal(index.get("the-state-of-things.md"), undefined, "the extension is not a key");
  });

  it("crosses between the spaced and dashed file name in both directions", () => {
    const spaced = buildWikilinkIndex([note("notes/beta note.md")]);
    assert.equal(spaced.get("beta note"), "notes/beta note.md");
    assert.equal(spaced.get("beta-note"), "notes/beta note.md", "the written slug resolves");

    const dashed = buildWikilinkIndex([note("notes/beta-note.md")]);
    assert.equal(dashed.get("beta-note"), "notes/beta-note.md");
    assert.equal(dashed.get("beta note"), "notes/beta-note.md");
  });

  it("treats runs of dashes and underscores as one word break", () => {
    const index = buildWikilinkIndex([note("notes/3-2-1__method.md")]);
    for (const key of ["3-2-1__method", "3 2 1 method", "3-2-1-method"]) {
      assert.equal(index.get(key), "notes/3-2-1__method.md", key);
    }
  });

  it("indexes lowercased keys, leaving normalisation to the resolver", () => {
    const index = buildWikilinkIndex([note("a.md", "Alpha")]);
    assert.equal(index.get("alpha"), "a.md");
    assert.equal(index.get("Alpha"), undefined, "the resolver, not the index, folds case");
  });

  it("keeps the first note when two share a title", () => {
    const index = buildWikilinkIndex([note("one/same.md", "Same"), note("two/same.md", "Same")]);
    assert.equal(index.get("same"), "one/same.md");
  });

  it("does not register a blank key", () => {
    const index = buildWikilinkIndex([note("a.md", "   ")]);
    assert.equal(index.get(""), undefined);
    assert.equal(index.get("a"), "a.md", "the path still resolves");
  });

  it("handles an empty vault and an extensionless path", () => {
    assert.equal(buildWikilinkIndex([]).size, 0);
    const index = buildWikilinkIndex([note("notes/loose")]);
    assert.equal(resolveWikilink(index, "loose"), "notes/loose");
  });

  it("does not mutate the notes it is given", () => {
    const notes = [note("notes/Beta Note.md", "Beta Note")];
    buildWikilinkIndex(notes);
    assert.deepEqual(notes, [{ path: "notes/Beta Note.md", title: "Beta Note" }]);
  });
});

describe("resolveWikilink", () => {
  const index = buildWikilinkIndex([note("notes/beta note.md", "Beta Note")]);

  it("folds case and trims padding before looking up", () => {
    assert.equal(resolveWikilink(index, "  BETA NOTE  "), "notes/beta note.md");
    assert.equal(resolveWikilink(index, "beta-note"), "notes/beta note.md");
    assert.equal(resolveWikilink(index, "notes/beta note"), "notes/beta note.md");
  });

  it("returns null for a target the vault does not have", () => {
    assert.equal(resolveWikilink(index, "Ghost"), null);
    assert.equal(resolveWikilink(index, ""), null);
    assert.equal(resolveWikilink(index, "   "), null);
    assert.equal(resolveWikilink(buildWikilinkIndex([]), "anything"), null);
  });

  it("resolves to the path, not the title, so the reader can open it", () => {
    const path = resolveWikilink(index, "Beta Note");
    assert.equal(path, "notes/beta note.md");
  });
});

describe("parseWikilink — the parts of one link", () => {
  it("splits a target from its heading and alias", () => {
    assert.deepEqual(parseWikilink("daily#Morning|Today"), {
      target: "daily",
      heading: "Morning",
      alias: "Today",
      label: "Today",
    });
  });

  it("keeps a heading that has no target, but as text rather than an edge", () => {
    assert.deepEqual(parseWikilink("#Morning"), {
      target: "",
      heading: "Morning",
      alias: null,
      label: "Morning",
    });
  });

  it("falls back to the target when the alias is blank", () => {
    assert.equal(parseWikilink("daily|")?.label, "daily");
    assert.equal(parseWikilink("daily|   ")?.label, "daily");
  });

  it("keeps extra pipes in the alias instead of dropping them", () => {
    assert.equal(parseWikilink("daily|Today|Now")?.alias, "Today|Now");
    assert.equal(parseWikilink("daily|Today|Now")?.target, "daily");
  });

  it("lets a backslash keep a separator literal", () => {
    assert.deepEqual(parseWikilink("a\\|b"), { target: "a|b", heading: null, alias: null, label: "a|b" });
    assert.deepEqual(parseWikilink("C\\#1"), { target: "C#1", heading: null, alias: null, label: "C#1" });
    assert.equal(parseWikilink("a\\]b")?.target, "a]b");
  });

  it("has nothing to show for blank or separator-only tokens", () => {
    assert.equal(parseWikilink(""), null);
    assert.equal(parseWikilink("   "), null);
    assert.equal(parseWikilink("#"), null);
    assert.equal(parseWikilink("|"), null);
  });
});

describe("findWikilinks — scanning prose", () => {
  it("returns every link in order, repeats included", () => {
    const links = findWikilinks("[[a]] then [[b|Bee]] and [[a]] again");
    assert.deepEqual(
      links.map((link) => link.target),
      ["a", "b", "a"],
    );
    assert.equal(links[1]?.label, "Bee");
  });

  it("ignores a link whose opening brackets are escaped", () => {
    assert.deepEqual(findWikilinks("\\[[not a link]]"), []);
    // An even number of backslashes is a literal backslash, not an escape.
    assert.deepEqual(
      findWikilinks("\\\\[[real]]").map((link) => link.target),
      ["real"],
    );
  });

  it("accepts an escaped closing bracket inside the target", () => {
    assert.deepEqual(
      findWikilinks("[[a\\]b]]").map((link) => link.target),
      ["a]b"],
    );
  });

  it("stops at an unterminated token instead of guessing", () => {
    assert.deepEqual(findWikilinks("[[open and then nothing"), []);
  });

  it("does not join a token across a line, as the line-based renderer cannot", () => {
    assert.deepEqual(findWikilinks("[[one\ntwo]]"), []);
  });
});

describe("wikilinkTargets — what the scanner records", () => {
  it("trims, unescapes and dedupes exactly as the graph expects", () => {
    assert.deepEqual(
      wikilinkTargets("[[ Beta ]] [[Beta|B]] [[beta#Top]] [[a\\|b]] [[#heading]]"),
      ["Beta", "beta", "a|b"],
    );
  });

  it("records nothing for a note without links", () => {
    assert.deepEqual(wikilinkTargets("plain prose #tag"), []);
  });
});

describe("the vault scanner uses the shared grammar", () => {
  it("reads alias and heading links the way the reader renders them", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wikilinks-"));
    try {
      writeFileSync(
        path.join(root, "note.md"),
        "# Note\n\n[[beta#Top|B]] [[beta]] [[a\\|b]] [[#local]] \\[[literal]] [[ spaced ]] `[[inline]]`\n",
      );
      const note = await readNote(root, "note.md");
      assert.deepEqual(
        note.links.map((link) => link.target),
        ["beta", "a|b", "spaced"],
      );
      // The first spelling keeps the heading and alias the note actually wrote.
      assert.deepEqual(note.links[0], {
        target: "beta",
        heading: "Top",
        alias: "B",
        label: "B",
      });
      assert.equal(note.links[1]?.heading, null, "a bare repeat is deduped against the first");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
