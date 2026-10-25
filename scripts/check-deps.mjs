#!/usr/bin/env node
/**
 * Dependency drift report for the weekly CI sweep.
 *
 * `npm ci` already proves that `package.json` and `package-lock.json` agree and
 * that every locked tarball still exists. This script answers the other half:
 * has the registry moved while nothing in the repository changed?
 *
 *   in-range drift  `wanted !== current` — the lockfile is behind what the
 *                   declared semver ranges already allow. That is a stale
 *                   lockfile: `npm update` would change it, so it fails.
 *   out-of-range    `latest !== wanted` — a newer major/minor calls for a
 *                   deliberate version bump. Reported, never a failure, because
 *                   upgrading majors on a schedule is not an automation's call.
 *
 * Exit codes: 0 clean or informational-only, 1 in-range drift, 2 npm failed.
 *
 * In CI the classified report is also written to `.ci/deps.json`, which is what
 * `drift-issue.mjs` reads to open, update or close the single drift issue. The
 * file is written only after a successful `npm outdated`, so an npm failure
 * leaves no report and the issue script leaves the issue untouched.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Where the CI report is handed to the next step. `.ci/` is gitignored. */
export const REPORT_PATH = path.join(".ci", "deps.json");

/**
 * `npm outdated --json` maps a name to one object, or to an array when several
 * workspaces depend on the same package. Warnings can precede the JSON, so the
 * payload starts at the first bracket rather than at character zero.
 *
 * @param {string} stdout
 * @returns {import("./check-deps.d.mts").OutdatedEntry[]}
 */
export function parseOutdated(stdout) {
  const start = stdout.search(/[[{]/);
  if (start === -1) return [];
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    throw new Error("npm outdated did not print JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  const entries = [];
  for (const [name, value] of Object.entries(parsed)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!item || typeof item !== "object") continue;
      const text = (key) => (typeof item[key] === "string" ? item[key] : undefined);
    entries.push({
        name,
        current: text("current"),
        wanted: text("wanted"),
        latest: text("latest"),
        type: text("type"),
        dependent: text("dependent"),
        location: text("location"),
      });
    }
  }
  return entries;
}

/**
 * Splits the rows into the two kinds of drift. A row whose `current` is missing
 * is in-range drift: `npm ci` installed it, so the lockfile and the tree
 * disagree and the next `npm install` would rewrite the lockfile.
 *
 * @param {import("./check-deps.d.mts").OutdatedEntry[]} entries
 * @returns {import("./check-deps.d.mts").DriftReport}
 */
export function classifyOutdated(entries) {
  const inRange = [];
  const outOfRange = [];
  for (const entry of entries) {
    if (!entry.wanted) continue;
    if (!entry.current || entry.current !== entry.wanted) {
      inRange.push(entry);
      continue;
    }
    if (entry.latest && entry.latest !== entry.wanted) outOfRange.push(entry);
  }
  // Stable, readable order independent of the registry's response order.
  const byName = (a, b) => a.name.localeCompare(b.name) || (a.dependent ?? "").localeCompare(b.dependent ?? "");
  return { inRange: inRange.sort(byName), outOfRange: outOfRange.sort(byName) };
}

/**
 * Plain-text report for the log.
 *
 * @param {import("./check-deps.d.mts").DriftReport} report
 * @returns {string}
 */
export function renderReport(report) {
  if (report.inRange.length === 0 && report.outOfRange.length === 0) {
    return "No dependency drift: every lockfile entry still matches what its range allows.";
  }
  const lines = [];
  if (report.inRange.length === 0) {
    lines.push("Lockfile is in date with every declared range.");
  } else {
    lines.push(
      `${report.inRange.length} lockfile entr${report.inRange.length === 1 ? "y is" : "ies are"} behind (in-range drift):`,
    );
    for (const entry of report.inRange) {
      lines.push(`  ${entry.name}  ${entry.current ?? "(missing)"} -> ${entry.wanted}  [${entry.dependent ?? "?"}]`);
    }
    lines.push("Fix: run `npm update` (or `npm install` per package), then commit the lockfile.");
  }
  if (report.outOfRange.length > 0) {
    lines.push(
      `${report.outOfRange.length} newer version${report.outOfRange.length === 1 ? "" : "s"} outside the declared ranges (informational):`,
    );
    for (const entry of report.outOfRange) {
      lines.push(`  ${entry.name}  ${entry.wanted} -> ${entry.latest}  [${entry.dependent ?? "?"}]`);
    }
  }
  return lines.join("\n");
}

/**
 * One table of rows, header included. Shared so the job summary and the issue
 * comment cannot render the same packages two different ways.
 *
 * @param {import("./check-deps.d.mts").OutdatedEntry[]} rows
 * @returns {string[]}
 */
export function versionTable(rows) {
  return [
    "| package | current | wanted | latest | declared by |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (entry) =>
        `| \`${entry.name}\` | ${entry.current ?? "—"} | ${entry.wanted ?? "—"} | ${entry.latest ?? "—"} | ${entry.dependent ?? "?"} |`,
    ),
  ];
}

