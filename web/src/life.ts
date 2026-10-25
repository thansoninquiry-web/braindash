import type { LifeDaily, LifeData, LifeMonthly, LifeWeekly } from "./types";
import {
  LIFE_AREAS,
  LIFE_TARGETS,
  ROLLING_DAYS,
  SPARK_DAYS,
  WEEKLY_WINDOW,
  scoreTone,
  type AreaId,
  type Direction,
  type TargetId,
} from "./lifeConfig";

/* Dates ---------------------------------------------------------------- */

export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayKey(now = new Date()): string {
  return dayKey(now);
}

export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function addDays(key: string, delta: number): string {
  const date = parseDayKey(key);
  date.setDate(date.getDate() + delta);
  return dayKey(date);
}

/** Ascending window ending on `end`, inclusive. */
export function lastDays(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(end, index - (count - 1)));
}

/** ISO week key (`2026-W42`) for a calendar day. */
export function isoWeekKey(key: string): string {
  const date = parseDayKey(key);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${`${week}`.padStart(2, "0")}`;
}

/** Monday of an ISO week key such as `2026-W42`. */
export function weekStartKey(week: string): string {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(week);
  if (!match?.[1] || !match[2]) return week;
  const year = Number(match[1]);
  const weekNo = Number(match[2]);
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (weekNo - 1) * 7);
  return dayKey(monday);
}

/* Metric plumbing ------------------------------------------------------ */

const MONTHLY_FIELD: Partial<Record<TargetId, keyof LifeMonthly>> = {
  netWorth: "netWorth",
  creditScore: "creditScore",
  creditUtilization: "creditUtilization",
  savingsRate: "savingsRate",
};

const DAILY_FIELD: Partial<Record<TargetId, keyof LifeDaily>> = {
  sleepHrs: "sleepHrs",
  energy: "energy",
  deepWorkHrs: "deepWorkHrs",
  studyHrs: "studyHrs",
  outreachSent: "outreachSent",
  applicationsSent: "applicationsSent",
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** `min(value / target, 1)`, or `1 - value / target` when lower is better. */
export function metricScore(value: number | null, id: TargetId): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const target = LIFE_TARGETS[id];
  if (target.direction === "down") return clamp01(1 - value / target.target);
  return clamp01(value / target.target);
}

/** One metric's value on a day; monthly fields come from the latest month note. */
export function metricValue(
  id: TargetId,
  daily: LifeDaily | undefined,
  monthly: LifeMonthly | null,
): number | null {
  if (id === "netRevenue") {
    if (!daily) return null;
    return (daily.revenueToday ?? 0) - (daily.spendToday ?? 0);
  }
  if (id === "winLogged") return daily ? (daily.win ? 1 : 0) : null;
  if (id === "workout") return daily ? (daily.workout ? 1 : 0) : null;
  if (id === "revenueToday") return daily?.revenueToday ?? null;
  if (id === "spendToday") return daily?.spendToday ?? null;

  const monthField = MONTHLY_FIELD[id];
  if (monthField) {
    const value = monthly?.[monthField];
    return typeof value === "number" ? value : null;
  }

  const field = DAILY_FIELD[id];
  if (!field || !daily) return null;
  const value = daily[field];
  return typeof value === "number" ? value : null;
}

/** Latest month note at or before the given day's month. */
export function monthEntryAt(monthly: LifeMonthly[], endKey: string): LifeMonthly | null {
  const month = endKey.slice(0, 7);
  let found: LifeMonthly | null = null;
  for (const entry of monthly) {
    if (entry.month <= month) found = entry;
  }
  return found;
}

export function previousMonth(monthly: LifeMonthly[], month: string): LifeMonthly | null {
  const index = monthly.findIndex((entry) => entry.month === month);
  return index > 0 ? monthly[index - 1] ?? null : null;
}

/** The weekly self-rating that applies on a given day. */
export function weeklyRatingAt(
  area: AreaId,
  weekly: LifeWeekly[],
  endKey: string,
): number | null {
  let latest: number | null = null;
  let latestStart = "";
  for (const entry of weekly) {
    const start = weekStartKey(entry.week);
    const rating = entry.ratings[area];
    if (rating === undefined || start > endKey) continue;
    if (start >= latestStart) {
      latestStart = start;
      latest = rating;
    }
  }
  return latest;
}

/* Scores --------------------------------------------------------------- */

const EMPTY: Pick<LifeData, "daily" | "monthly" | "weekly"> = { daily: [], monthly: [], weekly: [] };

/**
 * 0–100 for one area over the 7 days ending on `endKey`: average of each
 * metric's `min(value/target, 1)` across the metrics and days. Missing daily
 * fields score zero; monthly fields are sampled once and skipped when absent.
 */
export function areaScore(
  area: AreaId,
  data: Pick<LifeData, "daily" | "monthly" | "weekly"> = EMPTY,
  endKey = todayKey(),
): number {
  const definition = LIFE_AREAS.find((candidate) => candidate.id === area);
  if (!definition) return 0;

  if (definition.weeklyOnly) {
    const rating = weeklyRatingAt(area, data.weekly, endKey);
    return rating === null ? 0 : clamp01(rating / 10) * 100;
  }

  const byDate = new Map(data.daily.map((entry) => [entry.date, entry]));
  const month = monthEntryAt(data.monthly, endKey);
  const samples: number[] = [];

  for (const date of lastDays(endKey, ROLLING_DAYS)) {
    const entry = byDate.get(date);
    for (const id of definition.daily) {
      samples.push(metricScore(metricValue(id, entry, month), id) ?? 0);
    }
  }
  for (const id of definition.monthly) {
    const score = metricScore(metricValue(id, undefined, month), id);
    if (score !== null) samples.push(score);
  }

  if (samples.length === 0) return 0;
  return (samples.reduce((sum, value) => sum + value, 0) / samples.length) * 100;
}

/** Rolling 7-day score for each of the last `days` days (oldest first). */
export function areaHistory(area: AreaId, data: LifeData, endKey: string, days = SPARK_DAYS): number[] {
  return lastDays(endKey, days).map((date) => Math.round(areaScore(area, data, date)));
}

/* Streaks -------------------------------------------------------------- */

export interface StreakCount {
  current: number;
  best: number;
}

function countBack(dates: Set<string>, from: string): number {
  let count = 0;
  let cursor = from;
  while (dates.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

function streakFor(dates: Set<string>, today: string): StreakCount {
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of [...dates].sort()) {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1;
    previous = date;
    best = Math.max(best, run);
  }
  // A streak stays alive until a full day is missed; a missing today is fine.
  const anchor = dates.has(today) ? today : addDays(today, -1);
  const current = dates.has(anchor) ? countBack(dates, anchor) : 0;
  return { current, best };
}

export function streaks(
  daily: LifeDaily[],
  today: string,
): { workout: StreakCount; study: StreakCount; win: StreakCount } {
  const workout = new Set<string>();
  const study = new Set<string>();
  const win = new Set<string>();
  for (const entry of daily) {
    if (entry.workout) workout.add(entry.date);
    if ((entry.studyHrs ?? 0) > 0) study.add(entry.date);
    if (entry.win) win.add(entry.date);
  }
  return {
    workout: streakFor(workout, today),
    study: streakFor(study, today),
    win: streakFor(win, today),
  };
}

/* Panel rows ----------------------------------------------------------- */

export type Trend = "up" | "down" | "flat";

function trendOf(current: number | null, previous: number | null): Trend {
  if (current === null || previous === null) return "flat";
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) return "flat";
  return diff > 0 ? "up" : "down";
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface MetricView {
  id: TargetId;
  label: string;
  unit: string;
  decimals: number;
  target: number;
  direction: Direction;
  /** Today's value, or null when today has no entry. */
  today: number | null;
  /** Average over the 7 days ending today (available values only). */
  average: number | null;
  trend: Trend;
  /** Last 14 days; missing days are 0 so the line keeps its shape. */
  series: number[];
}

export function metricView(id: TargetId, data: LifeData, endKey: string): MetricView {
  const target = LIFE_TARGETS[id];
  const byDate = new Map(data.daily.map((entry) => [entry.date, entry]));
  const month = monthEntryAt(data.monthly, endKey);
  const isMonthly = Boolean(MONTHLY_FIELD[id]);

  const valueAt = (date: string): number | null =>
    metricValue(id, byDate.get(date), isMonthly ? monthEntryAt(data.monthly, date) : null);

  const today = isMonthly ? valueAt(endKey) : metricValue(id, byDate.get(endKey), null);
  const window = lastDays(endKey, ROLLING_DAYS).map(valueAt).filter((value): value is number => value !== null);
  const average = mean(window);
  const series = lastDays(endKey, SPARK_DAYS).map((date) => valueAt(date) ?? 0);

  let previous: number | null = null;
  if (isMonthly) {
    const prior = previousMonth(data.monthly, month?.month ?? "");
    previous = prior ? metricValue(id, undefined, prior) : null;
  } else {
    const priorWindow = lastDays(addDays(endKey, -ROLLING_DAYS), ROLLING_DAYS)
      .map(valueAt)
      .filter((value): value is number => value !== null);
    previous = mean(priorWindow);
  }

  return {
    id,
    label: target.label,
    unit: target.unit,
    decimals: target.decimals ?? (Math.abs(target.target) >= 1000 ? 0 : 1),
    target: target.target,
    direction: target.direction,
    today,
    average,
    trend: trendOf(average, previous),
    series,
  };
}

export interface RatingView {
  today: number | null;
  average: number | null;
  trend: Trend;
  series: number[];
}

/** The weekly self-rating row shown beside every area's daily metrics. */
export function ratingView(area: AreaId, weekly: LifeWeekly[], endKey: string): RatingView {
  const series = lastDays(endKey, SPARK_DAYS).map((date) => weeklyRatingAt(area, weekly, date) ?? 0);
  const rated = weekly.filter((entry) => entry.ratings[area] !== undefined).slice(-2);
  const today = rated[rated.length - 1]?.ratings[area] ?? null;
  const previous = rated[rated.length - 2]?.ratings[area] ?? null;
  return {
    today,
    average: today,
    trend: trendOf(today, previous),
    series,
  };
}

/* Weekly view ---------------------------------------------------------- */

export interface WeeklyPoint {
  week: string;
  ratings: Partial<Record<AreaId, number>>;
}

export function weeklySeries(weekly: LifeWeekly[], count = WEEKLY_WINDOW): WeeklyPoint[] {
  return weekly.slice(-count).map((entry) => {
    const ratings: Partial<Record<AreaId, number>> = {};
    for (const area of LIFE_AREAS) {
      const rating = entry.ratings[area.id];
      if (rating !== undefined) ratings[area.id] = rating;
    }
    return { week: entry.week, ratings };
  });
}

/* Alerts --------------------------------------------------------------- */

export interface LifeAlert {
  area: AreaId;
  label: string;
  reason: "drop" | "low";
  message: string;
}

export function lifeAlerts(areas: AreaView[], weekly: LifeWeekly[]): LifeAlert[] {
  const alerts: LifeAlert[] = [];
  for (const area of areas) {
    const ratings = weekly
      .map((entry) => entry.ratings[area.id])
      .filter((rating): rating is number => rating !== undefined)
      .slice(-3);
    if (ratings.length === 3) {
      const [older, middle, latest] = ratings as [number, number, number];
      if (older > middle && middle > latest) {
        alerts.push({
          area: area.id,
          label: area.label,
          reason: "drop",
          message: `${area.label} rating fell two weeks running (${older} → ${middle} → ${latest})`,
        });
      }
    }
    if (area.score < 40) {
      alerts.push({
        area: area.id,
        label: area.label,
        reason: "low",
        message: `${area.label} is at ${Math.round(area.score)} over 7 days — below 40`,
      });
    }
  }
  return alerts;
}

/* Money ---------------------------------------------------------------- */

export interface MoneyChange {
  netWorth: number | null;
  creditScore: number | null;
  creditUtilization: number | null;
  savingsRate: number | null;
}

export interface MoneyMonthView {
  month: string;
  netWorth: number | null;
  creditScore: number | null;
  creditUtilization: number | null;
  savingsRate: number | null;
  change: MoneyChange;
}

function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

export function moneySnapshot(monthly: LifeMonthly[]): MoneyMonthView | null {
  const latest = monthly[monthly.length - 1];
  if (!latest) return null;
  const prior = previousMonth(monthly, latest.month);
  return {
    month: latest.month,
    netWorth: latest.netWorth,
    creditScore: latest.creditScore,
    creditUtilization: latest.creditUtilization,
    savingsRate: latest.savingsRate,
    change: {
      netWorth: delta(latest.netWorth, prior?.netWorth ?? null),
      creditScore: delta(latest.creditScore, prior?.creditScore ?? null),
      creditUtilization: delta(latest.creditUtilization, prior?.creditUtilization ?? null),
      savingsRate: delta(latest.savingsRate, prior?.savingsRate ?? null),
    },
  };
}

/* View model ----------------------------------------------------------- */

export interface AreaView {
  id: AreaId;
  label: string;
  short: string;
  color: string;
  score: number;
  tone: "good" | "warn" | "bad";
  /** Score change over the previous 7 days, in points. */
  delta: number;
  trend: Trend;
  history: number[];
  metrics: MetricView[];
  rating: RatingView;
}

export interface LifeView {
  today: string;
  demo: boolean;
  counts: { daily: number; monthly: number; weekly: number };
  warnings: string[];
  overall: number;
  areas: AreaView[];
  streaks: ReturnType<typeof streaks>;
  weekly: WeeklyPoint[];
  alerts: LifeAlert[];
  latestWin: { date: string; text: string } | null;
  money: MoneyMonthView | null;
}

export function latestWin(daily: LifeDaily[]): { date: string; text: string } | null {
  for (let index = daily.length - 1; index >= 0; index -= 1) {
    const entry = daily[index];
    if (entry?.win) return { date: entry.date, text: entry.win };
  }
  return null;
}

export function buildLifeView(data: LifeData, endKey = todayKey()): LifeView {
  const areas: AreaView[] = LIFE_AREAS.map((definition) => {
    const score = areaScore(definition.id, data, endKey);
    const earlier = areaScore(definition.id, data, addDays(endKey, -ROLLING_DAYS));
    return {
      id: definition.id,
      label: definition.label,
      short: definition.short,
      color: definition.color,
      score,
      tone: scoreTone(score),
      delta: score - earlier,
      trend: trendOf(score, earlier),
      history: areaHistory(definition.id, data, endKey),
      metrics: definition.metrics.map((id) => metricView(id, data, endKey)),
      rating: ratingView(definition.id, data.weekly, endKey),
    };
  });
  const overall = areas.reduce((sum, area) => sum + area.score, 0) / (areas.length || 1);
  return {
    today: endKey,
    demo: data.demo,
    counts: {
      daily: data.daily.length,
      monthly: data.monthly.length,
      weekly: data.weekly.length,
    },
    warnings: data.warnings,
    overall,
    areas,
    streaks: streaks(data.daily, endKey),
    weekly: weeklySeries(data.weekly),
    alerts: lifeAlerts(areas, data.weekly),
    latestWin: latestWin(data.daily),
    money: moneySnapshot(data.monthly),
  };
}

/* Demo data ------------------------------------------------------------ */

function seeded(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Plausible, deterministic data used only when all three folders are empty.
 * `demo: true` keeps the badge honest; nothing is written anywhere.
 */
export function demoLife(endKey = todayKey()): LifeData {
  const daily: LifeDaily[] = [];
  for (let offset = 41; offset >= 0; offset -= 1) {
    const index = 41 - offset;
    const r = (salt: number) => seeded(index * 7 + salt);
    const date = addDays(endKey, -offset);
    const workout = r(1) > 0.55;
    const winRoll = r(9);
    daily.push({
      date,
      sleepHrs: Number((5.9 + r(2) * 2.4).toFixed(1)),
      energy: 2 + Math.round(r(3) * 3),
      workout,
      deepWorkHrs: Number((0.5 + r(4) * 4.4).toFixed(1)),
      studyHrs: r(5) > 0.25 ? Number((0.4 + r(13) * 2.4).toFixed(1)) : 0,
      outreachSent: Math.round(r(6) * 13),
      applicationsSent: Math.round(r(7) * 6),
      revenueToday: r(8) > 0.45 ? Math.round(80 + r(10) * 420) : 0,
      spendToday: Math.round(20 + r(11) * 160),
      // Guarantee a recent win so the footer shows today's or yesterday's.
      win:
        offset <= 2 || winRoll > 0.68
          ? [
              "Shipped the LIFE section skeleton",
              "Closed a discovery call",
              "Finally fixed the credit-utilization tracker",
              "Wrote 1,200 words before 9am",
              "Cleared the inbox to zero",
            ][Math.floor(r(12) * 5) % 5] ?? null
          : null,
    });
  }

  const monthly: LifeMonthly[] = [];
  for (let index = 5; index >= 0; index -= 1) {
    const date = parseDayKey(endKey);
    date.setMonth(date.getMonth() - index, 1);
    const month = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
    const drift = 5 - index;
    monthly.push({
      month,
      netWorth: Math.round(31_500 + drift * 1_850 + seeded(index + 40) * 900),
      creditScore: Math.round(706 + drift * 3 + seeded(index + 50) * 6),
      creditUtilization: Number((34 - drift * 2.1 - seeded(index + 60) * 3).toFixed(1)),
      savingsRate: Number((9 + drift * 1.4 + seeded(index + 70) * 4).toFixed(1)),
    });
  }

  const weekly: LifeWeekly[] = [];
  const drop = [8, 6, 4];
  for (let index = 9; index >= 0; index -= 1) {
    const date = parseDayKey(endKey);
    date.setDate(date.getDate() - index * 7);
    const week = isoWeekKey(dayKey(date));
    const trendIndex = 9 - index;
    weekly.push({
      week,
      ratings: {
        health: Math.round(5 + seeded(index + 1) * 4),
        money: Math.round(4 + seeded(index + 2) * 4),
        business: Math.round(4 + seeded(index + 3) * 5),
        learning: Math.round(5 + seeded(index + 4) * 4),
        focus: drop[Math.max(0, trendIndex - 7)] ?? Math.round(5 + seeded(index + 5) * 4),
        relationships: Math.round(6 + seeded(index + 6) * 3),
        habits: Math.round(4 + seeded(index + 7) * 5),
      },
    });
  }

  return {
    vaultPath: null,
    scannedAt: new Date().toISOString(),
    demo: true,
    folders: { daily: false, monthly: false, weekly: false },
    daily,
    monthly,
    weekly,
    warnings: [],
  };
}
