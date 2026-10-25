import { GRAPH_PULSE_PERIOD } from "./cloudMotion";
import type { GraphBounds } from "./graphLayout";

export interface PulsePoint {
  x: number;
  y: number;
}

export interface PulseGeometry {
  cx: number;
  cy: number;
  radius: number;
}

/** Extra distance past the farthest node, so the ring leaves the graph. */
const PULSE_MARGIN = 30;

/**
 * Where the full graph's wave starts and how far it has to travel.
 *
 * The centre is the bounding box's middle rather than the mean of the points: a
 * vault with one dense cluster and a single outlier would drag a mean off to
 * one side, and the ring would appear to start beside the graph. The radius is
 * the farthest node plus a margin, so the crest exits the canvas instead of
 * stopping between notes.
 */
export function pulseGeometry(
  points: readonly PulsePoint[],
  bounds: GraphBounds,
  margin = PULSE_MARGIN,
): PulseGeometry {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  let radius = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
  for (const point of points) {
    radius = Math.max(radius, Math.hypot(point.x - cx, point.y - cy));
  }
  return { cx, cy, radius: Math.max(1, radius + Math.max(0, margin)) };
}

/**
 * Seconds from the start of a cycle until the wave reaches `point`. Distance
 * over reach keeps the front circular; the result is clamped so a point outside
 * the padded radius still answers at the end of the cycle rather than waiting
 * forever. Positive delays mean the first pass begins at the centre instead of
 * every note lighting at once.
 */
export function pulseDelay(
  point: PulsePoint,
  geometry: PulseGeometry,
  period = GRAPH_PULSE_PERIOD,
): number {
  if (!(period > 0) || !(geometry.radius > 0)) return 0;
  const distance = Math.hypot(point.x - geometry.cx, point.y - geometry.cy);
  const fraction = Math.min(1, Math.max(0, distance / geometry.radius));
  return fraction * period;
}
