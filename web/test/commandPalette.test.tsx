import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CommandPalette, { PaletteList } from "../src/components/CommandPalette.js";
import type { PaletteEntry } from "../src/palette.js";

const noop = () => {};

const COMMANDS: PaletteEntry[] = [
  {
    id: "rescan",
    label: "Rescan vault",
    detail: "Read the folder from disk now",
    group: "Commands",
  },
  {
    id: "settings",
    label: "Open settings",
    detail: "Accent, clock, motion, refresh",
    group: "Commands",
    keywords: "theme",
  },
];

const NOTE: PaletteEntry = {
  id: "notes/orchard.md",
  label: "Alpha Orchard",
  detail: "notes/orchard.md · title",
  group: "Notes",
};

function render(overrides: { open?: boolean; commands?: PaletteEntry[] } = {}): string {
  return renderToStaticMarkup(
    <CommandPalette
      open={overrides.open ?? true}
      commands={overrides.commands ?? COMMANDS}
      onRun={noop}
      onClose={noop}
    />,
  );
}

describe("CommandPalette", () => {
  it("is a labelled modal combobox listing every command", () => {
    const markup = render();
    assert.match(markup, /role="dialog"/);
    assert.match(markup, /aria-modal="true"/);
    assert.match(markup, /aria-label="Command palette"/);
    assert.match(markup, /role="combobox"/);
    assert.match(markup, /aria-expanded="true"/);
    assert.match(markup, /aria-controls="palette-list"/);
    assert.match(markup, /aria-activedescendant="palette-option-0"/);
    assert.match(markup, /id="palette-list"/);
    assert.match(markup, /role="listbox"/);
    assert.equal((markup.match(/role="option"/g) ?? []).length, 2);
    assert.match(markup, /Rescan vault/);
    assert.match(markup, /Read the folder from disk now/);
    assert.match(markup, /2 commands · type to search notes/);
    assert.match(markup, /aria-label="Close the command palette"/);
    assert.match(markup, /<kbd>↵<\/kbd>/);
    assert.match(markup, /<kbd>esc<\/kbd>/);
    assert.match(markup, /⌘K \/ Ctrl\+K/);
  });

  it("marks the first row selected so Enter has an unambiguous target", () => {
    assert.match(render(), /id="palette-option-0" role="option" aria-selected="true"/);
  });

  it("renders nothing while it is closed", () => {
    assert.equal(render({ open: false }), "");
  });
});

describe("PaletteList", () => {
  it("heads each group and marks only the active row", () => {
    const markup = renderToStaticMarkup(
      <PaletteList entries={[COMMANDS[0]!, NOTE]} active={1} query="" onHover={noop} onRun={noop} />,
    );
    assert.match(markup, /class="palette-group" aria-hidden="true">Commands</);
    assert.match(markup, /class="palette-group" aria-hidden="true">Notes</);
    assert.match(markup, /aria-selected="false" class="palette-row"/);
    assert.match(markup, /aria-selected="true" class="palette-row is-active"/);
    assert.match(markup, /class="palette-row-kind" aria-hidden="true">note</);
    assert.match(markup, /class="palette-row-kind" aria-hidden="true">run</);
  });

  it("says what missed instead of rendering an empty box", () => {
    const markup = renderToStaticMarkup(
      <PaletteList entries={[]} active={0} query="  zebra  " onHover={noop} onRun={noop} />,
    );
    assert.match(markup, /No command or note matches/);
    assert.match(markup, /zebra/);
    assert.doesNotMatch(markup, /palette-row/);
  });
});
