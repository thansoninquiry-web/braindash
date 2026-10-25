import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  areaScore,
  buildLifeView,
  dayKey,
  demoLife,
  isoWeekKey,
  lastDays,
  latestWin,
  lifeAlerts,
  metricScore,
  metricView,
  moneySnapshot,
  streaks,
  weekStartKey,
  weeklySeries,
} from "../src/life.ts";
import type { LifeDaily, LifeData, LifeMonthly, LifeWeekly } from "../src/types.ts";

const TODAY = "2026-10-19";

function daily(date: string, overrides: Partial<LifeDaily> = {}): LifeDaily {
  return {
    date,
    sleepHrs: 8,
    energy: 5,
    workout: true,
    deepWorkHrs: 4,
    studyHrs: 2,
    outreachSent: 10,
    applicationsSent: 5,
    revenueToday: 200,
    spendToday: 40,
    win: "Did the thing",
    ...overrides,
  };
}

function data(overrides: Partial<LifeData> = {}): LifeData {
  return {
    vaultPath: null,
    scannedAt: "2026-10-19T12:00:00.000Z",
    demo: false,
    folders: { daily: true, monthly: true, weekly: true },
    daily: [],
    monthly: [],
    weekly: [],
    warnings: [],
    ...overrides,
  };
}

const perfectWeek = (today = TODAY): LifeDaily[] =>
  lastDays(today, 7).map((date) => daily(date));

describe("date helpers", () => {
  it("keys local days and walks them", () => {
    assert.equal(dayKey(new Date(2026, 9, 19)), "2026-10-19");
    assert.equal(addDays("2026-10-19", 1), "2026-10-20");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.deepEqual(lastDays("2026-10-19", 3), ["2026-10-17", "2026-10-18", "2026-10-19"]);
  });

  it("maps between ISO weeks and their Monday", () => {
    assert.equal(isoWeekKey("2026-10-19"), "2026-W43");
    assert.equal(weekStartKey("2026-W43"), "2026-10-19");
    assert.equal(weekStartKey("2026-W42"), "2026-10-12");
    assert.equal(weekStartKey("not-a-week"), "not-a-week");
  });
});

describe("metricScore", () => {
  it("caps at the target and clamps negatives", () => {
    assert.equal(metricScore(4, "sleepHrs"), 0.5);
    assert.equal(metricScore(8, "sleepHrs"), 1);
    assert.equal(metricScore(12, "sleepHrs"), 1);
  });

  it("flips for lower-is-better metrics", () => {
    assert.equal(metricScore(0, "creditUtilization"), 1);
    assert.equal(metricScore(15, "creditUtilization"), 0.5);
    assert.equal(metricScore(30, "creditUtilization"), 0);
    assert.equal(metricScore(60, "creditUtilization"), 0);
  });

  it("returns null for missing values", () => {
    assert.equal(metricScore(null, "sleepHrs"), null);
    assert.equal(metricScore(Number.NaN, "energy"), null);
  });
});

describe("areaScore", () => {
  it("scores a perfect health week at 100", () => {
    assert.equal(areaScore("health", data({ daily: perfectWeek() }), TODAY), 100);
  });

  it("counts a missing day as zero", () => {
    const week = perfectWeek().slice(1);
    const score = areaScore("health", data({ daily: week }), TODAY);
    assert.ok(Math.abs(score - (600 / 7)) < 0.001, `six of seven days: ${score}`);
  });

  it("uses only the requested window", () => {
    const old = lastDays(TODAY, 14).slice(0, 7).map((date) => daily(date, { sleepHrs: 0, energy: 0, workout: false }));
    const score = areaScore("health", data({ daily: [...old, ...perfectWeek()] }), TODAY);
    assert.equal(score, 100);
  });

  it("scores business from outreach, applications and any revenue", () => {
    const week = lastDays(TODAY, 7).map((date) =>
      daily(date, { outreachSent: 5, applicationsSent: 5, revenueToday: 1 }),
    );
    // outreach 0.5, applications 1, revenue 1 => 0.833
    assert.ok(Math.abs(areaScore("business", data({ daily: week }), TODAY) - 83.333) < 0.01);
  });

  it("skips missing monthly fields rather than scoring them as zero", () => {
    const week = lastDays(TODAY, 7).map((date) => daily(date, { revenueToday: 10, spendToday: 0 }));
    assert.equal(areaScore("money", data({ daily: week }), TODAY), 100);
  });

  it("folds monthly money metrics into the average", () => {
    const monthly: LifeMonthly[] = [
      { month: "2026-10", netWorth: 100_000, creditScore: 800, creditUtilization: 0, savingsRate: 20 },
    ];
    const week = lastDays(TODAY, 7).map((date) => daily(date, { revenueToday: 10, spendToday: 0 }));
    assert.equal(areaScore("money", data({ daily: week, monthly }), TODAY), 100);
  });

  it("scores a bad month lower", () => {
    const monthly: LifeMonthly[] = [
      { month: "2026-10", netWorth: 0, creditScore: 0, creditUtilization: 30, savingsRate: 0 },
    ];
    const week = lastDays(TODAY, 7).map((date) => daily(date, { revenueToday: 0, spendToday: 50 }));
    assert.equal(areaScore("money", data({ daily: week, monthly }), TODAY), 0);
  });

  it("scores relationships from the weekly rating alone", () => {
    const weekly: LifeWeekly[] = [{ week: "2026-W43", ratings: { relationships: 8 } }];
    const score = areaScore("relationships", data({ weekly }), TODAY);
    assert.equal(score, 80);
  });

  it("is zero when there is no data at all", () => {
    for (const area of ["health", "money", "business", "learning", "focus", "relationships", "habits"] as const) {
      assert.equal(areaScore(area, data(), TODAY), 0, area);
    }
  });
});

