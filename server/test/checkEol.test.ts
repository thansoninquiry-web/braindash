import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  collectEol,
  crlfBlobs,
  crlfLines,
  crlfOffenders,
  isBinaryFile,
  parseEolList,
  type TrackedFile,
} from "../../scripts/check-eol.mjs";

/**
 * One `git ls-files --eol -z` record, padded the way Git pads it: the columns are
 * space-aligned and only the tab before the path is unambiguous.
 */
function row(overrides: Partial<TrackedFile> & { path: string }): string {
  const { path: file, index = "lf", worktree = "lf", attr = "text", eol } = overrides;
  const columns = `i/${index}    w/${worktree}    attr/${attr}${eol ? ` eol=${eol}` : ""}`;
  return `${columns.padEnd(40)}\t${file}`;
}

function files(...rows: string[]): TrackedFile[] {
  return parseEolList(rows.join("\0") + "\0");
}

describe("parseEolList", () => {
  it("reads index, worktree and attribute columns and keeps the path intact", () => {
    const parsed = files(
      row({ path: "README.md", eol: "lf" }),
      row({ path: "docs/my note.md", worktree: "crlf", eol: "lf" }),
      row({ path: "notes/run.cmd", worktree: "crlf", eol: "crlf" }),
    );
    assert.deepEqual(
      parsed.map((file) => [file.path, file.index, file.worktree, file.attr, file.eol]),
      [
        ["README.md", "lf", "lf", "/text", "lf"],
        ["docs/my note.md", "lf", "crlf", "/text", "lf"],
        ["notes/run.cmd", "lf", "crlf", "/text", "crlf"],
      ],
    );
  });

  it("reads a binary record, which has no eol column", () => {
    const [png] = files(row({ path: "docs/reference/jarvis.png", index: "-text", worktree: "-text", attr: "-text" }));
    assert.deepEqual(png, { path: "docs/reference/jarvis.png", index: "-text", worktree: "-text", attr: "/-text", eol: undefined });
  });

  it("is empty for empty output and ignores only the terminator of -z output", () => {
    assert.deepEqual(parseEolList(""), []);
    assert.equal(files(row({ path: "a.md" })).length, 1);
  });

  it("refuses a record it does not recognise instead of skipping it", () => {
    assert.throws(() => parseEolList("something git never printed\0"), /unexpected git ls-files --eol row/);
  });
});

describe("isBinaryFile", () => {
  it("treats both the binary macro and a sniffed -text index as binary", () => {
    assert.equal(isBinaryFile({ path: "a.png", index: "-text", worktree: "-text", attr: "-text" }), true);
    assert.equal(isBinaryFile({ path: "a.bin", index: "lf", worktree: "lf", attr: "/binary" }), true);
    assert.equal(isBinaryFile({ path: "a.md", index: "lf", worktree: "lf", attr: "/text" }), false);
  });
});

describe("crlfOffenders", () => {
  const text = (worktree: string, eol?: string): TrackedFile => ({ path: `${worktree}${eol ?? ""}.md`, index: "lf", worktree, attr: "/text", eol });

  it("reports CRLF and mixed files and leaves LF and empty ones alone", () => {
    const offenders = crlfOffenders([
      text("lf", "lf"),
      text("crlf", "lf"),
      text("mixed", "lf"),
      text("none"),
    ]);
    assert.deepEqual(
      offenders.map((file) => file.worktree),
      ["crlf", "mixed"],
    );
  });

  it("skips a binary file that happens to hold CRLF bytes", () => {
    assert.deepEqual(
      crlfOffenders([{ path: "a.png", index: "-text", worktree: "-text", attr: "/-text" }]),
      [],
    );
  });

  it("skips a path whose rule asks for CRLF, such as a Windows launcher", () => {
    assert.deepEqual(
      crlfOffenders([{ path: "run.cmd", index: "lf", worktree: "crlf", attr: "/text", eol: "crlf" }]),
      [],
    );
  });
});

describe("crlfBlobs", () => {
  const blob = (index: string, overrides: Partial<TrackedFile> = {}): TrackedFile => ({
    path: `${index}.md`,
    index,
    worktree: "lf",
    attr: "/text",
    ...overrides,
  });

  it("reports a staged blob holding CRLF or a mix, and leaves LF and empty alone", () => {
    const offenders = crlfBlobs([blob("lf"), blob("none"), blob("crlf"), blob("mixed")]);
    assert.deepEqual(
      offenders.map((file) => file.index),
      ["crlf", "mixed"],
    );
  });

  it("reads the index column, not the working tree — a clean checkout is not a clean blob", () => {
    const staged = blob("crlf", { worktree: "lf" });
    const diskOnly = blob("lf", { worktree: "crlf" });
    assert.equal(crlfBlobs([staged]).length, 1, "the blob is what gets committed");
    assert.equal(crlfBlobs([diskOnly]).length, 0, "that one is crlfOffenders' job");
  });

  it("still skips binaries and paths whose rule asks for CRLF", () => {
    assert.deepEqual(crlfBlobs([blob("crlf", { attr: "/binary" })]), []);
    assert.deepEqual(crlfBlobs([blob("crlf", { attr: "/-text" })]), []);
    assert.deepEqual(crlfBlobs([blob("crlf", { path: "run.cmd", eol: "crlf" })]), []);
  });
});

