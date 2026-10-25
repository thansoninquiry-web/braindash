#!/usr/bin/env node
/**
 * Fails when a tracked text file has CRLF in the working tree *or* in the index.
 *
 * `.gitattributes` asks Git for LF in every checkout (`* text=auto eol=lf`), so a
 * fresh clone should never hand you CRLF. This checks the bytes rather than
 * trusting the attribute file: an editor that writes CRLF, a tool that ignores
 * `eol=lf`, or a rule that stopped matching all surface as `w/crlf` or `w/mixed`
 * in `git ls-files --eol`.
 *
 * The index column of that same command (`i/…`) is the blob that would be
 * committed, and it can disagree with the disk. A blob written past the filters —
 * `git hash-object --no-filters` plus `update-index`, a merge tool, a file added
 * under an older ruleset — carries CRLF into history while the working tree still
 * looks correct, and the only way to notice is a checkout on the next machine.
 * Reading the index costs no extra Git call: both columns come from one listing.
 *
 * That command is also the source of truth for *which* files are text: Git's own
 * content sniffing and the `binary` declarations decide, so a PNG that happens to
 * contain 0x0d0a is not a finding, and the file does not have to be read to know
 * the difference. Paths declared `eol=crlf` are skipped for the same reason — the
 * rule is the answer for them — which is what lets the Windows launcher entries in
 * `.gitattributes` stay meaningful.
 *
 * Exit codes: 0 every text file is LF in both places, 1 CRLF found in either,
 * 2 Git could not answer.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The repository this script lives in, so `npm run check:eol` works from any cwd. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One `git ls-files --eol -z` record:
 *
 *   i/lf    w/lf    attr/text eol=lf      <TAB>README.md
 *   i/-text w/-text attr/-text            <TAB>docs/reference/jarvis.png
 *
 * The columns are space-padded, so the tab is what separates the attributes from
 * the path; splitting on it rather than on whitespace keeps paths with spaces
 * intact. `eol=` is absent unless a rule declares it.
 */
const EOL_ROW = /^i\/(\S+)\s+w\/(\S+)\s+attr(\S+)(?:\s+eol=(\S+))?\s*\t([\s\S]*)$/;

/**
 * Parses the `-z` output into one entry per tracked file. A record that does not
 * match the expected shape throws instead of being skipped: an unfamiliar format
 * must not read as "nothing to report", which would make the gate quietly
 * useless after a Git upgrade.
 *
 * @param {string} stdout
 * @returns {import("./check-eol.d.mts").TrackedFile[]}
 */
export function parseEolList(stdout) {
  const files = [];
  for (const record of stdout.split("\0")) {
    if (!record) continue;
    const match = EOL_ROW.exec(record);
    if (!match) {
      throw new Error(`unexpected git ls-files --eol row: ${JSON.stringify(record)}`);
    }
    const [, index, worktree, attr, eol, file] = match;
    files.push({ path: file, index, worktree, attr, eol });
  }
  return files;
}

/**
 * Whether Git treats the path as binary. `binary` is a macro for `-text -diff`, so
 * either spelling can be what `attr/` reports, and the content-sniffed answer can
 * still appear as `i/-text` when no rule matches the extension.
 *
 * @param {import("./check-eol.d.mts").TrackedFile} file
 * @returns {boolean}
 */
export function isBinaryFile(file) {
  return file.attr === "/binary" || file.attr.startsWith("/-text") || file.index === "-text";
}

/**
 * The files that break the rule: text, not explicitly declared `eol=crlf`, and
 * ending lines with CRLF on disk — all of them (`crlf`) or some of them (`mixed`).
 * `w/none` is a file with no line ending at all, which cannot be a CRLF line.
 *
 * @param {readonly import("./check-eol.d.mts").TrackedFile[]} files
 * @returns {import("./check-eol.d.mts").TrackedFile[]}
 */
export function crlfOffenders(files) {
  return files.filter(
    (file) =>
      !isBinaryFile(file) &&
      file.eol !== "crlf" &&
      (file.worktree === "crlf" || file.worktree === "mixed"),
  );
}

/**
 * The files whose *staged blob* carries CRLF: the same rule as the working tree,
 * applied to the column that is actually committed. This is the check the disk
 * cannot stand in for — a blob can hold CRLF while every working-tree copy reads
 * `w/lf`, because the working tree is regenerated from the blob on checkout and a
 * filter can rewrite it in either direction.
 *
 * @param {readonly import("./check-eol.d.mts").TrackedFile[]} files
 * @returns {import("./check-eol.d.mts").TrackedFile[]}
 */
export function crlfBlobs(files) {
  return files.filter(
    (file) =>
      !isBinaryFile(file) &&
      file.eol !== "crlf" &&
      (file.index === "crlf" || file.index === "mixed"),
  );
}

