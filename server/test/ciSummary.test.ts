import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  formatBytes,
  markdown,
  measureArtifact,
  parseTestTotals,
  readTestSummaries,
  type TestSummary,
} from "../../scripts/ci-summary.mjs";

function summary(workspace: string, tests: number, overrides: Partial<TestSummary> = {}): TestSummary {
  return {
    workspace,
    tests,
    pass: tests,
    fail: 0,
    skipped: 0,
    cancelled: 0,
    todo: 0,
    durationMs: 1000,
    ...overrides,
  };
}

describe("ci-summary — reading the test totals", () => {
  it("reads the spec reporter's summary", () => {
    const output = [
      "✔ vault resolves a note (1.2ms)",
      "ℹ tests 191",
      "ℹ suites 10",
      "ℹ pass 190",
      "ℹ fail 1",
      "ℹ cancelled 0",
      "ℹ skipped 0",
      "ℹ todo 0",
      "ℹ duration_ms 553.0406",
    ].join("\n");
    assert.deepEqual(parseTestTotals(output), {
      tests: 191,
      pass: 190,
      fail: 1,
      skipped: 0,
      cancelled: 0,
      todo: 0,
      durationMs: 553.0406,
    });
  });

  it("reads tap, which is what a non-TTY run prints", () => {
    const totals = parseTestTotals(["# tests 208", "# pass 208", "# fail 0", "# duration_ms 369.6"].join("\n"));
    assert.equal(totals?.tests, 208);
    assert.equal(totals?.pass, 208);
    assert.equal(totals?.durationMs, 369.6);
  });

  it("strips colour codes around the summary lines", () => {
    const totals = parseTestTotals("\u001b[32mℹ tests 3\u001b[39m\n\u001b[32mℹ pass 3\u001b[39m");
    assert.equal(totals?.tests, 3);
    assert.equal(totals?.pass, 3);
  });

  it("uses the aggregate block, not a per-file count", () => {
    const output = ["ℹ tests 5", "ℹ pass 5", "ℹ tests 9", "ℹ pass 9"].join("\n");
    assert.equal(parseTestTotals(output)?.tests, 9);
  });

  it("returns null when the run never reached a summary", () => {
    assert.equal(parseTestTotals("Error: bad import"), null);
    assert.equal(parseTestTotals(""), null);
  });
});

describe("ci-summary — collecting captured totals", () => {
  it("reads every workspace, server and web first, and skips junk", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ci-summary-"));
    try {
      writeFileSync(path.join(dir, "tests-web.json"), JSON.stringify(summary("web", 208)));
      writeFileSync(path.join(dir, "tests-server.json"), JSON.stringify(summary("server", 191)));
      writeFileSync(path.join(dir, "tests-audio.json"), JSON.stringify(summary("audio", 12)));
      writeFileSync(path.join(dir, "tests-broken.json"), "{not json");
      writeFileSync(path.join(dir, "notes.txt"), "ignore me");

      assert.deepEqual(
        readTestSummaries(dir).map((entry) => entry.workspace),
        ["server", "web", "audio"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns nothing when the directory does not exist", () => {
    assert.deepEqual(readTestSummaries(path.join(os.tmpdir(), "ci-summary-missing")), []);
  });
});

describe("ci-summary — measuring the build", () => {
  it("counts files, raw bytes, gzipped text and the largest files", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ci-build-"));
    try {
      mkdirSync(path.join(dir, "assets"));
      writeFileSync(path.join(dir, "assets", "index.js"), "x".repeat(4096));
      writeFileSync(path.join(dir, "assets", "index.css"), "y".repeat(1024));
      writeFileSync(path.join(dir, "favicon.ico"), Buffer.alloc(512));

      const measured = measureArtifact(dir);
      assert.ok(measured);
      assert.equal(measured.files, 3);
      assert.equal(measured.bytes, 4096 + 1024 + 512);
      // The .ico is not compressible, so this is gzip of the two text files.
      assert.ok(measured.gzipBytes > 0 && measured.gzipBytes < 4096 + 1024);
      assert.equal(measured.largest[0]?.path.endsWith("assets/index.js"), true);
      assert.equal(measured.largest[1]?.path.endsWith("assets/index.css"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing build rather than an empty one", () => {
    assert.equal(measureArtifact(path.join(os.tmpdir(), "ci-build-missing")), null);
  });
});

describe("ci-summary — what a person reads", () => {
  it("prints per-workspace totals with an aggregate row", () => {
    const body = markdown({
      os: "Linux",
      tests: [summary("server", 191, { durationMs: 2400 }), summary("web", 208, { durationMs: 1600 })],
    });
    assert.ok(body.includes("### What this run executed — Linux"));
    assert.ok(body.includes("| server | 191 | 191 | 0 | 0 | 2.4 s |"));
    assert.ok(body.includes("| **total** | **399** | **399** | **0** | **0** | **4.0 s** |"));
  });

  it("lists build sizes and the largest files", () => {
    const body = markdown({
      os: "Windows",
      tests: [summary("server", 191)],
      artifacts: [
        [
          "dashboard",
          {
            path: "web/dist",
            files: 4,
            bytes: 4096,
            gzipBytes: 1024,
            largest: [{ path: "web/dist/assets/index.js", bytes: 4096, gzipBytes: 1024 }],
          },
        ],
        ["server", null],
      ],
    });
    assert.ok(body.includes("| dashboard | 4 | 4.0 KiB | 1.0 KiB |"));
    assert.ok(body.includes("| server | — | not built | — |"));
    assert.ok(body.includes("`web/dist/assets/index.js` (4.0 KiB)"));
  });

  it("says so when nothing was captured", () => {
    const body = markdown({});
    assert.ok(body.includes("### What this run executed"));
    assert.ok(body.includes("No test totals were captured"));
    assert.ok(body.includes("No build artifacts were measured"));
  });

  it("formats bytes at each scale", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KiB");
    assert.equal(formatBytes(3 * 1024 * 1024), "3.00 MiB");
  });
});
