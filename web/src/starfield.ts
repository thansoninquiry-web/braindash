/**
 * Deterministic stars for the space behind the dashboard.
 *
 * A random field per render would reshuffle on every mount, which reads as
 * flicker rather than depth; the same seed always returns the same sky. Kept
 * pure so the placement can be tested without a DOM.
 */

export interface Star {
  x: number;
  y: number;
  /** Radius in user units, small enough to stay pinpricks. */
  r: number;
  /** Base opacity, 0–1. */
  o: number;
  /** A minority breathe, so the sky is not frozen but most of it is calm. */
  twinkle: boolean;
}

/** Small seeded PRNG: same sequence on every platform and every run. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` stars spread over `width` × `height`. Sizes and opacities are skewed
 * low: a few bright stars carry the field, the rest are barely-there dust.
 */
export function starfield(count: number, width: number, height: number, seed = 1): Star[] {
  const random = mulberry32(seed);
  const stars: Star[] = [];
  for (let index = 0; index < count; index += 1) {
    const bright = random() > 0.86;
    const r = bright ? 0.75 + random() * 0.9 : 0.32 + random() * 0.5;
    const o = bright ? 0.62 + random() * 0.38 : 0.16 + random() * 0.42;
    stars.push({
      x: random() * width,
      y: random() * height,
      r,
      o,
      twinkle: random() > 0.78,
    });
  }
  return stars;
}
