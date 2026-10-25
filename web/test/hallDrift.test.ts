import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HALL_DRIFT, hallOffset } from "../src/hallDrift.ts";

describe("hallOffset", () => {
  it("leaves the hall centred when the pointer is", () => {
    assert.deepEqual(hallOffset(0, 0), { x: 0, y: 0 });
  });

  it("moves the hall against the sphere's near face", () => {
    // A positive yaw turns the sphere's near face toward −x, and a positive
    // pitch lifts it toward −y; the hall slides with the pointer, so the two
    // layers move in opposition. That difference is what reads as depth.
    assert.ok(hallOffset(1, 0).x > 0);
    assert.ok(hallOffset(0, 1).y > 0);
    assert.ok(hallOffset(-1, 0).x < 0);
    assert.ok(hallOffset(0, -1).y < 0);
  });

  it("reaches the declared travel at full deflection and no further", () => {
    assert.deepEqual(hallOffset(1, 1), { x: HALL_DRIFT.x, y: HALL_DRIFT.y });
    assert.deepEqual(hallOffset(-1, -1), { x: -HALL_DRIFT.x, y: -HALL_DRIFT.y });
    assert.deepEqual(hallOffset(4, -9), { x: HALL_DRIFT.x, y: -HALL_DRIFT.y });
  });

  it("is proportional between the centre and the edge", () => {
    const half = hallOffset(0.5, -0.5);
    assert.equal(half.x, HALL_DRIFT.x / 2);
    assert.equal(half.y, -HALL_DRIFT.y / 2);
  });

  it("accepts a smaller travel without changing its direction", () => {
    assert.deepEqual(hallOffset(1, 1, { x: 4, y: 2 }), { x: 4, y: 2 });
  });

  it("stays inside the layer's bleed, so no edge can show", () => {
    // styles.css insets .cloud-void by 20px on every side. The travel has to
    // stay under that or a translated edge would uncover the frame.
    assert.ok(HALL_DRIFT.x <= 20);
    assert.ok(HALL_DRIFT.y <= 20);
  });
});
