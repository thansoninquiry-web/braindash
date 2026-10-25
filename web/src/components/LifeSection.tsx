import { useEffect, useMemo, useState } from "react";
import { getJson } from "../api";
import { formatDateKey, zoneDayKey, type ClockPrefs } from "../clock";
import {
  buildLifeView,
  demoLife,
  type AreaView,
  type LifeView,
  type MetricView,
  type MoneyMonthView,
  type WeeklyPoint,
} from "../life";
import {
  LIFE_AREAS,
  scoreTone,
  type AreaId,
  type TargetId,
} from "../lifeConfig";
import type { RefreshPref } from "../refresh";
import type { LifeData } from "../types";
import LifeSphere from "./LifeSphere";
import Sparkline from "./Sparkline";

interface LifeSectionProps {
  animate: boolean;
  /** "Today" is the calendar day of the zone the clock is set to. */
  clock: ClockPrefs;
  /**
   * Bumped by the dashboard whenever its vault check runs, so LIFE follows the
   * Settings → Vault refresh cadence instead of polling on its own clock.
   */
  refreshTick: number;
  /** Only used for the HUD caption describing the current cadence. */
  refresh: RefreshPref;
}

const MONTHLY_METRICS = new Set<TargetId>([
  "netWorth",
  "creditScore",
  "creditUtilization",
  "savingsRate",
]);


