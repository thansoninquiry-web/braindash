import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISK_TILT_FLOOR,
  GRAPH_PULSE_PERIOD,
  LANDING_HOLD_SECONDS,
  PITCH_LIMIT,
  SPARK_LAYER,
  advanceAmbient,
  clampPitch,
  facingAngles,
  focusNudge,
  focusPitch,
  graphPulse,
  nearestPose,
  pulseFrame,
  settleStep,
  shortestAngle,
  sparkPose,
  waveFrame,
} from "../src/cloudMotion.ts";

function approx(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);
}

/** The projection the cloud uses, so the facing maths is checked the same way. */
function project(
  point: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
): { rx: number; ry: number; depth: number } {
  const rx = point.x * Math.cos(yaw) - point.z * Math.sin(yaw);
  const rz = point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
  const ry = point.y * Math.cos(pitch) - rz * Math.sin(pitch);
  const depth = point.y * Math.sin(pitch) + rz * Math.cos(pitch);
  return { rx, ry, depth };
}

describe("shortestAngle", () => {
  it("is zero when the angles already match", () => {
    assert.equal(shortestAngle(0.8, 0.8), 0);
  });

  it("takes the short way round instead of the long one", () => {
    approx(shortestAngle(0, Math.PI / 4), Math.PI / 4, "quarter turn forward");
    approx(shortestAngle(Math.PI / 4, 0), -Math.PI / 4, "quarter turn back");
    // 3.0 → -3.0 is +0.28 rad across the seam, not -6.0 the other way.
    approx(shortestAngle(3, -3), Math.PI * 2 - 6, "short way across the seam");
  });

  it("treats a full turn as no movement", () => {
    approx(shortestAngle(0, Math.PI * 2), 0, "one turn");
    approx(shortestAngle(1, 1 + Math.PI * 4), 0, "two turns");
  });

  it("always answers within half a turn", () => {
    for (const from of [-10, -1, 0, 0.5, 3.14]) {
      for (const to of [-4, -0.2, 0, 2.9, 9]) {
        const delta = shortestAngle(from, to);
        assert.ok(delta > -Math.PI - 1e-9 && delta <= Math.PI + 1e-9, `${from} → ${to}: ${delta}`);
      }
    }
  });
});

describe("facingAngles / focusNudge", () => {
  it("brings a point to the centre of the ball, nearest the camera", () => {
    const points = [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0.5, z: 0.5 },
      { x: -0.4, y: 0.3, z: -0.2 },
    ];
    for (const point of points) {
      const { yaw, pitch } = facingAngles(point.x, point.y, point.z);
      const projected = project(point, yaw, pitch);
      const length = Math.hypot(point.x, point.y, point.z);
      assert.ok(Math.abs(projected.rx) < 1e-9, `x centred for ${JSON.stringify(point)}`);
      assert.ok(Math.abs(projected.ry) < 1e-9, `y centred for ${JSON.stringify(point)}`);
      // Depth equals the point's length: on the camera side, fully front-on.
      approx(projected.depth, length, "faces the camera");
    }
  });

  it("nudges by the current offset when the camera already faces part-way there", () => {
    const target = facingAngles(0, 0, 1).yaw;
    const nudge = focusNudge({ x: 0, y: 0, z: 1 }, target + 0.5, 0);
    approx(nudge.dYaw, -0.5, "undoes the offset");
    approx(nudge.dPitch, 0, "no pitch change on the equator");
  });

  it("keeps a disk tilted when facing a note on its plane", () => {
    // Every note sits near y = 0, so a literal face-on pose would be edge-on.
    assert.equal(focusPitch(0.7, 0, 0.7), DISK_TILT_FLOOR);
    assert.equal(focusPitch(0, 0, 1), DISK_TILT_FLOOR);
    // A note off the plane is followed, but never past the tilt limit.
    approx(focusPitch(0, 0.8, 0.6), Math.atan2(0.8, 0.6), "follows a high note");
    assert.equal(focusPitch(0, 1, 0), PITCH_LIMIT);
  });

  it("never asks for a pitch past the tilt limit", () => {
    const nudge = focusNudge({ x: 0, y: 1, z: 0 }, 0, 0);
    assert.equal(nudge.dPitch, PITCH_LIMIT);
    assert.ok(clampPitch(nudge.dPitch) <= PITCH_LIMIT);
  });

  it("applies the nudge to land exactly on the facing pose", () => {
    const point = { x: 0.3, y: -0.6, z: 0.74 };
    const current = { yaw: 1.1, pitch: -0.4 };
    const nudge = focusNudge(point, current.yaw, current.pitch);
    const projected = project(
      point,
      current.yaw + nudge.dYaw,
      clampPitch(current.pitch + nudge.dPitch),
    );
    assert.ok(Math.abs(projected.rx) < 1e-9, "x centred after the nudge");
    assert.ok(Math.abs(projected.ry) < 1e-9, "y centred after the nudge");
  });
});

