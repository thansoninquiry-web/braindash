import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import QuickActions from "../src/components/QuickActions.js";
import type { ActionCatalogue } from "../src/types.js";

const noop = () => {};

const CATALOGUE: ActionCatalogue = {
  date: "2026-10-21",
  timeZone: "UTC",
  actions: [
    { id: "today", label: "Today's captures", count: 3, hint: "3 notes captured" },
    { id: "review", label: "Review queue", count: 2, hint: "1 of 2 overdue" },
  ],
};

function render(overrides: {
  writable?: boolean;
  actions?: ActionCatalogue | null;
  graphReady?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    <QuickActions
      onRescan={noop}
      busy={false}
      vaultPath="/vault"
      onOpenRandom={noop}
      notesBusy={false}
      onOpenSettings={noop}
      onOpenGraph={noop}
      graphReady={overrides.graphReady ?? true}
      writable={overrides.writable ?? false}
      onNewNote={noop}
      onOpenTrash={noop}
      actions={overrides.actions === undefined ? CATALOGUE : overrides.actions}
      onTodayCaptures={noop}
      onOpenReview={noop}
    />,
  );
}

describe("QuickActions", () => {
  it("shows live counts instead of an M3 badge", () => {
    const markup = render();
    assert.match(markup, /Today&#x27;s captures/);
    assert.match(markup, /Review queue/);
    assert.match(markup, /class="tile-count is-active">3</);
    assert.match(markup, /class="tile-count is-active">2</);
    assert.doesNotMatch(markup, /tile-badge/);
    assert.doesNotMatch(markup, /M3/);
    assert.match(markup, /3 notes captured · open today&#x27;s captures/);
    assert.match(markup, /1 of 2 overdue · open the review queue/);
  });

  it("counts both new actions in the rail's live total", () => {
    assert.match(render({ writable: false }), /5 live/);
    assert.match(render({ writable: true }), /7 live/);
  });

  it("offers the trash only where a restore is allowed", () => {
    assert.doesNotMatch(render({ writable: false }), /Trash/);
    const writable = render({ writable: true });
    assert.match(writable, /Trash/);
    assert.match(writable, /Deleted notes are recoverable/);
  });

  it("waits for the catalogue rather than showing a fake zero", () => {
    const markup = render({ actions: null, graphReady: false });
    assert.match(markup, /Waiting for the vault index/);
    assert.equal((markup.match(/—<\/span>/g) ?? []).length, 2, "both tiles show a dash");
    assert.doesNotMatch(markup, /is-active/);
  });

  it("keeps a genuine zero quiet but still opens the list", () => {
    const markup = render({
      actions: {
        date: "2026-10-21",
        timeZone: "UTC",
        actions: [
          { id: "today", label: "Today's captures", count: 0, hint: "Nothing captured on this day" },
          { id: "review", label: "Review queue", count: 0, hint: "Nothing due" },
        ],
      },
    });
    assert.match(markup, /class="tile-count">0</);
    assert.doesNotMatch(markup, /is-active/);
    assert.doesNotMatch(markup, /Waiting for the vault index/);
  });
});
