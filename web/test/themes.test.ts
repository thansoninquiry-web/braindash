import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { THEMES } from "../src/themes.js";

type RGB = [number, number, number];
type Lab = [number, number, number];

function rgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((at) => parseInt(clean.slice(at, at + 2), 16)) as RGB;
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgb(hex).map((value) => value / 255) as RGB;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return { h: hue < 0 ? hue + 360 : hue, s: saturation, l: lightness };
}

/** sRGB channel (0–255) to linear light, the first step into CIE Lab. */
function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** CIE L*a*b* under D65 — the space CIEDE2000 compares. */
function lab(hex: string): Lab {
  const [r, g, b] = rgb(hex).map(linear) as RGB;
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (value: number) =>
    value > 216 / 24389 ? Math.cbrt(value) : (841 / 108) * value + 4 / 29;
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIEDE2000 colour difference: perceptually uniform, unlike a hue angle, which
 * ignores how light or how grey two colours are. ~2.3 is a just-noticeable
 * difference for large patches; 10 reads as clearly different.
 */
function deltaE([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = c1p === 0 ? 0 : ((Math.atan2(b1, a1p) * 180) / Math.PI) % 360;
  const h2p = c2p === 0 ? 0 : ((Math.atan2(b2, a2p) * 180) / Math.PI) % 360;
  const hue1 = h1p < 0 ? h1p + 360 : h1p;
  const hue2 = h2p < 0 ? h2p + 360 : h2p;
  const dL = l2 - l1;
  const dC = c2p - c1p;
  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = hue2 - hue1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh * Math.PI) / 360);
  const lBar = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBar = (hue1 + hue2) / 2;
  if (c1p * c2p !== 0 && Math.abs(hue1 - hue2) > 180) {
    hBar += hue1 + hue2 < 360 ? 180 : -180;
  }
  const t =
    1 -
    0.17 * Math.cos(((hBar - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hBar * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hBar + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hBar - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin((2 * dTheta * Math.PI) / 180) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(linear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("CSS palette defaults", () => {
  it("mirrors the Orange theme in :root, variable for variable", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const block = /:root\s*\{([\s\S]*?)\}/.exec(css)?.[1];
    assert.ok(block, "styles.css has no :root block");

    const orange = THEMES.find((theme) => theme.id === "orange");
    assert.ok(orange, "the Orange theme is missing from themes.ts");
    const expected: Record<string, string> = {
      "--accent": orange.accent,
      "--accent-bright": orange.bright,
      "--accent-dim": orange.dim,
      "--accent-rgb": orange.rgb,
      "--node-career": orange.career,
      "--node-life": orange.life,
      "--node-ideas": orange.ideas,
      "--node-unset": orange.unset,
      "--node-dust": orange.dust,
    };
    const normalise = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

    for (const [name, value] of Object.entries(expected)) {
      const declarations: RegExpMatchArray[] = [
        ...block.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, "g")),
      ];
      assert.equal(
        declarations.length,
        1,
        `${name} is declared ${declarations.length} time(s) in :root`,
      );
      const found: string | undefined = declarations[0]?.[1];
      assert.ok(found, `${name} is missing from :root`);
      assert.equal(
        normalise(found),
        normalise(value),
        `${name} in :root is ${normalise(found)}, but the Orange theme says ${normalise(value)}`,
      );
    }
  });
});

describe("perceptual colour distance", () => {
  it("matches published CIEDE2000 reference pairs", () => {
    // Sharma, Wu & Dalal (2005) test data, including the blue pairs that catch
    // a sign error in the rotation term.
    const pairs: [Lab, Lab, number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 0, 0], [50, -1, 2], 2.3669],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
      [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
      [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
    ];
    for (const [a, b, expected] of pairs) {
      const found = deltaE(a, b);
      assert.ok(
        Math.abs(found - expected) < 0.0001,
        `ΔE2000(${a.join(",")} → ${b.join(",")}) = ${found.toFixed(4)}, expected ${expected}`,
      );
    }
  });
});

/** CIEDE2000 room a spark keeps from every node shade in its own palette. */
const SPARK_NODE_GAP = 25;
/** CIEDE2000 room between any two themes' sparks, so no pastel is reused. */
const SPARK_SPARK_GAP = 10;

describe("theme spark colours", () => {
  it("gives every theme a spark colour of its own", () => {
    const sparks = THEMES.map((theme) => theme.dust);
    assert.equal(new Set(sparks).size, THEMES.length);
  });

  it("keeps each spark perceptually clear of every node colour", () => {
    for (const theme of THEMES) {
      const spark = lab(theme.dust);
      const nodeColours: [string, string][] = [
        ["accent", theme.accent],
        ["career", theme.career],
        ["life", theme.life],
        ["ideas", theme.ideas],
        ["unset", theme.unset],
      ];
      for (const [name, colour] of nodeColours) {
        const distance = deltaE(spark, lab(colour));
        assert.ok(
          distance >= SPARK_NODE_GAP,
          `${theme.id}: spark ${theme.dust} is only ${distance.toFixed(1)} ΔE2000 from ${name} ${colour}`,
        );
      }
    }
  });

  it("keeps the five spark colours perceptually apart", () => {
    for (let i = 0; i < THEMES.length; i += 1) {
      for (let j = i + 1; j < THEMES.length; j += 1) {
        const a = THEMES[i];
        const b = THEMES[j];
        const distance = deltaE(lab(a.dust), lab(b.dust));
        assert.ok(
          distance >= SPARK_SPARK_GAP,
          `${a.id} ${a.dust} and ${b.id} ${b.dust} are only ${distance.toFixed(1)} ΔE2000 apart`,
        );
      }
    }
  });

  it("keeps the sparks pale and muted so they sit behind the nodes", () => {
    for (const theme of THEMES) {
      const spark = hsl(theme.dust);
      assert.ok(luminance(theme.dust) > 0.35, `${theme.id}: ${theme.dust} is too dark to read`);
      assert.ok(spark.s <= 0.5, `${theme.id}: ${theme.dust} is saturated enough to compete with a node`);
    }
  });
});
