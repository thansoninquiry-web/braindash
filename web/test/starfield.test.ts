import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { starfield } from "../src/starfield.js";

describe("starfield", () => {
  it("returns the number of stars asked for, all inside the box", () => {
    const stars = starfield(240, 1600, 1000, 7);
    assert.equal(stars.length, 240);
    for (const star of stars) {
      assert.ok(star.x >= 0 && star.x < 1600);
      assert.ok(star.y >= 0 && star.y < 1000);
      assert.ok(star.r > 0 && star.r < 2);
      assert.ok(star.o > 0 && star.o <= 1);
    }
  });

  it("is stable for a seed and different for another", () => {
    assert.deepEqual(starfield(40, 800, 600, 3), starfield(40, 800, 600, 3));
    assert.notDeepEqual(starfield(40, 800, 600, 3), starfield(40, 800, 600, 4));
  });

  it("keeps most of the sky calm and a minority bright", () => {
    const stars = starfield(400, 1000, 1000, 11);
    const twinkling = stars.filter((star) => star.twinkle).length;
    const bright = stars.filter((star) => star.r > 0.75).length;
    assert.ok(twinkling > 0, "some stars breathe");
    assert.ok(twinkling < stars.length / 2, "most do not");
    assert.ok(bright > 0, "there are bright stars");
    assert.ok(bright < stars.length / 3, "and they are the minority");
    assert.ok(stars.filter((star) => star.o < 0.6).length > stars.length / 2, "the dust is dim");
  });

  it("handles an empty sky", () => {
    assert.deepEqual(starfield(0, 100, 100), []);
  });
});