describe("streaks", () => {
  it("counts workout, study and win runs with their bests", () => {
    const rows: LifeDaily[] = [
      daily("2026-10-14", { workout: true }),
      daily("2026-10-15", { workout: true, studyHrs: 0, win: null }),
      daily("2026-10-16", { workout: true, studyHrs: 0, win: null }),
      daily("2026-10-17", { workout: true, studyHrs: 0, win: null }),
      daily("2026-10-18", { workout: true, studyHrs: 1, win: "a" }),
      daily("2026-10-19", { workout: true, studyHrs: 1.5, win: "b" }),
    ];
    const result = streaks(rows, TODAY);
    assert.deepEqual(result.workout, { current: 6, best: 6 });
    assert.deepEqual(result.study, { current: 2, best: 2 });
    assert.deepEqual(result.win, { current: 2, best: 2 });
  });

  it("keeps a streak alive while today has no entry yet", () => {
    const rows: LifeDaily[] = [
      daily("2026-10-16", { workout: true }),
      daily("2026-10-17", { workout: true }),
      daily("2026-10-18", { workout: true }),
    ];
    assert.deepEqual(streaks(rows, TODAY).workout, { current: 3, best: 3 });
  });

  it("breaks on a gap and remembers the longer run", () => {
    const rows: LifeDaily[] = [
      daily("2026-10-01", { workout: true }),
      daily("2026-10-02", { workout: true }),
      daily("2026-10-03", { workout: true }),
      daily("2026-10-04", { workout: true }),
      daily("2026-10-15", { workout: true }),
      daily("2026-10-16", { workout: true }),
      daily("2026-10-17", { workout: true }),
      daily("2026-10-19", { workout: true }),
    ];
    assert.deepEqual(streaks(rows, TODAY).workout, { current: 1, best: 4 });
  });

  it("is zero for no entries", () => {
    assert.deepEqual(streaks([], TODAY).win, { current: 0, best: 0 });
  });
});

describe("weekly view and alerts", () => {
  const weekly: LifeWeekly[] = [
    { week: "2026-W40", ratings: { focus: 9, health: 7 } },
    { week: "2026-W41", ratings: { focus: 7, health: 7 } },
    { week: "2026-W42", ratings: { focus: 5, health: 7, relationships: 2 } },
  ];

  it("keeps the last eight weeks and drops absent ratings", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      week: `2026-W${`${index + 34}`.padStart(2, "0")}`,
      ratings: { health: 5 },
    }));
    const series = weeklySeries(many);
    assert.equal(series.length, 8);
    assert.equal(series[0]?.week, "2026-W36");
    assert.deepEqual(series[0]?.ratings, { health: 5 });
  });

  it("warns on two consecutive drops", () => {
    const view = buildLifeView(
      data({ daily: perfectWeek(), weekly }),
      TODAY,
    );
    const alerts = lifeAlerts(view.areas, weekly);
    assert.ok(alerts.some((alert) => alert.area === "focus" && alert.reason === "drop"));
  });

  it("warns below 40 and stays quiet for strong areas", () => {
    const view = buildLifeView(data({ daily: perfectWeek(), weekly }), TODAY);
    const alerts = lifeAlerts(view.areas, weekly);
    assert.ok(alerts.some((alert) => alert.area === "relationships" && alert.reason === "low"));
    assert.ok(!alerts.some((alert) => alert.area === "health"));
  });
});

