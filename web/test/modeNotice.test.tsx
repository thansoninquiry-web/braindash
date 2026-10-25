import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ModeNotice from "../src/components/ModeNotice.js";

const noop = () => {};

describe("ModeNotice", () => {
  it("announces the new mode and its reason in a polite status region", () => {
    const markup = renderToStaticMarkup(
      <ModeNotice
        notice={{
          label: "Home",
          tone: "home",
          source: "manual",
          detail: "Questions are welcome. Set by hand.",
        }}
        onDismiss={noop}
        onMute={noop}
      />,
    );

    assert.match(markup, /class="mode-notice is-home"/);
    assert.match(markup, /role="status"/);
    assert.match(markup, /aria-live="polite"/);
    assert.match(markup, /aria-atomic="true"/);
    assert.match(markup, /Working mode:/);
    assert.match(markup, /<strong>Home<\/strong> <span class="mode-notice-source">manual<\/span>/);
    assert.match(markup, /Questions are welcome\. Set by hand\./);
    assert.match(markup, /aria-label="Dismiss working mode notice"/);
    assert.match(markup, /type="button"/);
  });

  it("offers a session mute beside the dismiss control", () => {
    const markup = renderToStaticMarkup(
      <ModeNotice
        notice={{
          label: "Work",
          tone: "work",
          source: "manual",
          detail: "The dashboard finishes tasks without asking. Set by hand.",
        }}
        onDismiss={noop}
        onMute={noop}
      />,
    );

    // The mute is a separate, named control — not a second meaning for the ×.
    assert.match(markup, /class="mode-notice-mute"/);
    assert.match(markup, /aria-label="Mute working mode notices for this tab"/);
    assert.match(markup, />Mute<\/button>/);
    assert.match(markup, /title="No more mode notices in this tab; they return when it closes"/);
  });

  it("uses the work tone and keeps the dismiss target accessible", () => {
    const markup = renderToStaticMarkup(
      <ModeNotice
        notice={{
          label: "Work",
          tone: "work",
          source: "auto",
          detail: "The dashboard finishes tasks without asking. Inferred from the weekly schedule.",
        }}
        onDismiss={noop}
        onMute={noop}
      />,
    );

    assert.match(markup, /class="mode-notice is-work"/);
    assert.match(markup, /<strong>Work<\/strong>/);
    assert.match(markup, /aria-hidden="true">×</);
  });
});
