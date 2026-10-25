#!/usr/bin/env node
/**
 * Keeps exactly one GitHub issue for the weekly dependency-drift run.
 *
 * `check-deps.mjs` decides what is stale and exits 1 when the lockfile has
 * fallen behind a range `package.json` already allows. A red scheduled run is
 * easy to scroll past, so this script turns the same report into something that
 * can be assigned, labelled and discussed:
 *
 *   in-range drift   create the issue when none is open, otherwise rewrite its
 *                    title and body in place. The body *is* the state, so a
 *                    weekly run that finds the same packages does not add a
 *                    comment every week.
 *   clean            comment once with the result, then close every open issue
 *                    carrying the label. The closing comment keeps the
 *                    informational newer-majors list, which would otherwise
 *                    disappear with the issue.
 *
 * Input is `.ci/deps.json`, written by `check-deps.mjs` after a successful
 * `npm outdated`. No report means the check never reached a verdict (npm
 * failed, the step was skipped, or this ran outside CI): the issue is left
 * exactly as it is rather than being closed on missing evidence.
 *
 * Duplicates are reconciled rather than ignored: if an earlier run left more
 * than one open issue with the label, the lowest-numbered one is updated and the
 * rest are closed with a pointer to it.
 *
 * Usage: `npm run drift:issue` in Actions. `npm run drift:issue -- --dry-run`
 * prints the title and body it would publish without calling the API.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { markdown, versionTable } from "./check-deps.mjs";

/** Label that marks the issue as this job's, and the fallback title prefix. */
export const LABEL = "dependency-drift";
export const TITLE_PREFIX = "Dependency drift: ";

/** Invisible marker so a human can tell the issue is machine-maintained. */
export const MARKER = "<!-- braindash:dependency-drift -->";

/** Where `check-deps.mjs` leaves the report it classified. `.ci/` is untracked. */
export const REPORT_PATH = path.join(".ci", "deps.json");

const LABEL_COLOR = "B60205";
const LABEL_DESCRIPTION = "Weekly dependency drift report, maintained by CI";
const TIMEOUT_MS = 20_000;

/** `Oct 21, 2026 14:05 UTC` — one shape for every message this script writes. */
export function stamp(date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Reads the report, or null when there is nothing trustworthy to act on. A
 * half-written file (killed run, hand-edited) is treated like a missing one.
 *
 * @param {string} [file]
 * @returns {import("./drift-issue.d.mts").DriftReport | null}
 */
export function readReport(file = REPORT_PATH) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!Array.isArray(parsed.inRange) || !Array.isArray(parsed.outOfRange)) return null;
  return { inRange: parsed.inRange, outOfRange: parsed.outOfRange };
}

/**
 * The count is in the title because that is what a person scanning the issue
 * list needs; the body carries the rows. Rewriting the title each week is safe
 * because the issue is found by label or prefix, never by exact title.
 *
 * @param {import("./drift-issue.d.mts").DriftReport} report
 * @returns {string}
 */
export function issueTitle(report) {
  const count = report.inRange.length;
  return `${TITLE_PREFIX}${count} lockfile ${count === 1 ? "entry is" : "entries are"} behind`;
}

/**
 * @param {import("./drift-issue.d.mts").DriftReport} report
 * @param {string | null} runUrl
 * @param {Date} now
 * @returns {string}
 */
export function issueBody({ report, runUrl = null, now = new Date() }) {
  const count = report.inRange.length;
  const checked = runUrl ? `[this run](${runUrl})` : "the weekly run";
  return [
    MARKER,
    `The weekly drift check found **${count} lockfile ${count === 1 ? "entry" : "entries"}** behind a version range \`package.json\` already allows. \`npm ci\` still installs cleanly: the lockfile is *stale*, not broken.`,
    "",
    "**Fix:** run `npm update` (or install the package at its wanted version), then commit `package-lock.json`. This issue is rewritten by the next weekly run and closed automatically once every entry matches its range.",
    "",
    markdown(report).trimEnd(),
    "",
    "---",
    `Last checked ${stamp(now)} by ${checked}.`,
    "",
  ].join("\n");
}

/**
 * The comment left behind when the issue closes, so the reason survives it. The
 * informational newer-majors table is repeated here on purpose: it is the one
 * piece of the report that would otherwise vanish with the issue.
 *
 * @param {import("./drift-issue.d.mts").DriftReport} report
 * @param {string | null} runUrl
 * @param {Date} now
 * @returns {string}
 */
