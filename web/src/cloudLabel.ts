/**
 * The label under the sphere swaps to whatever the pointer is over, so its
 * block has to stay exactly the same height: the sphere is a flex sibling, and
 * a title that wrapped to a third line would shrink the frame and shift every
 * node under the cursor. Instead the slot reserves two lines and the title
 * steps down in size until the whole name fits, which keeps a long note
 * readable without moving the cloud.
 */

/** The cap the slot is sized for; CSS owns the responsive value. */
export const CLOUD_TITLE_MAX = 30;
/** Smallest size still worth reading; below this a title is ellipsised. */
export const CLOUD_TITLE_MIN = 13;
/** Lines the slot reserves, matching `-webkit-line-clamp` in styles.css. */
export const CLOUD_TITLE_LINES = 2;

/** Sizes tried from largest down; the first that fits two lines wins. */
const TITLE_SIZES = [CLOUD_TITLE_MAX, 27, 24, 21, 19, 17, 15, CLOUD_TITLE_MIN] as const;

/**
 * Real advances, not an estimate: the browser measures the title's own font
 * (including its tracking and text-transform) so a font swap, a proportional
 * face or a change to `--cloud-title-tracking` all move the fit with it.
 */
export interface GlyphMetrics {
  /** Rendered width of `text` in px at `fontSize`, trailing tracking included. */
  width(text: string, fontSize: number): number;
  /** Width the first line loses to `text-indent`, in px at `fontSize`. */
  indent(fontSize: number): number;
}

export interface CloudTitleFit {
  /** Font size in px, between `CLOUD_TITLE_MIN` and `CLOUD_TITLE_MAX`. */
  fontSize: number;
  /** Lines the text occupies at that size. */
  lines: number;
  /** True when even the smallest size runs past the reserved lines. */
  clipped: boolean;
}

/** Splits text where a line may break: after whitespace, hyphens and dashes. */
function breakPoints(text: string): string[] {
  return text.match(/\s+|[^\s\u2014-]+[\u2014-]?/g) ?? [];
}

/**
 * A piece wider than the whole line breaks anywhere, because the title is
 * painted with `overflow-wrap: anywhere`. Fills the rest of the current line
 * first, exactly as the browser does.
 */
function wrapLongPiece(
  piece: string,
  fontSize: number,
  limit: number,
  metrics: GlyphMetrics,
  used: number,
  lines: number,
): { used: number; lines: number } {
  let rest = piece;
  let available = Math.max(1, limit - used);
  let lastWidth = 0;

  while (rest.length > 0) {
    let taken = "";
    for (const char of rest) {
      const next = taken + char;
      // One glyph always goes on the line, even if the font is wider than it.
      if (taken !== "" && metrics.width(next, fontSize) > available) break;
      taken = next;
    }
    if (taken === "") taken = rest.slice(0, 1);

    lastWidth = metrics.width(taken, fontSize);
    rest = rest.slice(taken.length);
    if (rest.length > 0) {
      lines += 1;
      available = limit;
    }
  }

  return { used: lastWidth, lines };
}

/**
 * How many lines the browser would use, filling each one as far as it goes.
 * This is greedy on purpose: "PRD — reverse-engineering a repo with AI" needs
 * three lines at a size where its 40 characters would fit two if they were
 * packed perfectly, and the slot has to hold the real result.
 */
function wrappedLines(
  text: string,
  fontSize: number,
  available: number,
  metrics: GlyphMetrics,
): number {
  const limit = Math.max(1, available);
  // The indent pushes only the first line's start, so only it loses width.
  let lineLimit = Math.max(1, limit - Math.max(0, metrics.indent(fontSize)));
  let lines = 1;
  let used = 0;

  for (const piece of breakPoints(text)) {
    const space = piece.trim() === "";
    // A line never starts with the space the previous one ended on.
    if (space && used === 0) continue;

    const width = metrics.width(piece, fontSize);
    if (used + width <= lineLimit) {
      used += width;
      continue;
    }

    // A space that cannot fit collapses into the break instead of opening the
    // next line with itself.
    if (space) {
      lines += 1;
      used = 0;
      lineLimit = limit;
      continue;
    }

    // The word fits a line of its own, so break before it rather than inside.
    if (width <= limit) {
      lines += 1;
      used = width;
      lineLimit = limit;
      continue;
    }

    const wrapped = wrapLongPiece(piece, fontSize, lineLimit, metrics, used, lines);
    lines = wrapped.lines;
    used = wrapped.used;
    lineLimit = limit;
  }

  return lines;
}

/**
 * Picks the largest title size whose wrapped text still fits the reserved
 * two-line slot for the given width, measured in the title's real glyphs.
 */
export function fitCloudTitle(title: string, available: number, metrics: GlyphMetrics): CloudTitleFit {
  const text = title.trim();
  if (text.length === 0) return { fontSize: CLOUD_TITLE_MAX, lines: 0, clipped: false };
  // Before the first measurement there is nothing to fit against: paint at
  // full size (CSS clamps it) and let the next frame settle on a real size.
  if (!(available > 0)) {
    return { fontSize: CLOUD_TITLE_MAX, lines: CLOUD_TITLE_LINES, clipped: false };
  }

  for (const fontSize of TITLE_SIZES) {
    const lines = wrappedLines(text, fontSize, available, metrics);
    if (lines <= CLOUD_TITLE_LINES) return { fontSize, lines, clipped: false };
  }

  // Even the floor is too big: keep it legible and let the clamp ellipsise.
  return {
    fontSize: CLOUD_TITLE_MIN,
    lines: CLOUD_TITLE_LINES,
    clipped: wrappedLines(text, CLOUD_TITLE_MIN, available, metrics) > CLOUD_TITLE_LINES,
  };
}
