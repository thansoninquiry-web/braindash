import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./vault.js";

/**
 * Life metrics live beside the vault as three plain folders of markdown:
 * `Daily/YYYY-MM-DD.md`, `Monthly/YYYY-MM.md` and `Weekly/YYYY-Www.md`.
 * Everything here is tolerant by design: a missing folder, an unreadable file
 * or a field written in the wrong shape becomes "no data", never an error.
 */

export type WeeklyArea = "health" | "money" | "business" | "learning" | "focus" | "relationships" | "habits";

export interface DailyEntry {
  date: string;
  sleepHrs: number | null;
  energy: number | null;
  workout: boolean;
  deepWorkHrs: number | null;
  studyHrs: number | null;
  outreachSent: number | null;
  applicationsSent: number | null;
  revenueToday: number | null;
  spendToday: number | null;
  win: string | null;
}

export interface MonthlyEntry {
  month: string;
  netWorth: number | null;
  creditScore: number | null;
  /** Percent, e.g. 24 means 24%. A bare fraction like 0.24 is read as 24. */
  creditUtilization: number | null;
  /** Percent, e.g. 18 means 18%. A bare fraction like 0.18 is read as 18. */
  savingsRate: number | null;
}

export interface WeeklyEntry {
  week: string;
  ratings: Partial<Record<WeeklyArea, number>>;
}

export interface LifeFolders {
  daily: boolean;
  monthly: boolean;
  weekly: boolean;
}

export interface LifeData {
  vaultPath: string | null;
  scannedAt: string;
  /** True when all three sources are empty, so the client should show demo data. */
  demo: boolean;
  folders: LifeFolders;
  daily: DailyEntry[];
  monthly: MonthlyEntry[];
  weekly: WeeklyEntry[];
  /** Non-fatal problems (unreadable folder, skipped file). */
  warnings: string[];
}

const DAILY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/i;
const MONTHLY_FILE = /^(\d{4}-\d{2})\.md$/i;
const WEEKLY_FILE = /^(\d{4})-w(\d{1,2})\.md$/i;
const WEEKLY_AREAS: WeeklyArea[] = [
  "health",
  "money",
  "business",
  "learning",
  "focus",
  "relationships",
  "habits",
];

