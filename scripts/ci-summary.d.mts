/**
 * Types for `ci-summary.mjs`, the CI run summary.
 */

export interface TestTotals {
  tests: number;
  pass: number;
  fail: number;
  skipped: number;
  cancelled: number;
  todo: number;
  durationMs: number;
}

export interface TestSummary extends TestTotals {
  workspace: string;
}

export interface MeasuredFile {
  path: string;
  bytes: number;
  gzipBytes: number;
}

export interface ArtifactMeasurement {
  path: string;
  files: number;
  bytes: number;
  gzipBytes: number;
  largest: MeasuredFile[];
}

export function parseTestTotals(output: string): TestTotals | null;
export function readTestSummaries(dir?: string): TestSummary[];
export function measureArtifact(dir: string): ArtifactMeasurement | null;
export function formatBytes(bytes: number): string;
export function markdown(options: {
  os?: string;
  tests?: TestSummary[];
  artifacts?: Array<[string, ArtifactMeasurement | null]>;
}): string;
