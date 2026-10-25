import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRAPH_PULSE_PERIOD } from "../src/cloudMotion.ts";
import { pulseDelay, pulseGeometry } from "../src/graphPulse.ts";

const bounds = { minX: -100, minY: -50, maxX: 100, maxY: 50 };

describe("pulseGeometry", () => {
  it("centres on the bounding box, not on the average of the notes", () => {
    const geometry = pulseGeometry(
      [
        { x: -90, y: 0 },
        { x: -80, y: 0 },
        { x: 95, y: 0 },
      ],
      bounds,
    );
    assert.equal(geometry.cx, 0);
    assert.equal(geometry.cy, 0);
    // The mean would be -25; the box middle is what the ring should share.
    assert.notEqual(geometry.cx, (-90 - 80 + 95) / 3);
  });

  it("reaches past the farthest note by the margin", () => {
    const geometry = pulseGeometry([{ x: 0, y: 0 }, { x: 0, y: 50 }], bounds, 12);
    assert.equal(geometry.radius, 112, "half the box width wins, then the margin");
  });

  it("uses the farthest point when it sits outside the bounds box", () => {
    const geometry = pulseGeometry([{ x: 200, y: 0 }], bounds, 10);
    assert.equal(geometry.radius, 210);
  });

  it("keeps a drawable radius for an empty or degenerate graph", () => {
    assert.ok(
      pulseGeometry([], { minX: 0, minY: 0, maxX: 0, maxY: 0 }).radius > 0,
      "an empty layout still gets a ring to draw",
    );
    assert.ok(pulseGeometry([], bounds, -100).radius >= 1, "a negative margin cannot shrink it below 1");
  });
});

describe("pulseDelay", () => {
  const geometry = { cx: 0, cy: 0, radius: 100 };

  it("starts at the centre and ends at the reach", () => {
    assert.equal(pulseDelay({ x: 0, y: 0 }, geometry), 0);
    assert.equal(pulseDelay({ x: 100, y: 0 }, geometry), GRAPH_PULSE_PERIOD);
  });

  it("arrives later the farther a note is, on a straight line over time", () => {
    const near = pulseDelay({ x: 25, y: 0 }, geometry);
    const middle = pulseDelay({ x: 50, y: 0 }, geometry);
    const far = pulseDelay({ x: 0, y: 75 }, geometry);
    assert.ok(near < middle && middle < far);
    assert.ok(Math.abs(middle - GRAPH_PULSE_PERIOD / 2) < 1e-9);
  });

  it("measures radial distance, not x alone", () => {
    assert.equal(
      pulseDelay({ x: 30, y: 40 }, geometry),
      pulseDelay({ x: 50, y: 0 }, geometry),
      "a 3-4-5 triangle lands at the same radius as 50 on the x axis",
    );
  });

  it("clamps points outside the reach and refuses a period that cannot run", () => {
    assert.equal(pulseDelay({ x: 500, y: 0 }, geometry), GRAPH_PULSE_PERIOD);
    assert.equal(pulseDelay({ x: 500, y: 0 }, geometry, 2), 2);
    assert.equal(pulseDelay({ x: 50, y: 0 }, geometry, 0), 0);
    assert.equal(pulseDelay({ x: 50, y: 0 }, { ...geometry, radius: 0 }), 0);
  });
});
