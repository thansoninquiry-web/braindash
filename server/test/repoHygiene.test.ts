import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * This checkout is published as a public portfolio repository, so the vault it
 * reads must never travel with it: note bodies are the one thing that cannot be
 * un-published. `VAULT_PATH` points outside the repository and the `.gitignore`
 * rules below are the backstop for a vault that gets copied in by mistake.
 *
 * These tests read the real repository through git rather than keeping a list of
 * filenames in sync by hand, because the failure they guard against is a new
 * file appearing, not an old one changing.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const gitAvailable = (() => {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
})();

const isRepo = (() => {
  if (!gitAvailable) return false;
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    encoding: "utf8",
  });
  return !result.error && result.status === 0 && result.stdout.trim() === "true";
})();

const skip = isRepo ? false : "not a git checkout";

function git(args: string[], input?: string): { status: number | null; stdout: string } {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", input });
  return { status: result.status, stdout: result.stdout ?? "" };
}

/** Every path git would put in a commit, `/`-separated and repository-relative. */
function trackedFiles(): string[] {
  return git(["ls-files", "-z"])
    .stdout.split("\0")
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"));
}

/**
 * Directory names that only ever hold note content. A tracked path with one of
 * these segments means a vault (or a trashed note) was committed.
 */
const VAULT_DIRS = new Set([".obsidian", ".trash", "notes", "inbox", ".vault"]);

describe("repository hygiene", () => {
  it("tracks no vault directories, trashed notes or scratch vaults", { skip }, () => {
    const offenders = trackedFiles().filter((file) => {
      const segments = file.split("/");
      return segments.some((segment) => VAULT_DIRS.has(segment) || segment.startsWith(".tmp-"));
    });
    assert.deepEqual(
      offenders,
      [],
      "note content must stay outside the repository; move it to the vault and run `git rm -r --cached` on these",
    );
  });

  it("never tracks the local environment file", { skip }, () => {
    const result = git(["ls-files", "--error-unmatch", ".env"]);
    assert.notEqual(result.status, 0, ".env is machine-local and must stay untracked");
  });

  it("ignores a vault even when it is copied into the checkout", { skip }, () => {
    // None of these need to exist: `check-ignore` matches the rules alone, which
    // is what makes this a real backstop rather than a description of today.
    const candidates = [
      ".env",
      "notes/daily/2026-10-24.md",
      "inbox/capture.md",
      ".obsidian/app.json",
      ".trash/2026-10-01T00-00-00-000Z/notes/old.md",
      ".vault/notes/kept.md",
      ".tmp-verify-vault/alpha.md",
      "web/.tmp-vite-verify.config.ts",
      "screenshots/dashboard.png",
    ];
    const ignored = new Set(
      git(["check-ignore", "--no-index", "--stdin"], `${candidates.join("\n")}\n`)
        .stdout.split("\n")
        .map((line) => line.trim().replace(/\\/g, "/"))
        .filter(Boolean),
    );
    const uncovered = candidates.filter((candidate) => !ignored.has(candidate));
    assert.deepEqual(uncovered, [], "these paths would be swept into a commit by `git add -A`");
  });
});
