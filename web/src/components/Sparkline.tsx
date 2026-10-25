interface SparklineProps {
  values: number[];
  /**
   * Hover tooltip per bucket, aligned with `values`. When present, each bucket
   * gets a full-height hit band whose native `<title>` names the date and count,
   * so the shape is readable without guessing which day a spike belongs to.
   */
  labels?: string[];
  width?: number;
  height?: number;
  label: string;
  /** The app's motion setting; false keeps the line and dot still. */
  animate?: boolean;
}

const TICKS = 13;

export default function Sparkline({
  values,
  labels,
  width = 208,
  height = 36,
  label,
  animate = false,
}: SparklineProps) {
  if (values.length < 2) {
    return <div className="sparkline-empty" aria-label={`${label}: no data`} />;
  }

  const max = Math.max(...values, 1);
  const stepX = width / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = index * stepX;
      const y = height - (value / max) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `0,${height} ${points} ${width},${height}`;
  const gradientId = `spark-${label.replace(/\W+/g, "-")}`;
  const last = values[values.length - 1] ?? 0;
  const lastX = width;
  const lastY = height - (last / max) * (height - 8) - 4;

  return (
    <svg
      className={`sparkline${animate ? " is-animated" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label} sparkline`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g aria-hidden="true">
        {Array.from({ length: TICKS }, (_, index) => {
          const x = (index / (TICKS - 1)) * width;
          return (
            <line
              key={index}
              x1={x.toFixed(1)}
              y1={height - 4}
              x2={x.toFixed(1)}
              y2={height}
              stroke="var(--line)"
              strokeWidth="1"
            />
          );
        })}
      </g>

      <polygon className="sparkline-area" points={area} fill={`url(#${gradientId})`} />
      <polyline
        className="sparkline-line"
        points={points}
        pathLength={1}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.25"
      />
      <circle className="sparkline-dot" cx={lastX} cy={lastY} r="1.9" fill="var(--accent-bright)" />

      {labels && labels.length === values.length ? (
        <g className="sparkline-hits">
          {values.map((_, index) => {
            const x = index * stepX;
            // Each point owns half a step either side, clipped at the edges, so
            // the whole width is hoverable and neighbours do not overlap.
            const left = Math.max(0, x - stepX / 2);
            const right = Math.min(width, x + stepX / 2);
            return (
              <rect
                key={index}
                className="sparkline-hit"
                x={left.toFixed(2)}
                y={0}
                width={(right - left).toFixed(2)}
                height={height}
              >
                <title>{labels[index]}</title>
              </rect>
            );
          })}
        </g>
      ) : null}
    </svg>
  );
}
