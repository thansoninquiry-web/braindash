import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectDrift, type DriftOutcome, type DriftReport, type OutdatedEntry } from "../../scripts/check-deps.mjs";

/**
 * Dependency health for the dashboard, from the same check the weekly CI job
 * runs: `scripts/check-deps.mjs` shells out to `npm outdated --json --long` and
 * classifies the rows. Nothing is re-implemented here, so the card and the
 * issue can never disagree about what counts as "behind".
 *
 * The npm call costs a registry round trip, so it is cached: a good answer lives
 * for 15 minutes, a failure for one minute (a broken registry must not be asked
 * again on every poll). Concurrent requests share one in-flight run.
 */

export interface DepsPackage {
  name: string;
  current: string | null;
  wanted: string | null;
  latest: string | null;
  dependent: string | null;
}

export interface DependencyHealth {
  ok: boolean;
  checkedAt: string;
  /** In-range drift: lockfile entries behind a range `package.json` allows. */
  behind: number;
  /** Newer versions outside the declared ranges; informational only. */
  newer: number;
  /** The in-range rows, sorted by name then workspace. */
  stale: DepsPackage[];
  /** The informational rows, for the "newer majors" line. */
  majors: DepsPackage[];
  /** One line saying why the check could not answer; null when `ok`. */
  error: string | null;
  /** True when this answer was served from cache rather than a fresh npm run. */
  cached: boolean;
}

export const OK_TTL_MS = 15 * 60_000;
export const ERROR_TTL_MS = 60_000;
export const CHECK_TIMEOUT_MS = 20_000;

// Source runs sit at server/src; the compiled entry sits deeper
// (server/dist/server/src), so the launchers and the smoke run pin it with
// BRAINDASH_ROOT — the same contract `workingMode.ts` relies on.
const ROOT = path.resolve(
  process.env.BRAINDASH_ROOT?.trim() || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);

export type DriftCollector = () => Promise<DriftOutcome>;

export interface DepsReaderOptions {
  /** Defaults to the real npm check; tests pass a stub instead of a registry. */
  collect?: DriftCollector;
  /** Repository root npm runs in. Defaults to the inferred root. */
  cwd?: string;
  /** Injectable clock, so the TTLs are tested without sleeping. */
  now?: () => number;
  okTtlMs?: number;
  errorTtlMs?: number;
  timeoutMs?: number;
}

export interface DepsReader {
  read(options?: { refresh?: boolean }): Promise<DependencyHealth>;
}

function toPackage(entry: OutdatedEntry): DepsPackage {
  return {
    name: entry.name,
    current: entry.current ?? null,
    wanted: entry.wanted ?? null,
    latest: entry.latest ?? null,
    dependent: entry.dependent ?? null,
  };
}

function oneLine(text: string, limit = 180): string {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? text.trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

function snapshot(report: DriftReport, at: number): DependencyHealth {
  return {
    ok: true,
    checkedAt: new Date(at).toISOString(),
    behind: report.inRange.length,
    newer: report.outOfRange.length,
    stale: report.inRange.map(toPackage),
    majors: report.outOfRange.map(toPackage),
    error: null,
    cached: false,
  };
}

function failure(error: string, at: number): DependencyHealth {
  return {
    ok: false,
    checkedAt: new Date(at).toISOString(),
    behind: 0,
    newer: 0,
    stale: [],
    majors: [],
    error: oneLine(error) || "npm outdated did not answer",
    cached: false,
  };
}

export function createDepsReader(options: DepsReaderOptions = {}): DepsReader {
  const cwd = options.cwd ?? ROOT;
  const collect = options.collect ?? (() => collectDrift({ cwd, timeoutMs: options.timeoutMs ?? CHECK_TIMEOUT_MS }));
  const now = options.now ?? Date.now;
  const okTtlMs = options.okTtlMs ?? OK_TTL_MS;
  const errorTtlMs = options.errorTtlMs ?? ERROR_TTL_MS;

  let cached: { at: number; health: DependencyHealth } | null = null;
  let pending: Promise<DependencyHealth> | null = null;

  return {
    async read({ refresh = false } = {}) {
      if (!refresh && cached) {
        const ttl = cached.health.ok ? okTtlMs : errorTtlMs;
        if (now() - cached.at < ttl) return { ...cached.health, cached: true };
      }

      // Single flight: a page load and a manual recheck must not run npm twice.
      pending ??= (async () => {
        const at = now();
        try {
          const outcome = await collect();
          const health = outcome.ok ? snapshot(outcome.report, at) : failure(outcome.error, at);
          cached = { at, health };
          return health;
        } catch (error) {
          const health = failure((error as Error)?.message ?? String(error), at);
          cached = { at, health };
          return health;
        } finally {
          pending = null;
        }
      })();

      return pending;
    },
  };
}
