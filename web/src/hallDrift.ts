/**
 * Parallax for the empty hall behind the vault core.
 *
 * The sphere turns away from the pointer: its near face swings left when the
 * pointer goes right. A backdrop glued to that turn would read as one flat
 * picture, so the hall slides the other way, by a few pixels at full
 * deflection. The travel is deliberately tiny: it should be felt as depth, not
 * watched. The CSS layer carries a matching bleed on every edge (`inset: -20px`
 * in `styles.css`), so the room never exposes the frame behind it however far
 * this pushes it.
 */
export const HALL_DRIFT = { x: 16, y: 10 };

export interface HallOffset {
  x: number;
  y: number;
}

const clamp = (value: number): number => Math.min(1, Math.max(-1, value));

/**
 * `pointerX`/`pointerY` are normalised to −1..1 across the cloud frame. Values
 * outside that range (a pointer captured at the edge, a resize mid-gesture) are
 * clamped so the room can never slide away from its frame.
 */
export function hallOffset(
  pointerX: number,
  pointerY: number,
  drift: { x: number; y: number } = HALL_DRIFT,
): HallOffset {
  const x = clamp(pointerX) * drift.x;
  const y = clamp(pointerY) * drift.y;
  // `-0` is a different value to tests and pointless in a transform string.
  return { x: x || 0, y: y || 0 };
}
