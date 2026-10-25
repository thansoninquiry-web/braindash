import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import SettingsPanel from "../src/components/SettingsPanel.js";
import { REFRESH_OPTIONS } from "../src/refresh.js";
import { THEMES } from "../src/themes.js";

const noop = () => {};

function render(noticesMuted = false): string {
  return renderToStaticMarkup(
    <SettingsPanel
      open
      theme="orange"
      themeMode="manual"
      autoSource="OS dark · night"
      onSelectMode={noop}
      onSelect={noop}
      motion="auto"
      onSelectMotion={noop}
      clock={{ timeZone: "", hour12: true }}
      onSelectTimeZone={noop}
      onSelectHour12={noop}
      refresh="1m"
      onSelectRefresh={noop}
      noticesMuted={noticesMuted}
      onSelectNoticesMuted={noop}
      onClose={noop}
    />,
  );
}

/** React renders the style object as `background:#rrggbb` (no spaces). */
function bands(markup: string): string[] {
  return [...markup.matchAll(/background:(#[0-9a-f]{6})/gi)].map((match) => (match[1] ?? "").toLowerCase());
}

describe("SettingsPanel accent swatches", () => {
  it("previews every colour a palette paints", () => {
    const markup = render();
    const shown = bands(markup);
    for (const theme of THEMES) {
      for (const colour of [theme.accent, theme.bright, theme.dim, theme.unset, theme.dust]) {
        assert.ok(
          shown.includes(colour.toLowerCase()),
          `${theme.id} swatch is missing ${colour}`,
        );
      }
    }
    // Five bands per card: the accent trio plus the untagged node and the spark.
    assert.equal(shown.length, THEMES.length * 5);
  });

  it("describes every swatch band for screen readers", () => {
    const markup = render();
    for (const theme of THEMES) {
      const description =
        `Palette: accent ${theme.accent}, bright ${theme.bright}, dim ${theme.dim}, ` +
        `untagged node ${theme.unset}, spark field ${theme.dust}.`;
      const id = `theme-palette-${theme.id}`;
      // The sentence lives outside the accessible name, wired up as the radio's
      // description, so the option is still announced as just "Orange".
      assert.ok(markup.includes(`id="${id}"`), `${theme.id}: description element`);
      assert.ok(markup.includes(description), `${theme.id}: palette description`);
      assert.ok(
        markup.includes(`aria-describedby="${id}"`),
        `${theme.id}: radio points at its description`,
      );
      assert.ok(
        markup.includes(`aria-labelledby="theme-name-${theme.id}"`),
        `${theme.id}: radio is named by its label`,
      );
    }
  });

  it("offers the unattended refresh cadences", () => {
    const markup = render();
    for (const option of REFRESH_OPTIONS) {
      assert.ok(markup.includes(option.label), `missing refresh option ${option.label}`);
      assert.ok(markup.includes(option.hint), `missing hint for ${option.label}`);
    }
    assert.ok(markup.includes('aria-label="Vault refresh"'), "the group is labelled");
  });

  it("offers a session mute for mode-change notices", () => {
    const shown = render(false);
    assert.ok(shown.includes('aria-label="Mode-change notices"'), "the group is labelled");
    assert.ok(
      shown.includes("Silent; flips collect on the badge"),
      "the hint says where the flips go",
    );
    assert.ok(
      shown.includes('aria-checked="true" class="choice-option is-selected"') &&
        shown.includes("<span class=\"choice-name\">Shown</span>"),
      "notices are on by default",
    );
    assert.ok(shown.includes("until this tab closes"), "the caption explains the scope");
    assert.ok(shown.includes("last three flips"), "the caption explains the backlog");

    // The selected option follows the stored choice, so a muted tab says so.
    const muted = render(true);
    assert.ok(muted.includes("<span class=\"choice-name\">Muted</span>"));
    assert.ok(muted.includes("choice-option is-selected"), "one option is selected");
  });

  it("keeps the spark band last and the untagged node before it", () => {
    const markup = render();
    for (const theme of THEMES) {
      const accent = markup.indexOf(theme.accent);
      const unset = markup.indexOf(theme.unset);
      const spark = markup.indexOf(theme.dust);
      assert.ok(accent !== -1 && unset !== -1 && spark !== -1, `${theme.id}: all three bands render`);
      assert.ok(accent < unset && unset < spark, `${theme.id}: accent → untagged → spark order`);
    }
  });
});