describe("crlfLines", () => {
  it("finds nothing in an LF file or an empty one", () => {
    assert.deepEqual(crlfLines(Buffer.from("a\nb\nc\n", "utf8")), []);
    assert.deepEqual(crlfLines(Buffer.from("", "utf8")), []);
  });

  it("numbers every CRLF line, including a last line with no trailing newline", () => {
    assert.deepEqual(crlfLines(Buffer.from("a\r\nb\r\nc\r\n", "utf8")), [1, 2, 3]);
    assert.deepEqual(crlfLines(Buffer.from("a\r\nb", "utf8")), [1]);
  });

  it("numbers only the CRLF lines of a mixed file", () => {
    assert.deepEqual(crlfLines(Buffer.from("a\nb\r\nc\n", "utf8")), [2]);
  });

  it("does not mistake a lone CR for a CRLF ending", () => {
    assert.deepEqual(crlfLines(Buffer.from("old\rmac\r\n", "utf8")), [1]);
  });
});

/** Git is only required for the repository tests below. */
const gitAvailable = (() => {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
})();

/**
 * A throwaway repository with the same rule as the real one: LF for text, CRLF
 * only where a rule asks for it. `git add` runs before the test rewrites anything,
 * so the index is committed-quality LF and the working tree is what changes.
 */
async function withRepo(run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-eol-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "pipe" });
    await fs.writeFile(
      path.join(root, ".gitattributes"),
      "* text=auto eol=lf\n*.cmd text eol=crlf\n",
      "utf8",
    );
    await fs.writeFile(path.join(root, "note.md"), "---\ntitle: Note\n---\nbody\n", "utf8");
    await fs.writeFile(path.join(root, "run.cmd"), "@echo off\r\nrem launcher\r\n", "utf8");
    execFileSync("git", ["add", "--all"], { cwd: root, stdio: "pipe" });
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("collectEol", () => {
  it("passes a checkout that honours the LF rule, and leaves a declared CRLF launcher alone", { skip: gitAvailable ? false : "git is not available" }, async () => {
    await withRepo(async (root) => {
      const outcome = collectEol({ cwd: root });
      assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
      if (!outcome.ok) return;
      assert.deepEqual(outcome.offenders, []);
      assert.deepEqual(outcome.blobs, []);
      assert.equal(outcome.declaredCrlf, 1, "run.cmd is declared eol=crlf");
      assert.equal(outcome.text, 3);
      assert.equal(outcome.binary, 0);
    });
  });

  it("fails a text file whose working-tree copy was rewritten with CRLF", { skip: gitAvailable ? false : "git is not available" }, async () => {
    await withRepo(async (root) => {
      await fs.writeFile(path.join(root, "note.md"), "---\r\ntitle: Note\r\n---\r\nbody\r\n", "utf8");
      const outcome = collectEol({ cwd: root });
      assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
      if (!outcome.ok) return;
      assert.deepEqual(
        outcome.offenders.map((file) => file.path),
        ["note.md"],
      );
    });
  });

  it("fails a CRLF blob even when every working-tree copy is LF", { skip: gitAvailable ? false : "git is not available" }, async () => {
    await withRepo(async (root) => {
      // The bytes a filter would never produce: a raw CRLF blob written straight
      // into the index, while the checked-out file stays LF. Nothing on disk can
      // reveal this, which is why the gate reads the index too.
      const hash = execFileSync("git", ["hash-object", "-w", "--no-filters", "--stdin"], {
        cwd: root,
        input: "---\r\ntitle: Note\r\n---\r\nbody\r\n",
        encoding: "utf8",
      }).trim();
      execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${hash},note.md`], {
        cwd: root,
        stdio: "pipe",
      });

      const outcome = collectEol({ cwd: root });
      assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
      if (!outcome.ok) return;
      assert.deepEqual(outcome.offenders, [], "the working tree is still LF");
      assert.deepEqual(
        outcome.blobs.map((file) => [file.path, file.index, file.worktree]),
        [["note.md", "crlf", "lf"]],
      );
    });
  });

  it("reports a Git failure instead of a clean tree", { skip: gitAvailable ? false : "git is not available" }, async () => {
    const notARepository = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-eol-plain-"));
    try {
      const outcome = collectEol({ cwd: notARepository });
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.match(outcome.error, /git ls-files exited/);
    } finally {
      await fs.rm(notARepository, { recursive: true, force: true });
    }
  });
});
