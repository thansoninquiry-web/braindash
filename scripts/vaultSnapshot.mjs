/**
 * Read-only proof for the built-server smoke run: every file under a root, with
 * the three things a read-only dashboard must not touch — content, size and
 * mtime.
 *
 * The smoke uses it twice. Once on the scratch vault, because "the vault is the
 * source of truth and is never written" is the product's central promise. Once
 * on the checkout the server is started from, because a cache, a log or a
 * config file dropped beside the code is a write outside the vault that the
 * vault-only walk could not see.
 *
 * Kept out of `smoke-built-server.mjs` so the comparison rules can be exercised
 * without booting a server (`server/test/vaultSnapshot.test.ts`). Directories are
 * deliberately not in the snapshot: their mtime moves when a file inside them is
 * created or removed, which the file entries already report, and a directory
 * whose mtime differs for another reason is not something either contract cares
 * about.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Walks `root` and returns one entry per file, sorted by path so two snapshots
 * compare deterministically and a failure names the same file every run.
 *
 * `ignore` holds slash-separated paths relative to the root; an entry and
 * everything below it is skipped (`"node_modules"`, `"web/dist"`). `ignoreFile`
 * is the per-file version, for the one class of noise a path list cannot name:
 * a developer's own dev server appending to a gitignored log beside the code.
 * Symlinks are skipped rather than followed: the vault scanner has the same rule,
 * and a link to a directory would otherwise be read as a file and throw `EISDIR`.
 * A write *through* a link is therefore outside this proof.
 *
 * @param {string} root
 * @param {{ ignore?: readonly string[], ignoreFile?: (relative: string) => boolean }} [options]
 */
export async function snapshotTree(root, { ignore = [], ignoreFile } = {}) {
  const skip = ignore.map((entry) => entry.replace(/^\.[/\\]/, "").split(path.sep).join("/"));
  const isIgnored = (relative) =>
    skip.some((entry) => relative === entry || relative.startsWith(`${entry}/`));

  async function walk(relative, into) {
    const absolute = path.join(root, relative);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const child = relative ? path.join(relative, entry.name) : entry.name;
      const slashPath = child.split(path.sep).join("/");
      if (isIgnored(slashPath)) continue;
      if (ignoreFile?.(slashPath)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(child, into);
        continue;
      }
      const file = path.join(root, child);
      // One read serves both the hash and the size, so a file rewritten
      // between two syscalls cannot produce a snapshot that never existed.
      const [data, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
      into.push({
        path: slashPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
    return into;
  }

  return walk("", []);
}

/**
 * Differences between two snapshots, as human-readable lines; an empty array
 * means every file is byte-for-byte where it was, at the same size and mtime,
 * with nothing added or removed.
 *
 * Content is compared by hash because that is the claim being made ("nothing is
 * written"); size and mtime are reported too so a failure says whether the
 * bytes moved or only the metadata did.
 */
export function diffSnapshots(before, after) {
  const changes = [];
  const beforeByPath = new Map(before.map((file) => [file.path, file]));
  const afterByPath = new Map(after.map((file) => [file.path, file]));

  for (const file of before) {
    const now = afterByPath.get(file.path);
    if (!now) {
      changes.push(`${file.path}: removed`);
      continue;
    }
    if (now.sha256 !== file.sha256) changes.push(`${file.path}: content changed`);
    if (now.size !== file.size) changes.push(`${file.path}: size ${file.size} → ${now.size}`);
    if (now.mtimeMs !== file.mtimeMs) changes.push(`${file.path}: mtime changed`);
  }

  for (const file of after) {
    if (!beforeByPath.has(file.path)) changes.push(`${file.path}: added`);
  }

  return changes;
}
