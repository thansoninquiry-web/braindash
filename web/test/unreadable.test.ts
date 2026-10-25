import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readFailureMessage,
  unreadableLabel,
  unreadableTooltip,
} from "../src/unreadable.ts";
import type { UnreadableEntry } from "../src/types.ts";

const entry = (path: string, code = "EACCES"): UnreadableEntry => ({ path, code });

describe("unreadableLabel", () => {
  it("is absent when every listed note was read", () => {
    assert.equal(unreadableLabel([]), null);
  });

  it("counts one or many notes, with the plural only when it is true", () => {
    assert.equal(unreadableLabel([entry("notes/locked.md")]), "1 note unreadable");
    assert.equal(
      unreadableLabel([entry("a.md"), entry("b.md")]),
      "2 notes unreadable",
    );
  });
});

describe("readFailureMessage", () => {
  it("turns the codes a vault actually produces into plain language", () => {
    assert.equal(readFailureMessage("EACCES"), "permission denied");
    assert.equal(readFailureMessage("EPERM"), "permission denied");
    assert.equal(readFailureMessage("ENOENT"), "vanished before it could be read");
    assert.equal(readFailureMessage("EISDIR"), "it is a folder, not a file");
    assert.equal(readFailureMessage("EIO"), "an I/O error");
  });

  it("is case-insensitive and does not invent a reason for an unknown code", () => {
    assert.equal(readFailureMessage("eacces"), "permission denied");
    assert.equal(readFailureMessage("UNKNOWN"), "the read failed");
    assert.equal(readFailureMessage("EWHATEVER"), "the read failed");
  });
});

describe("unreadableTooltip", () => {
  it("is empty when there is no row to explain", () => {
    assert.equal(unreadableTooltip([]), "");
  });

  it("lists every path with its reason, in scan order", () => {
    assert.equal(
      unreadableTooltip([
        entry("notes/locked.md", "EACCES"),
        entry("notes/vanished.md", "ENOENT"),
      ]),
      "Could not be read during the scan (2):\n" +
        "notes/locked.md — permission denied (EACCES)\n" +
        "notes/vanished.md — vanished before it could be read (ENOENT)",
    );
  });

  it("keeps an unrecognised code visible for whoever has to fix it", () => {
    assert.match(unreadableTooltip([entry("odd.md", "EWHATEVER")]), /the read failed \(EWHATEVER\)/);
  });
});
