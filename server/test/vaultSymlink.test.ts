import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NotePathError, readNote, scanVault } from "../src/vault.js";

let root = "";
let vault = "";
let outside = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-link-"));
  vault = path.join(root, "vault");
  outside = path.join(root, "outside");
  await fs.mkdir(path.join(vault, "notes"), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(vault, "note.md"), "# Inside\n\nA normal note.\n", "utf8");
  await fs.writeFile(path.join(vault, "notes", "inner.md"), "# Inner\n\nNested but inside.\n", "utf8");
  await fs.writeFile(path.join(vault, "2026-10-19-daily-log.md"), "A quiet day with no heading.\n", "utf8");
  await fs.mkdir(path.join(vault, "folder.md"));
  await fs.writeFile(path.join(outside, "secret.md"), "# Secret\n\nTOP SECRET.\n", "utf8");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * Creates a link, or explains why this machine will not.
 *
 * A directory junction needs no privileges on Windows, but a file symlink needs
 * Developer Mode (or an elevated shell), and some CI images forbid both. The
 * caller skips with the reason instead of failing, so the suite stays portable
 * and a link that *is* created is always tested for real.
 */
async function makeLink(target: string, at: string, directory: boolean): Promise<string | null> {
  // `junction` is the Windows way to link a directory without elevation; POSIX
  // ignores the type except to distinguish a directory.
  const type = process.platform === "win32" ? (directory ? "junction" : "file") : directory ? "dir" : "file";
  try {
    await fs.symlink(target, at, type);
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    if (["EPERM", "EACCES", "ENOSYS", "ENOTSUP", "ENOENT", "EINVAL"].includes(code)) {
      return `this machine does not allow ${directory ? "directory" : "file"} links (${code})`;
    }
    throw error;
  }
}

/** Asserts the request is refused as an escape, not as a missing file. */
async function assertEscapeRefused(requested: string): Promise<void> {
  await assert.rejects(
    () => readNote(vault, requested),
    (error: unknown) => {
      assert.ok(error instanceof NotePathError, `${requested}: expected a typed rejection`);
      assert.equal(error.code, "invalid_path", `${requested}: code`);
      assert.equal(error.status, 400, `${requested}: status`);
      assert.doesNotMatch(error.message, /TOP SECRET/, `${requested}: must not leak content`);
      return true;
    },
  );
}

