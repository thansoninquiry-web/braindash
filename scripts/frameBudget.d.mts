/** Types for `frameBudget.mjs`, the animated-core performance gate. */

export interface RawFrameSample {
  taskMs: number;
  layoutMs: number;
  styleMs: number;
  scriptMs: number;
  frames: number;
  elapsedMs: number;
}

export interface FrameSample {
  frames: number;
  seconds: number;
  fps: number;
  taskMsPerFrame: number;
  animationMsPerFrame: number;
  layoutMsPerFrame: number;
  styleMsPerFrame: number;
  scriptMsPerFrame: number;
}

export interface FrameLimits {
  budgetMs: number;
  minFps: number;
  minFrames?: number;
}

export interface FrameVerdict {
  ok: boolean;
  reasons: string[];
}

export function sampleFrames(raw: RawFrameSample): FrameSample;
export function judgeFrameSample(sample: FrameSample, limits: FrameLimits): FrameVerdict;
