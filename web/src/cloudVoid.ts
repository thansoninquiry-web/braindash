/**
 * Geometry for the empty hall behind the vault core.
 *
 * The core floats on a black canvas; a one-point-perspective room gives it
 * somewhere to float. Every guide here is derived from a single vanishing point
 * and a depth fraction, so the ceiling grid, the floor seams and the far opening
 * can never drift apart — and the numbers stay testable without a DOM.
 */

export interface Point {
  x: number;
  y: number;
}

/** A straight guide drawn between two points. */
export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Quad {
  points: [Point, Point, Point, Point];
}

export interface VoidOptions {
  width?: number;
  height?: number;
  /** Screen y of the horizon. The vanishing point sits on it, centred. */
  horizon?: number;
  /** Ray columns on each side of centre; the centre column is skipped. */
  columns?: number;
  /** Transverse panel seams on each plane. */
  seams?: number;
  /** Vertical seams on each side wall. */
  wallSeams?: number;
  /** Depth of the far opening, 0 at the near edge and 1 at the vanishing point. */
  mouthDepth?: number;
}

export interface Hall {
  width: number;
  height: number;
  vp: Point;
  mouth: Rect;
  /** Long seams running away from the viewer, converging on the mouth. */
  ceilingRays: Guide[];
  floorRays: Guide[];
  /** Cross seams: harmonic spacing, so they crowd as the floor recedes. */
  ceilingSeams: Guide[];
  floorSeams: Guide[];
  /** Vertical seams on the side walls, which stay upright in one-point perspective. */
  wallSeams: Guide[];
  /** Fluorescent plates on the ceiling, brightest near the far end. */
  lights: Quad[];
}

const DEFAULTS = {
  width: 1200,
  height: 640,
  horizon: 304,
  columns: 4,
  seams: 5,
  wallSeams: 3,
  mouthDepth: 0.88,
};

/**
 * Depth of the nth cross seam. Screen depth is z / (z + eye), so evenly spaced
 * panels in the room bunch up toward the horizon instead of looking like a ladder.
 */
const EYE = 1.4;

function seamDepth(index: number): number {
  return index / (index + EYE);
}

export function cloudVoid(options: VoidOptions = {}): Hall {
  const { width, height, horizon, columns, seams, wallSeams, mouthDepth } = {
    ...DEFAULTS,
    ...options,
  };
  const cx = width / 2;
  const vp = { x: cx, y: horizon };
  /** Half width of the room at a depth fraction. */
  const halfWidth = (depth: number) => (width / 2) * (1 - depth);
  /** Screen y of the ceiling at a depth fraction. */
  const ceilingY = (depth: number) => horizon * depth;
  const floorY = (depth: number) => height - (height - horizon) * depth;
  const ceilingPoint = (depth: number, side: number): Point => ({
    x: cx + side * halfWidth(depth),
    y: ceilingY(depth),
  });
  const floorPoint = (depth: number, side: number): Point => ({
    x: cx + side * halfWidth(depth),
    y: floorY(depth),
  });
  const guide = (a: Point, b: Point): Guide => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });

  const mouth: Rect = {
    x: cx - halfWidth(mouthDepth),
    y: ceilingY(mouthDepth),
    w: halfWidth(mouthDepth) * 2,
    h: floorY(mouthDepth) - ceilingY(mouthDepth),
  };

  // A ray leaves the near edge of the frame aiming at the vanishing point and
  // stops at the far opening, so every line ends exactly on the mouth's edge.
  const sides: number[] = [];
  for (let step = 1; step <= columns; step += 1) {
    const side = step / columns;
    sides.push(-side, side);
  }
  const ceilingRays = sides.map((side) =>
    guide({ x: cx + side * (width / 2), y: 0 }, ceilingPoint(mouthDepth, side)),
  );
  const floorRays = sides.map((side) =>
    guide({ x: cx + side * (width / 2), y: height }, floorPoint(mouthDepth, side)),
  );

  const depths = Array.from({ length: seams }, (_, index) => seamDepth(index + 1));
  const ceilingSeams = depths.map((depth) =>
    guide(ceilingPoint(depth, -1), ceilingPoint(depth, 1)),
  );
  const floorSeams = depths.map((depth) => guide(floorPoint(depth, -1), floorPoint(depth, 1)));

  // Wall seams start past the near panels: a joint right beside the camera reads
  // as the front edge of a box instead of a wall receding away from us.
  const wallDepths = Array.from({ length: wallSeams }, (_, index) => seamDepth(index + 3));
  const wallSeamsGuides: Guide[] = [];
  for (const depth of wallDepths) {
    for (const side of [-1, 1]) {
      wallSeamsGuides.push(guide(ceilingPoint(depth, side), floorPoint(depth, side)));
    }
  }

  // Ceiling panels between the cross seams, catching the light from the far
  // end. Panels rather than strips: they line up with the grid, so they read as
  // part of the roof instead of floating in front of it.
  const lights: Quad[] = depths.slice(0, -1).map((depth, index) => {
    const far = depths[index + 1] ?? depth;
    const inset = (far - depth) * 0.14;
    return {
      points: [
        ceilingPoint(depth + inset, -0.9),
        ceilingPoint(far - inset, -0.9),
        ceilingPoint(far - inset, 0.9),
        ceilingPoint(depth + inset, 0.9),
      ],
    };
  });

  return {
    width,
    height,
    vp,
    mouth,
    ceilingRays,
    floorRays,
    ceilingSeams,
    floorSeams,
    wallSeams: wallSeamsGuides,
    lights,
  };
}
