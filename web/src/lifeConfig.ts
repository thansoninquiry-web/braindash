/**
 * Life targets — the one file to edit when a goal changes.
 *
 * A score is `min(value / target, 1)` per metric, averaged across the metrics of
 * an area over the last 7 days and shown as 0–100. `direction: "down"` flips it
 * so lower is better (credit utilization). Missing daily fields count as zero;
 * missing monthly fields are skipped rather than scored as failures, so an
 * unfilled monthly note does not sink MONEY on its own.
 */

export type Direction = "up" | "down";

export interface LifeTarget {
  /** The value a perfect day scores against. */
  target: number;
  direction: Direction;
  label: string;
  unit: string;
  /** Digits to show in the panels; defaults to 0 for whole numbers. */
  decimals?: number;
}

export const LIFE_TARGETS = {
  sleepHrs: { target: 8, direction: "up", label: "Sleep", unit: "h", decimals: 1 },
  energy: { target: 5, direction: "up", label: "Energy", unit: "/5", decimals: 0 },
  workout: { target: 1, direction: "up", label: "Workout", unit: "", decimals: 0 },
  deepWorkHrs: { target: 4, direction: "up", label: "Deep work", unit: "h", decimals: 1 },
  studyHrs: { target: 2, direction: "up", label: "Study", unit: "h", decimals: 1 },
  outreachSent: { target: 10, direction: "up", label: "Outreach", unit: "/day", decimals: 0 },
  applicationsSent: { target: 5, direction: "up", label: "Applications", unit: "/day", decimals: 0 },
  /** Any positive net day scores 1; the target is the break-even line, not a sum. */
  netRevenue: { target: 1, direction: "up", label: "Net revenue", unit: ">0", decimals: 0 },
  revenueToday: { target: 1, direction: "up", label: "Revenue", unit: "$", decimals: 0 },
  spendToday: { target: 100, direction: "down", label: "Spend", unit: "$", decimals: 0 },
  /** Percent. Lower is better: 0% scores 100, 30% scores 0. */
  creditUtilization: { target: 30, direction: "down", label: "Credit utilization", unit: "%", decimals: 1 },
  netWorth: { target: 100_000, direction: "up", label: "Net worth", unit: "$", decimals: 0 },
  creditScore: { target: 800, direction: "up", label: "Credit score", unit: "", decimals: 0 },
  savingsRate: { target: 20, direction: "up", label: "Savings rate", unit: "%", decimals: 1 },
  winLogged: { target: 1, direction: "up", label: "Win logged", unit: "", decimals: 0 },
} satisfies Record<string, LifeTarget>;

export type TargetId = keyof typeof LIFE_TARGETS;

export type AreaId = "health" | "money" | "business" | "learning" | "focus" | "relationships" | "habits";

export interface AreaDefinition {
  id: AreaId;
  label: string;
  /** Two-to-three letters drawn inside the 3D node. */
  short: string;
  /** CSS custom property used for the node and the weekly chart line. */
  color: string;
  /** Daily fields that feed the score. */
  daily: TargetId[];
  /** Monthly fields repeated across the window (skipped when absent). */
  monthly: TargetId[];
  /** The weekly self-rating that scores this area on its own. */
  weeklyOnly: boolean;
  /** Metrics shown in the side panel, in order. */
  metrics: TargetId[];
}

export const LIFE_AREAS: AreaDefinition[] = [
  {
    id: "health",
    label: "Health",
    short: "HLT",
    color: "var(--life-health)",
    daily: ["sleepHrs", "energy", "workout"],
    monthly: [],
    weeklyOnly: false,
    metrics: ["sleepHrs", "energy", "workout"],
  },
  {
    id: "money",
    label: "Money",
    short: "MON",
    color: "var(--life-money)",
    daily: ["netRevenue"],
    monthly: ["netWorth", "creditScore", "creditUtilization", "savingsRate"],
    weeklyOnly: false,
    metrics: ["revenueToday", "spendToday", "netWorth", "creditScore", "creditUtilization", "savingsRate"],
  },
  {
    id: "business",
    label: "Business",
    short: "BIZ",
    color: "var(--life-business)",
    daily: ["outreachSent", "applicationsSent", "revenueToday"],
    monthly: [],
    weeklyOnly: false,
    metrics: ["outreachSent", "applicationsSent", "revenueToday"],
  },
  {
    id: "learning",
    label: "Learning",
    short: "LRN",
    color: "var(--life-learning)",
    daily: ["studyHrs"],
    monthly: [],
    weeklyOnly: false,
    metrics: ["studyHrs"],
  },
  {
    id: "focus",
    label: "Focus",
    short: "FOC",
    color: "var(--life-focus)",
    daily: ["deepWorkHrs"],
    monthly: [],
    weeklyOnly: false,
    metrics: ["deepWorkHrs"],
  },
  {
    id: "relationships",
    label: "Relationships",
    short: "REL",
    color: "var(--life-relationships)",
    daily: [],
    monthly: [],
    weeklyOnly: true,
    metrics: [],
  },
  {
    id: "habits",
    label: "Habits",
    short: "HAB",
    color: "var(--life-habits)",
    daily: ["workout", "winLogged"],
    monthly: [],
    weeklyOnly: false,
    metrics: ["workout", "winLogged"],
  },
];

/** Node / score colours: green from 70, amber from 40, red below. */
export const LIFE_BANDS = [
  { min: 70, tone: "good" as const },
  { min: 40, tone: "warn" as const },
  { min: 0, tone: "bad" as const },
];

export function scoreTone(score: number): "good" | "warn" | "bad" {
  return LIFE_BANDS.find((band) => score >= band.min)?.tone ?? "bad";
}

/** One page of the weekly view. */
export const WEEKLY_WINDOW = 8;
/** Everything life-shaped rolls over this many days. */
export const ROLLING_DAYS = 7;
/** Sparklines under each metric. */
export const SPARK_DAYS = 14;
