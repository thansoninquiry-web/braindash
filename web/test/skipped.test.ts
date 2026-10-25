import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { skippedLabel, skippedTooltip } from "../src/skipped.ts";
import type { SkippedEntry } from "../src/types.ts";

const symlink = (path: string): SkippedEntry => ({ path, reason: "symlink" });

describe("skippedLabel", () => {
  it("is absent when nothing was skipped", () => {
    assert.equal(skippedLabel([]), null);
  });

  it("counts one or many, with the plural only when it is true", () => {
    assert.equal(skippedLabel([symlink("shared.md")]), "1 symlink skipped");
    assert.equal(
      skippedLabel([symlink("a.md"), symlink("Archive")]),
      "2 symlinks skipped",
    );
  });
});

describe("skippedTooltip", () => {
  it("is empty when there is no row to explain", () => {
    assert.equal(skippedTooltip([]), "");
  });

  it("lists every path on its own line, in scan order", () => {
    assert.equal(
      skippedTooltip([
        symlink("Archive"),
        symlink("notes/shared.md"),
        symlink("projects/old"),
      ]),
      "Symlinks are never followed (3):\nArchive\nnotes/shared.md\nprojects/old",
    );
  });

  it("says so for a lone entry", () => {
    assert.equal(
      skippedTooltip([symlink("notes/shared.md")]),
      "Symlinks are never followed (1):\nnotes/shared.md",
    );
  });
});