/**
 * 1-based line numbers whose ending is CRLF. A lone CR is an old-Mac line ending
 * rather than a CRLF one, so it is not counted.
 *
 * @param {Buffer | Uint8Array} data
 * @returns {number[]}
 */
export function crlfLines(data) {
  const lines = [];
  let line = 1;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] !== 0x0a) continue;
    if (i > 0 && data[i - 1] === 0x0d) lines.push(line);
    line += 1;
  }
  return lines;
}

/**
 * The whole check. Never throws: `ok: false` carries a one-line reason and the
 * caller turns it into exit code 2, so "Git could not answer" is never reported
 * as a clean tree.
 *
 * @param {{ cwd?: string }} [options]
 * @returns {import("./check-eol.d.mts").EolOutcome}
 */
export function collectEol(options = {}) {
  const cwd = options.cwd ?? ROOT;
  const result = spawnSync("git", ["ls-files", "--eol", "-z"], {
    cwd,
    encoding: "utf8",
    // Every tracked path plus its attributes: tens of KB here, a few MB in a
    // large repository. The default 1 MB would truncate a real answer.
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    return { ok: false, error: `could not run git: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const detail = result.stderr
      .trim()
      .split("\n")
      .filter(Boolean)
      .at(-1);
    return {
      ok: false,
      error: `git ls-files exited ${result.status ?? "without a status"}${detail ? `: ${detail}` : ""}`,
    };
  }

  let files;
  try {
    files = parseEolList(result.stdout);
  } catch (error) {
    return { ok: false, error: (error && error.message) || String(error) };
  }

  const binary = files.filter(isBinaryFile).length;
  const declaredCrlf = files.filter((file) => !isBinaryFile(file) && file.eol === "crlf").length;
  return {
    ok: true,
    root: cwd,
    files,
    text: files.length - binary,
    binary,
    declaredCrlf,
    offenders: crlfOffenders(files),
    blobs: crlfBlobs(files),
  };
}

/** Counts the CRLF lines inside a blob, so an index finding is as specific as a disk one. */
function describeBlob(root, file) {
  const result = spawnSync("git", ["cat-file", "blob", `:${file.path}`], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
    return `  ${file.path} — CRLF in the staged blob (could not read it to count them)`;
  }
  const lines = crlfLines(result.stdout);
  const first = lines[0];
  const count = `${lines.length} CRLF line${lines.length === 1 ? "" : "s"} in the staged blob`;
  return `  ${file.path} — ${count}${first === undefined ? "" : ` (first at line ${first})`}`;
}

/** Human-readable lines: one per offending path, with the count and first line. */
function describeOffender(root, file) {
  try {
    const lines = crlfLines(readFileSync(path.join(root, file.path)));
    const first = lines[0];
    const count = `${lines.length} CRLF line${lines.length === 1 ? "" : "s"}`;
    return `  ${file.path} — ${count}${first === undefined ? "" : ` (first at line ${first})`}`;
  } catch {
    // A file that vanished between Git's scan and this read is still a finding;
    // the path alone is the useful part.
    return `  ${file.path} — CRLF line endings (could not read the file to count them)`;
  }
}

function main() {
  const outcome = collectEol();
  if (!outcome.ok) {
    console.error(`[line-endings] ${outcome.error}`);
    return 2;
  }

  if (outcome.offenders.length === 0 && outcome.blobs.length === 0) {
    const parts = [
      `${outcome.text} text file${outcome.text === 1 ? "" : "s"}`,
      "all LF in the index and the working tree",
    ];
    if (outcome.binary > 0) parts.push(`${outcome.binary} binary skipped`);
    if (outcome.declaredCrlf > 0) parts.push(`${outcome.declaredCrlf} declared CRLF skipped`);
    console.log(`[line-endings] ${parts.join(", ")}`);
    return 0;
  }

  // The index finding comes first: it is the one that reaches other machines.
  if (outcome.blobs.length > 0) {
    console.error(
      `[line-endings] CRLF in the index: ${outcome.blobs.length} of ${outcome.text} text files`,
    );
    for (const file of outcome.blobs) console.error(describeBlob(outcome.root, file));
    console.error(
      "\nThese staged blobs are text, carry CRLF, and are not declared `eol=crlf`," +
        " so a\ncheckout of them would hand out CRLF everywhere. Rewrite them through the\n" +
        "filters with `git add --renormalize <path>` and commit again.",
    );
  }

  if (outcome.offenders.length > 0) {
    if (outcome.blobs.length > 0) console.error("");
    console.error(
      `[line-endings] CRLF in the working tree: ${outcome.offenders.length} of ${outcome.text} text files`,
    );
    for (const file of outcome.offenders) console.error(describeOffender(outcome.root, file));
    console.error(
      "\nThese paths are tracked as text and are not declared `eol=crlf`. Restore the\n" +
        "committed bytes with `git checkout -- <path>`, or rewrite them with LF.",
    );
  }

  return 1;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  process.exitCode = main();
}
