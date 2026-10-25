import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ActionPanel, { type ActionPanelProps } from "../src/components/ActionPanel.js";
import type { NoteSummary } from "../src/types.js";

const noop = () => {};

function note(overrides: Partial<NoteSummary> & { path: string }): NoteSummary {
  return {
    path: overrides.path,
    title: overrides.title ?? overrides.path.replace(/\.md$/, ""),
    captured: overrides.captured ?? null,
    capturedZone: overrides.capturedZone ?? null,
    nextReview: overrides.nextReview ?? null,
    origin: null,
    area: null,
    words: 10,
    bytes: 100,
    keywords: [],
    tags: [],
  };
}

function render(overrides: Partial<ActionPanelProps> = {}): string {
  return renderToStaticMarkup(
    <ActionPanel
      open
      kind="today"
      date="2026-10-21"
      notes={[]}
      loading={false}
      error={null}
      clock={{ timeZone: "UTC", hour12: true }}
      onOpenNote={noop}
      onClose={noop}
      {...overrides}
    />,
  );
}

describe("ActionPanel — Today's captures", () => {
  it("is a labelled dialog with a close control and one row per note", () => {
    const markup = render({
      notes: [
        note({ path: "notes/alpha.md", title: "Alpha", captured: "2026-10-21 9:00 AM", capturedZone: "UTC" }),
        note({ path: "notes/beta.md", title: "Beta", captured: "2026-10-21" }),
      ],
    });
    assert.match(markup, /role="dialog"/);
    assert.match(markup, /aria-modal="true"/);
    assert.match(markup, /id="action-sheet-title"/);
    assert.match(markup, /Today&#x27;s captures/);
    assert.match(markup, /2 notes · WED, OCT 21, 2026/);
    assert.match(markup, /aria-label="Close today&#x27;s captures"/);
    assert.equal((markup.match(/class="action-row"/g) ?? []).length, 2);
    assert.match(markup, /Alpha/);
    assert.match(markup, /notes\/alpha\.md/);
    // A timed row names the stamp, converted into the clock's zone.
    assert.match(markup, /9:00 AM/);
    assert.match(markup, /Captured on this day, newest first/);
  });

  it("says the day was empty instead of showing a lone header", () => {
    const markup = render();
    assert.match(markup, /Nothing was captured on WED, OCT 21, 2026\./);
    assert.doesNotMatch(markup, /class="action-row"/);
  });
});

describe("ActionPanel — Review queue", () => {
  it("labels each row with how late it is and marks the overdue ones", () => {
    const markup = render({
      kind: "review",
      notes: [
        note({ path: "notes/late.md", title: "Late", nextReview: "2026-10-20" }),
        note({ path: "notes/today.md", title: "Today", nextReview: "2026-10-21" }),
      ],
    });
    assert.match(markup, /Review queue/);
    assert.match(markup, /2 due · 1 overdue/);
    assert.match(markup, /1 day overdue/);
    assert.match(markup, /class="action-row-status is-overdue"/);
    assert.match(markup, /Due today/);
    assert.match(markup, /class="action-row-status is-due-today"/);
    assert.match(markup, /Due dates come from each note&#x27;s next_review/);
    assert.match(markup, /aria-label="Close review queue"/);
  });

  it("says nothing is due rather than pretending the queue is broken", () => {
    const markup = render({ kind: "review" });
    assert.match(markup, /No note is due on or before WED, OCT 21, 2026\./);
  });
});

describe("ActionPanel — states", () => {
  it("shows a status while the list is read, without the empty message", () => {
    const markup = render({ loading: true });
    assert.match(markup, /role="status"/);
    assert.match(markup, /Reading the vault index/);
    assert.doesNotMatch(markup, /Nothing was captured/);
  });

  it("shows a read failure in an alert instead of an empty list", () => {
    const markup = render({ error: "VAULT_PATH is not set to a readable directory" });
    assert.match(markup, /role="alert"/);
    assert.match(markup, /VAULT_PATH is not set/);
    assert.match(markup, /The vault index could not be read\./);
    assert.doesNotMatch(markup, /Nothing was captured/);
  });
});
