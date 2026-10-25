/**
 * Writes what a CI run actually executed into the GitHub Actions job summary.
 *
 * Two halves, both measured rather than asserted:
 *  - the totals `run-tests.mjs` captured while the suites ran (it writes
 *    `.ci/tests-<workspace>.json` in CI, because the step that later composes
 *    this table cannot see the tests' output);
 *  - the size of the built artifacts on disk.
 *
 * Run after `npm test` and `npm run build`. With `GITHUB_STEP_SUMMARY` set the
 * Markdown is appended there; otherwise it is printed, so the numbers can be
 * checked locally. A missing half is reported as missing, never invented.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUMMARY_DIR = path.join(ROOT, ".ci");

/** Extensions worth gzipping when reporting "what a browser downloads". */
const COMPRESSIBLE = new Set([".js", ".css", ".html", ".svg", ".json", ".txt", ".map"]);
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Reads the runner's own totals out of a spec / tap transcript.
 *
 * The spec reporter prints `ℹ tests 191`; tap prints `# tests 191` (plain
 * non-TTY runs default to tap). Colours are stripped first. Returns null when
 * no run reached the summary block — a crash still exits non-zero, but there is
 * nothing truthful to publish.
 */
export function parseTestTotals(output) {
  if (typeof output !== "string") return null;
  const text = output.replace(ANSI, "");
  const totals = {};
  for (const match of text.matchAll(/^\s*(?:ℹ|#)\s+(tests|pass|fail|skipped|cancelled|todo|duration_ms)\s+([\d.]+)\s*$/gm)) {
    const key = match[1];
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    // The last occurrence is the run's aggregate summary, after the files.
    totals[key] = value;
  }
  if (!Number.isFinite(totals.tests)) return null;
  return {
    tests: totals.tests,
    pass: totals.pass ?? 0,
    fail: totals.fail ?? 0,
    skipped: totals.skipped ?? 0,
    cancelled: totals.cancelled ?? 0,
    todo: totals.todo ?? 0,
    durationMs: totals.duration_ms ?? 0,
  };
}

/** Every workspace's captured totals, server first, then web, then the rest. */
export function readTestSummaries(dir = SUMMARY_DIR) {
  if (!existsSync(dir)) return [];
  const order = ["server", "web"];
  const summaries = [];
  for (const name of readdirSync(dir)) {
    if (!/^tests-.+\.json$/.test(name)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
      if (Number.isFinite(parsed?.tests)) summaries.push(parsed);
    } catch {
      // A half-written or hand-edited file is a missing row, not a failed run.
    }
  }
  return summaries.sort((a, b) => {
    const left = order.indexOf(a.workspace);
    const right = order.indexOf(b.workspace);
    if (left !== -1 || right !== -1) return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
    return String(a.workspace).localeCompare(String(b.workspace));
  });
}

/** Files, raw bytes, gzipped bytes and the largest files under `dir`. */
export function measureArtifact(dir) {
  if (!existsSync(dir)) return null;
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const { size } = statSync(full);
      const relative = path.relative(ROOT, full).split(path.sep).join("/");
      let gzip = 0;
      if (COMPRESSIBLE.has(path.extname(entry.name).toLowerCase())) {
        try {
          gzip = gzipSync(readFileSync(full)).length;
        } catch {
          gzip = 0;
        }
      }
      files.push({ path: relative, bytes: size, gzipBytes: gzip });
    }
  };
  walk(dir);
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const gzipBytes = files.reduce((sum, file) => sum + file.gzipBytes, 0);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
  return { path: dir, files: files.length, bytes, gzipBytes, largest };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The summary block. `artifacts` is a list of `[label, measureArtifact(...)]`
 * pairs; a null measurement means the build did not produce that directory and
 * is called out instead of being counted as zero.
 */
export function markdown({ os, tests = [], artifacts = [] }) {
  const lines = [`### What this run executed${os ? ` — ${os}` : ""}`, ""];

  if (tests.length > 0) {
    lines.push(
      "| Workspace | Tests | Passed | Failed | Skipped | Duration |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const summary of tests) {
      lines.push(
        `| ${summary.workspace} | ${summary.tests} | ${summary.pass} | ${summary.fail} | ` +
          `${summary.skipped} | ${formatDuration(summary.durationMs)} |`,
      );
    }
    const total = tests.reduce(
      (sum, summary) => ({
        tests: sum.tests + summary.tests,
        pass: sum.pass + summary.pass,
        fail: sum.fail + summary.fail,
        skipped: sum.skipped + summary.skipped,
        durationMs: sum.durationMs + summary.durationMs,
      }),
      { tests: 0, pass: 0, fail: 0, skipped: 0, durationMs: 0 },
    );
    lines.push(
      `| **total** | **${total.tests}** | **${total.pass}** | **${total.fail}** | ` +
        `**${total.skipped}** | **${formatDuration(total.durationMs)}** |`,
    );
  } else {
    lines.push("_No test totals were captured; the suites did not report a summary._");
  }

  lines.push("");
  if (artifacts.length > 0) {
    lines.push("| Artifact | Files | Raw | Gzipped |", "| --- | ---: | ---: | ---: |");
    for (const [label, measured] of artifacts) {
      if (!measured) {
        lines.push(`| ${label} | — | not built | — |`);
        continue;
      }
      lines.push(
        `| ${label} | ${measured.files} | ${formatBytes(measured.bytes)} | ${formatBytes(measured.gzipBytes)} |`,
      );
    }
    const largest = artifacts
      .filter(([, measured]) => measured)
      .flatMap(([, measured]) => measured.largest)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 3);
    if (largest.length > 0) {
      lines.push(
        "",
        `Largest files: ${largest.map((file) => `\`${file.path}\` (${formatBytes(file.bytes)})`).join(", ")}.`,
      );
    }
  } else {
    lines.push("_No build artifacts were measured._");
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const os = process.env.RUNNER_OS || `${process.platform} ${process.arch}`;
  const tests = readTestSummaries();
  const artifacts = [
    ["dashboard", measureArtifact(path.join(ROOT, "web", "dist"))],
    ["server", measureArtifact(path.join(ROOT, "server", "dist"))],
  ];
  const body = markdown({ os, tests, artifacts });

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, body);
    } catch (error) {
      // The numbers are useful, not a gate: a read-only summary path must not
      // turn a green build red.
      console.error(`[summary] could not append to ${summaryPath}: ${(error && error.message) || error}`);
      process.stdout.write(body);
    }
  } else {
    process.stdout.write(body);
  }
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  process.exit(main());
}
