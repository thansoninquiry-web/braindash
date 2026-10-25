import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLOUD_TITLE_LINES,
  CLOUD_TITLE_MAX,
  CLOUD_TITLE_MIN,
  fitCloudTitle,
  type GlyphMetrics,
} from "../src/cloudLabel.ts";
import { lengthPx } from "../src/cloudTitleMetrics.ts";

/**
 * The heading's real metrics in the browser: a monospace advance plus tracking,
 * both in em, and the first-line indent. Tests inject this instead of relying on
 * the canvas, which only exists in the browser.
 */
function mono(trackingEm = 0.3, advanceEm = 0.6, indentEm = 0.3): GlyphMetrics {
  return {
    width: (text, fontSize) => [...text].length * fontSize * (advanceEm + trackingEm),
    indent: (fontSize) => fontSize * indentEm,
  };
}

const METRICS = mono();

describe("fitCloudTitle", () => {
  it("keeps a short title at full size on one line", () => {
    const fit = fitCloudTitle("MCP", 900, METRICS);
    assert.deepEqual(fit, { fontSize: CLOUD_TITLE_MAX, lines: 1, clipped: false });
  });

  it("steps a long title down until it fits the two reserved lines", () => {
    const fit = fitCloudTitle("Aion 2 — Assassin @ Lv 27, stat & gear review", 585, METRICS);
    assert.equal(fit.fontSize, 27);
    assert.equal(fit.lines, 2);
    assert.equal(fit.clipped, false, "the whole title stays readable");
  });

  it("counts words, not characters: a word that cannot fill a line costs one", () => {
    const hyphenated = fitCloudTitle("PRD — reverse-engineering a repo with AI", 585, METRICS);
    const even = fitCloudTitle("Forty characters of short words here.", 585, METRICS);
    assert.equal(even.fontSize, CLOUD_TITLE_MAX, "evenly sized words pack tightly");
    assert.equal(hyphenated.lines, 2);
    assert.equal(hyphenated.fontSize, 24, "the long word forces a smaller size");
  });

  it("gives a wide layout the full size for the same title", () => {
    const title = "Aion 2 — Assassin @ Lv 27, stat & gear review";
    assert.equal(fitCloudTitle(title, 1200, METRICS).fontSize, CLOUD_TITLE_MAX);
  });

  it("never reports more lines than the slot reserves", () => {
    for (const width of [320, 585, 900, 1600]) {
      for (const title of ["Short", "A ".repeat(20), "x".repeat(300)]) {
        const fit = fitCloudTitle(title, width, METRICS);
        assert.ok(fit.lines <= CLOUD_TITLE_LINES, `${JSON.stringify(title)} at ${width}`);
      }
    }
  });

  it("clamps an extreme title at the readable floor and flags the cut", () => {
    const fit = fitCloudTitle("y ".repeat(150), 585, METRICS);
    assert.equal(fit.fontSize, CLOUD_TITLE_MIN);
    assert.equal(fit.clipped, true);
  });

  it("does not flag a quiet fit at the floor", () => {
    const fit = fitCloudTitle("z".repeat(90), 585, METRICS);
    assert.equal(fit.fontSize, CLOUD_TITLE_MIN);
    assert.equal(fit.clipped, false);
  });

  it("never exceeds the cap or drops below the floor", () => {
    for (const width of [0, 1, 80, 400, 900, 2400]) {
      const fit = fitCloudTitle("Some note title of ordinary length", width, METRICS);
      assert.ok(fit.fontSize <= CLOUD_TITLE_MAX && fit.fontSize >= CLOUD_TITLE_MIN);
    }
  });

  it("wastes no size as the column widens", () => {
    const title = "PRD — reverse-engineering a repo with AI and other words";
    let previous = 0;
    for (let width = 200; width <= 2000; width += 25) {
      const { fontSize } = fitCloudTitle(title, width, METRICS);
      assert.ok(fontSize >= previous, `width ${width} stepped back to ${fontSize}`);
      previous = fontSize;
    }
  });

  it("paints at full size before the first measurement", () => {
    assert.deepEqual(fitCloudTitle("Anything at all", 0, METRICS), {
      fontSize: CLOUD_TITLE_MAX,
      lines: CLOUD_TITLE_LINES,
      clipped: false,
    });
  });

  it("treats a blank label as no title", () => {
    assert.deepEqual(fitCloudTitle("   ", 500, METRICS), {
      fontSize: CLOUD_TITLE_MAX,
      lines: 0,
      clipped: false,
    });
  });

  it("measures every glyph, so a narrow face keeps a larger size", () => {
    const narrow: GlyphMetrics = {
      // An "i" is a quarter of an em before tracking, as a proportional face
      // would draw it; a per-character estimate would call this monospace.
      width: (text, fontSize) =>
        [...text].reduce((sum, char) => sum + fontSize * (char === "i" ? 0.25 : 0.6), 0) +
        [...text].length * fontSize * 0.3,
      indent: (fontSize) => fontSize * 0.3,
    };
    const title = "i".repeat(50);
    assert.equal(fitCloudTitle(title, 585, narrow).fontSize, CLOUD_TITLE_MAX);
    assert.equal(fitCloudTitle(title, 585, METRICS).fontSize, 24, "monospace is wider");
  });

  it("follows the authored tracking instead of a fixed em per character", () => {
    const loose = fitCloudTitle("Aion 2 — Assassin @ Lv 27, stat & gear review", 585, mono(0.5));
    const tight = fitCloudTitle("Aion 2 — Assassin @ Lv 27, stat & gear review", 585, mono(0.2));
    assert.ok(loose.fontSize < tight.fontSize, `loose ${loose.fontSize}, tight ${tight.fontSize}`);
  });

  it("charges the first line for its text-indent", () => {
    const title = "AAAAA BBBBB CCCCC DDDDD";
    const flush = fitCloudTitle(title, 324, mono(0.3, 0.6, 0));
    const indented = fitCloudTitle(title, 324, mono(0.3, 0.6, 2));
    assert.equal(flush.fontSize, CLOUD_TITLE_MAX);
    assert.ok(indented.fontSize < flush.fontSize, "the indent costs the first line a word");
  });
});

describe("lengthPx", () => {
  it("resolves em against the candidate size, not the rendered one", () => {
    assert.equal(lengthPx("0.3em", 30), 9);
    assert.equal(lengthPx("0.3em", 13), 3.9);
    assert.equal(lengthPx("0.22em", 22), 4.84);
  });

  it("passes absolute lengths through", () => {
    assert.equal(lengthPx("2px", 30), 2);
    assert.equal(lengthPx("0.5rem", 30, 16), 8);
    assert.equal(lengthPx("9pt", 30), 12);
  });

  it("treats a missing or unknown length as zero", () => {
    assert.equal(lengthPx("", 30), 0);
    assert.equal(lengthPx("normal", 30), 0);
    assert.equal(lengthPx("2ch", 30), 0);
  });
});
