import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ZOOM_STEP,
  cloudFocusIndex,
  cloudKeyAction,
  cursorTargetPath,
  stepCursor,
} from "../src/cloudCursor.ts";

describe("stepCursor", () => {
  it("starts on the first note when moving forward from nothing", () => {
    assert.equal(stepCursor(null, 1, 4), 0);
  });

  it("starts on the last note when moving backward from nothing", () => {
    assert.equal(stepCursor(null, -1, 4), 3);
  });

  it("advances and wraps at the end", () => {
    assert.equal(stepCursor(0, 1, 4), 1);
    assert.equal(stepCursor(2, 1, 4), 3);
    assert.equal(stepCursor(3, 1, 4), 0);
  });

  it("walks backward and wraps past the start", () => {
    assert.equal(stepCursor(3, -1, 4), 2);
    assert.equal(stepCursor(0, -1, 4), 3);
  });

  it("stays on the only note when there is one", () => {
    assert.equal(stepCursor(null, 1, 1), 0);
    assert.equal(stepCursor(null, -1, 1), 0);
    assert.equal(stepCursor(0, 1, 1), 0);
    assert.equal(stepCursor(0, -1, 1), 0);
  });

  it("leaves the cursor untouched when the cloud is empty", () => {
    assert.equal(stepCursor(null, 1, 0), null);
    assert.equal(stepCursor(null, -1, 0), null);
    assert.equal(stepCursor(2, 1, 0), 2);
    assert.equal(stepCursor(2, -1, 0), 2);
  });

  it("returns to the start after a full lap", () => {
    const count = 7;
    let cursor: number | null = 0;
    for (let index = 0; index < count; index += 1) cursor = stepCursor(cursor, 1, count);
    assert.equal(cursor, 0);
  });

  it("walks the whole list once from nothing, ending on the last note", () => {
    const count = 5;
    const visited: number[] = [];
    let cursor: number | null = null;
    for (let index = 0; index < count; index += 1) {
      cursor = stepCursor(cursor, 1, count);
      assert.ok(cursor !== null);
      visited.push(cursor);
    }
    assert.deepEqual(visited, [0, 1, 2, 3, 4]);
  });

  it("never lands outside the list", () => {
    const count = 5;
    for (let start = 0; start < count; start += 1) {
      for (const delta of [1, -1] as const) {
        const next = stepCursor(start, delta, count);
        assert.ok(next !== null && next >= 0 && next < count, `${start} ${delta} -> ${next}`);
      }
    }
  });
});

describe("cloudFocusIndex", () => {
  it("gives the label to the pointer whenever it is over a node", () => {
    assert.equal(cloudFocusIndex({ hovered: 4, settled: 2, selected: 1, cursor: 3 }), 4);
    assert.equal(cloudFocusIndex({ hovered: 0, settled: 0, selected: 0, cursor: 0 }), 0);
  });

  it("names the landed note before a clicked cluster or the keyboard cursor", () => {
    assert.equal(cloudFocusIndex({ hovered: null, settled: 2, selected: 1, cursor: 3 }), 2);
    assert.equal(cloudFocusIndex({ hovered: null, settled: 0, selected: 0, cursor: 0 }), 0);
  });

  it("falls back to the clicked cluster and then the cursor", () => {
    assert.equal(cloudFocusIndex({ hovered: null, settled: null, selected: 1, cursor: 3 }), 1);
    assert.equal(cloudFocusIndex({ hovered: null, settled: null, selected: null, cursor: 3 }), 3);
  });

  it("is empty when nothing is focused", () => {
    assert.equal(cloudFocusIndex({ hovered: null, settled: null, selected: null, cursor: null }), null);
  });
});

describe("cloudKeyAction", () => {
  it("maps both rightward arrows to a forward move", () => {
    assert.deepEqual(cloudKeyAction("ArrowRight"), { type: "move", delta: 1 });
    assert.deepEqual(cloudKeyAction("ArrowDown"), { type: "move", delta: 1 });
  });

  it("maps both leftward arrows to a backward move", () => {
    assert.deepEqual(cloudKeyAction("ArrowLeft"), { type: "move", delta: -1 });
    assert.deepEqual(cloudKeyAction("ArrowUp"), { type: "move", delta: -1 });
  });

  it("opens on Enter and Space", () => {
    assert.deepEqual(cloudKeyAction("Enter"), { type: "open" });
    assert.deepEqual(cloudKeyAction(" "), { type: "open" });
  });

  it("zooms in and out with either symbol of each pair", () => {
    assert.deepEqual(cloudKeyAction("+"), { type: "zoom", direction: 1 });
    assert.deepEqual(cloudKeyAction("="), { type: "zoom", direction: 1 });
    assert.deepEqual(cloudKeyAction("-"), { type: "zoom", direction: -1 });
    assert.deepEqual(cloudKeyAction("_"), { type: "zoom", direction: -1 });
  });

  it("resets on r, R and 0", () => {
    for (const key of ["r", "R", "0"]) assert.deepEqual(cloudKeyAction(key), { type: "reset" });
  });

  it("clears the cursor on Escape", () => {
    assert.deepEqual(cloudKeyAction("Escape"), { type: "clear" });
  });

  it("ignores everything else, including near misses", () => {
    for (const key of ["a", "Tab", "Enter ", "escape", "ArrowRightEdge", "1"]) {
      assert.equal(cloudKeyAction(key), null, `${JSON.stringify(key)} is not a cloud key`);
    }
  });

  it("uses a zoom step that compounds the same way in both directions", () => {
    assert.ok(ZOOM_STEP > 1);
    assert.equal(ZOOM_STEP * (1 / ZOOM_STEP), 1);
  });
});

describe("cursorTargetPath", () => {
  it("has nothing to open without a cursor, and does not read the list", () => {
    let calls = 0;
    const path = cursorTargetPath(null, () => {
      calls += 1;
      return "notes/a.md";
    });
    assert.equal(path, null);
    assert.equal(calls, 0);
  });

  it("resolves the note at the cursor index", () => {
    const paths = ["notes/a.md", "notes/b.md", null, "notes/c.md"];
    assert.equal(cursorTargetPath(1, (index) => paths[index]), "notes/b.md");
    assert.equal(cursorTargetPath(3, (index) => paths[index]), "notes/c.md");
  });

  it("passes the cursor index straight through", () => {
    const seen: number[] = [];
    cursorTargetPath(2, (index) => {
      seen.push(index);
      return null;
    });
    assert.deepEqual(seen, [2]);
  });

  it("treats a spark with no note, an empty path or a missing slot as unopenable", () => {
    assert.equal(cursorTargetPath(0, () => null), null);
    assert.equal(cursorTargetPath(0, () => undefined), null);
    assert.equal(cursorTargetPath(0, () => ""), null);
  });
});
