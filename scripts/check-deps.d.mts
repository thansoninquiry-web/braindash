/**
 * Types for `check-deps.mjs`, the weekly dependency-drift report.
 */

/** One row of `npm outdated --json`, after normalising the two output shapes. */
export interface OutdatedEntry {
  name: string;
  current?: string;
  wanted?: string;
  latest?: string;
  type?: string;
  dependent?: string;
  location?: string;
}

export interface DriftReport {
  /** The lockfile is behind a range `package.json` already declares. */
  inRange: OutdatedEntry[];
  /** Newer versions exist outside the declared ranges; for a human to decide. */
  outOfRange: OutdatedEntry[];
}

/** The check's outcome, for callers that must not throw (the dashboard route). */
export type DriftOutcome = { ok: true; report: DriftReport } | { ok: false; error: string };

/**
 * Runs `npm outdated` through the npm that started this process. `status` is 0
 * (nothing outdated), 1 (rows exist), the npm failure code, or null when the
 * call was killed by the timeout.
 */
export function runNpmOutdated(options?: {
  cwd?: string;
  timeoutMs?: number;
}): Promise<{ status: number | null; stdout: string; stderr: string }>;
export function collectDrift(options?: { cwd?: string; timeoutMs?: number }): Promise<DriftOutcome>;

export function parseOutdated(stdout: string): OutdatedEntry[];
export function classifyOutdated(entries: OutdatedEntry[]): DriftReport;
export function renderReport(report: DriftReport): string;
export function versionTable(rows: OutdatedEntry[]): string[];
export function markdown(report: DriftReport): string;

/** The path `check-deps.mjs` writes in CI, relative to the repository root. */
export const REPORT_PATH: string;
export function writeReport(report: DriftReport, file?: string, now?: Date): string;
