/**
 * The arithmetic behind the animated-core performance gate.
 *
 * Kept apart from the Chrome plumbing so the budget rule is testable without a
 * browser: one sample is the delta of Chrome's own performance counters over a
 * fixed window, plus the number of animation frames painted in it.
 *
 * The budget applies to the cost the draw loop owns — script, style recalc and
 * layout — not to rasterisation. A headless CI browser has no GPU, so painting
 * 160 note gradients and several hundred links is an order of magnitude more
 * expensive there than on the machine the dashboard is actually used on. What
 * this check can compare across runs is the animation's own main-thread work:
 * at 60 Hz it has 16.7 ms per frame, and the budget leaves the rest for paint
 * and compositing.
 */

/**
 * @param {{
 *   taskMs: number,
 *   layoutMs: number,
 *   styleMs: number,
 *   scriptMs: number,
 *   frames: number,
 *   elapsedMs: number,
 * }} raw
 */
export function sampleFrames(raw) {
  const frames = Math.max(0, raw.frames);
  const elapsedMs = Math.max(0, raw.elapsedMs);
  const seconds = elapsedMs / 1000;
  const perFrame = (value) => (frames > 0 ? value / frames : Number.POSITIVE_INFINITY);
  return {
    frames,
    seconds,
    fps: seconds > 0 ? frames / seconds : 0,
    taskMsPerFrame: perFrame(raw.taskMs),
    animationMsPerFrame: perFrame(raw.scriptMs + raw.styleMs + raw.layoutMs),
    layoutMsPerFrame: perFrame(raw.layoutMs),
    styleMsPerFrame: perFrame(raw.styleMs),
    scriptMsPerFrame: perFrame(raw.scriptMs),
  };
}

/**
 * A frame budget is a ceiling on animation milliseconds per painted frame. The
 * frame-rate floor is a liveness check, not a second budget: in a headless
 * software renderer the presentation rate reflects the runner's rasteriser more
 * than the draw loop, but a sample with almost no frames means the animation
 * stopped rather than got faster.
 *
 * @param {ReturnType<typeof sampleFrames>} sample
 * @param {{ budgetMs: number, minFps: number, minFrames?: number }} limits
 */
export function judgeFrameSample(sample, limits) {
  const minFrames = limits.minFrames ?? 30;
  /** @type {string[]} */
  const reasons = [];
  if (sample.frames < minFrames) {
    reasons.push(
      `only ${sample.frames} animation frames were painted in ${sample.seconds.toFixed(2)} s ` +
        `(need at least ${minFrames}); the core may not have been animating`,
    );
    return { ok: false, reasons };
  }
  if (sample.fps < limits.minFps) {
    reasons.push(
      `the core painted ${sample.fps.toFixed(1)} fps, below the ${limits.minFps} fps liveness floor`,
    );
  }
  if (sample.animationMsPerFrame > limits.budgetMs) {
    reasons.push(
      `animation work was ${sample.animationMsPerFrame.toFixed(2)} ms/frame, ` +
        `over the ${limits.budgetMs.toFixed(1)} ms budget`,
    );
  }
  return { ok: reasons.length === 0, reasons };
}