describe("money snapshot", () => {
  const monthly: LifeMonthly[] = [
    { month: "2026-08", netWorth: 40_000, creditScore: 700, creditUtilization: 32, savingsRate: 10 },
    { month: "2026-09", netWorth: 42_000, creditScore: 705, creditUtilization: 30, savingsRate: 12 },
    { month: "2026-10", netWorth: 45_000, creditScore: 712, creditUtilization: 26, savingsRate: 15 },
  ];

  it("reports the latest month and month-over-month change", () => {
    const snapshot = moneySnapshot(monthly);
    assert.ok(snapshot);
    assert.equal(snapshot.month, "2026-10");
    assert.equal(snapshot.netWorth, 45_000);
    assert.equal(snapshot.change.netWorth, 3000);
    assert.equal(snapshot.change.creditScore, 7);
    assert.equal(snapshot.change.creditUtilization, -4);
    assert.equal(snapshot.change.savingsRate, 3);
  });

  it("has nulls, not NaN, for a single month", () => {
    const snapshot = moneySnapshot([monthly[2]!]);
    assert.ok(snapshot);
    assert.equal(snapshot.change.netWorth, null);
  });

  it("returns null with no months", () => {
    assert.equal(moneySnapshot([]), null);
  });
});

describe("metricView", () => {
  it("reports today, a 7-day average and the trend", () => {
    const rows: LifeDaily[] = lastDays(TODAY, 14).map((date) =>
      daily(date, { sleepHrs: date < "2026-10-13" ? 4 : 8 }),
    );
    const view = metricView("sleepHrs", data({ daily: rows }), TODAY);
    assert.equal(view.today, 8);
    assert.equal(view.average, 8);
    assert.equal(view.trend, "up", "4h last week, 8h this week");
    assert.equal(view.series.length, 14);
    assert.equal(view.decimals, 1);
  });

  it("uses the latest monthly value for monthly metrics", () => {
    const monthly: LifeMonthly[] = [
      { month: "2026-09", netWorth: 90_000, creditScore: 780, creditUtilization: 20, savingsRate: 20 },
      { month: "2026-10", netWorth: 96_000, creditScore: 790, creditUtilization: 18, savingsRate: 22 },
    ];
    const view = metricView("netWorth", data({ monthly }), TODAY);
    assert.equal(view.today, 96_000);
    assert.equal(view.average, 96_000);
    assert.equal(view.trend, "up");
  });

  it("returns null when the metric has never been logged", () => {
    const view = metricView("studyHrs", data(), TODAY);
    assert.equal(view.today, null);
    assert.equal(view.average, null);
    assert.equal(view.trend, "flat");
  });
});

describe("buildLifeView", () => {
  it("produces seven areas, an overall average and a latest win", () => {
    const view = buildLifeView(
      data({
        daily: perfectWeek(),
        monthly: [{ month: "2026-10", netWorth: 100_000, creditScore: 800, creditUtilization: 0, savingsRate: 20 }],
        weekly: [{ week: "2026-W43", ratings: { relationships: 10 } }],
      }),
      TODAY,
    );
    assert.equal(view.areas.length, 7);
    assert.equal(view.overall, 100);
    assert.equal(view.alerts.length, 0);
    assert.equal(view.latestWin?.text, "Did the thing");
    assert.equal(view.counts.daily, 7);
    assert.ok(view.areas.every((area) => Number.isFinite(area.score)));
  });

  it("stays finite and empty with no data", () => {
    const view = buildLifeView(data(), TODAY);
    assert.equal(view.overall, 0);
    assert.equal(view.areas.length, 7);
    assert.ok(view.areas.every((area) => area.score === 0));
    assert.equal(view.latestWin, null);
    assert.equal(view.weekly.length, 0);
  });
});

describe("latestWin", () => {
  it("finds the most recent logged win", () => {
    const rows = [
      daily("2026-10-17", { win: "older" }),
      daily("2026-10-18", { win: null }),
      daily("2026-10-19", { win: "newest" }),
    ];
    assert.deepEqual(latestWin(rows), { date: "2026-10-19", text: "newest" });
  });
});

describe("demoLife", () => {
  it("returns a full, deterministic and self-consistent demo snapshot", () => {
    const demo = demoLife(TODAY);
    assert.equal(demo.demo, true);
    assert.equal(demo.daily.length, 42);
    assert.equal(demo.monthly.length, 6);
    assert.equal(demo.weekly.length, 10);
    assert.match(demo.weekly[9]?.week ?? "", /^\d{4}-W\d{2}$/);
    assert.deepEqual(demoLife(TODAY).daily, demo.daily);
  });

  it("produces scores the UI can draw", () => {
    const view = buildLifeView(demoLife(TODAY), TODAY);
    assert.ok(view.overall > 0 && view.overall < 100, `overall ${view.overall}`);
    assert.equal(view.areas.length, 7);
    assert.ok(view.areas.every((area) => area.history.length === 14));
    assert.ok(view.areas.every((area) => Number.isFinite(area.score)));
    assert.ok(view.weekly.length === 8);
    assert.ok(view.money);
    assert.ok(view.streaks.workout.best > 0);
    assert.ok(view.alerts.length > 0, "demo includes a warning worth showing");
  });
});
