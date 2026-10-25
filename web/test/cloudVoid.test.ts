import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cloudVoid } from "../src/cloudVoid.js";

const hall = cloudVoid();
const cx = hall.width / 2;

/** Signed distance of `point` from the line through `a` and `b`, scaled by |b-a|. */
function cross(a: { x: number; y: number }, b: { x: number; y: number }, point: { x: number; y: number }) {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

describe("cloudVoid", () => {
  it("sets a horizon and a vanishing point on the centre line", () => {
    assert.equal(hall.vp.x, cx);
    assert.ok(hall.vp.y > 0 && hall.vp.y < hall.height);
  });

  it("mirrors every ray about the centre line, so the hall is symmetrical", () => {
    const near = hall.ceilingRays.map((ray) => ray.x1);
    for (const x of near) {
      assert.ok(
        near.some((other) => Math.abs(other - (2 * cx - x)) < 1e-9),
        `${x} has a mirror`,
      );
    }
  });

  it("aims every ray at the vanishing point and stops it at the far opening", () => {
    for (const [rays, edge] of [
      [hall.ceilingRays, hall.mouth.y],
      [hall.floorRays, hall.mouth.y + hall.mouth.h],
    ] as const) {
      for (const ray of rays) {
        const near = { x: ray.x1, y: ray.y1 };
        const far = { x: ray.x2, y: ray.y2 };
        assert.ok(Math.abs(cross(near, hall.vp, far)) < 1e-6, "on the ray toward the vp");
        assert.ok(far.x > hall.mouth.x - 1e-9 && far.x < hall.mouth.x + hall.mouth.w + 1e-9);
        assert.ok(Math.abs(far.y - edge) < 1e-9, "ends on the mouth's edge");
      }
    }
  });

  it("crowds the cross seams toward the horizon instead of spacing them evenly", () => {
    const ceiling = hall.ceilingSeams.map((seam) => seam.y1);
    for (let index = 0; index < ceiling.length; index += 1) {
      assert.ok(ceiling[index] < hall.vp.y, "every ceiling seam is above the horizon");
      if (index > 0) {
        assert.ok(ceiling[index] > ceiling[index - 1], "the seams march toward the horizon");
        assert.ok(
          ceiling[index] - ceiling[index - 1] < ceiling[index - 1] - (ceiling[index - 2] ?? 0),
          "and bunch up as they go",
        );
      }
    }

    const floor = hall.floorSeams.map((seam) => seam.y1);
    for (let index = 0; index < floor.length; index += 1) {
      assert.ok(floor[index] > hall.vp.y, "every floor seam is below the horizon");
      if (index > 0) {
        assert.ok(floor[index] < floor[index - 1], "the seams march toward the horizon");
        assert.ok(floor[index - 1] - floor[index] < (floor[index - 2] ?? hall.height) - floor[index - 1]);
      }
    }
  });

  it("shrinks each seam as it recedes", () => {
    const widths = hall.ceilingSeams.map((seam) => seam.x2 - seam.x1);
    for (let index = 1; index < widths.length; index += 1) {
      assert.ok(widths[index] < widths[index - 1]);
    }
  });

  it("keeps the opening inside the frame and straddling the horizon", () => {
    const { mouth } = hall;
    assert.ok(mouth.x > 0 && mouth.x + mouth.w < hall.width);
    assert.ok(mouth.y > 0 && mouth.y + mouth.h < hall.height);
    assert.ok(mouth.y < hall.vp.y && mouth.y + mouth.h > hall.vp.y);
  });

  it("hangs the wall seams between the two cross planes", () => {
    assert.equal(hall.wallSeams.length, 3 * 2);
    for (const seam of hall.wallSeams) {
      assert.equal(seam.x1, seam.x2, "wall seams stay upright");
      assert.ok(seam.y1 < hall.vp.y && seam.y2 > hall.vp.y);
    }
  });

  it("puts the ceiling lights in front of the opening", () => {
    assert.ok(hall.lights.length > 0);
    for (const plate of hall.lights) {
      assert.equal(plate.points.length, 4);
      for (const point of plate.points) {
        assert.ok(point.y < hall.vp.y, "under the roof");
        assert.ok(point.x > 0 && point.x < hall.width);
      }
    }
  });

  it("re-derives the whole hall for another viewport", () => {
    const narrow = cloudVoid({ width: 600, height: 700, columns: 2, seams: 3, wallSeams: 1 });
    assert.equal(narrow.ceilingRays.length, 4);
    assert.equal(narrow.ceilingSeams.length, 3);
    assert.equal(narrow.floorSeams.length, 3);
    assert.equal(narrow.wallSeams.length, 2);
    assert.equal(narrow.vp.x, 300);
    assert.ok(narrow.mouth.y > 0 && narrow.mouth.y + narrow.mouth.h < 700);
  });
});