describe("sparkPose", () => {
  it("takes the same fraction of the yaw, so the drift and drag lag the notes", () => {
    const note = { yaw: 2, pitch: 0.5 };
    approx(sparkPose(note, 0.22).yaw, 2 * SPARK_LAYER, "yaw share");
    approx(sparkPose({ yaw: -1.5, pitch: 0.22 }, 0.22).yaw, -1.5 * SPARK_LAYER, "negative share");
  });

  it("keeps the shared horizon while scaling the pitch's movement", () => {
    const base = 0.22;
    const still = sparkPose({ yaw: 0, pitch: base }, base);
    approx(still.pitch, base, "no tilt when the notes are at rest");
    const tilted = sparkPose({ yaw: 0, pitch: base + 0.28 }, base);
    approx(tilted.pitch, base + 0.28 * SPARK_LAYER, "a shallower tilt");
  });

  it("honours an explicit layer, including one that leaves the sparks still", () => {
    const note = { yaw: 3, pitch: 0.5 };
    approx(sparkPose(note, 0.2, 0.5).yaw, 1.5, "half the yaw");
    approx(sparkPose(note, 0.2, 0.5).pitch, 0.35, "half the tilt above the base");
    assert.deepEqual(sparkPose(note, 0.2, 0), { yaw: 0, pitch: 0.2 });
  });
});

describe("nearestPose", () => {
  /** Front, back and right notes on the equator. */
  const cloud = [
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
    { x: 1, y: 0, z: 0 },
  ];

  it("picks the note closest to the current pose", () => {
    const found = nearestPose(cloud, 0.2, 0.1);
    assert.equal(found?.index, 0);
    approx(found?.yaw ?? NaN, 0, "yaw of the front note");
    approx(found?.pitch ?? NaN, 0, "pitch of the front note");
  });

  it("takes the short way round the seam", () => {
    // Just below -π, the far note is a sliver away, not a full turn.
    const found = nearestPose(cloud, -3.13, 0);
    assert.equal(found?.index, 1);
    approx(Math.abs(found?.yaw ?? NaN), Math.PI, "faces the far note");
    assert.ok(found !== null && found.distance < 0.02, "a sliver, not 6.2 rad");
  });

  it("counts pitch in the distance", () => {
    const tilted = [
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0.5, z: 0.866 },
    ];
    assert.equal(nearestPose(tilted, 0, 0)?.index, 0);
    // Already tilted toward the second note, which is only a few degrees away.
    assert.equal(nearestPose(tilted, 0, 0.45)?.index, 1);
  });

  it("only falls back to a note no allowed pitch can centre", () => {
    const pole = [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
    // A note that can be centred always wins.
    assert.equal(nearestPose(pole, 0, 0)?.index, 1);
    // A two-note vault sits on the poles, so the pose still faces one, parked
    // on the tilt limit rather than asking for a flipped view.
    const onlyPole = nearestPose([{ x: 0, y: 1, z: 0 }], 0, 0);
    assert.equal(onlyPole?.index, 0);
    approx(onlyPole?.pitch ?? NaN, PITCH_LIMIT, "parked on the clamp");
  });

  it("is null for an empty cloud and breaks ties by index", () => {
    assert.equal(nearestPose([], 0, 0), null);
    assert.equal(nearestPose([{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }], 0, 0)?.index, 0);
  });
});

