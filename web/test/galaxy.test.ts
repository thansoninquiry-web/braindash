import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CORE_RADIUS,
  GALAXY_ARMS,
  armAngle,
  galaxyPoint,
  galaxyRadius,
  galaxyStars,
} from "../src/galaxy.js";

describe("galaxyPoint", () => {
  it("is deterministic, so a rescan does not reshuffle the sky", () => {
    for (const index of [0, 7, 42, 159]) {
      assert.deepEqual(galaxyPoint(index, 160), galaxyPoint(index, 160));
    }
  });

  it("keeps every particle inside the disk", () => {
    for (let index = 0; index < 240; index += 1) {
      const point = galaxyPoint(index, 240);
      assert.ok(Math.hypot(point.x, point.z) <= 1, `${index} stays on the disk`);
      assert.ok(Math.abs(point.y) <= 0.08, `${index} stays thin`);
    }
  });

  it("puts the first particles in the core and the last at the rim", () => {
    assert.ok(galaxyRadius(0, 160) < 0.2);
    assert.ok(galaxyRadius(159, 160) > 0.95);
    for (let index = 1; index < 160; index += 1) {
      assert.ok(galaxyRadius(index, 160) > galaxyRadius(index - 1, 160), "radius grows with index");
    }
  });

  it("spreads the index order across every arm", () => {
    const angles = Array.from({ length: GALAXY_ARMS * 4 }, (_, index) => {
      const point = galaxyPoint(index, GALAXY_ARMS * 4);
      return Math.atan2(point.z, point.x);
    });
    // Consecutive particles land on different arms, not on one another.
    for (let index = 1; index < angles.length; index += 1) {
      assert.ok(Math.abs(angles[index] - angles[index - 1]) > 0.2, `arm ${index} is its own place`);
    }
  });

  it("sweeps the arms as the radius grows", () => {
    assert.ok(armAngle(1, 0) > armAngle(CORE_RADIUS, 0) + 3, "an arm winds more than half a turn");
    assert.ok(Math.abs(armAngle(1, 1) - armAngle(1, 0)) > 1, "neighbouring arms start apart");
  });

  it("survives degenerate counts", () => {
    const single = galaxyPoint(0, 1);
    assert.ok(Number.isFinite(single.x) && Number.isFinite(single.y) && Number.isFinite(single.z));
    assert.ok(Math.hypot(single.x, single.z) < 1);
  });
});

describe("galaxyStars", () => {
  it("fills the disk with the requested stars, deterministically", () => {
    const stars = galaxyStars(600, 4);
    assert.equal(stars.length, 600);
    assert.deepEqual(galaxyStars(600, 4), stars);
    assert.notDeepEqual(galaxyStars(600, 5), stars);
    for (const star of stars) {
      assert.ok(Math.hypot(star.x, star.y) <= 1, "inside the disk");
      assert.ok(star.r > 0 && star.r < 1.4);
      assert.ok(star.o > 0 && star.o <= 1);
    }
  });

  it("puts a bright bulge in the middle and dust out along the arms", () => {
    const stars = galaxyStars(800, 2);
    const inner = stars.filter((star) => Math.hypot(star.x, star.y) < CORE_RADIUS);
    const outer = stars.filter((star) => Math.hypot(star.x, star.y) > CORE_RADIUS * 2);
    assert.ok(inner.length > stars.length * 0.2, "a real bulge, not a dot");
    assert.ok(outer.length > stars.length * 0.4, "and most of the disk still outside it");
    const mean = (list: typeof stars) => list.reduce((sum, star) => sum + star.o, 0) / Math.max(1, list.length);
    assert.ok(mean(inner) > mean(outer), "the core is the bright part");
  });
});