/** Money written as "$1,200", "1 200" or "1200 usd" all become 1200. */
function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/[$,€£\s]/g, "").replace(/%$/, "").replace(/^\+/, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Percent fields accept either shape: "24%"/24 mean 24 percent, 0.24 means the
 * same thing as a fraction. Values above 1 are left alone so 1.5 (150%) and
 * 1.5% stay distinguishable by the % sign.
 */
function toPercent(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = toNumber(value);
  if (parsed === null) return null;
  const percent = value.includes("%");
  if (percent) return parsed;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

const TRUTHY = new Set(["true", "yes", "y", "1", "done", "x"]);
const FALSY = new Set(["false", "no", "n", "0", ""]);

function toBool(value: string | undefined): boolean {
  const text = (value ?? "").trim().toLowerCase();
  if (TRUTHY.has(text)) return true;
  if (FALSY.has(text)) return false;
  // Anything unexpected is treated as not done rather than thrown away.
  return false;
}

function toRating(value: string | undefined): number | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return Math.min(10, Math.max(1, Math.round(parsed)));
}

function dateFromFile(name: string, fields: Record<string, string>): string | null {
  const fromName = DAILY_FILE.exec(name);
  if (fromName?.[1]) return fromName[1];
  const field = fields.date?.match(/^(\d{4}-\d{2}-\d{2})/);
  return field?.[1] ?? null;
}

async function markdownFiles(dir: string): Promise<{ files: string[]; exists: boolean }> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return {
      exists: true,
      // `_template.md` and other underscore files are scaffolding, not data.
      files: entries
        .filter((entry) => entry.isFile() && !entry.name.startsWith("_") && entry.name.toLowerCase().endsWith(".md"))
        .map((entry) => entry.name),
    };
  } catch {
    return { files: [], exists: false };
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

function parseDaily(name: string, raw: string): DailyEntry | null {
  const { fields } = parseFrontmatter(raw);
  const date = dateFromFile(name, fields);
  if (!date) return null;
  const win = (fields.win ?? "").trim();
  return {
    date,
    sleepHrs: toNumber(fields.sleep_hrs),
    energy: toNumber(fields.energy),
    workout: toBool(fields.workout),
    deepWorkHrs: toNumber(fields.deep_work_hrs),
    studyHrs: toNumber(fields.study_hrs),
    outreachSent: toNumber(fields.outreach_sent),
    applicationsSent: toNumber(fields.applications_sent),
    revenueToday: toNumber(fields.revenue_today),
    spendToday: toNumber(fields.spend_today),
    win: win.length > 0 ? win : null,
  };
}

function parseMonthly(name: string, raw: string): MonthlyEntry | null {
  const month = MONTHLY_FILE.exec(name)?.[1];
  if (!month) return null;
  const { fields } = parseFrontmatter(raw);
  return {
    month,
    netWorth: toNumber(fields.net_worth),
    creditScore: toNumber(fields.credit_score),
    creditUtilization: toPercent(fields.credit_utilization),
    savingsRate: toPercent(fields.savings_rate),
  };
}

function parseWeekly(name: string, raw: string): WeeklyEntry | null {
  const match = WEEKLY_FILE.exec(name);
  if (!match?.[1] || !match[2]) return null;
  const week = `${match[1]}-W${match[2].padStart(2, "0")}`;
  const { fields } = parseFrontmatter(raw);
  const ratings: WeeklyEntry["ratings"] = {};
  for (const area of WEEKLY_AREAS) {
    const rating = toRating(fields[area]);
    if (rating !== null) ratings[area] = rating;
  }
  return { week, ratings };
}

/** Empty snapshot used when the vault is missing or unreadable. */
export function emptyLife(vaultPath: string | null, warning?: string): LifeData {
  return {
    vaultPath,
    scannedAt: new Date().toISOString(),
    demo: true,
    folders: { daily: false, monthly: false, weekly: false },
    daily: [],
    monthly: [],
    weekly: [],
    warnings: warning ? [warning] : [],
  };
}

/** Reads the three life folders. Never throws. */
export async function readLife(vaultPath: string): Promise<LifeData> {
  const root = path.resolve(vaultPath);
  const warnings: string[] = [];

  const [dailyDir, monthlyDir, weeklyDir] = await Promise.all([
    markdownFiles(path.join(root, "Daily")),
    markdownFiles(path.join(root, "Monthly")),
    markdownFiles(path.join(root, "Weekly")),
  ]);

  for (const [label, result] of [
    ["Daily", dailyDir],
    ["Monthly", monthlyDir],
    ["Weekly", weeklyDir],
  ] as const) {
    if (!result.exists) warnings.push(`${label}/ not found — treated as empty`);
  }

  const daily: DailyEntry[] = [];
  for (const name of dailyDir.files) {
    const raw = await readText(path.join(root, "Daily", name));
    if (raw === null) {
      warnings.push(`Daily/${name} could not be read`);
      continue;
    }
    const entry = parseDaily(name, raw);
    if (entry) daily.push(entry);
    else warnings.push(`Daily/${name} has no date — skipped`);
  }

  const monthly: MonthlyEntry[] = [];
  for (const name of monthlyDir.files) {
    const raw = await readText(path.join(root, "Monthly", name));
    if (raw === null) {
      warnings.push(`Monthly/${name} could not be read`);
      continue;
    }
    const entry = parseMonthly(name, raw);
    if (entry) monthly.push(entry);
  }

  const weekly: WeeklyEntry[] = [];
  for (const name of weeklyDir.files) {
    const raw = await readText(path.join(root, "Weekly", name));
    if (raw === null) {
      warnings.push(`Weekly/${name} could not be read`);
      continue;
    }
    const entry = parseWeekly(name, raw);
    if (entry) weekly.push(entry);
  }

  daily.sort((a, b) => a.date.localeCompare(b.date));
  monthly.sort((a, b) => a.month.localeCompare(b.month));
  weekly.sort((a, b) => a.week.localeCompare(b.week));

  return {
    vaultPath: root,
    scannedAt: new Date().toISOString(),
    demo: daily.length === 0 && monthly.length === 0 && weekly.length === 0,
    folders: { daily: dailyDir.exists, monthly: monthlyDir.exists, weekly: weeklyDir.exists },
    daily,
    monthly,
    weekly,
    warnings: warnings.slice(0, 8),
  };
}
