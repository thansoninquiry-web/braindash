import type { ReactNode } from "react";
import Sparkline from "./Sparkline";

interface StatCardProps {
  label: string;
  value: string;
  caption: string;
  spark?: number[];
  /** Hover labels for the sparkline buckets, aligned with `spark`. */
  sparkLabels?: string[];
  /** Small right-aligned chip, e.g. "▲ +4 today". */
  delta?: string;
  footer?: ReactNode;
  /** The app's motion setting: drives the scan wash and the value tick. */
  animate?: boolean;
}

export default function StatCard({
  label,
  value,
  caption,
  spark,
  sparkLabels,
  delta,
  footer,
  animate = false,
}: StatCardProps) {
  return (
    <article className={`metric${animate ? " is-animated" : ""}`}>
      {/* A clipped wash that crosses the row on the rail's own beat. Kept out
          of the card's box so the figure's glow is never cut off. */}
      <span className="metric-scan" aria-hidden="true" />
      <header className="metric-head">
        <span className="metric-label">{label}</span>
        {delta ? <span className="metric-delta">{delta}</span> : null}
      </header>
      {/* Keyed by the figure: a poll that really changed it remounts this node,
          replaying the tick; an unchanged figure stays perfectly still. */}
      <div className="metric-value" key={value}>
        {value}
      </div>
      <p className="metric-caption">{caption}</p>
      {spark ? (
        <Sparkline values={spark} labels={sparkLabels} label={label} animate={animate} />
      ) : null}
      {footer ? <div className="metric-footer">{footer}</div> : null}
    </article>
  );
}
