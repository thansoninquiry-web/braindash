import { useEffect, useMemo, useState } from "react";
import { cloudVoid, type Quad, type Rect } from "../cloudVoid";
import { hallLightingAt, minutesOfDay, type HallLighting } from "../hallLight";

/** SVG polygon points for a quad or a rectangle, one decimal is plenty. */
function polygon(points: { x: number; y: number }[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

const quad = (shape: Quad) => polygon(shape.points);

const rectCorners = (rect: Rect) => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.w, y: rect.y },
  { x: rect.x + rect.w, y: rect.y + rect.h },
  { x: rect.x, y: rect.y + rect.h },
];

/**
 * The hall's static geometry plus the lighting it is lit by. Split from the
 * ticking wrapper so a test can render the room at a fixed hour.
 */
export function HallScene({ lighting }: { lighting: HallLighting }) {
  const hall = useMemo(() => cloudVoid(), []);
  const { width, height, mouth } = hall;
  const mouthBottom = mouth.y + mouth.h;

  return (
    <div className="cloud-void" aria-hidden="true" data-hall-phase={lighting.phase}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="void-ceiling" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0c1013" />
            <stop offset="0.55" stopColor="#1a2024" />
            <stop offset="1" stopColor="#333a3e" />
          </linearGradient>

          <linearGradient id="void-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2b3237" />
            <stop offset="0.3" stopColor="#181d20" />
            <stop offset="1" stopColor="#080a0c" />
          </linearGradient>

          <linearGradient id="void-wall-left" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#090c0e" />
            <stop offset="0.7" stopColor="#171c1f" />
            <stop offset="1" stopColor="#2c3337" />
          </linearGradient>

          <linearGradient id="void-wall-right" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="#090c0e" />
            <stop offset="0.7" stopColor="#171c1f" />
            <stop offset="1" stopColor="#2c3337" />
          </linearGradient>

          {/* Light spilling out of the far opening, and its long reflection. */}
          <radialGradient id="void-door-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#eef4f6" stopOpacity="0.26" />
            <stop offset="45%" stopColor="#dfe8ec" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#dfe8ec" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="void-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#eef4f6" stopOpacity="0.16" />
            <stop offset="0.45" stopColor="#e4ecef" stopOpacity="0.05" />
            <stop offset="1" stopColor="#e4ecef" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="void-mouth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#04060a" />
            <stop offset="0.7" stopColor="#070a0d" />
            <stop offset="1" stopColor="#0d1216" />
          </linearGradient>

          <filter id="void-soft" x="-30%" y="-60%" width="160%" height="220%">
            <feGaussianBlur stdDeviation="4" />
          </filter>

          <filter id="void-bloom" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        {/* Three planes meeting at the vanishing point: roof, two walls, floor. */}
        <polygon
          points={polygon([
            { x: 0, y: 0 },
            { x: width, y: 0 },
            { x: mouth.x + mouth.w, y: mouth.y },
            { x: mouth.x, y: mouth.y },
          ])}
          fill="url(#void-ceiling)"
        />
        <polygon
          points={polygon([
            { x: 0, y: 0 },
            { x: mouth.x, y: mouth.y },
            { x: mouth.x, y: mouthBottom },
            { x: 0, y: height },
          ])}
          fill="url(#void-wall-left)"
        />
        <polygon
          points={polygon([
            { x: width, y: 0 },
            { x: mouth.x + mouth.w, y: mouth.y },
            { x: mouth.x + mouth.w, y: mouthBottom },
            { x: width, y: height },
          ])}
          fill="url(#void-wall-right)"
        />
        <polygon
          points={polygon([
            { x: 0, y: height },
            { x: width, y: height },
            { x: mouth.x + mouth.w, y: mouthBottom },
            { x: mouth.x, y: mouthBottom },
          ])}
          fill="url(#void-floor)"
        />

        {/* Pooled light on the concrete, widening toward the viewer. Dimmed
            with the doorway: at night only the door itself still glows. */}
        <g className="void-glow" style={{ opacity: lighting.glow }}>
          <polygon
            points={polygon([
              { x: mouth.x - mouth.w * 0.2, y: mouthBottom },
              { x: mouth.x + mouth.w * 1.2, y: mouthBottom },
              { x: width / 2 + width * 0.38, y: height },
              { x: width / 2 - width * 0.38, y: height },
            ])}
            fill="url(#void-sheen)"
            filter="url(#void-bloom)"
          />

          {/* The lit floor right in front of the opening, where the sheen starts. */}
          <ellipse
            cx={mouth.x + mouth.w / 2}
            cy={mouthBottom + mouth.h * 0.35}
            rx={mouth.w * 1.9}
            ry={mouth.h * 0.8}
            fill="url(#void-door-glow)"
          />
        </g>

        <g className="void-grid">
          {hall.ceilingSeams.map((line, index) => (
            <line key={`ceiling-seam-${index}`} {...line} />
          ))}
          {hall.floorSeams.map((line, index) => (
            <line key={`floor-seam-${index}`} {...line} />
          ))}
          {hall.ceilingRays.map((line, index) => (
            <line key={`ceiling-ray-${index}`} {...line} />
          ))}
          {hall.floorRays.map((line, index) => (
            <line key={`floor-ray-${index}`} {...line} />
          ))}
        </g>

        <g className="void-wall-seams">
          {hall.wallSeams.map((line, index) => (
            <line key={`wall-seam-${index}`} {...line} />
          ))}
        </g>

        {/* Ceiling panels: dimmest overhead, brighter toward the far end where
            the room's only light comes from. The group carries the time of day,
            so every plate dims together without losing that gradient. */}
        <g className="void-lights" style={{ opacity: lighting.strips }}>
          {hall.lights.map((plate, index) => (
            <polygon
              key={`light-${index}`}
              points={quad(plate)}
              style={{ opacity: 0.04 + (index / hall.lights.length) * 0.1 }}
            />
          ))}
        </g>

        {/* The far end of the hall: a lit doorway, then the dark it opens onto. */}
        <g className="void-glow" style={{ opacity: lighting.glow }}>
          <ellipse
            cx={mouth.x + mouth.w / 2}
            cy={mouth.y + mouth.h / 2}
            rx={mouth.w * 3.2}
            ry={mouth.h * 3}
            fill="url(#void-door-glow)"
          />
        </g>
        <polygon points={polygon(rectCorners(mouth))} fill="url(#void-mouth)" />
        <rect
          className="void-door"
          x={mouth.x}
          y={mouth.y}
          width={mouth.w}
          height={mouth.h}
          filter="url(#void-soft)"
          style={{ opacity: lighting.glow }}
        />

        {/* Night settles over the whole room, not just its lamps: one black
            veil above every layer, thinnest at noon and deepest after 21:00. */}
        <rect
          className="void-night"
          x={0}
          y={0}
          width={width}
          height={height}
          style={{ opacity: lighting.veil }}
        />
      </svg>
    </div>
  );
}

/**
 * The empty hall the vault core hangs in. Drawn once: the depth comes from the
 * perspective, and the slow drift against the sphere is a CSS transform fed by
 * the cloud's draw loop (`--hall-x` / `--hall-y`), so the geometry is never
 * recomputed and the room only ever moves a few pixels. The lighting is sampled
 * every 30 s from this device's wall clock, so the room dims into the night and
 * lifts at dawn on a dashboard left open. Purely decorative, and hidden from
 * assistive tech.
 */
export default function CloudVoid() {
  const [minutes, setMinutes] = useState(() => minutesOfDay(new Date()));

  useEffect(() => {
    const id = window.setInterval(() => setMinutes(minutesOfDay(new Date())), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return <HallScene lighting={hallLightingAt(minutes)} />;
}
