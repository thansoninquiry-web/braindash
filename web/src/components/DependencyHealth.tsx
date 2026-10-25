import type { DependencyHealth } from "../types";

interface DependencyHealthProps {
  deps: DependencyHealth | null;
  loading: boolean;
  /** e.g. "Checked 1:04 PM" — the App owns the clock preferences. */
  checkedLabel: string;
  onRecheck: () => void;
}

/** At most three rows: the card is a readout, the CI issue is the full list. */
const SHOWN = 3;

/**
 * The lockfile's health, from the same npm comparison the weekly CI drift job
 * runs. Deliberately small: a count, the packages that are behind, and the fact
 * that newer majors exist — the issue is where the full table lives.
 */
export default function DependencyHealthCard({ deps, loading, checkedLabel, onRecheck }: DependencyHealthProps) {
  const behind = deps?.ok ? deps.behind : null;
  const shown = deps?.stale.slice(0, SHOWN) ?? [];
  const hidden = (deps?.stale.length ?? 0) - shown.length;
  const state = deps === null ? "pending" : deps.ok ? (behind ? "behind" : "clean") : "unavailable";

  return (
    <section className="dep-health" aria-label="Dependency health" data-state={state}>
      <div className="dep-head">
        <span className="metric-label">Dependencies</span>
        <span className="dep-tag">npm</span>
      </div>

      <div className="dep-value">
        <span className="dep-count">{deps?.ok ? deps.behind : "—"}</span>
        <span className="dep-unit">{behind === 1 ? "package behind" : "packages behind"}</span>
      </div>

      <p className="dep-caption" aria-live="polite">
        {deps === null
          ? loading
            ? "Comparing the lockfile with what the registry allows…"
            : "No dependency check yet"
          : deps.ok
            ? behind
              ? "The lockfile is behind a range package.json already allows."
              : "Lockfile matches every declared range."
            : deps.error}
      </p>

      {shown.length > 0 ? (
        <ul className="dep-list">
          {shown.map((entry) => (
            <li key={`${entry.name}:${entry.dependent ?? ""}`}>
              <span className="dep-name">{entry.name}</span>
              <span className="dep-versions">
                {entry.current ?? "missing"} → {entry.wanted ?? "—"}
              </span>
            </li>
          ))}
          {hidden > 0 ? <li className="dep-more">+{hidden} more</li> : null}
        </ul>
      ) : null}

      {deps?.ok && deps.newer > 0 ? (
        <p className="dep-note">
          {deps.newer} newer major{deps.newer === 1 ? "" : "s"} outside the declared ranges
        </p>
      ) : null}

      <div className="dep-foot">
        <span className="dep-stamp">{loading ? "Rechecking…" : checkedLabel}</span>
        <button type="button" className="dep-recheck" onClick={onRecheck} disabled={loading}>
          Recheck
        </button>
      </div>
    </section>
  );
}
