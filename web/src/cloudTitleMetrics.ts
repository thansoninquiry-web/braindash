import type { GlyphMetrics } from "./cloudLabel";

/**
 * Real glyph metrics for the cloud title. The canvas is the same text engine
 * that paints the heading, so measuring there removes the old per-character em
 * guess: a different monospace face, a proportional fallback or a new tracking
 * value in styles.css changes the fit instead of drifting away from it.
 */

let context: CanvasRenderingContext2D | null | undefined;

function canvasContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  context =
    typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  return context;
}

/**
 * Resolves a length against a candidate font size. Tracking and indent are read
 * from custom properties rather than `getComputedStyle`, which would collapse
 * `0.3em` to a px value for whichever size happens to be rendered right now.
 */
export function lengthPx(value: string, fontSize: number, rootFontSize = 16): number {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  switch ((match[2] ?? "").toLowerCase()) {
    case "em":
      return amount * fontSize;
    case "rem":
      return amount * rootFontSize;
    case "px":
      return amount;
    case "pt":
      return amount * (96 / 72);
    default:
      return 0;
  }
}

/** `text-transform` is applied before measuring, so the canvas sees real glyphs. */
function transformText(text: string, value: string): string {
  switch (value) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) =>
        `${space}${letter.toUpperCase()}`,
      );
    default:
      return text;
  }
}

/** Builds the metrics for one rendered title element, or null without a canvas. */
export function cloudTitleMetrics(element: Element): GlyphMetrics | null {
  const ctx = canvasContext();
  if (!ctx) return null;

  const style = getComputedStyle(element);
  const tracking =
    style.getPropertyValue("--cloud-title-tracking").trim() ||
    (style.letterSpacing === "normal" ? "0px" : style.letterSpacing);
  const indent = style.getPropertyValue("--cloud-title-indent").trim() || style.textIndent;
  const transform = style.textTransform;
  const family = style.fontFamily;
  if (!family) return null;

  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const tracksOnCanvas = typeof ctx.letterSpacing === "string";
  const font = (fontSize: number) =>
    `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${family}`;

  return {
    width(text, fontSize) {
      const rendered = transformText(text, transform);
      const spacing = lengthPx(tracking, fontSize, rootFontSize);
      ctx.font = font(fontSize);
      if (tracksOnCanvas) ctx.letterSpacing = `${spacing}px`;
      const measured = ctx.measureText(rendered).width;
      // Older canvas implementations have no `letterSpacing`, so add it by hand.
      return measured + (tracksOnCanvas ? 0 : spacing * [...rendered].length);
    },
    indent(fontSize) {
      return Math.max(0, lengthPx(indent, fontSize, rootFontSize));
    },
  };
}