/**
 * Markdown for `$GITHUB_STEP_SUMMARY`, so the weekly run leaves a readable table.
 *
 * @param {import("./check-deps.d.mts").DriftReport} report
 * @returns {string}
 */
export function markdown(report) {
  const table = versionTable;
  const parts = ["## Dependency drift", ""];
  if (report.inRange.length === 0) {
    parts.push("Every lockfile entry matches its declared range.");
  } else {
    parts.push(`**${report.inRange.length} in-range** — the lockfile is stale:`, "", ...table(report.inRange), "");
  }
  if (report.outOfRange.length > 0) {
    parts.push(
      `**${report.outOfRange.length} outside the declared ranges** — informational:`,
      "",
      ...table(report.outOfRange),
      "",
    );
  }
  return `${parts.join("\n")}\n`;
}

/**
 * Writes the report for `drift-issue.mjs`. `inRange` is the actionable half;
 * `outOfRange` travels with it so the closing comment can still say which newer
 * majors exist instead of dropping that information with the issue.
 *
 * @param {import("./check-deps.d.mts").DriftReport} report
 * @param {string} [file]
 * @param {Date} [now]
 * @returns {string} the path written
 */
export function writeReport(report, file = REPORT_PATH, now = new Date()) {
  mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    schema: 1,
    generatedAt: now.toISOString(),
    inRange: report.inRange,
    outOfRange: report.outOfRange,
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

/**
 * Runs npm's own report. Async because the dashboard calls this on a request;
 * a synchronous child would freeze every other route for the length of a
 * registry round trip.
 *
 * @param {{ cwd?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string }>}
 */
export function runNpmOutdated({ cwd = process.cwd(), timeoutMs = 60_000 } = {}) {
  const execPath = process.env.npm_execpath;
  const command = execPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = [...(execPath ? [execPath] : []), "outdated", "--json", "--long"];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      // A bare npm.cmd needs a shell on Windows; the npm_execpath route does not.
      shell: !execPath && process.platform === "win32",
      windowsHide: true,
      timeout: timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    // A timeout kill closes the child with a null status, which the caller reads
    // as npm failing rather than as "no drift".
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * The whole check, shared by the CLI and the dashboard. Never throws: `ok: false`
 * carries a one-line reason, so a route can answer with an honest "unavailable"
 * instead of failing the page.
 *
 * @param {{ cwd?: string, timeoutMs?: number }} [options]
 * @returns {Promise<import("./check-deps.d.mts").DriftOutcome>}
 */
export async function collectDrift(options = {}) {
  let result;
  try {
    result = await runNpmOutdated(options);
  } catch (error) {
    return { ok: false, error: `could not run npm outdated: ${(error && error.message) || error}` };
  }

  // 0 = nothing outdated, 1 = outdated rows exist. Anything else is npm itself.
  if (result.status !== 0 && result.status !== 1) {
    const detail = result.stderr.trim().split("\n").filter(Boolean).at(-1);
    return {
      ok: false,
      error: `npm outdated failed (exit ${result.status ?? "timeout"})${detail ? `: ${detail}` : ""}`,
    };
  }

  try {
    return { ok: true, report: classifyOutdated(parseOutdated(result.stdout)) };
  } catch (error) {
    return { ok: false, error: (error && error.message) || String(error) };
  }
}

async function main() {
  const outcome = await collectDrift();
  if (!outcome.ok) {
    console.error(`[deps] ${outcome.error}`);
    return 2;
  }
  const report = outcome.report;

  console.log(renderReport(report));

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, markdown(report));
    } catch {
      // A missing summary file must not change the check's outcome.
    }
  }

  // The report is evidence for the issue step, not a gate: a read-only
  // workspace must not turn an accurate verdict into a failure.
  const ci = process.env.CI;
  if (ci && ci !== "0" && ci !== "false") {
    try {
      writeReport(report);
    } catch (error) {
      console.error(`[deps] could not write ${REPORT_PATH}: ${(error && error.message) || error}`);
    }
  }

  return report.inRange.length > 0 ? 1 : 0;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  process.exit(await main());
}
