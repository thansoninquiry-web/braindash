import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { headingSlug } from "../src/headingTarget.ts";

describe("headingSlug — the comparable name of a heading", () => {
  it("folds case, spacing and punctuation", () => {
    assert.equal(headingSlug("My Heading"), "my-heading");
    assert.equal(headingSlug("  my   heading  "), "my-heading");
    assert.equal(headingSlug("What's next?"), "whats-next");
    assert.equal(headingSlug("Hello, world!"), "hello-world");
    assert.equal(headingSlug("my-heading"), "my-heading");
  });

  it("strips the inline markdown the renderer would show as markup", () => {
    assert.equal(headingSlug("Use `fs` and **care**"), "use-fs-and-care");
    assert.equal(headingSlug("_quiet_ opening"), "quiet-opening");
  });

  it("reads a wikilink in a heading as its label", () => {
    assert.equal(headingSlug("See [[Daily|today's log]]"), "see-todays-log");
    assert.equal(headingSlug("See [[Daily]]"), "see-daily");
  });

  it("keeps letters and digits from any script", () => {
    assert.equal(headingSlug("Über café — notes"), "über-café-notes");
    assert.equal(headingSlug("2026 goals"), "2026-goals");
  });

  it("is empty when there is nothing to match on", () => {
    assert.equal(headingSlug(""), "");
    assert.equal(headingSlug("   "), "");
    assert.equal(headingSlug("?!—"), "");
  });
});