describe("settleStep", () => {
  it("closes the gap from rest and reports done", () => {
    let remaining = 0.6;
    let closing = 0;
    let done = false;
    for (let frame = 0; frame < 240 && !done; frame += 1) {
      const step = settleStep(remaining, closing, 1 / 60);
      remaining = step.remaining;
      closing = step.closing;
      done = step.done;
    }
    assert.equal(done, true);
    assert.ok(Math.abs(remaining) < 0.002, `remaining ${remaining}`);
  });

  it("never overshoots when released at rest", () => {
    let remaining = 0.5;
    let closing = 0;
    for (let frame = 0; frame < 240; frame += 1) {
      const step = settleStep(remaining, closing, 1 / 60);
      remaining = step.remaining;
      closing = step.closing;
      assert.ok(remaining >= -1e-9, `frame ${frame}: ${remaining}`);
    }
  });

  it("lets an inherited flick carry past the target, then return", () => {
    let remaining = 0.05;
    let closing = 3;
    let lowest = remaining;
    for (let frame = 0; frame < 240; frame += 1) {
      const step = settleStep(remaining, closing, 1 / 60);
      remaining = step.remaining;
      closing = step.closing;
      lowest = Math.min(lowest, remaining);
    }
    assert.ok(lowest < 0, "the flick passes the target");
    assert.ok(lowest > -0.02, `the overshoot stays small: ${lowest}`);
    assert.ok(Math.abs(remaining) < 0.002, "and comes back");
  });

  it("does nothing without time passing and stops when already there", () => {
    assert.deepEqual(settleStep(0.5, 1, 0), { remaining: 0.5, closing: 1, done: false });
    assert.equal(settleStep(0, 0, 1 / 60).done, true);
  });
});

describe("advanceAmbient", () => {
  it("passes the raw clock through when nothing is held", () => {
    const clock = { offset: 1.25, hold: 0 };
    const step = advanceAmbient(clock, 4, 1 / 60);
    approx(step.seconds, 2.75, "raw time minus withheld time");
    assert.deepEqual(step.clock, clock, "an idle clock is unchanged");
  });

  it("freezes the drawn time while the hold runs", () => {
    let clock = { offset: 0, hold: LANDING_HOLD_SECONDS };
    let raw = 4;
    let seconds = 4;
    for (let frame = 0; frame < 30; frame += 1) {
      raw += 1 / 60;
      const step = advanceAmbient(clock, raw, 1 / 60);
      clock = step.clock;
      seconds = step.seconds;
    }
    approx(seconds, 4, "the pose stays where the settle left it");
    assert.ok(clock.hold > 0, "half the beat is still to run");
  });

  it("resumes from the held pose instead of jumping by the beat", () => {
    let clock = { offset: 0, hold: 0.2 };
    let raw = 8;
    let held = 8;
    for (let frame = 0; frame < 12; frame += 1) {
      raw += 1 / 60;
      const step = advanceAmbient(clock, raw, 1 / 60);
      clock = step.clock;
      held = step.seconds;
    }
    raw += 1 / 60;
    const resumed = advanceAmbient(clock, raw, 1 / 60);
    approx(held, 8, "held at the landing");
    approx(resumed.seconds, 8 + 1 / 60, "the next frame moves one frame, not 0.2 s");
  });

  it("withholds only the hold from a long frame", () => {
    const step = advanceAmbient({ offset: 0, hold: 0.2 }, 5, 1);
    approx(step.seconds, 4.8, "the delivered part of the frame still passes");
    assert.equal(step.clock.hold, 0, "the hold is spent");
    assert.equal(step.clock.offset, 0.2);
  });
});

describe("pulseFrame", () => {
  it("starts wide open and fades as it expands", () => {
    const start = pulseFrame(0);
    const middle = pulseFrame(0.9);
    assert.ok(Math.abs(start.radius - 0.94) < 1e-9);
    assert.ok(Math.abs(start.opacity - 0.42) < 1e-9);
    assert.ok(middle.radius > start.radius);
    assert.ok(middle.opacity < start.opacity);
  });

  it("repeats every period and handles elapsed time before zero", () => {
    const first = pulseFrame(0.35);
    const later = pulseFrame(0.35 + 1.8);
    assert.ok(Math.abs(first.radius - later.radius) < 1e-9);
    assert.ok(Math.abs(first.opacity - later.opacity) < 1e-9);
    const negative = pulseFrame(-1.8 + 0.35);
    assert.ok(Math.abs(first.radius - negative.radius) < 1e-9);
  });

  it("stays inside the sphere and never goes negative in opacity", () => {
    for (let elapsed = 0; elapsed < 4; elapsed += 0.05) {
      const frame = pulseFrame(elapsed);
      assert.ok(frame.radius >= 0.94 && frame.radius <= 1.3, `radius at ${elapsed}`);
      assert.ok(frame.opacity >= 0 && frame.opacity <= 0.42, `opacity at ${elapsed}`);
    }
  });
});

