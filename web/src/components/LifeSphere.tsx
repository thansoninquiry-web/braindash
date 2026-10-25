import { useCallback, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import type { KeyboardEvent } from "react";
import type { AreaView } from "../life";
import { scoreTone, type AreaId } from "../lifeConfig";

interface LifeSphereProps {
  areas: AreaView[];
  selected: AreaId | null;
  onSelect: (area: AreaId) => void;
  animate: boolean;
}

const VIEW = { w: 520, h: 380, cx: 260, cy: 190 };
const RADIUS = 128;
const CAMERA = 620;

/** Fibonacci sphere, same placement rule as the vault core. */
function spherePoint(index: number, count: number): { x: number; y: number; z: number } {
  const y = count <= 1 ? 0 : 1 - (index / (count - 1)) * 2;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * Math.PI * (3 - Math.sqrt(5));
  return { x: Math.cos(theta) * ring, y, z: Math.sin(theta) * ring };
}

const TONE_FILL: Record<"good" | "warn" | "bad", string> = {
  good: "var(--life-good)",
  warn: "var(--life-warn)",
  bad: "var(--life-bad)",
};

export default function LifeSphere({ areas, selected, onSelect, animate }: LifeSphereProps) {
  const nodeRefs = useRef<(SVGCircleElement | null)[]>([]);
  const haloRefs = useRef<(SVGCircleElement | null)[]>([]);
  const labelRefs = useRef<(SVGTextElement | null)[]>([]);
  const points = useMemo(() => areas.map((_, index) => spherePoint(index, areas.length)), [areas.length]);

  const draw = useCallback(
    (elapsed: number) => {
      const yaw = 0.4 + elapsed * 0.22;
      const pitch = 0.16 + Math.sin(elapsed * 0.3) * 0.08;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);

      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const area = areas[index];
        const circle = nodeRefs.current[index];
        const halo = haloRefs.current[index];
        const label = labelRefs.current[index];
        if (!point || !area || !circle) continue;

        const x = point.x * RADIUS;
        const y = point.y * RADIUS;
        const z = point.z * RADIUS;
        const rx = x * cosY - z * sinY;
        const rz = x * sinY + z * cosY;
        const ry = y * cosP - rz * sinP;
        const depth = y * sinP + rz * cosP;
        const closeness = (depth / RADIUS + 1) / 2; // 1 = nearest the camera
        const scale = CAMERA / (CAMERA - depth * 0.9);
        const px = VIEW.cx + rx * scale;
        const py = VIEW.cy + ry * scale;
        const radius = (6 + (area.score / 100) * 9) * (0.78 + closeness * 0.4);

        circle.setAttribute("cx", px.toFixed(1));
        circle.setAttribute("cy", py.toFixed(1));
        circle.setAttribute("r", radius.toFixed(2));
        circle.setAttribute("opacity", (0.55 + closeness * 0.45).toFixed(2));
        // The glow scales with the score: a weak area is a dim ember.
        circle.setAttribute("stroke-width", selected === area.id ? "1.6" : "0");

        if (halo) {
          halo.setAttribute("cx", px.toFixed(1));
          halo.setAttribute("cy", py.toFixed(1));
          halo.setAttribute("r", (radius * 2.4).toFixed(1));
          halo.setAttribute(
            "opacity",
            ((0.05 + (area.score / 100) * 0.22) * (0.55 + closeness * 0.45)).toFixed(3),
          );
        }

        if (label) {
          label.setAttribute("x", px.toFixed(1));
          label.setAttribute("y", (py + radius + 11).toFixed(1));
          label.setAttribute("opacity", (0.3 + closeness * 0.55).toFixed(2));
        }
      }
    },
    [areas, points, selected],
  );

  useLayoutEffect(() => {
    draw(0.6);
    if (!animate) return;
    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (start === 0) start = now;
      draw((now - start) / 1000);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [animate, draw]);

  // Selection changes repaint a still sphere without waiting for a frame.
  useEffect(() => {
    if (!animate) draw(0.6);
  }, [animate, draw, selected]);

  function onKeyDown(event: KeyboardEvent<SVGCircleElement>, area: AreaId) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(area);
    }
  }

  return (
    <div className="life-sphere-wrap">
      <svg
        className="life-sphere"
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        role="group"
        aria-label="Life areas, sized and coloured by their 7-day score"
      >
        <defs>
          <radialGradient id="life-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="60%" stopColor="var(--accent)" stopOpacity="0.05" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <filter id="life-glow" x="-140%" y="-140%" width="380%" height="380%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width={VIEW.w} height={VIEW.h} fill="url(#life-halo)" />
        <circle
          cx={VIEW.cx}
          cy={VIEW.cy}
          r={RADIUS}
          className="life-orbit"
          fill="none"
          stroke="var(--line)"
          strokeDasharray="2 7"
        />

        <g>
          {areas.map((area, index) => (
            <circle
              key={`halo-${area.id}`}
              ref={(element) => {
                haloRefs.current[index] = element;
              }}
              className="life-halo-node"
              style={{ fill: TONE_FILL[scoreTone(area.score)] }}
              filter="url(#life-glow)"
            />
          ))}
        </g>

        <g filter="url(#life-glow)">
          {areas.map((area, index) => (
            <circle
              key={area.id}
              ref={(element) => {
                nodeRefs.current[index] = element;
              }}
              className={`life-node tone-${scoreTone(area.score)}${selected === area.id ? " is-selected" : ""}`}
              style={{ fill: TONE_FILL[scoreTone(area.score)], stroke: "var(--accent-bright)" }}
              role="button"
              tabIndex={0}
              aria-label={`${area.label}, ${Math.round(area.score)} out of 100`}
              onClick={() => onSelect(area.id)}
              onKeyDown={(event) => onKeyDown(event, area.id)}
            />
          ))}
        </g>

        {areas.map((area, index) => (
          <text
            key={`label-${area.id}`}
            ref={(element) => {
              labelRefs.current[index] = element;
            }}
            className={`life-node-label${selected === area.id ? " is-selected" : ""}`}
            textAnchor="middle"
          >
            {area.short}
          </text>
        ))}
      </svg>
    </div>
  );
}
