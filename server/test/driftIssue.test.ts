import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  closeComment,
  issueBody,
  issueTitle,
  planIssues,
  readReport,
  run,
} from "../../scripts/drift-issue.mjs";
import type { DriftReport, OutdatedEntry } from "../../scripts/check-deps.mjs";

const NOW = new Date("2026-10-21T06:00:00Z");

function row(overrides: Partial<OutdatedEntry> = {}): OutdatedEntry {
  return {
    name: "vite",
    current: "6.3.4",
    wanted: "6.4.4",
    latest: "6.4.4",
    type: "devDependencies",
    dependent: "web",
    ...overrides,
  };
}

function drift(overrides: Partial<DriftReport> = {}): DriftReport {
  return { inRange: [], outOfRange: [], ...overrides };
}

/* ------------------------------------------------------------------ */
/* A stand-in for the handful of REST routes the script uses.          */
/* ------------------------------------------------------------------ */

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  comments: string[];
}

interface FakeGitHub {
  url: string;
  issues: FakeIssue[];
  labels: string[];
  calls: Array<{ method: string; route: string; body: unknown }>;
  close(): Promise<void>;
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

async function fakeGitHub(initial: Array<{ title: string; body?: string; labels?: string[] }> = []): Promise<FakeGitHub> {
  const issues: FakeIssue[] = initial.map((issue, index) => ({
    number: index + 1,
    title: issue.title,
    body: issue.body ?? "",
    labels: issue.labels ?? [],
    state: "open",
    comments: [],
  }));
  let nextNumber = issues.length + 1;
  const labels: string[] = [];
  const calls: Array<{ method: string; route: string; body: unknown }> = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = `${url.pathname}${url.search}`;
    const body = await readJson(req);
    const method = req.method ?? "GET";
    calls.push({ method, route, body });

    const found = url.pathname.match(/^\/repos\/o\/r(\/.*)?$/);
    if (!found) {
      json(res, 404, { message: "Not Found" });
      return;
    }
    const rest = found[1] ?? "";

    if (method === "GET" && rest === "/labels/dependency-drift") {
      if (labels.includes("dependency-drift")) json(res, 200, { name: "dependency-drift" });
      else json(res, 404, { message: "Not Found" });
      return;
    }
    if (method === "POST" && rest === "/labels") {
      const name = typeof body?.name === "string" ? body.name : "";
      if (labels.includes(name)) json(res, 422, { message: "Validation Failed" });
      else {
        labels.push(name);
        json(res, 201, { name });
      }
      return;
    }
    if (rest === "/issues") {
      if (method === "GET") {
        json(
          res,
          200,
          issues
            .filter((issue) => issue.state === "open")
            .map((issue) => ({
              number: issue.number,
              title: issue.title,
              body: issue.body,
              labels: issue.labels.map((name) => ({ name })),
            })),
        );
        return;
      }
      if (method === "POST") {
        const created: FakeIssue = {
          number: nextNumber++,
          title: String(body?.title ?? ""),
          body: String(body?.body ?? ""),
          labels: Array.isArray(body?.labels) ? [...body.labels] : [],
          state: "open",
          comments: [],
        };
        issues.push(created);
        json(res, 201, { number: created.number });
        return;
      }
    }

    const byNumber = rest.match(/^\/issues\/(\d+)(\/comments)?$/);
    const issue = byNumber ? issues.find((candidate) => candidate.number === Number(byNumber[1])) : undefined;
    if (!byNumber || !issue) {
      json(res, 404, { message: "Not Found" });
      return;
    }
    if (byNumber[2] === "/comments" && method === "POST") {
      issue.comments.push(String(body?.body ?? ""));
      json(res, 201, { id: issue.comments.length });
      return;
    }
    if (!byNumber[2] && method === "PATCH") {
      if (typeof body?.title === "string") issue.title = body.title;
      if (typeof body?.body === "string") issue.body = body.body;
      if (body?.state === "closed") issue.state = "closed";
      json(res, 200, { number: issue.number, state: issue.state });
      return;
    }
    json(res, 405, { message: "Method Not Allowed" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    issues,
    labels,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/* ------------------------------------------------------------------ */
/* Test harness: a report on disk plus a fake API, cleaned up together. */
/* ------------------------------------------------------------------ */

interface Harness {
  github: FakeGitHub;
  logs: string[];
  reportPath: string;
  run(options?: { argv?: string[]; env?: Record<string, string | undefined> }): Promise<number>;
  stop(): Promise<void>;
}

async function harness(
  report: DriftReport | null,
  initial: Array<{ title: string; body?: string; labels?: string[] }> = [],
): Promise<Harness> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "drift-issue-"));
  const reportPath = path.join(dir, "deps.json");
  if (report) writeFileSync(reportPath, JSON.stringify({ schema: 1, generatedAt: NOW.toISOString(), ...report }));
  const github = await fakeGitHub(initial);
  const logs: string[] = [];

  return {
    github,
    logs,
    reportPath,
    run: (options = {}) =>
      run({
        reportPath,
        now: NOW,
        argv: options.argv ?? [],
        env: {
          GITHUB_REPOSITORY: "o/r",
          GITHUB_TOKEN: "test-token",
          GITHUB_API_URL: github.url,
          ...options.env,
        },
        log: (line) => logs.push(line),
      }),
    async stop() {
      await github.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/* ------------------------------------------------------------------ */

describe("drift-issue — the report it trusts", () => {
  it("reads a report written by check-deps", async () => {
    const test = await harness(drift({ inRange: [row()] }));
    try {
      const report = readReport(test.reportPath);
      assert.ok(report);
      assert.equal(report.inRange.length, 1);
      assert.equal(report.inRange[0]?.name, "vite");
    } finally {
      await test.stop();
    }
  });

  it("treats a missing, malformed or wrongly shaped file as no report", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "drift-report-"));
    try {
      assert.equal(readReport(path.join(dir, "absent.json")), null);
      const junk = path.join(dir, "junk.json");
      writeFileSync(junk, "{not json");
      assert.equal(readReport(junk), null);
      const wrong = path.join(dir, "wrong.json");
      writeFileSync(wrong, JSON.stringify({ inRange: "nope" }));
      assert.equal(readReport(wrong), null);
      const array = path.join(dir, "array.json");
      writeFileSync(array, JSON.stringify([]));
      assert.equal(readReport(array), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("drift-issue — what a person reads", () => {
  it("counts the stale entries in the title, with the right verb", () => {
    assert.equal(issueTitle(drift({ inRange: [row()] })), "Dependency drift: 1 lockfile entry is behind");
    assert.equal(issueTitle(drift({ inRange: [row(), row({ name: "react" })] })), "Dependency drift: 2 lockfile entries are behind");
  });

  it("writes a body with the marker, the table, the fix and the run link", () => {
    const body = issueBody({
      report: drift({ inRange: [row()] }),
      runUrl: "https://github.com/o/r/actions/runs/42",
      now: NOW,
    });
    assert.match(body, /<!-- braindash:dependency-drift -->/);
    assert.match(body, /\*\*1 lockfile entry\*\* behind a version range/);
    assert.match(body, /\| `vite` \| 6\.3\.4 \| 6\.4\.4 \| 6\.4\.4 \| web \|/);
    assert.match(body, /npm update/);
    assert.match(body, /\[this run\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/42\)/);
    assert.match(body, /2026-10-21 06:00 UTC/);
  });

  it("closes with the reason and keeps the newer-majors table", () => {
    const comment = closeComment({
      report: drift({
        outOfRange: [row({ name: "express", current: "4.22.3", wanted: "4.22.3", latest: "5.3.0", dependent: "server" })],
      }),
      now: NOW,
    });
    assert.match(comment, /found no in-range drift/);
    assert.match(comment, /reopens automatically/);
    assert.match(comment, /1 newer version outside the declared ranges is still available/);
    assert.match(comment, /\| `express` \|/);
    assert.doesNotMatch(comment, /^## /m, "a heading is noise in a comment");
  });

  it("closes plainly when there is nothing to report", () => {
    const comment = closeComment({ report: drift(), now: NOW });
    assert.match(comment, /every lockfile entry matches the range/);
    assert.doesNotMatch(comment, /newer version/);
  });
});

describe("drift-issue — what to do with the open issues", () => {
  it("creates when stale and nothing is open", () => {
    assert.deepEqual(planIssues({ report: drift({ inRange: [row()] }), issues: [] }), {
      update: null,
      create: true,
      close: [],
    });
  });

  it("updates the oldest and closes the rest", () => {
    assert.deepEqual(planIssues({ report: drift({ inRange: [row()] }), issues: [{ number: 5 }, { number: 2 }] }), {
      update: 2,
      create: false,
      close: [5],
    });
  });

  it("closes everything when the lockfile is current", () => {
    assert.deepEqual(planIssues({ report: drift(), issues: [{ number: 3 }] }), {
      update: null,
      create: false,
      close: [3],
    });
  });

  it("does nothing when clean with no issue", () => {
    assert.deepEqual(planIssues({ report: drift(), issues: [] }), { update: null, create: false, close: [] });
  });
});

describe("drift-issue — reconciling against the API", () => {
  it("does not call the API without a report", async () => {
    const test = await harness(null);
    try {
      assert.equal(await test.run(), 0);
      assert.equal(test.github.calls.length, 0);
      assert.match(test.logs.join("\n"), /leaving the issue as it is/);
    } finally {
      await test.stop();
    }
  });

  it("opens one labelled issue for a stale lockfile", async () => {
    const test = await harness(drift({ inRange: [row()] }));
    try {
      assert.equal(await test.run(), 0);
      assert.equal(test.github.issues.length, 1);
      const issue = test.github.issues[0]!;
      assert.equal(issue.title, "Dependency drift: 1 lockfile entry is behind");
      assert.deepEqual(issue.labels, ["dependency-drift"]);
      assert.deepEqual(test.github.labels, ["dependency-drift"]);
      assert.match(issue.body, /`vite`/);
      assert.equal(issue.comments.length, 0, "creating does not also comment");
    } finally {
      await test.stop();
    }
  });

  it("rewrites the same issue instead of opening a second one", async () => {
    const test = await harness(drift({ inRange: [row()] }));
    try {
      assert.equal(await test.run(), 0);
      const first = test.github.issues[0]!;

      // Next week: another package falls behind.
      const changed = drift({ inRange: [row(), row({ name: "react", current: "19.0.0", wanted: "19.1.0", dependent: "web" })] });
      const again = await harness(changed, [{ title: first.title, body: first.body, labels: ["dependency-drift"] }]);
      try {
        assert.equal(await again.run(), 0);
        assert.equal(again.github.issues.length, 1);
        assert.equal(again.github.issues[0]!.title, "Dependency drift: 2 lockfile entries are behind");
        assert.match(again.github.issues[0]!.body, /`react`/);
        assert.equal(again.github.issues[0]!.comments.length, 0, "a recurring report is not a weekly comment");
      } finally {
        await again.stop();
      }
    } finally {
      await test.stop();
    }
  });

  it("closes the issue once every entry matches its range", async () => {
    const test = await harness(drift(), [
      { title: "Dependency drift: 2 lockfile entries are behind", body: "old", labels: ["dependency-drift"] },
    ]);
    try {
      assert.equal(await test.run(), 0);
      const issue = test.github.issues[0]!;
      assert.equal(issue.state, "closed");
      assert.equal(issue.comments.length, 1);
      assert.match(issue.comments[0]!, /found no in-range drift/);
      assert.equal(test.github.issues.length, 1, "closing does not open anything");
    } finally {
      await test.stop();
    }
  });

  it("finds the issue by title prefix when the label is missing", async () => {
    const test = await harness(drift({ inRange: [row()] }), [
      { title: "Dependency drift: 1 lockfile entry is behind", body: "old" },
    ]);
    try {
      assert.equal(await test.run(), 0);
      assert.equal(test.github.issues.length, 1);
      assert.match(test.github.issues[0]!.body, /`vite`/);
    } finally {
      await test.stop();
    }
  });

  it("folds a leftover duplicate into the oldest issue", async () => {
    const test = await harness(drift({ inRange: [row()] }), [
      { title: "Dependency drift: 1 lockfile entry is behind", body: "one", labels: ["dependency-drift"] },
      { title: "Dependency drift: 2 lockfile entries are behind", body: "two", labels: ["dependency-drift"] },
    ]);
    try {
      assert.equal(await test.run(), 0);
      assert.equal(test.github.issues[0]!.state, "open");
      assert.match(test.github.issues[0]!.body, /`vite`/);
      assert.equal(test.github.issues[1]!.state, "closed");
      assert.match(test.github.issues[1]!.comments[0]!, /Superseded by #1/);
    } finally {
      await test.stop();
    }
  });

  it("writes nothing when clean with no open issue", async () => {
    const test = await harness(drift());
    try {
      assert.equal(await test.run(), 0);
      assert.deepEqual(
        test.github.calls.filter((call) => call.method !== "GET"),
        [],
        "a clean run should not create a label or an issue",
      );
    } finally {
      await test.stop();
    }
  });

  it("dry-runs the body without touching the API", async () => {
    const test = await harness(drift({ inRange: [row()] }));
    try {
      assert.equal(await test.run({ argv: ["--dry-run"] }), 0);
      assert.equal(test.github.calls.length, 0);
      assert.match(test.logs.join("\n"), /would create or update "Dependency drift: 1 lockfile entry is behind"/);
      assert.match(test.logs.join("\n"), /`vite`/);
    } finally {
      await test.stop();
    }
  });

  it("fails in Actions when the token is missing, instead of silently skipping", async () => {
    const test = await harness(drift({ inRange: [row()] }));
    try {
      assert.equal(await test.run({ env: { GITHUB_TOKEN: "", GH_TOKEN: "", GITHUB_ACTIONS: "true" } }), 1);
      assert.equal(test.github.calls.length, 0);
      assert.match(test.logs.join("\n"), /GITHUB_TOKEN is not set/);
    } finally {
      await test.stop();
    }
  });
});
