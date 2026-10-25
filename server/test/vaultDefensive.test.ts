import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NotePathError, readNote, resolveNotePath, scanVault } from "../src/vault.js";
import { withFsFaults } from "./fsFault.js";

let root = "";
let vault = "";

function rejectsNotFound(requested: string): Promise<void> {
  return assert.rejects(
    () => readNote(vault, requested),
    (error: unknown) => {
      assert.ok(error instanceof NotePathError, `${requested}: expected a typed rejection`);
      assert.equal(error.code, "not_found", `${requested}: code`);
      assert.equal(error.status, 404, `${requested}: status`);
      assert.equal(error.message, "No note at that path", `${requested}: message`);
      return true;
    },
  );
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-defensive-"));
  vault = path.join(root, "vault");
  await fs.mkdir(path.join(vault, "notes"), { recursive: true });
  await fs.writeFile(path.join(vault, "keep.md"), "# Kept\n\nThis note survives the scan.\n", "utf8");
  await fs.writeFile(path.join(vault, "notes", "nested.md"), "# Nested\n\nAlso here.\n", "utf8");
  await fs.writeFile(path.join(vault, "vanishing.md"), "# Vanishing\n\nGone before it is read.\n", "utf8");
  // A directory wearing a .md name: the walk never collects it as a note, but a
  // request can still ask for it by path. Plain `mkdir`, so it exists everywhere.
  await fs.mkdir(path.join(vault, "folder.md"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("scanVault — a note that disappears mid-scan", () => {
  it("drops the vanished note and keeps the rest of the vault", async () => {
    // The fault stands in for the race the empty `catch` exists for: the walk
    // listed `vanishing.md` a moment ago, and the read arrives after it is gone.
    const scan = await withFsFaults([{ kind: "missing", path: path.join(vault, "vanishing.md") }], () =>
      scanVault(vault),
    );

    assert.deepEqual(
      scan.notes.map((note) => note.path),
      ["keep.md", "notes/nested.md"],
    );
    assert.deepEqual([...scan.bodies.keys()], ["keep.md", "notes/nested.md"]);
    assert.equal(scan.bodies.has("vanishing.md"), false);
    // The survivors are read normally, not just listed.
    assert.equal(scan.notes.find((note) => note.path === "keep.md")?.title, "Kept");
    assert.equal(scan.notes.find((note) => note.path === "notes/nested.md")?.title, "Nested");
    // A vanished note is not a skipped one: `skipped` reports deliberate
    // exclusions, while `unreadable` reports a read that failed.
    assert.deepEqual(scan.skipped, []);
    assert.deepEqual(scan.unreadable, [{ path: "vanishing.md", code: "ENOENT" }]);
  });

  it("keeps the scan going when more than one note has gone", async () => {
    // Two declared faults: both have to fire, and neither may abort the scan.
    const scan = await withFsFaults(
      [
        { kind: "missing", path: path.join(vault, "vanishing.md") },
        { kind: "missing", path: path.join(vault, "keep.md") },
      ],
      () => scanVault(vault),
    );
    assert.deepEqual(
      scan.notes.map((note) => note.path),
      ["notes/nested.md"],
    );
    // Both failures are reported, in path order, not just the first one.
    assert.deepEqual(scan.unreadable, [
      { path: "keep.md", code: "ENOENT" },
      { path: "vanishing.md", code: "ENOENT" },
    ]);
  });

  it("reports a refused read by its error code and keeps scanning", async () => {
    const scan = await withFsFaults([{ kind: "denied", path: path.join(vault, "keep.md") }], () =>
      scanVault(vault),
    );

    assert.deepEqual(
      scan.notes.map((note) => note.path),
      ["notes/nested.md", "vanishing.md"],
    );
    assert.deepEqual(scan.unreadable, [{ path: "keep.md", code: "EACCES" }]);
    assert.equal(scan.bodies.has("keep.md"), false);
  });
});

describe("readNote — a non-file at a .md path", () => {
  it("reports a real directory named like a note as not found", async () => {
    // The path rule accepts it — it is a .md name inside the vault — so the
    // refusal has to come from the filesystem read.
    assert.equal(resolveNotePath(vault, "folder.md"), path.join(path.resolve(vault), "folder.md"));
    await rejectsNotFound("folder.md");
  });

  it("refuses a path that reads but does not stat as a file", async () => {
    // A real directory makes `readFile` fail (EISDIR) before the type guard is
    // reached, so the guard after the read is posed directly: bytes come back,
    // the stat says the entry is not a regular file.
    await withFsFaults([{ kind: "not-a-file", path: path.join(vault, "keep.md") }], () =>
      rejectsNotFound("keep.md"),
    );
  });

  it("still reads the notes beside the offending path", async () => {
    await withFsFaults([{ kind: "not-a-file", path: path.join(vault, "keep.md") }], async () => {
      await rejectsNotFound("keep.md");
      const nested = await readNote(vault, "notes/nested.md");
      assert.equal(nested.title, "Nested");
      assert.match(nested.markdown, /Also here/);
    });
  });
});
