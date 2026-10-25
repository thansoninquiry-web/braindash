import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import NoteReader from "../src/components/NoteReader.js";
import type { NoteDetail } from "../src/types.js";

function note(overrides: Partial<NoteDetail> = {}): NoteDetail {
  return {
    path: "notes/alpha.md",
    title: "Alpha Note",
    captured: "2026-10-18 3:38 PM",
    capturedZone: "America/New_York",
    nextReview: null,
    origin: "me",
    area: "career",
    words: 12,
    bytes: 48,
    keywords: ["orchard"],
    tags: ["focus"],
    markdown: "# Alpha Note\n\nThe orchard and the lantern.",
    size: 48,
    modifiedAt: "2026-10-19T12:00:00.000Z",
    vaultPath: "/vault",
    outbound: [],
    backlinks: [],
    ...overrides,
  };
}

const noop = () => {};

function render(
  overrides: Partial<NoteDetail> = {},
  clock = { timeZone: "Asia/Tokyo", hour12: true },
): string {
  return renderToStaticMarkup(
    <NoteReader
      open
      note={note(overrides)}
      error={null}
      loading={false}
      onClose={noop}
      onRetry={noop}
      resolveWikilink={() => null}
      onOpenNote={noop}
      clock={clock}
    />,
  );
}

function renderWritable(overrides: Partial<NoteDetail> = {}): string {
  return renderToStaticMarkup(
    <NoteReader
      open
      note={note(overrides)}
      error={null}
      loading={false}
      onClose={noop}
      onRetry={noop}
      resolveWikilink={() => null}
      onOpenNote={noop}
      clock={{ timeZone: "Asia/Tokyo", hour12: true }}
      writes
      onSave={async () => {}}
      onDelete={async () => {}}
    />,
  );
}

describe("NoteReader — captured zone", () => {
  it("shows the recorded zone beside the stamp converted into the chosen zone", () => {
    const markup = render();
    // 3:38 PM in New York is 4:38 AM the next morning in Tokyo, and the IANA
    // name says what the reader converted from.
    assert.ok(markup.includes("Oct 19, 2026 · 4:38 AM GMT+9"), "the stamp is converted");
    assert.ok(markup.includes('class="reader-meta-zone"'), "the zone has its own slot");
    assert.ok(markup.includes(">America/New_York</span>"), "the recorded zone is named");
    assert.ok(markup.includes('title="Captured in America/New_York"'));
  });

  it("shows the zone even when no conversion happens", () => {
    const markup = render({}, { timeZone: "America/New_York", hour12: true });
    assert.ok(markup.includes("Oct 18, 2026 · 3:38 PM EDT"));
    assert.ok(markup.includes(">America/New_York</span>"));
  });

  it("omits the zone for a date-only capture, which has no clock to convert", () => {
    const markup = render({ captured: "2026-10-18" });
    assert.ok(markup.includes("Oct 18, 2026"));
    assert.equal(markup.includes("reader-meta-zone"), false);
  });

  it("omits the zone when the note recorded none", () => {
    const markup = render({ capturedZone: null });
    assert.equal(markup.includes("reader-meta-zone"), false);
  });

  it("keeps the no-capture case unchanged", () => {
    const markup = render({ captured: null, capturedZone: null });
    assert.ok(markup.includes("no captured date"));
    assert.equal(markup.includes("reader-meta-zone"), false);
  });
});

describe("NoteReader — write controls", () => {
  it("stays read-only when the API has not enabled writes", () => {
    const markup = render();
    assert.ok(markup.includes("Read-only · nothing is written to the vault"));
    assert.equal(markup.includes(">Edit</button>"), false);
    assert.equal(markup.includes(">Delete</button>"), false);
  });

  it("offers Edit and Delete once writing is allowed", () => {
    const markup = renderWritable();
    assert.ok(markup.includes(">Edit</button>"));
    assert.ok(markup.includes(">Delete</button>"));
    // Deletion asks before it moves anything.
    assert.equal(markup.includes("Move to .trash"), false);
    assert.match(markup, /Editing writes to your vault/);
  });

  it("renders the note's markdown, not an editor, until Edit is pressed", () => {
    const markup = renderWritable();
    assert.equal(markup.includes('id="reader-editor"'), false);
    assert.ok(markup.includes("The orchard and the lantern."));
  });
});
