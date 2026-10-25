import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  judgeFrameSample,
  sampleFrames,
  type RawFrameSample,
} from "../../scripts/frameBudget.mjs";

/** Four seconds at 60 fps, with 10 ms of animation work and 16.7 ms total. */
function raw(overrides: Partial<RawFrameSample> = {}): RawFrameSample {
  return {
    taskMs: 4_000,
    layoutMs: 400,
    styleMs: 1_200,
    scriptMs: 800,
    frames: 240,
    elapsedMs: 4_000,
    ...overrides,
  };
}

describe("frameBudget — sampling Chrome's counters", () => {
  it("turns cumulative milliseconds into per-frame costs", () => {
    const sample = sampleFrames(raw());
    assert.equal(sample.frames, 240);
    assert.equal(sample.seconds, 4);
    assert.equal(sample.fps, 60);
    assert.equal(sample.scriptMsPerFrame, 800 / 240);
    assert.equal(sample.styleMsPerFrame, 1_200 / 240);
    assert.equal(sample.layoutMsPerFrame, 400 / 240);
    assert.equal(sample.animationMsPerFrame, 2_400 / 240);
    assert.equal(sample.taskMsPerFrame, 4_000 / 240);
  });

  it("reports infinity rather than NaN when no frame was painted", () => {
    const sample = sampleFrames(raw({ frames: 0, elapsedMs: 0 }));
    assert.equal(sample.fps, 0);
    assert.equal(sample.animationMsPerFrame, Number.POSITIVE_INFINITY);
    assert.equal(sample.taskMsPerFrame, Number.POSITIVE_INFINITY);
    assert.ok(Number.isFinite(sample.scriptMsPerFrame) === false);
  });

  it("clamps a negative frame or time delta", () => {
    const sample = sampleFrames(raw({ frames: -10, elapsedMs: -5 }));
    assert.equal(sample.frames, 0);
    assert.equal(sample.seconds, 0);
    assert.equal(sample.fps, 0);
  });
});

describe("frameBudget — the budget verdict", () => {
  const limits = { budgetMs: 10, minFps: 20 };

  it("passes a sample inside the budget and above the liveness floor", () => {
    const verdict = judgeFrameSample(sampleFrames(raw()), limits);
    assert.deepEqual(verdict, { ok: true, reasons: [] });
  });

  it("allows a sample exactly on the budget", () => {
    const sample = sampleFrames(raw({ scriptMs: 1_000, styleMs: 1_000, layoutMs: 400 }));
    assert.equal(sample.animationMsPerFrame, 10);
    assert.equal(judgeFrameSample(sample, limits).ok, true);
  });

  it("fails when animation work goes over the budget", () => {
    const sample = sampleFrames(raw({ scriptMs: 1_000, styleMs: 1_200, layoutMs: 400 }));
    const verdict = judgeFrameSample(sample, limits);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons.join("\n"), /animation work was 10\.83 ms\/frame/);
    assert.match(verdict.reasons.join("\n"), /over the 10\.0 ms budget/);
  });

  it("fails when the core paints below the liveness floor", () => {
    const sample = sampleFrames(raw({ frames: 60 }));
    const verdict = judgeFrameSample(sample, limits);
    assert.equal(sample.fps, 15);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons.join("\n"), /15\.0 fps, below the 20 fps liveness floor/);
  });

  it("refuses a sample too short to say anything about the loop", () => {
    const sample = sampleFrames(raw({ frames: 29 }));
    const verdict = judgeFrameSample(sample, limits);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons.join("\n"), /only 29 animation frames/);
    assert.equal(verdict.reasons.length, 1, "no rate or budget claim from a short sample");
  });

  it("accepts a custom minimum frame count", () => {
    const sample = sampleFrames(
      raw({ frames: 10, elapsedMs: 400, scriptMs: 40, styleMs: 40, layoutMs: 20 }),
    );
    assert.equal(sample.fps, 25);
    assert.equal(sample.animationMsPerFrame, 10);
    assert.equal(judgeFrameSample(sample, { ...limits, minFrames: 10 }).ok, true);
  });

  it("judges only the loop's work, not software rasterisation", () => {
    // The headless runner has no GPU, so TaskDuration can be dominated by
    // paint. That is reported but is not the budget's subject.
    const sample = sampleFrames(raw({ taskMs: 12_000 }));
    assert.ok(sample.taskMsPerFrame > 40);
    assert.equal(judgeFrameSample(sample, limits).ok, true);
  });
});
