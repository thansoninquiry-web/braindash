/**
 * Keyboard cursor rules for the vault cloud, kept out of the SVG component so
 * they can be checked without a DOM. The component owns the React state; this
 * module owns the arithmetic and the key map.
 */

/** Multiplier per `+`/`-` press. The wheel uses a continuous version of this. */
export const ZOOM_STEP = 1.15;

export type CloudKeyAction =
  | { type: "move"; delta: 1 | -1 }
  | { type: "open" }
  | { type: "zoom"; direction: 1 | -1 }
  | { type: "reset" }
  | { type: "clear" };

/** Maps a key from a keyboard event to the cloud's action, or null if unused. */
export function cloudKeyAction(key: string): CloudKeyAction | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return { type: "move", delta: 1 };
    case "ArrowLeft":
    case "ArrowUp":
      return { type: "move", delta: -1 };
    case "Enter":
    case " ":
      return { type: "open" };
    case "+":
    case "=":
      return { type: "zoom", direction: 1 };
    case "-":
    case "_":
      return { type: "zoom", direction: -1 };
    case "r":
    case "R":
    case "0":
      return { type: "reset" };
    case "Escape":
      return { type: "clear" };
    default:
      return null;
  }
}

/**
 * Next cursor position, wrapping at both ends. Starting from no cursor, forward
 * lands on the first note and backward wraps to the last. With no notes the
 * cursor is returned untouched so the caller can skip the repaint.
 */
export function stepCursor(cursor: number | null, delta: 1 | -1, count: number): number | null {
  if (count <= 0) return cursor;
  const from = cursor ?? (delta > 0 ? -1 : 0);
  return (((from + delta) % count) + count) % count;
}

/** The four things that can claim the cloud's one focus label. */
export interface CloudFocus {
  /** Pointer over a node: always wins, so hover stays truthful. */
  hovered: number | null;
  /** Note the release settle landed on, shown while its pose is held. */
  settled: number | null;
  /** Clicked cluster, which keeps its label until it is cleared. */
  selected: number | null;
  /** Keyboard cursor, the fallback when nothing else is active. */
  cursor: number | null;
}

/**
 * One focus slot for four inputs. A released drag outranks a clicked cluster
 * because it names the note the camera just landed on; the keyboard cursor only
 * labels a note while no pointer or click focus exists.
 */
export function cloudFocusIndex(focus: CloudFocus): number | null {
  return focus.hovered ?? focus.settled ?? focus.selected ?? focus.cursor;
}

/**
 * The note path under the keyboard cursor, or null when there is nothing to
 * open — no cursor yet, a decorative spark at that slot, or a broken link.
 */
export function cursorTargetPath(
  cursor: number | null,
  pathAt: (index: number) => string | null | undefined,
): string | null {
  if (cursor === null) return null;
  return pathAt(cursor) || null;
}