function formatValue(id: TargetId, value: number | null, decimals: number): string {
  if (value === null) return "—";
  if (id === "workout") return value >= 1 ? "Done" : "Missed";
  if (id === "winLogged") return value >= 1 ? "Logged" : "None";
  if (id === "revenueToday" || id === "spendToday" || id === "netRevenue" || id === "netWorth") {
    const sign = value < 0 ? "-" : "";
    return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (id === "energy") return `${value.toFixed(0)}/5`;
  if (id === "creditUtilization" || id === "savingsRate") return `${value.toFixed(1)}%`;
  if (id === "sleepHrs" || id === "deepWorkHrs" || id === "studyHrs") return `${value.toFixed(1)}h`;
  return value.toFixed(decimals);
}

function formatDay(key: string): string {
  return formatDateKey(key) ?? key;
}

function trendArrow(trend: MetricView["trend"]): string {
  return trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
}

/** Targets read differently per metric: presence goals have no numeric aim. */
function targetText(metric: MetricView): string {
  if (metric.id === "revenueToday" || metric.id === "netRevenue") return "goal > $0";
  if (metric.id === "workout" || metric.id === "winLogged") return "goal daily";
  if (metric.direction === "down") return `≤ ${metric.target}${metric.unit === "%" ? "%" : ""}`;
  if (metric.unit === "$") return `goal $${metric.target}`;
  if (metric.unit === "/5") return `goal ${metric.target}`;
  return `goal ${metric.target}${metric.unit}`;
}

function MetricRow({ metric, animate }: { metric: MetricView; animate: boolean }) {
  const target = targetText(metric);
  return (
    <li className="life-metric">
      <div className="life-metric-head">
        <span className="life-metric-label">{metric.label}</span>
        <span className={`life-trend is-${metric.trend}`} title={`7-day trend: ${metric.trend}`}>
          {trendArrow(metric.trend)}
        </span>
      </div>
      <div className="life-metric-values">
        <strong>{formatValue(metric.id, metric.today, metric.decimals)}</strong>
        <span className="life-metric-average">
          7d {formatValue(metric.id, metric.average, metric.decimals)}
        </span>
        <span className="life-metric-target">{target}</span>
      </div>
      <Sparkline
        values={metric.series}
        label={`${metric.label} 14 days`}
        width={132}
        height={22}
        animate={animate}
      />
    </li>
  );
}

interface MoneyRow {
  label: string;
  value: number | null;
  change: number | null;
  format: (value: number) => string;
  /** Month-over-month change with its sign; `$` for dollars, `pp` for points. */
  formatChange: (change: number) => string;
  /** Utilization reads better when it falls, so colour it by goodness. */
  goodWhenDown: boolean;
}

function MoneyBlock({ money }: { money: MoneyMonthView }) {
  const signed = (change: number, digits: number, suffix: string) =>
    `${change >= 0 ? "+" : "−"}${Math.abs(change).toLocaleString("en-US", { maximumFractionDigits: digits })}${suffix}`;
  const rows: MoneyRow[] = [
    {
      label: "Net worth",
      value: money.netWorth,
      change: money.change.netWorth,
      format: (value) => `$${Math.round(value).toLocaleString("en-US")}`,
      formatChange: (change) => signed(change, 0, "").replace(/^(\+|−)/, `$1$`),
      goodWhenDown: false,
    },
    {
      label: "Credit score",
      value: money.creditScore,
      change: money.change.creditScore,
      format: (value) => `${Math.round(value)}`,
      formatChange: (change) => signed(change, 0, ""),
      goodWhenDown: false,
    },
    {
      label: "Utilization",
      value: money.creditUtilization,
      change: money.change.creditUtilization,
      format: (value) => `${value.toFixed(1)}%`,
      formatChange: (change) => signed(change, 1, "pp"),
      goodWhenDown: true,
    },
    {
      label: "Savings rate",
      value: money.savingsRate,
      change: money.change.savingsRate,
      format: (value) => `${value.toFixed(1)}%`,
      formatChange: (change) => signed(change, 1, "pp"),
      goodWhenDown: false,
    },
  ];
  return (
    <div className="life-money">
      <div className="life-money-head">
        <span className="life-metric-label">Latest month</span>
        <span className="life-tag">{money.month}</span>
      </div>
      <dl>
        {rows.map((row) => (
          <div key={row.label} className="life-money-row">
            <dt>{row.label}</dt>
            <dd>
              {row.value === null ? "—" : row.format(row.value)}
              {row.change !== null ? (
                <span
                  className={`life-change ${
                    (row.change < 0) === row.goodWhenDown ? "is-good" : "is-bad"
                  }`}
                  title={`${row.formatChange(row.change)} vs previous month`}
                >
                  {row.formatChange(row.change)} MoM
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AreaPanel({
  area,
  money,
  animate,
}: {
  area: AreaView;
  money: MoneyMonthView | null;
  animate: boolean;
}) {
  return (
    <section className="life-panel" aria-label={`${area.label} detail`}>
      <header className="life-panel-head">
        <div>
          <p className="life-kicker">Area</p>
          <h2 className="life-panel-title">{area.label}</h2>
        </div>
        <div className={`life-score-chip tone-${area.tone}`}>
          {Math.round(area.score)}
          <span>/100</span>
        </div>
      </header>

      <p className="life-panel-delta">
        {area.delta >= 0 ? "+" : ""}
        {area.delta.toFixed(1)} vs previous 7 days · {trendArrow(area.trend)}
      </p>

      {area.id === "relationships" ? (
        <div className="life-rating">
          <span className="life-metric-label">Weekly self-rating</span>
          <strong>{area.rating.today === null ? "—" : `${area.rating.today}/10`}</strong>
          <span className={`life-trend is-${area.rating.trend}`}>{trendArrow(area.rating.trend)}</span>
        </div>
      ) : null}

      <ul className="life-metrics">
        {/* Monthly figures live in the Money block: a 14-day sparkline of a
            monthly number is a flat line, so it is not shown as a daily row. */}
        {area.metrics
          .filter((metric) => !MONTHLY_METRICS.has(metric.id))
          .map((metric) => (
            <MetricRow key={metric.id} metric={metric} animate={animate} />
          ))}
      </ul>

      {area.metrics.length === 0 && area.id !== "relationships" ? (
        <p className="life-empty">No tracked metrics for this area.</p>
      ) : null}

      {area.id !== "relationships" ? (
        <div className="life-rating">
          <span className="life-metric-label">Weekly rating</span>
          <strong>{area.rating.today === null ? "—" : `${area.rating.today}/10`}</strong>
          <span className={`life-trend is-${area.rating.trend}`}>{trendArrow(area.rating.trend)}</span>
          <Sparkline
            values={area.rating.series}
            label={`${area.label} weekly rating`}
            width={120}
            height={20}
            animate={animate}
          />
        </div>
      ) : null}

      {area.id === "money" && money ? <MoneyBlock money={money} /> : null}
    </section>
  );
}

function AlertsPanel({ view }: { view: LifeView }) {
  return (
    <section className="life-card" aria-label="Alerts">
      <header className="life-card-head">
        <h3>Alerts</h3>
        <span className="life-tag">{view.alerts.length || "clear"}</span>
      </header>
      {view.alerts.length === 0 ? (
        <p className="life-empty">All areas holding this week.</p>
      ) : (
        <ul className="life-alerts">
          {view.alerts.slice(0, 6).map((alert, index) => (
            <li key={`${alert.area}-${alert.reason}-${index}`} className={`life-alert is-${alert.reason}`}>
              <span aria-hidden="true">{alert.reason === "drop" ? "▾" : "!"}</span>
              <p>{alert.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StreaksPanel({ view }: { view: LifeView }) {
  const rows = [
    { label: "Workout", streak: view.streaks.workout },
    { label: "Study", streak: view.streaks.study },
    { label: "Win logged", streak: view.streaks.win },
  ];
  return (
    <section className="life-card" aria-label="Streaks">
      <header className="life-card-head">
        <h3>Streaks</h3>
        <span className="life-tag">days</span>
      </header>
      <ul className="life-streaks">
        {rows.map(({ label, streak }) => (
          <li key={label}>
            <span className="life-streak-label">{label}</span>
            <span className="life-streak-current">{streak.current}</span>
            <span className="life-streak-best">best {streak.best}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WeeklyChart({ points }: { points: WeeklyPoint[] }) {
  const W = 300;
  const H = 138;
  const PAD_X = 22;
  const PAD_Y = 16;

  if (points.length === 0) {
    return (
      <section className="life-weekly" aria-label="Weekly ratings">
        <header className="life-card-head">
          <h3>Weekly ratings</h3>
          <span className="life-tag">8 weeks</span>
        </header>
        <p className="life-empty">No Weekly/ notes yet — add `2026-W42.md` with your 1–10 ratings.</p>
      </section>
    );
  }

  const x = (index: number) =>
    points.length === 1 ? W / 2 : PAD_X + (index / (points.length - 1)) * (W - PAD_X * 2);
  const y = (rating: number) => H - PAD_Y - ((rating - 1) / 9) * (H - PAD_Y * 2);

  return (
    <section className="life-weekly" aria-label="Weekly ratings">
      <header className="life-card-head">
        <h3>Weekly ratings</h3>
        <span className="life-tag">1–10 · {points.length} weeks</span>
      </header>
      <svg className="life-weekly-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly self-ratings per area">
        {[1, 4, 7, 10].map((tick) => (
          <g key={tick}>
            <line x1={PAD_X} x2={W - PAD_X} y1={y(tick)} y2={y(tick)} stroke="var(--line-soft)" strokeWidth="1" />
            <text x={PAD_X - 8} y={y(tick) + 3} textAnchor="end" className="life-axis">
              {tick}
            </text>
          </g>
        ))}
        {LIFE_AREAS.map((area) => {
          const segments: string[] = [];
          let drawing = false;
          points.forEach((point, index) => {
            const rating = point.ratings[area.id];
            if (rating === undefined) {
              drawing = false;
              return;
            }
            segments.push(`${drawing ? "L" : "M"}${x(index).toFixed(1)},${y(rating).toFixed(1)}`);
            drawing = true;
          });
          if (segments.length === 0) return null;
          return (
            <path
              key={area.id}
              d={segments.join(" ")}
              fill="none"
              stroke={area.color}
              strokeWidth="1.5"
              strokeLinejoin="round"
              opacity="0.9"
            />
          );
        })}
        <text x={PAD_X} y={H - 4} className="life-axis is-edge">
          {points[0]?.week.replace(/^\d{4}-/, "") ?? ""}
        </text>
        <text x={W - PAD_X} y={H - 4} textAnchor="end" className="life-axis is-edge">
          {points[points.length - 1]?.week.replace(/^\d{4}-/, "") ?? ""}
        </text>
      </svg>
      <ul className="life-weekly-legend">
        {LIFE_AREAS.map((area) => (
          <li key={area.id}>
            <span className="life-swatch" style={{ background: area.color }} />
            {area.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LifeSection({ animate, clock, refreshTick, refresh }: LifeSectionProps) {
  const [raw, setRaw] = useState<LifeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AreaId>("health");
  const [now, setNow] = useState(() => new Date());

  // The ticker belongs to the dashboard: every due vault check bumps `refreshTick`,
  // and mounting the section loads once. No independent poll, so "Off" really
  // means nothing reads LIFE until the section is revisited.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await getJson<LifeData>("/api/life");
        if (cancelled) return;
        setRaw(data);
        setError(null);
        setNow(new Date());
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Life data unavailable");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  // The date has to roll at midnight even when no refresh is due, and the demo
  // generator is keyed on it; this tick reads no data.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const today = zoneDayKey(now, clock);
  const data = useMemo(() => {
    if (!raw) return null;
    return raw.demo ? demoLife(today) : raw;
  }, [raw, today]);
  const view = useMemo(() => (data ? buildLifeView(data, today) : null), [data, today]);

  if (!view) {
    return (
      <section className="life" aria-label="Life">
        <p className="life-empty">
          {error ? `Life data unavailable — retrying. ${error}` : "Reading life data…"}
        </p>
      </section>
    );
  }

  const area = view.areas.find((candidate) => candidate.id === selected) ?? view.areas[0];
  if (!area) return null;

  return (
    <section className="life" aria-label="Life">
      <header className="life-hud">
        <div className="life-hud-main">
          <p className="life-kicker">Life · overall 7-day score</p>
          <div className={`life-score tone-${scoreTone(view.overall)}`}>
            {Math.round(view.overall)}
            <span>/100</span>
          </div>
          <p className="life-date">{formatDay(view.today)}</p>
        </div>

        <div className="life-hud-side">
          {view.demo ? (
            <span
              className="life-demo"
              title="No Daily/, Monthly/ or Weekly/ entries were found — showing generated demo data"
            >
              DEMO DATA
            </span>
          ) : null}
          <span className="life-live">
            <span className="life-live-dot" aria-hidden="true" />
            {refresh === "off"
              ? "Automatic refresh off"
              : `Refreshing every ${refresh === "1m" ? "minute" : "5 minutes"}`}
          </span>
          <span className="life-counts">
            Daily {view.counts.daily} · Monthly {view.counts.monthly} · Weekly {view.counts.weekly}
          </span>
          {error ? <span className="life-warning">Retrying: {error}</span> : null}
          {!error && view.warnings.length > 0 ? (
            <span className="life-warning" title={view.warnings.join("\n")}>
              {view.warnings.length} data warning{view.warnings.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </header>

      <div className="life-grid">
        <div className="life-rail">
          <AlertsPanel view={view} />
          <StreaksPanel view={view} />
          <WeeklyChart points={view.weekly} />
        </div>

        <div className="life-core">
          <LifeSphere areas={view.areas} selected={selected} onSelect={setSelected} animate={animate} />
          <ul className="life-legend" aria-label="Area scores">
            {view.areas.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className={`life-legend-button${candidate.id === selected ? " is-active" : ""}`}
                  onClick={() => setSelected(candidate.id)}
                >
                  <span className={`life-swatch tone-${candidate.tone}`} />
                  {candidate.label}
                  <span className="life-legend-score">{Math.round(candidate.score)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <AreaPanel area={area} money={view.money} animate={animate} />
      </div>

      <div className="life-win">
        <span className="life-win-label">Latest win</span>
        {view.latestWin ? (
          <>
            <span className="life-win-date">{formatDay(view.latestWin.date)}</span>
            <p>{view.latestWin.text}</p>
          </>
        ) : (
          <p className="life-empty">No win logged yet — add `win:` to a Daily note.</p>
        )}
      </div>
    </section>
  );
}
