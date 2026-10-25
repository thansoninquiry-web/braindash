import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FLARE_SECONDS,
  MAX_FLARE_NOTES,
  addedNotePaths,
  flareProgress,
  shouldFlare,
} from "../src/newNotes.ts";

describe("addedNotePaths", () => {
  it("stays quiet on the first scan, when every note would look new", () => {
    assert.deepEqual(addedNotePaths(null, ["a.md", "b.md"]), []);
  });

  it("finds the note that was not in the previous index", () => {
    assert.deepEqual(
      addedNotePaths(new Set(["a.md", "b.md"]), ["a.md", "b.md", "fresh.md"]),
      ["fresh.md"],
    );
  });

  it("keeps the cloud's order and ignores placeholder particles", () => {
    assert.deepEqual(
      addedNotePaths(new Set(["old.md"]), [null, "z.md", "old.md", "a.md"]),
      ["z.md", "a.md"],
    );
  });

  it("does not report a note twice or one that was already known", () => {
    assert.deepEqual(addedNotePaths(new Set(["a.md"]), ["a.md", "same.md", "same.md"]), ["same.md"]);
  });

  it("is empty when a scan only removed notes", () => {
    assert.deepEqual(addedNotePaths(new Set(["a.md", "gone.md"]), ["a.md"]), []);
  });
});

describe("shouldFlare", () => {
  it("treats a few arrivals as captures", () => {
    assert.equal(shouldFlare([]), false);
    assert.equal(shouldFlare(["one.md"]), true);
    assert.equal(shouldFlare(Array.from({ length: MAX_FLARE_NOTES }, (_, i) => `${i}.md`)), true);
  });

  it("refuses to sparkle a bulk import or a vault switch", () => {
    assert.equal(
      shouldFlare(Array.from({ length: MAX_FLARE_NOTES + 1 }, (_, i) => `${i}.md`)),
      false,
    );
  });
});

describe("flareProgress", () => {
  it("starts at the core, bright, and lands in place with the flare spent", () => {
    const start = flareProgress(10, 10);
    assert.equal(start.progress, 0);
    assert.equal(start.eased, 0);
    assert.equal(start.spark, 1);

    const end = flareProgress(10, 10 + FLARE_SECONDS + 0.5);
    assert.equal(end.progress, 1);
    assert.equal(end.eased, 1);
    assert.equal(end.spark, 0);
  });

  it("eases out and fades monotonically", () => {
    let previousEased = -1;
    let previousSpark = 2;
    for (let step = 0; step <= 20; step += 1) {
      const point = flareProgress(0, (FLARE_SECONDS * step) / 20);
      assert.ok(point.eased >= previousEased, `eased at step ${step}`);
      assert.ok(point.spark <= previousSpark, `spark at step ${step}`);
      previousEased = point.eased;
      previousSpark = point.spark;
    }
  });

  it("clamps a clock that is early, late or paused", () => {
    assert.deepEqual(flareProgress(5, 4), flareProgress(5, 5));
    assert.deepEqual(flareProgress(5, 99), flareProgress(5, 5 + FLARE_SECONDS + 1));
    assert.equal(flareProgress(5, 6, 0).progress, 1, "a zero duration lands immediately");
  });
});
