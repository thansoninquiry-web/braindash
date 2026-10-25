import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWorkingMode } from "../src/workingMode.js";

let root = "";
const stateFile = () => path.join(root, ".freebuff", "working-mode");

async function writeMode(body: string): Promise<void> {
  await fs.mkdir(path.dirname(stateFile()), { recursive: true });
  await fs.writeFile(stateFile(), body, "utf8");
}

async function clearMode(): Promise<void> {
  await fs.rm(stateFile(), { force: true });
}

/** Instants in UTC; the schedule is read in America/New_York (EDT until Nov 1). */
const at = (iso: string) => new Date(iso);

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-mode-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("readWorkingMode — the weekly schedule", () => {
  it("follows Mon–Fri 08:30–17:30 in New York", async () => {
    await clearMode();
    const cases: Array<[string, "work" | "home"]> = [
      ["2026-10-19T12:29:00Z", "home"], // Mon 08:29 EDT
      ["2026-10-19T12:30:00Z", "work"], // Mon 08:30
      ["2026-10-19T21:29:00Z", "work"], // Mon 17:29
      ["2026-10-19T21:30:00Z", "home"], // Mon 17:30
      ["2026-10-24T15:00:00Z", "home"], // Sat 11:00
      ["2026-10-18T15:00:00Z", "home"], // Sun 11:00
    ];
    for (const [iso, expected] of cases) {
      const mode = readWorkingMode({ root, now: at(iso) });
      assert.equal(mode.mode, expected, iso);
      assert.equal(mode.source, "schedule", iso);
      assert.equal(mode.schedule.mode, expected, iso);
      assert.equal(mode.stale, false);
    }
  });

  it("reads the zone, not the machine clock", async () => {
    await clearMode();
    // 08:29 and 08:30 in January are EST (UTC-5), so UTC-4 arithmetic is wrong.
    assert.equal(readWorkingMode({ root, now: at("2027-01-04T13:29:00Z") }).mode, "home");
    assert.equal(readWorkingMode({ root, now: at("2027-01-04T13:30:00Z") }).mode, "work");
  });

  it("has nothing to override when the file is missing", async () => {
    await clearMode();
    const mode = readWorkingMode({ root, now: at("2026-10-19T12:30:00Z") });
    assert.equal(mode.mode, "work");
    assert.equal(mode.since, null);
    assert.equal(mode.until, null);
    assert.equal(mode.note, null);
  });
});

describe("readWorkingMode — explicit state", () => {
  const now = at("2026-10-19T12:30:00Z"); // 08:30 Monday, schedule says work

  it("lets a fresh work override win, and says so", async () => {
    await writeMode(
      [
        "mode: work",
        "since: 2026-10-19T10:30:00.000Z",
        "until: 2026-10-19T19:30:00.000Z",
        "note: at the office",
      ].join("\n"),
    );
    const mode = readWorkingMode({ root, now });
    assert.equal(mode.mode, "work");
    assert.equal(mode.source, "explicit override");
    assert.equal(mode.stale, false);
    assert.equal(mode.since, "2026-10-19T10:30:00.000Z");
    assert.equal(mode.until, "2026-10-19T19:30:00.000Z");
    assert.equal(mode.note, "at the office");
  });

  it("lets a fresh home override beat office hours", async () => {
    await writeMode(["mode: home", "since: 2026-10-19T12:00:00.000Z"].join("\n"));
    const mode = readWorkingMode({ root, now });
    assert.equal(mode.mode, "home", "standing at the desk outranks the calendar");
    assert.equal(mode.source, "explicit override");
  });

  it("drops an override whose until has passed", async () => {
    await writeMode(
      ["mode: home", "since: 2026-10-19T08:00:00.000Z", "until: 2026-10-19T11:00:00.000Z"].join("\n"),
    );
    const mode = readWorkingMode({ root, now });
    assert.equal(mode.mode, "work", "the schedule decides again");
    assert.equal(mode.stale, true);
    assert.match(mode.source, /stale/);
    assert.equal(mode.since, "2026-10-19T08:00:00.000Z", "the ignored override is still visible");
  });

  it("drops an override older than twelve hours", async () => {
    await writeMode(["mode: home", "since: 2026-10-18T22:00:00.000Z"].join("\n"));
    const mode = readWorkingMode({ root, now });
    assert.equal(mode.mode, "work");
    assert.equal(mode.stale, true);
  });

  it("keeps the mode when the file has extra or unknown lines", async () => {
    await writeMode(["# a comment", "mode: home", "since: 2026-10-19T12:00:00.000Z", "mood: fine"].join("\n"));
    assert.equal(readWorkingMode({ root, now }).mode, "home");
  });
});

describe("readWorkingMode — a file it cannot trust", () => {
  it("falls back to the schedule for an unknown mode", async () => {
    await writeMode(["mode: nap", "since: 2026-10-19T12:00:00.000Z"].join("\n"));
    const mode = readWorkingMode({ root, now: at("2026-10-19T12:30:00Z") });
    assert.equal(mode.mode, "work");
    assert.equal(mode.source, "schedule");
  });

  it("falls back to the schedule for an empty file", async () => {
    await writeMode("");
    assert.equal(readWorkingMode({ root, now: at("2026-10-19T12:30:00Z") }).mode, "work");
  });

  it("does not throw when the state path is a directory", async () => {
    const dir = path.join(root, ".freebuff", "working-mode");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    assert.equal(readWorkingMode({ root, now: at("2026-10-19T12:30:00Z") }).source, "schedule");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("does not throw when the repo root has no .freebuff at all", () => {
    const mode = readWorkingMode({ root: path.join(root, "nowhere"), now: at("2026-10-19T12:30:00Z") });
    assert.equal(mode.mode, "work");
    assert.equal(mode.source, "schedule");
  });
});

describe("readWorkingMode — the payload the badge reads", () => {
  it("carries the schedule it resolved against", () => {
    const mode = readWorkingMode({ root, now: at("2026-10-19T12:30:00Z") });
    assert.deepEqual(mode.schedule, {
      mode: "work",
      timeZone: "America/New_York",
      days: [1, 2, 3, 4, 5],
      start: "08:30",
      end: "17:30",
    });
    assert.equal(mode.checkedAt, "2026-10-19T12:30:00.000Z");
  });

  it("reports the calendar even while an override is in force", async () => {
    await writeMode(["mode: home", "since: 2026-10-19T12:00:00.000Z"].join("\n"));
    const mode = readWorkingMode({ root, now: at("2026-10-19T12:30:00Z") });
    assert.equal(mode.mode, "home");
    assert.equal(mode.schedule.mode, "work", "the tooltip can explain the disagreement");
  });
});
