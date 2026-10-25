import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessGateView } from "../src/components/AccessGate.js";
import { accessState, usableToken } from "../src/access.js";

const noop = () => {};

function render(overrides: { state: "checking" | "locked" | "open"; busy?: boolean; error?: string | null }): string {
  return renderToStaticMarkup(
    <AccessGateView
      state={overrides.state}
      busy={overrides.busy ?? false}
      error={overrides.error ?? null}
      onUnlock={noop}
    />,
  );
}

describe("accessState", () => {
  it("waits until the session answer arrives", () => {
    assert.equal(accessState(null), "checking");
  });

  it("opens an install that requires no token", () => {
    assert.equal(accessState({ required: false, authenticated: false }), "open");
  });

  it("opens a browser that already presented the token", () => {
    assert.equal(accessState({ required: true, authenticated: true }), "open");
  });

  it("locks only when a token is required and missing", () => {
    assert.equal(accessState({ required: true, authenticated: false }), "locked");
  });
});

describe("usableToken", () => {
  it("trims a pasted token and keeps inner characters", () => {
    assert.equal(usableToken("  abc.def  "), "abc.def");
    assert.equal(usableToken("with space"), "with space");
  });

  it("is null for a blank field", () => {
    assert.equal(usableToken(""), null);
    assert.equal(usableToken("   \n"), null);
  });
});

describe("AccessGateView", () => {
  it("renders the unlock form with a masked, labelled field", () => {
    const markup = render({ state: "locked" });
    assert.match(markup, /Access token required/);
    assert.match(markup, /<label[^>]*for="access-token"[^>]*>Access token<\/label>/);
    assert.match(markup, /<input[^>]*id="access-token"/);
    assert.match(markup, /type="password"/);
    assert.match(markup, /name="token"/);
    // React's server renderer keeps the JSX casing for `autoComplete`.
    assert.match(markup, /autocomplete="current-password"/i);
    assert.match(markup, /type="submit"[^>]*>Unlock</);
    assert.match(markup, /remembers the token for a week/);
    assert.doesNotMatch(markup, /role="alert"/);
    // The field starts empty: nothing is prefilled or echoed into the markup.
    assert.doesNotMatch(markup, /value="[^"]+"/);
  });

  it("shows an error in an alert and drops the hint", () => {
    const markup = render({ state: "locked", error: "That access token was not accepted." });
    assert.match(markup, /role="alert"/);
    assert.match(markup, /That access token was not accepted\./);
    assert.doesNotMatch(markup, /remembers the token for a week/);
  });

  it("disables the field and button while a token is being checked", () => {
    const markup = render({ state: "locked", busy: true });
    assert.match(markup, /<button[^>]*disabled[^>]*>Checking…</);
    assert.match(markup, /<input[^>]*disabled/);
  });

  it("says it is checking before the session answer arrives, without a form", () => {
    const markup = render({ state: "checking" });
    assert.match(markup, /Checking access…/);
    assert.match(markup, /role="status"/);
    assert.doesNotMatch(markup, /<form/);
    assert.doesNotMatch(markup, /type="password"/);
  });

  it("renders nothing once the dashboard may mount", () => {
    assert.equal(render({ state: "open" }), "");
  });
});
