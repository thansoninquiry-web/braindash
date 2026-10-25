/**
 * Spiral-galaxy placement for the vault core.
 *
 * Notes and sparks sit on a thin disk wound into a few arms, not on a sphere:
 * the dashboard is a star chart of the vault, and a spiral reads as depth and
 * motion at a glance where a uniform ball reads as noise. Pure geometry, kept
 * out of the SVG component so the shape is testable without a DOM.
 */

export interface GalaxyPoint {
  /** Unit-disk coordinates: x/z are the disk plane, y is its thickness. */
  x: number;
  y: number;
  z: number;
}

/** Arms of the spiral. Four fills the disk without closing the gaps. */
export const GALAXY_ARMS = 4;

/** One deterministic value in [0, 1) per seed, so a rescan does not reshuffle. */
function hash(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 4.1414) * 43758.5453;
  return value - Math.floor(value);
}

/** Radius of the nth of `count` particles: crowded core, sparse rim. */
export function galaxyRadius(index: number, count: number): number {
  const t = count <= 1 ? 0 : index / (count - 1);
  return CORE_RADIUS + (1 - CORE_RADIUS) * Math.sqrt(t);
}

/** Where the arms start; inside this the bulge is a crowd, not a spiral. */
export const CORE_RADIUS = 0.14;

/** Radians of sweep per e-fold of radius: the arms wind out, not straight. */
const TWIST = 2.1;

/** Angle of a point at `radius` on `arm`, on a logarithmic spiral. */
export function armAngle(radius: number, arm: number, arms = GALAXY_ARMS): number {
  return (arm / arms) * Math.PI * 2 + Math.log(Math.max(radius, CORE_RADIUS) / CORE_RADIUS) * TWIST;
}

/**
 * Where one particle sits. `index` decides the arm, the radius and the phase;
 * the two hashes scatter it around the arm so the spiral looks organic instead
 * of drawn with a compass. The disk is thin and thicker near the core, which is
 * what makes it read as a galaxy seen at an angle.
 */
export function galaxyPoint(index: number, count: number, arms = GALAXY_ARMS): GalaxyPoint {
  const radius = galaxyRadius(index, count);
  const scatter = (hash(index * 1.7 + 3.1) - 0.5) * 0.42;
  const arm = index % arms;
  const angle = armAngle(radius, arm, arms) + scatter;
  const thickness = (hash(index * 5.3 + 11.9) - 0.5) * 0.16 * (1 - radius * 0.55);
  return {
    x: Math.cos(angle) * radius,
    y: thickness,
    z: Math.sin(angle) * radius,
  };
}

export interface GalaxyStar {
  /** Unit-disk coordinates; the renderer tilts and rotates the whole layer. */
  x: number;
  y: number;
  r: number;
  o: number;
  /** A rare foreground star, painted with its own soft bloom. */
  bright?: boolean;
}

/** Share of the dust that crowds the bulge instead of riding an arm. */
export const CORE_SHARE = 0.26;
/** Share of faint field stars scattered between the arms. */
const FIELD_SHARE = 0.18;

/**
 * The dust that fills the arms. Drawn once as a flat unit disk and animated as a
 * single rotated group, so a few thousand stars cost one transform per frame
 * rather than a few thousand attribute writes: rotating the disk then squashing
 * it on screen is exactly what a tilted galaxy does.
 *
 * Three populations, because one uniform scatter reads as a smudge: a dense
 * bulge, thin dust along the logarithmic arms, and a faint field between them
 * that keeps the black from looking empty.
 */
export function galaxyStars(count: number, seed = 1, arms = GALAXY_ARMS): GalaxyStar[] {
  const stars: GalaxyStar[] = [];
  for (let index = 0; index < count; index += 1) {
    const a = hash(index * 3.7 + seed);
    const b = hash(index * 8.3 + seed + 17);
    const c = hash(index * 1.9 + seed + 41);
    // The angle has its own hash. Sharing it with brightness put the big stars
    // on one side of every arm, which reads as knots strung along a wire.
    const d = hash(index * 6.7 + seed + 73);

    if (a < CORE_SHARE) {
      // The bulge: crowded at the middle and feathered at its edge, because a
      // flat-density disc would show a hard rim the arms have to attach to.
      const radius = CORE_RADIUS * 1.1 * Math.pow(b, 0.7);
      const angle = d * Math.PI * 2;
      stars.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        r: 0.11 + c * 0.2,
        o: Math.min(1, 0.55 + b * 0.45),
        bright: c > 0.962,
      });
      continue;
    }

    if (a > 1 - FIELD_SHARE) {
      // The field between the arms: separate stars, not fog, so the black
      // between the arms still reads as sky rather than as a hole.
      const radius = 0.22 + b * 0.78;
      const angle = d * Math.PI * 2;
      stars.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        r: 0.1 + Math.pow(b, 3) * 0.26,
        o: Math.max(0.18, 0.56 - radius * 0.2) * (0.5 + c * 0.5),
        bright: c > 0.99,
      });
      continue;
    }

    // The arms themselves: broad bands, crowded near the core and feathered
    // outward. The width is what makes them read as dust — a thread reads as a
    // string of beads no matter how many stars are strung along it.
    const radius = CORE_RADIUS + (1 - CORE_RADIUS) * Math.pow(b, 0.5);
    // Radial jitter only ever pulls inward, so no star leaves the disk.
    const drift = 1 - hash(index * 4.9 + seed + 5) * 0.05;
    const angle = armAngle(radius, index % arms, arms) + (d - 0.5) * 0.4;
    stars.push({
      x: Math.cos(angle) * radius * drift,
      y: Math.sin(angle) * radius * drift,
      // Size skews small: a rind of pebbles, not a bowl of marbles.
      r: 0.1 + Math.pow(c, 2.4) * 0.34,
      o: Math.min(1, Math.max(0.26, 0.64 - radius * 0.3 + c * 0.34)),
      bright: c > 0.985,
    });
  }
  return stars;
}

export interface GalaxyHaze {
  x: number;
  y: number;
  /** Radius in unit-disk space; the renderer scales it with the disk. */
  r: number;
  o: number;
}

/**
 * The gas the arms are made of: a few hundred soft, wide blobs on the same
 * spirals as the dust. Drawn under the sharp stars, it turns a string of specks
 * into a band with a body — the part a photograph of a galaxy has that a scatter
 * plot does not. Kept in unit-disk space so it rotates with the dust for free.
 */
export function galaxyHaze(count: number, seed = 3, arms = GALAXY_ARMS): GalaxyHaze[] {
  const haze: GalaxyHaze[] = [];
  for (let index = 0; index < count; index += 1) {
    const a = hash(index * 6.1 + seed);
    const b = hash(index * 2.7 + seed + 23);
    const c = hash(index * 9.3 + seed + 61);
    const d = hash(index * 5.3 + seed + 89);
    if (a < 0.28) {
      // Bulge glow, wrapping the core in light.
      const radius = CORE_RADIUS * 1.3 * Math.pow(b, 0.6);
      const angle = d * Math.PI * 2;
      haze.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        r: 0.03 + b * 0.05,
        o: 0.012 + c * 0.014,
      });
      continue;
    }
    const radius = CORE_RADIUS + (1 - CORE_RADIUS) * Math.pow(b, 0.5);
    const angle = armAngle(radius, index % arms, arms) + (d - 0.5) * 0.38;
    haze.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      // Wider out toward the rim, as though the gas were dispersing.
      r: 0.03 + radius * 0.05 + c * 0.025,
      o: Math.max(0.01, 0.03 - radius * 0.016) + c * 0.01,
    });
  }
  return haze;
}
