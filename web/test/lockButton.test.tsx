import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import LockButton, { LockButtonView } from "../src/components/LockButton.js";
import { SessionLockContext } from "../src/sessionLock.js";

const noop = () => {};

function view(overrides: { lockable?: boolean; busy?: boolean; error?: string | null } = {}): string {
  return renderToStaticMarkup(
    <LockButtonView
      lockable={overrides.lockable ?? true}
      busy={overrides.busy ?? false}
      error={overrides.error ?? null}
      onLock={noop}
    />,
  );
}

describe("LockButtonView", () => {
  it("shows nothing on an install with no token, where there is no session", () => {
    assert.equal(view({ lockable: false }), "");
  });

  it("is a labelled header button in the same square as the gear", () => {
    const markup = view();
    assert.match(markup, /class="icon-button lock-button"/);
    assert.match(markup, /type="button"/);
    assert.match(markup, /aria-label="Lock the dashboard"/);
    assert.match(markup, /title="Lock · ask for the access token again"/);
    assert.doesNotMatch(markup, /disabled/);
  });

  it("disables itself and says so while the session is being dropped", () => {
    const markup = view({ busy: true });
    assert.match(markup, /<button[^>]*disabled/);
    assert.match(markup, /aria-label="Locking the dashboard"/);
  });

  it("shows a failed lock instead of pretending the browser is signed out", () => {
    const markup = view({ error: "The session could not be locked." });
    assert.match(markup, /role="alert"/);
    assert.match(markup, /The session could not be locked\./);
  });

  it("renders no alert when nothing has gone wrong", () => {
    assert.doesNotMatch(view(), /role="alert"/);
  });
});

describe("LockButton outside a gate", () => {
  it("stays hidden, because the default session holds no lock", () => {
    assert.equal(renderToStaticMarkup(<LockButton />), "");
  });

  it("appears once a gate reports a token install", () => {
    const markup = renderToStaticMarkup(
      <SessionLockContext.Provider value={{ required: true, lock: async () => {} }}>
        <LockButton />
      </SessionLockContext.Provider>,
    );
    assert.match(markup, /aria-label="Lock the dashboard"/);
  });
});
