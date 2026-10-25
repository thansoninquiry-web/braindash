import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  entryScore,
  paletteCommands,
  paletteRows,
  rankPalette,
  stepIndex,
  type PaletteEntry,
} from "../src/palette.js";

const SETTINGS: PaletteEntry = {
  id: "settings",
  label: "Open settings",
  detail: "Accent, clock, motion, refresh",
  group: "Commands",
  keywords: "theme preferences",
};

const ORCHARD: PaletteEntry = {
  id: "notes/orchard.md",
  label: "Alpha Orchard",
  detail: "notes/orchard.md · body",
  group: "Notes",
  keywords: "fruit",
};

describe("paletteCommands", () => {
  it("offers the actions that can run and counts the day", () => {
    const commands = paletteCommands({
      writable: true,
      graphReady: true,
      lockable: false,
      today: { count: 3 },
      review: { count: 0 },
    });
    const ids = commands.map((command) => command.id);
    assert.deepEqual(ids, [
      "rescan",
      "today",
      "review",
      "random",
      "graph",
      "compose",
      "trash",
      "settings",
      "core",
      "life",
    ]);
    assert.equal(commands.find((command) => command.id === "today")?.detail, "3 captured today");
    assert.equal(commands.find((command) => command.id === "review")?.detail, "0 due · oldest first");
    for (const command of commands) assert.equal(command.group, "Commands");
  });

  it("leaves out commands that cannot run yet", () => {
    const commands = paletteCommands({
      writable: false,
      graphReady: false,
      lockable: false,
      today: null,
      review: null,
    });
    const ids = commands.map((command) => command.id);
    assert.ok(!ids.includes("compose"), "read-only has no composer");
    assert.ok(!ids.includes("trash"), "read-only cannot restore, so no trash row");
    assert.ok(!ids.includes("graph"), "no graph means no map to open");
    assert.equal(
      commands.find((command) => command.id === "today")?.detail,
      "Open today's captures",
    );
    assert.equal(commands.find((command) => command.id === "review")?.detail, "Open the review queue");
    assert.ok(!ids.includes("lock"), "a no-token install has no session to drop");
  });

  it("offers the session lock last, only where a token installs one", () => {
    const commands = paletteCommands({
      writable: false,
      graphReady: false,
      lockable: true,
      today: null,
      review: null,
    });
    assert.equal(commands[commands.length - 1]?.id, "lock", "the lock is not the Enter default");
    const lock = commands.find((command) => command.id === "lock");
    assert.equal(lock?.label, "Lock dashboard");
    assert.equal(lock?.detail, "Drop this browser's session");
  });

  it("finds the lock by the words a person would try", () => {
    const commands = paletteCommands({
      writable: false,
      graphReady: false,
      lockable: true,
      today: null,
      review: null,
    });
    for (const query of ["sign out", "logout", "session"]) {
      assert.equal(rankPalette(commands, query)[0]?.id, "lock", query);
    }
  });
});

describe("paletteRows", () => {
  const locked = paletteCommands({
    writable: true,
    graphReady: true,
    lockable: true,
    today: { count: 1 },
    review: { count: 0 },
  });

  it("lists every command on an empty query, including the last", () => {
    assert.equal(locked.length, 11);
    const rows = paletteRows(locked, [], "");
    assert.equal(rows.length, locked.length, "the menu is not capped below its own count");
    assert.equal(rows[rows.length - 1]?.id, "lock");
  });

  it("still caps a typed search but keeps the row the query asked for", () => {
    const long = Array.from({ length: 14 }, (_, index) => ({
      ...SETTINGS,
      id: `filler-${index}`,
      label: `Filler ${index}`,
      keywords: "filler",
      detail: "nothing to see",
    }));
    const rows = paletteRows([...locked, ...long], [], "sign out");
    assert.equal(rows[0]?.id, "lock");
    assert.ok(rows.length <= 9, "a search stays capped");
  });

  it("puts note hits after the commands", () => {
    const rows = paletteRows(locked, [ORCHARD], "");
    assert.equal(rows[rows.length - 1]?.id, "notes/orchard.md");
    assert.equal(rows.length, locked.length + 1);
  });
});

describe("entryScore", () => {
  it("is zero for an empty query and null for an unrelated one", () => {
    assert.equal(entryScore(SETTINGS, "   "), 0);
    assert.equal(entryScore(SETTINGS, "zebra"), null);
  });

  it("finds a keyword the row does not paint, below a label match", () => {
    const keyword = entryScore(SETTINGS, "preferences");
    const label = entryScore(SETTINGS, "settings");
    assert.ok(keyword !== null && keyword > 0, "a keyword is searchable");
    assert.ok(label !== null && label > keyword, "the label still wins");
    // The detail line is a hint, not a name: it ranks under a keyword.
    const detail = entryScore(SETTINGS, "clock");
    assert.ok(detail !== null && detail < keyword);
  });

  it("matches case and spacing insensitively", () => {
    assert.equal(entryScore(SETTINGS, "  OPEN   SETTINGS  "), 100);
  });

  it("does not let a scattered run match inside the hint line", () => {
    // "a c m o" appears in order in "Accent, clock, motion, refresh" but is not
    // a word there; a hint must not pull every query into the list.
    assert.equal(entryScore(SETTINGS, "acmo"), null);
  });

  it("accepts a scattered subsequence in a name but ranks it below a literal match", () => {
    const scattered = entryScore(SETTINGS, "opstg");
    assert.ok(scattered !== null, "the letters appear in order");
    const literal = entryScore(SETTINGS, "settings");
    assert.ok(scattered !== null && literal !== null && literal > scattered);
  });
});

describe("rankPalette", () => {
  it("puts the best match first and drops the rows that do not match", () => {
    const ranked = rankPalette([ORCHARD, SETTINGS], "settings");
    assert.deepEqual(ranked.map((entry) => entry.id), ["settings"]);
    assert.deepEqual(rankPalette([ORCHARD, SETTINGS], "orchard").map((entry) => entry.id), [
      "notes/orchard.md",
    ]);
  });

  it("prefers a command when a command and a note match equally", () => {
    const note: PaletteEntry = { ...ORCHARD, id: "notes/review.md", label: "Review queue" };
    const command: PaletteEntry = { ...SETTINGS, id: "review", label: "Review queue" };
    const ranked = rankPalette([note, command], "review queue");
    assert.equal(ranked[0]?.id, "review");
    assert.equal(ranked[1]?.id, "notes/review.md");
  });

  it("keeps catalogue order for an empty query and respects the limit", () => {
    const ranked = rankPalette([SETTINGS, ORCHARD], "", 9);
    assert.deepEqual(ranked.map((entry) => entry.id), ["settings", "notes/orchard.md"]);
    assert.equal(rankPalette([SETTINGS, ORCHARD], "", 1).length, 1);
    assert.equal(rankPalette([SETTINGS, ORCHARD], "e", 1).length, 1);
  });

  it("returns nothing when no row matches", () => {
    assert.deepEqual(rankPalette([SETTINGS, ORCHARD], "zebra crossing"), []);
  });
});

describe("stepIndex", () => {
  it("wraps in both directions", () => {
    assert.equal(stepIndex(0, 3, 1), 1);
    assert.equal(stepIndex(2, 3, 1), 0);
    assert.equal(stepIndex(0, 3, -1), 2);
    assert.equal(stepIndex(2, 3, -2), 0);
  });

  it("stays at zero on an empty list", () => {
    assert.equal(stepIndex(0, 0, 1), 0);
    assert.equal(stepIndex(4, 0, -1), 0);
  });
});
