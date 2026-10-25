import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  capturesOnDay,
  reviewQueue,
  scanFingerprint,
  scanVault,
  type NoteMeta,
} from "../src/vault.js";

/** A note with the fields these helpers read; a real scan fills the rest. */
function note(file: string, overrides: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path: file,
    title: file.replace(/\.md$/, ""),
    captured: null,
    capturedZone: null,
    nextReview: null,
    origin: null,
    area: null,
    words: 1,
    bytes: 1,
    keywords: [],
    tags: [],
    links: [],
    frontmatter: "",
    ...overrides,
  };
}

/** Noon UTC on the day the options are resolved against. */
const NOW = new Date("2026-10-21T12:00:00Z");

describe("capturesOnDay", () => {
  it("converts a timed stamp into the chosen zone before deciding the day", () => {
    const notes = [
      note("late.md", { captured: "2026-10-20 23:30", capturedZone: "UTC" }),
      note("early.md", { captured: "2026-10-21 02:00", capturedZone: "UTC" }),
    ];
    // 23:30 and 02:00 UTC are both the 20th in New York, and both the 21st in Tokyo.
    assert.deepEqual(
      capturesOnDay(notes, "2026-10-20", { timeZone: "America/New_York", now: NOW }).map((n) => n.path),
      ["early.md", "late.md"],
    );
    assert.deepEqual(
      capturesOnDay(notes, "2026-10-21", { timeZone: "Asia/Tokyo", now: NOW }).map((n) => n.path),
      ["early.md", "late.md"],
    );
  });

  it("keeps a bare date on the day it was written, whatever the zone", () => {
    const notes = [note("dated.md", { captured: "2026-10-21" })];
    assert.equal(capturesOnDay(notes, "2026-10-21", { timeZone: "Asia/Tokyo", now: NOW }).length, 1);
    assert.equal(capturesOnDay(notes, "2026-10-22", { timeZone: "Asia/Tokyo", now: NOW }).length, 0);
  });

  it("omits notes with no usable stamp and lists newest first", () => {
    const picks = capturesOnDay(
      [
        note("undated.md"),
        note("morning.md", { captured: "2026-10-21 09:00", capturedZone: "UTC" }),
        note("evening.md", { captured: "2026-10-21 18:00", capturedZone: "UTC" }),
        note("dated.md", { captured: "2026-10-21" }),
        note("other-day.md", { captured: "2026-10-20 09:00", capturedZone: "UTC" }),
      ],
      "2026-10-21",
      { timeZone: "UTC", now: NOW },
    );
    assert.deepEqual(
      picks.map((entry) => entry.path),
      ["evening.md", "morning.md", "dated.md"],
    );
  });

  it("falls back to the machine clock for an unknown zone", () => {
    const notes = [note("today.md", { captured: "2026-10-21 12:00", capturedZone: "UTC" })];
    // An unreadable zone is treated exactly as "no zone": the local clock decides,
    // rather than the note silently disappearing from every list.
    assert.deepEqual(
      capturesOnDay(notes, "2026-10-21", { timeZone: "Not/AZone", now: NOW }).map((n) => n.path),
      capturesOnDay(notes, "2026-10-21", { now: NOW }).map((n) => n.path),
    );
  });
});

describe("reviewQueue", () => {
  const notes = [
    note("future.md", { nextReview: "2026-11-30" }),
    note("today.md", { nextReview: "2026-10-21" }),
    note("late.md", { nextReview: "2026-10-19" }),
    note("older.md", { nextReview: "2026-10-01" }),
    note("none.md"),
  ];

  it("returns every note due on or before the day, oldest first", () => {
    const queue = reviewQueue(notes, "2026-10-21");
    assert.deepEqual(
      queue.due.map((entry) => entry.path),
      ["older.md", "late.md", "today.md"],
    );
    assert.equal(queue.overdue, 2, "both dates before today are overdue");
  });

  it("counts the day itself as due but not overdue", () => {
    const queue = reviewQueue(notes, "2026-10-21");
    assert.equal(queue.due.some((entry) => entry.path === "today.md"), true);
    assert.equal(queue.overdue, 2);
  });

  it("has nothing due on a day before every review date", () => {
    assert.deepEqual(reviewQueue(notes, "2026-09-30"), { due: [], overdue: 0 });
  });

  it("treats a missing date as out of the queue, never as due", () => {
    assert.equal(reviewQueue(notes, "2026-12-31").due.some((entry) => entry.path === "none.md"), false);
  });
});

describe("next_review on the scan", () => {
  async function scanWith(frontmatter: string, body = "Body.\n"): Promise<NoteMeta> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-review-"));
    try {
      await fs.writeFile(path.join(root, "note.md"), `---\n${frontmatter}\n---\n${body}`, "utf8");
      const scan = await scanVault(root);
      return scan.notes[0] as NoteMeta;
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  it("reads a bare date and drops a trailing time", async () => {
    assert.equal((await scanWith("next_review: 2026-10-27")).nextReview, "2026-10-27");
    assert.equal((await scanWith("next_review: 2026-10-27 09:00")).nextReview, "2026-10-27");
  });

  it("treats a malformed or missing date as absent", async () => {
    assert.equal((await scanWith("title: No review")).nextReview, null);
    assert.equal((await scanWith("next_review: soon")).nextReview, null);
    assert.equal((await scanWith("next_review: 2026-13-40")).nextReview, null);
  });
});

describe("scanFingerprint", () => {
  it("moves when a note's review date changes", () => {
    const before = scanFingerprint([note("a.md", { nextReview: "2026-10-21" })]);
    const after = scanFingerprint([note("a.md", { nextReview: "2026-10-22" })]);
    assert.notEqual(before, after);
  });
});
