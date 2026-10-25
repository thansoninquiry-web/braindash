import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normaliseNotePath } from "../src/notePath.ts";

describe("normaliseNotePath", () => {
  it("trims, converts backslashes and adds the markdown extension", () => {
    assert.deepEqual(normaliseNotePath("  notes\\fresh idea  "), {
      path: "notes/fresh idea.md",
      error: null,
    });
  });

  it("keeps an existing .md extension whatever its case", () => {
    assert.deepEqual(normaliseNotePath("notes/Idea.MD"), {
      path: "notes/Idea.MD",
      error: null,
    });
  });

  it("collapses empty and current-directory segments", () => {
    assert.deepEqual(normaliseNotePath("notes//./today.md"), {
      path: "notes/today.md",
      error: null,
    });
  });

  it("rejects an empty path with a usable hint", () => {
    const checked = normaliseNotePath("   ");
    assert.equal(checked.path, null);
    assert.match(checked.error ?? "", /example notes\/new-idea\.md/);
  });

  it("rejects absolute paths and a bare drive letter", () => {
    for (const input of ["/notes/idea.md", "~/notes/idea.md", "C:/notes/idea.md"]) {
      const checked = normaliseNotePath(input);
      assert.equal(checked.path, null, input);
      assert.match(checked.error ?? "", /vault-relative/);
    }
  });

  it("refuses to climb out of the vault", () => {
    for (const input of ["../idea.md", "notes/../../idea.md"]) {
      const checked = normaliseNotePath(input);
      assert.equal(checked.path, null, input);
      assert.match(checked.error ?? "", /outside the vault/);
    }
  });

  it("refuses hidden folders, which the scan never indexes", () => {
    const checked = normaliseNotePath("notes/.trash/old.md");
    assert.equal(checked.path, null);
    assert.match(checked.error ?? "", /Hidden folders/);
  });
});
