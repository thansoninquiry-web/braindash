import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyLife, readLife } from "../src/life.js";

let root = "";

async function write(relative: string, body: string): Promise<void> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-life-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("readLife — missing data", () => {
  it("treats absent folders as an empty, demo snapshot", async () => {
    const empty = path.join(root, "no-folders");
    const data = await readLife(empty);
    assert.equal(data.demo, true);
    assert.deepEqual(data.daily, []);
    assert.deepEqual(data.monthly, []);
    assert.deepEqual(data.weekly, []);
    assert.deepEqual(data.folders, { daily: false, monthly: false, weekly: false });
    assert.equal(data.warnings.length, 3, "one warning per missing folder");
  });

  it("has an emptyLife helper that is demo by definition", () => {
    const data = emptyLife(null, "no vault");
    assert.equal(data.demo, true);
    assert.equal(data.vaultPath, null);
    assert.deepEqual(data.warnings, ["no vault"]);
  });
});

describe("readLife — parsing", () => {
  const vault = "full";

  before(async () => {
    await write(
      path.join(vault, "Daily/2026-10-18.md"),
      [
        "---",
        "date: 2026-10-18",
        "sleep_hrs: 7.5",
        "energy: 4",
        "workout: yes",
        "deep_work_hrs: 3.5",
        "study_hrs: 2",
        "outreach_sent: 12",
        "applications_sent: 3",
        "revenue_today: $1,200",
        "spend_today: 350",
        "win: Landed the first client call",
        "---",
        "Notes for the day.",
      ].join("\n"),
    );
    await write(
      path.join(vault, "Daily/2026-10-19.md"),
      ["---", "sleep_hrs: 6", "workout: false", "win:", "---", ""].join("\n"),
    );
    await write(
      path.join(vault, "Daily/_template.md"),
      ["---", "sleep_hrs: 8", "workout: true", "---", ""].join("\n"),
    );
    await write(
      path.join(vault, "Monthly/2026-10.md"),
      [
        "---",
        "net_worth: $48,500",
        "credit_score: 742",
        "credit_utilization: 24%",
        "savings_rate: 0.18",
        "---",
      ].join("\n"),
    );
    await write(
      path.join(vault, "Monthly/_template.md"),
      ["---", "net_worth: 0", "credit_score: 0", "---"].join("\n"),
    );
    await write(
      path.join(vault, "Weekly/2026-W42.md"),
      ["---", "health: 7", "money: 6", "business: 5", "learning: 8", "focus: 4", "relationships: 9", "habits: 11", "---"].join("\n"),
    );
    await write(
      path.join(vault, "Weekly/2026-W41.md"),
      ["---", "health: 6", "money: 0", "---"].join("\n"),
    );
  });

  it("reads a full daily note", async () => {
    const data = await readLife(path.join(root, vault));
    const entry = data.daily.find((row) => row.date === "2026-10-18");
    assert.ok(entry);
    assert.equal(entry.sleepHrs, 7.5);
    assert.equal(entry.energy, 4);
    assert.equal(entry.workout, true);
    assert.equal(entry.deepWorkHrs, 3.5);
    assert.equal(entry.studyHrs, 2);
    assert.equal(entry.outreachSent, 12);
    assert.equal(entry.applicationsSent, 3);
    assert.equal(entry.revenueToday, 1200, "currency symbols and commas are stripped");
    assert.equal(entry.spendToday, 350);
    assert.equal(entry.win, "Landed the first client call");
  });

  it("turns missing fields into empty values instead of failing", async () => {
    const data = await readLife(path.join(root, vault));
    const entry = data.daily.find((row) => row.date === "2026-10-19");
    assert.ok(entry);
    assert.equal(entry.sleepHrs, 6);
    assert.equal(entry.energy, null);
    assert.equal(entry.workout, false);
    assert.equal(entry.deepWorkHrs, null);
    assert.equal(entry.win, null);
  });

  it("skips underscore templates and sorts oldest first", async () => {
    const data = await readLife(path.join(root, vault));
    assert.deepEqual(data.daily.map((row) => row.date), ["2026-10-18", "2026-10-19"]);
    assert.equal(data.demo, false);
  });

  it("normalises percent fields from either a percent or a fraction", async () => {
    const data = await readLife(path.join(root, vault));
    assert.equal(data.monthly.length, 1, "the template month is skipped");
    const month = data.monthly[0];
    assert.ok(month);
    assert.equal(month.netWorth, 48500);
    assert.equal(month.creditScore, 742);
    assert.equal(month.creditUtilization, 24);
    assert.equal(month.savingsRate, 18);
  });

  it("reads weekly ratings, clamps them to 1–10 and skips missing areas", async () => {
    const data = await readLife(path.join(root, vault));
    assert.deepEqual(data.weekly.map((row) => row.week), ["2026-W41", "2026-W42"]);
    const latest = data.weekly[1];
    assert.ok(latest);
    assert.deepEqual(latest.ratings, {
      health: 7,
      money: 6,
      business: 5,
      learning: 8,
      focus: 4,
      relationships: 9,
      habits: 10,
    });
    const prior = data.weekly[0];
    assert.ok(prior);
    assert.equal(prior.ratings.money, 1, "0 is clamped up to 1");
    assert.equal(prior.ratings.health, 6);
    assert.equal(prior.ratings.focus, undefined);
  });

  it("keeps the vault path and folder flags", async () => {
    const data = await readLife(path.join(root, vault));
    assert.equal(path.basename(data.vaultPath ?? ""), "full");
    assert.deepEqual(data.folders, { daily: true, monthly: true, weekly: true });
    assert.deepEqual(data.warnings, []);
  });
});

describe("readLife — malformed input", () => {
  const vault = "broken";

  before(async () => {
    await write(
      path.join(vault, "Daily/2026-10-17.md"),
      ["No frontmatter here.", "", "Just prose."].join("\n"),
    );
    await write(path.join(vault, "Daily/not-a-date.md"), "---\nsleep_hrs: 8\n---\n");
    await write(
      path.join(vault, "Daily/2026-10-16.md"),
      ["---", "sleep_hrs: about eight", "energy: five", "revenue_today: n/a", "workout: maybe", "---"].join("\n"),
    );
    await write(path.join(vault, "Monthly/2026-09.md"), "---\nnet_worth: unknown\n---\n");
    await write(path.join(vault, "Weekly/2026-W40.md"), "---\nhealth: eight\n---\n");
  });

  it("keeps a dated note whose frontmatter is missing", async () => {
    const data = await readLife(path.join(root, vault));
    assert.deepEqual(data.daily.map((row) => row.date), ["2026-10-16", "2026-10-17"]);
    const proseOnly = data.daily[1];
    assert.ok(proseOnly);
    assert.equal(proseOnly.sleepHrs, null);
    assert.equal(proseOnly.workout, false);
  });

  it("drops files with no usable date and counts them as warnings", async () => {
    const data = await readLife(path.join(root, vault));
    assert.ok(!data.daily.some((row) => row.date === "not-a-date"));
    assert.ok(data.warnings.some((warning) => warning.includes("not-a-date")));
  });

  it("reads unparseable numbers as null", async () => {
    const data = await readLife(path.join(root, vault));
    const entry = data.daily.find((row) => row.date === "2026-10-16");
    assert.ok(entry);
    assert.equal(entry.sleepHrs, null);
    assert.equal(entry.energy, null);
    assert.equal(entry.revenueToday, null);
    assert.equal(entry.workout, false);
    assert.equal(data.monthly[0]?.netWorth, null);
    assert.deepEqual(data.weekly[0]?.ratings, {});
  });
});