describe("readNote — within the vault", () => {
  it("reads a normal note and reports its vault-relative path", async () => {
    const note = await readNote(vault, "note.md");
    assert.equal(note.path, "note.md");
    assert.match(note.markdown, /A normal note/);
    assert.equal(note.title, "Inside");
  });

  it("derives a title from the file name when there is no frontmatter or heading", async () => {
    const note = await readNote(vault, "2026-10-19-daily-log.md");
    assert.equal(note.title, "Daily Log");
    assert.equal(note.frontmatter, "");
  });

  it("reports a directory named like a note as not found", async () => {
    await assert.rejects(
      () => readNote(vault, "folder.md"),
      (error: unknown) => {
        assert.ok(error instanceof NotePathError);
        assert.equal(error.code, "not_found");
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});

describe("readNote — symlink escapes", () => {
  it("refuses a directory junction that points out of the vault", async (t) => {
    const reason = await makeLink(outside, path.join(vault, "escape"), true);
    if (reason) {
      t.skip(reason);
      return;
    }

    // The target really is a readable file; this must fail on the boundary, not
    // because the secret is missing.
    assert.match(await fs.readFile(path.join(outside, "secret.md"), "utf8"), /TOP SECRET/);
    await assertEscapeRefused("escape/secret.md");
  });

  it("refuses a file symlink that points out of the vault", async (t) => {
    const reason = await makeLink(path.join(outside, "secret.md"), path.join(vault, "leak.md"), false);
    if (reason) {
      t.skip(reason);
      return;
    }
    await assertEscapeRefused("leak.md");
  });

  it("still allows a link that stays inside, and reports the real path", async (t) => {
    const reason = await makeLink(path.join(vault, "notes"), path.join(vault, "alias"), true);
    if (reason) {
      t.skip(reason);
      return;
    }

    const note = await readNote(vault, "alias/inner.md");
    assert.equal(note.path, "notes/inner.md", "the canonical path is what comes back");
    assert.match(note.markdown, /Nested but inside/);
  });

  it("reports a dangling link as not found rather than as an escape", async (t) => {
    const reason = await makeLink(path.join(outside, "gone"), path.join(vault, "dead"), true);
    if (reason) {
      t.skip(reason);
      return;
    }

    await assert.rejects(
      () => readNote(vault, "dead/missing.md"),
      (error: unknown) => {
        assert.ok(error instanceof NotePathError);
        assert.equal(error.code, "not_found");
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});

describe("readNote — chained links", () => {
  it("refuses a chain of directory links that ends outside the vault", async (t) => {
    const outer = await makeLink(outside, path.join(vault, "hop-b"), true);
    if (outer) {
      t.skip(outer);
      return;
    }
    const inner = await makeLink(path.join(vault, "hop-b"), path.join(vault, "hop-a"), true);
    if (inner) {
      t.skip(inner);
      return;
    }

    // Two hops, still a readable secret: refusal must come from containment.
    assert.match(await fs.readFile(path.join(outside, "secret.md"), "utf8"), /TOP SECRET/);
    await assertEscapeRefused("hop-a/secret.md");
  });

  it("refuses a file link that points at another link out", async (t) => {
    const outer = await makeLink(path.join(outside, "secret.md"), path.join(vault, "second.md"), false);
    if (outer) {
      t.skip(outer);
      return;
    }
    const inner = await makeLink(path.join(vault, "second.md"), path.join(vault, "first.md"), false);
    if (inner) {
      t.skip(inner);
      return;
    }

    await assertEscapeRefused("first.md");
  });

  it("follows a chain that stays inside and reports the canonical path", async (t) => {
    const hop = await makeLink(path.join(vault, "notes"), path.join(vault, "inside-hop"), true);
    if (hop) {
      t.skip(hop);
      return;
    }
    const second = await makeLink(path.join(vault, "inside-hop"), path.join(vault, "inside-hop-2"), true);
    if (second) {
      t.skip(second);
      return;
    }

    const note = await readNote(vault, "inside-hop-2/inner.md");
    assert.equal(note.path, "notes/inner.md", "the final real path is what comes back");
    assert.match(note.markdown, /Nested but inside/);
  });

  it("reports a dangling chain as not found rather than as an escape", async (t) => {
    const gone = await makeLink(path.join(outside, "gone"), path.join(vault, "dead-hop"), true);
    if (gone) {
      t.skip(gone);
      return;
    }
    const hop = await makeLink(path.join(vault, "dead-hop"), path.join(vault, "dead-hop-2"), true);
    if (hop) {
      t.skip(hop);
      return;
    }

    await assert.rejects(
      () => readNote(vault, "dead-hop-2/missing.md"),
      (error: unknown) => {
        assert.ok(error instanceof NotePathError);
        assert.equal(error.code, "not_found", "the target is gone, not an escape");
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});

describe("readNote — symlink cycles", () => {
  it(
    "answers 404 for a self-linked note instead of an escape or a hang",
    { timeout: 5_000 },
    async (t) => {
      const loop = path.join(vault, "loop.md");
      // A link whose target is itself: every resolution revisits the same path,
      // so `fs.realpath` must stop with ELOOP rather than walk forever.
      const reason = await makeLink(loop, loop, false);
      if (reason) {
        t.skip(reason);
        return;
      }

      // The fixture really is a cycle: the platform's own resolver reports it
      // before the reader gets a chance to classify the path.
      await assert.rejects(
        () => fs.realpath(loop),
        (error: NodeJS.ErrnoException) => error.code === "ELOOP",
      );

      await assert.rejects(
        () => readNote(vault, "loop.md"),
        (error: unknown) => {
          assert.ok(error instanceof NotePathError, "a typed rejection, not a raw ELOOP");
          assert.equal(error.code, "not_found", "a cycle is a missing note, not an escape");
          assert.equal(error.status, 404);
          assert.notEqual(error.code, "invalid_path");
          return true;
        },
      );
    },
  );
});

describe("scanVault — symlinked directories", () => {
  it("does not follow a link out of the vault and reports it instead of dropping it", async (t) => {
    const reason = await makeLink(outside, path.join(vault, "linked-outside"), true);
    if (reason) {
      t.skip(reason);
      return;
    }

    // The target is really readable; its absence must come from the walk, not
    // from a broken fixture.
    assert.match(await fs.readFile(path.join(outside, "secret.md"), "utf8"), /TOP SECRET/);
    const scan = await scanVault(vault);
    assert.equal(
      scan.notes.some((note) => note.path.startsWith("linked-outside/")),
      false,
      "the secret is not indexed",
    );
    assert.equal(scan.bodies.has("linked-outside/secret.md"), false, "and its body is not kept");
    assert.equal(
      [...scan.bodies.values()].some((body) => body.includes("TOP SECRET")),
      false,
      "no content leaks through a link",
    );
    // The skip is part of the scan result, so the missing note has an explanation.
    assert.deepEqual(
      scan.skipped.filter((entry) => entry.path === "linked-outside"),
      [{ path: "linked-outside", reason: "symlink" }],
    );
  });

  it("does not descend a link that stays inside either, so notes cannot be duplicated", async (t) => {
    const reason = await makeLink(path.join(vault, "notes"), path.join(vault, "linked-inside"), true);
    if (reason) {
      t.skip(reason);
      return;
    }

    const scan = await scanVault(vault);
    assert.equal(
      scan.notes.filter((note) => note.path.endsWith("inner.md")).length,
      1,
      "notes/inner.md appears once, not again under the link",
    );
    assert.ok(
      scan.skipped.some((entry) => entry.path === "linked-inside" && entry.reason === "symlink"),
      "the inside link is reported too",
    );
    assert.equal(
      scan.skipped.some((entry) => entry.path.startsWith("linked-inside/")),
      false,
      "the walk reports the link, not what is behind it",
    );
  });
});
