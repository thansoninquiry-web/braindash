import assert from "node:assert/strict";
import { createRef } from "react";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TrashPanelBody } from "../src/components/TrashPanel.js";
import type { TrashListing } from "../src/types.js";

const noop = () => {};
const clock = { timeZone: "America/New_York", hour12: true };

const LISTING: TrashListing = {
  trashPath: "/vault/.trash",
  total: 2,
  entries: [
    {
      id: "2026-10-22T13-05-00-000Z-abc123/notes/alpha.md",
      path: "notes/alpha.md",
      title: "Alpha",
      trashedAt: "2026-10-22T13:05:00.000Z",
      size: 861,
    },
    {
      id: "2026-10-21T09-30-00-000Z-def456/notes/beta.md",
      path: "notes/beta.md",
      title: "Beta",
      trashedAt: "2026-10-21T09:30:00.000Z",
      size: 2048,
    },
  ],
};

function render(overrides: {
  loading?: boolean;
  error?: string | null;
  listing?: TrashListing | null;
  restoringId?: string | null;
  restoreError?: { id: string; message: string } | null;
  writable?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    <TrashPanelBody
      clock={clock}
      loading={overrides.loading ?? false}
      error={overrides.error ?? null}
      listing={overrides.listing === undefined ? LISTING : overrides.listing}
      restoringId={overrides.restoringId ?? null}
      restoreError={overrides.restoreError ?? null}
      writable={overrides.writable ?? true}
      onRestore={noop}
      onClose={noop}
      panelRef={createRef<HTMLDivElement>()}
      closeRef={createRef<HTMLButtonElement>()}
    />,
  );
}

describe("TrashPanelBody", () => {
  it("lists what deleting kept, with where it returns and how big it was", () => {
    const markup = render();
    assert.match(markup, /role="dialog"/);
    assert.match(markup, /Vault · trash/);
    assert.match(markup, />Trash</);
    assert.match(markup, /2 recoverable notes · newest first/);
    assert.match(markup, /notes\/alpha\.md/);
    assert.match(markup, /notes\/beta\.md/);
    assert.match(markup, />Alpha</);
    assert.match(markup, />Beta</);
    assert.match(markup, /861 B/);
    assert.match(markup, /2\.0 kB/);
    // Two rows, two Restore buttons, each naming the path it would put back.
    assert.equal((markup.match(/class="trash-restore"/g) ?? []).length, 2);
    assert.match(markup, /title="Put notes\/alpha\.md back"/);
    assert.match(markup, /aria-label="Close the trash"/);
  });

  it("says the trash is empty rather than drawing an empty list", () => {
    const markup = render({ listing: { trashPath: null, total: 0, entries: [] } });
    assert.match(markup, /Nothing in the trash/);
    assert.doesNotMatch(markup, /class="trash-restore"/);
  });

  it("stays quiet with a status while the folder is read", () => {
    const markup = render({ loading: true, listing: null });
    assert.match(markup, /role="status"/);
    assert.match(markup, /Reading \.trash…/);
    assert.doesNotMatch(markup, /class="trash-restore"/);
  });

  it("reports a failed read in an alert", () => {
    const markup = render({ error: "The trash could not be read." });
    assert.match(markup, /role="alert"/);
    assert.match(markup, /The trash could not be read\./);
  });

  it("marks only the row that is being restored and blocks the rest", () => {
    const markup = render({ restoringId: LISTING.entries[0]?.id ?? null });
    assert.match(markup, /Restoring…/);
    assert.equal(
      (markup.match(/<button[^>]*class="trash-restore"[^>]*disabled/g) ?? []).length,
      2,
      "both buttons wait for the restore in flight",
    );
  });

  it("ties a refused restore to its row and keeps the note in the list", () => {
    const markup = render({
      restoreError: { id: LISTING.entries[0]?.id ?? "", message: "A note already exists at that path" },
    });
    assert.match(markup, /role="alert"/);
    assert.match(markup, /A note already exists at that path/);
    assert.match(markup, /notes\/alpha\.md/, "the row is still listed");
  });

  it("explains itself when the session is read-only", () => {
    const markup = render({ writable: false });
    assert.match(markup, /restores need BRAINDASH_WRITE=1/);
    assert.equal(
      (markup.match(/<button[^>]*class="trash-restore"[^>]*disabled/g) ?? []).length,
      2,
    );
  });
});