export function closeComment({ report, runUrl = null, now = new Date() }) {
  const checked = runUrl ? ` ([run](${runUrl}))` : "";
  const lines = [
    `The weekly drift check on ${stamp(now)} found no in-range drift: every lockfile entry matches the range it is declared under. Closing this issue. It reopens automatically if the lockfile falls behind again.${checked}`,
  ];
  if (report.outOfRange.length > 0) {
    const count = report.outOfRange.length;
    lines.push(
      "",
      `${count} newer version${count === 1 ? "" : "s"} outside the declared ranges ${count === 1 ? "is" : "are"} still available for a deliberate bump:`,
      "",
      ...versionTable(report.outOfRange),
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * What to do with the issues that are already open. Pure, so the duplicate and
 * close rules are tested without a network.
 *
 * @param {import("./drift-issue.d.mts").DriftReport} report
 * @param {Array<{ number: number }>} issues
 * @returns {import("./drift-issue.d.mts").IssuePlan}
 */
export function planIssues({ report, issues }) {
  const numbers = issues.map((issue) => issue.number).sort((a, b) => a - b);
  if (report.inRange.length === 0) return { update: null, create: false, close: numbers };
  const [primary, ...duplicates] = numbers;
  if (primary === undefined) return { update: null, create: true, close: [] };
  return { update: primary, create: false, close: duplicates };
}

/**
 * Minimal REST client. Kept as closures rather than a class so `run` can pass a
 * fake `fetch`-compatible base URL at a local server in tests.
 */
function createClient({ apiUrl, token, timeoutMs = TIMEOUT_MS }) {
  const base = apiUrl.replace(/\/+$/, "");

  const call = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: response.status, ok: response.ok, body: parsed, text };
  };

  const expect = (result, what) => {
    if (result.ok) return result.body;
    const detail = result.body?.message ?? result.text.slice(0, 300);
    throw new Error(`${what}: HTTP ${result.status}${detail ? ` — ${detail}` : ""}`);
  };

  return {
    expect,

    async ensureLabel(repo) {
      const found = await call("GET", `/repos/${repo}/labels/${encodeURIComponent(LABEL)}`);
      if (found.ok) return;
      if (found.status !== 404) expect(found, "reading the drift label");
      const created = await call("POST", `/repos/${repo}/labels`, {
        name: LABEL,
        color: LABEL_COLOR,
        description: LABEL_DESCRIPTION,
      });
      // 422 means it exists already: created by a human or a concurrent run.
      if (created.status !== 422) expect(created, "creating the drift label");
    },

    /** Open issues that are ours, by label or by title prefix, oldest first. */
    async openIssues(repo) {
      const listed = expect(
        await call("GET", `/repos/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`),
        "listing open issues",
      );
      const issues = Array.isArray(listed) ? listed : [];
      return issues
        .filter((issue) => issue && typeof issue.number === "number" && !issue.pull_request)
        .filter((issue) => {
          const labels = Array.isArray(issue.labels) ? issue.labels : [];
          const labelled = labels.some((label) => (typeof label === "string" ? label : label?.name) === LABEL);
          return labelled || String(issue.title ?? "").startsWith(TITLE_PREFIX);
        })
        .map((issue) => ({ number: issue.number }));
    },

    async post(route, body) {
      return expect(await call("POST", route, body), `POST ${route}`);
    },

    async patch(route, body) {
      return expect(await call("PATCH", route, body), `PATCH ${route}`);
    },
  };
}

async function closeIssue(client, repo, number, comment) {
  if (comment) await client.post(`/repos/${repo}/issues/${number}/comments`, { body: comment });
  await client.patch(`/repos/${repo}/issues/${number}`, { state: "closed", state_reason: "completed" });
}

/**
 * Runs one reconciliation. Returns a process exit code: 0 when the call did what
 * the report asked for (including "nothing to do"), 1 when the API or the
 * environment made that impossible.
 *
 * @param {import("./drift-issue.d.mts").RunOptions} [options]
 * @returns {Promise<number>}
 */
export async function run({ env = process.env, argv = [], now = new Date(), log = console.log, reportPath = REPORT_PATH } = {}) {
  const report = readReport(reportPath);
  if (!report) {
    log(`[drift-issue] no report at ${reportPath}; leaving the issue as it is`);
    return 0;
  }

  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  const dryRun = argv.includes("--dry-run");
  const stale = report.inRange.length > 0;
  const serverUrl = (env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
  const runUrl = repo && env.GITHUB_RUN_ID ? `${serverUrl}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const title = issueTitle(report);
  const body = issueBody({ report, runUrl, now });
  const closing = closeComment({ report, runUrl, now });

  if (dryRun || !token) {
    if (!token && env.GITHUB_ACTIONS) {
      log("[drift-issue] GITHUB_TOKEN is not set; cannot manage the issue");
      return 1;
    }
    log(`[drift-issue] dry run: ${stale ? `would create or update "${title}"` : "would close any open drift issue"}`);
    log(stale ? body : closing);
    return 0;
  }

  if (!repo) {
    log("[drift-issue] GITHUB_REPOSITORY is not set; cannot tell which repository to update");
    return 1;
  }

  const client = createClient({ apiUrl: env.GITHUB_API_URL || "https://api.github.com", token });

  try {
    const plan = planIssues({ report, issues: await client.openIssues(repo) });

    if (plan.update !== null) {
      await client.patch(`/repos/${repo}/issues/${plan.update}`, { title, body });
      log(`[drift-issue] updated #${plan.update}: ${title}`);
    } else if (plan.create) {
      await client.ensureLabel(repo);
      const created = await client.post(`/repos/${repo}/issues`, { title, body, labels: [LABEL] });
      log(`[drift-issue] opened #${created?.number ?? "?"}: ${title}`);
    }

    for (const number of plan.close) {
      if (stale) {
        await closeIssue(client, repo, number, `Superseded by #${plan.update}, which tracks the current drift report.`);
        log(`[drift-issue] closed duplicate #${number}`);
      } else {
        await closeIssue(client, repo, number, closing);
        log(`[drift-issue] closed #${number}: the lockfile is current`);
      }
    }

    if (!stale && plan.close.length === 0) {
      log("[drift-issue] no drift and no open issue: nothing to do");
    }
    return 0;
  } catch (error) {
    log(`[drift-issue] could not reconcile the issue: ${(error && error.message) || error}`);
    return 1;
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  process.exit(await run({ argv: process.argv.slice(2) }));
}
