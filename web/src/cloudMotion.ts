/**
 * Rotation, momentum and pulse maths for the vault core. Kept out of the SVG
 * component so the geometry is testable without a DOM: the component owns refs,
 * React state and attribute writes; this module owns the numbers.
 */

/** Pitch is clamped so the sphere never flips upside down under the pointer. */
export const PITCH_LIMIT = 1.15;

export const clampPitch = (value: number): number =>
  Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, value));

const TAU = Math.PI * 2;

/** Shortest signed way round the circle, in (-π, π]. */
export function shortestAngle(from: number, to: number): number {
  const delta = ((((to - from + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return delta === -Math.PI ? Math.PI : delta;
}

/**
 * Total rotation (yaw about Y, pitch about X) that puts a unit-sphere direction
 * face-on: the node lands at the centre of the ball, nearest the camera.
 */
export function facingAngles(x: number, y: number, z: number): { yaw: number; pitch: number } {
  return { yaw: Math.atan2(x, z), pitch: Math.atan2(y, Math.hypot(x, z)) };
}

/**
 * How far to add to the current yaw/pitch to bring a node face-on. Yaw takes the
 * short way round; pitch is clamped so the nudge cannot break the tilt limit.
 */
export function focusNudge(
  point: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
): { dYaw: number; dPitch: number } {
  const target = facingAngles(point.x, point.y, point.z);
  return {
    dYaw: shortestAngle(yaw, target.yaw),
    dPitch: clampPitch(target.pitch) - pitch,
  };
}

/**
 * How much tilt a note-facing pose must keep. The notes sit on a thin disk, so
 * facing one literally would mean looking along its plane and flattening the
 * whole galaxy into a line; this keeps the arms readable while the yaw still
 * turns the chosen note to the front.
 */
export const DISK_TILT_FLOOR = 0.55;

/** Pitch that brings a note as close to face-on as the disk allows. */
export function focusPitch(x: number, y: number, z: number): number {
  const facing = Math.atan2(y, Math.hypot(x, z));
  return Math.min(PITCH_LIMIT, Math.max(DISK_TILT_FLOOR, facing));
}

/** The spark layer's share of the notes' rotation. Lower reads as farther away. */
export const SPARK_LAYER = 0.35;

/**
 * Pose for the decorative layer behind the notes. The base tilt is shared, so
 * both layers sit on the same horizon, while yaw — the idle drift, the pointer
 * parallax and a released drag alike — and the varying part of the pitch are
 * scaled down. A smaller share is the depth cue: the sparks slide more slowly
 * and lag the notes when the pointer or the sphere moves.
 */
export function sparkPose(
  note: { yaw: number; pitch: number },
  basePitch: number,
  layer = SPARK_LAYER,
): { yaw: number; pitch: number } {
  return {
    yaw: note.yaw * layer,
    pitch: basePitch + (note.pitch - basePitch) * layer,
  };
}

/** A unit-sphere direction, the same shape the cloud projects. */
export interface CloudPoint {
  x: number;
  y: number;
  z: number;
}

export interface NotablePose {
  /** Index of the note that ends up face-on. */
  index: number;
  yaw: number;
  /** Inside the tilt limit, so the spring never asks for a flipped view. */
  pitch: number;
  /** Combined yaw and pitch turn, in radians; smaller is nearer. */
  distance: number;
}

/**
 * The nearest orientation that puts a note face-on. This is what a released
 * drag settles onto, so the cloud never comes to rest at an arbitrary angle.
 *
 * A note past the tilt limit cannot be centred by any allowed pitch, so those
 * only become candidates when nothing else exists (a two-note vault puts both
 * notes on the poles): then the pose still faces the nearest one, with the
 * pitch parked on the clamp instead of asking for a flipped view. Ties go to
 * the lower index, which keeps the resting pose deterministic.
 */
export function nearestPose(
  points: readonly CloudPoint[],
  yaw: number,
  pitch: number,
): NotablePose | null {
  let best: NotablePose | null = null;
  let clamped: NotablePose | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    const facing = facingAngles(point.x, point.y, point.z);
    const candidate: NotablePose = {
      index,
      yaw: facing.yaw,
      pitch: clampPitch(facing.pitch),
      distance: Math.hypot(shortestAngle(yaw, facing.yaw), clampPitch(facing.pitch) - pitch),
    };
    if (Math.abs(facing.pitch) <= PITCH_LIMIT) {
      if (best === null || candidate.distance < best.distance) best = candidate;
    } else if (clamped === null || candidate.distance < clamped.distance) {
      clamped = candidate;
    }
  }
  return best ?? clamped;
}

/** Natural frequency of the release settle: higher arrives sooner. */
export const SETTLE_FREQUENCY = 16;

/**
 * One step of a critically damped spring, written as the error still to close
 * and the speed it is closing at — the pair a released drag hands over.
 *
 * Critical damping means the pose arrives without oscillating at rest, while an
 * inherited flick can still swing a little past the target before returning.
 */
export function settleStep(
  remaining: number,
  closing: number,
  dt: number,
  frequency = SETTLE_FREQUENCY,
): { remaining: number; closing: number; done: boolean } {
  if (!(dt > 0)) return { remaining, closing, done: false };
  const accel = frequency * frequency * remaining - 2 * frequency * closing;
  const nextClosing = closing + accel * dt;
  const nextRemaining = remaining - nextClosing * dt;
  return {
    remaining: nextRemaining,
    closing: nextClosing,
    done: Math.abs(nextRemaining) < 0.002 && Math.abs(nextClosing) < 0.02,
  };
}

/** Seconds the landed pose is held after a release settle, so it reads. */
export const LANDING_HOLD_SECONDS = 0.9;

/**
 * Ambient animation time, split into the time a hold has withheld and the hold
 * still to run. Kept beside the settle maths because the two are one gesture:
 * the spring lands, then the drift waits a beat before moving again.
 */
export interface AmbientClock {
  /** Ambient seconds withheld by completed and running holds. */
  offset: number;
  /** Seconds left in the current hold; 0 while drifting. */
  hold: number;
}

/**
 * The ambient clock for one frame. While a hold runs the drawn time stays put
 * and the frame's `dt` is added to `offset`, so when the hold ends the drift
 * resumes from the landed pose instead of jumping ahead by the length of the
 * beat. A frame longer than the remaining hold withholds only the hold.
 */
export function advanceAmbient(
  clock: AmbientClock,
  raw: number,
  dt: number,
): { seconds: number; clock: AmbientClock } {
  if (!(clock.hold > 0) || !(dt > 0)) return { seconds: raw - clock.offset, clock };
  const held = Math.min(clock.hold, dt);
  const next = { offset: clock.offset + held, hold: clock.hold - held };
  return { seconds: raw - next.offset, clock: next };
}

/**
 * Seconds per ambient heartbeat ring while the core is idle. Slower than the
 * busy ring on purpose: a scan is an event, this is a pulse you stop noticing
 * until it is gone.
 */
export const GRAPH_PULSE_PERIOD = 4.6;

/**
 * Ambient heartbeat for the galaxy: a crest that travels outward from the bulge
 * plus a slow per-note breath.
 *
 * `phase` desynchronises notes that share a radius, and `radius` (0 at the core,
 * 1 at the rim) delays the crest with distance, so the disk reads as a pulse
 * moving through it rather than one global flash. The delay is 2.4 rad — about
 * 1.8 s per period here, comfortably under a full turn, because more than 2π
 * would wrap and make the rim crest *before* the core on the first pass.
 *
 * The crest is cubed to sharpen the front and flatten the trough; the result is
 * roughly -0.12 (trough) to 0.72 (crest), and callers scale it to the lift they
 * want.
 */
export function graphPulse(
  elapsed: number,
  phase: number,
  radius = 0,
  period = GRAPH_PULSE_PERIOD,
): number {
  if (!(period > 0)) return 0;
  const ring = Math.sin((elapsed / period) * TAU - radius * 2.4 + phase * 0.35);
  const crest = Math.max(0, ring) ** 3;
  const breath = Math.sin(elapsed * 0.85 + phase);
  return crest * 0.6 + breath * 0.12;
}

/** Seconds per pulse ring while the core is scanning or reading. */
export const PULSE_PERIOD = 1.8;

/**
 * The idle heartbeat as a wave that starts near the bulge and travels to the
 * rim. Unlike `pulseFrame`, which opens already at the rim while a scan is an
 * event, this one crosses the disk, so the eye can follow a front instead of a
 * ring appearing and vanishing at the edge. The opacity falls faster than the
 * radius grows, keeping it a hint rather than a hard circle over the arms.
 */
export function waveFrame(
  elapsed: number,
  period = GRAPH_PULSE_PERIOD,
): { radius: number; opacity: number } {
  if (!(period > 0)) return { radius: 0.06, opacity: 0 };
  const phase = (((elapsed % period) + period) % period) / period;
  return { radius: 0.06 + phase * 0.98, opacity: 0.4 * (1 - phase) ** 1.4 };
}

/**
 * One expanding, fading ring per period: radius as a multiple of the sphere's
 * radius, plus its opacity. Feeds the SVG attributes each frame.
 */
export function pulseFrame(
  elapsed: number,
  period = PULSE_PERIOD,
): { radius: number; opacity: number } {
  const phase = (((elapsed % period) + period) % period) / period;
  return { radius: 0.94 + phase * 0.36, opacity: 0.42 * (1 - phase) * (1 - phase) };
}