describe("waveFrame", () => {
  it("starts near the bulge and reaches the rim as it fades", () => {
    const start = waveFrame(0);
    const middle = waveFrame(GRAPH_PULSE_PERIOD / 2);
    const end = waveFrame(GRAPH_PULSE_PERIOD - 1e-9);
    assert.ok(Math.abs(start.radius - 0.06) < 1e-9);
    assert.ok(start.opacity > middle.opacity && middle.opacity > 0);
    assert.ok(end.radius > 1 && end.opacity < 1e-6, "the wave leaves the disk at the period");
  });

  it("repeats every period and survives elapsed time before zero", () => {
    const first = waveFrame(0.8);
    const later = waveFrame(0.8 + GRAPH_PULSE_PERIOD);
    assert.ok(Math.abs(first.radius - later.radius) < 1e-9);
    assert.ok(Math.abs(first.opacity - later.opacity) < 1e-9);
    const negative = waveFrame(-GRAPH_PULSE_PERIOD + 0.8);
    assert.ok(Math.abs(first.radius - negative.radius) < 1e-9);
  });

  it("never crosses the rim before the next cycle and never goes negative", () => {
    for (let elapsed = 0; elapsed < GRAPH_PULSE_PERIOD; elapsed += 0.05) {
      const frame = waveFrame(elapsed);
      assert.ok(frame.radius >= 0.06 && frame.radius <= 1.04, `radius at ${elapsed}`);
      assert.ok(frame.opacity >= 0 && frame.opacity <= 0.4, `opacity at ${elapsed}`);
    }
  });

  it("is invisible for a period that cannot run", () => {
    assert.deepEqual(waveFrame(2, 0), { radius: 0.06, opacity: 0 });
    assert.deepEqual(waveFrame(2, -1), { radius: 0.06, opacity: 0 });
  });
});

describe("graphPulse", () => {
  it("stays between a small trough and a moderate crest for every note", () => {
    for (const phase of [0, 0.7, 2.4, 5.9]) {
      for (const radius of [0, 0.35, 1]) {
        for (let elapsed = 0; elapsed < GRAPH_PULSE_PERIOD * 2; elapsed += 0.02) {
          const beat = graphPulse(elapsed, phase, radius);
          assert.ok(beat >= -0.1201, `trough at ${elapsed}/${phase}/${radius}: ${beat}`);
          assert.ok(beat <= 0.7201, `crest at ${elapsed}/${phase}/${radius}: ${beat}`);
        }
      }
    }
  });

  it("is deterministic for the same time, phase and radius", () => {
    assert.equal(graphPulse(3.25, 1.1, 0.4), graphPulse(3.25, 1.1, 0.4));
  });

  it("sends the crest outward: a rim note pulses later than a core note", () => {
    const crestAt = (radius: number): number => {
      let bestTime = 0;
      let best = Number.NEGATIVE_INFINITY;
      for (let elapsed = 0; elapsed < GRAPH_PULSE_PERIOD * 2; elapsed += 0.005) {
        const beat = graphPulse(elapsed, 0, radius);
        if (beat > best) {
          best = beat;
          bestTime = elapsed;
        }
      }
      return bestTime;
    };
    const core = crestAt(0);
    const rim = crestAt(1);
    assert.ok(rim > core, `the crest reaches the rim (${rim}) after the core (${core})`);
    // 2.4 rad at one revolution per period: about 1.8 s here. The delay must
    // stay under a full turn, or the rim would crest before the core.
    assert.ok(rim - core > 1.2 && rim - core < 2.4, `expected a visible inward-out delay, got ${rim - core}`);
  });

  it("gives different notes their own phase at one instant", () => {
    const beats = new Set([0, 1.3, 2.9, 4.4].map((phase) => graphPulse(1.7, phase, 0.5).toFixed(4)));
    assert.ok(beats.size >= 3, `phases collapsed to ${[...beats].join(", ")}`);
  });

  it("is still when the period is not a positive number", () => {
    assert.equal(graphPulse(2, 0.3, 0.5, 0), 0);
    assert.equal(graphPulse(2, 0.3, 0.5, -1), 0);
  });
});
