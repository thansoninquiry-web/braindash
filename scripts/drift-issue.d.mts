/**
 * Types for `drift-issue.mjs`, the single-issue manager for the weekly drift run.
 */
import type { DriftReport } from "./check-deps.mjs";

export type { DriftReport };

/** What one run should do with the open issues it found. */
export interface IssuePlan {
  /** Issue to rewrite in place, or null to create one. */
  update: number | null;
  create: boolean;
  /** Issues to comment on and close: duplicates, or every issue when clean. */
  close: number[];
}

export interface RunOptions {
  /** Reads `GITHUB_*` from here rather than `process.env`. */
  env?: Record<string, string | undefined>;
  /** `--dry-run` prints the title and body and calls no API. */
  argv?: string[];
  now?: Date;
  log?: (message: string) => void;
  /** Defaults to `.ci/deps.json`; tests point it at a fixture. */
  reportPath?: string;
}

export const LABEL: string;
export const TITLE_PREFIX: string;
export const MARKER: string;
export const REPORT_PATH: string;

export function stamp(date: Date): string;
export function readReport(file?: string): DriftReport | null;
export function issueTitle(report: DriftReport): string;
export function issueBody(options: { report: DriftReport; runUrl?: string | null; now?: Date }): string;
export function closeComment(options: { report: DriftReport; runUrl?: string | null; now?: Date }): string;
export function planIssues(options: { report: DriftReport; issues: Array<{ number: number }> }): IssuePlan;
export function run(options?: RunOptions): Promise<number>;
