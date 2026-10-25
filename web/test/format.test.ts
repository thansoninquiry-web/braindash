import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exactBytes, formatBytes } from "../src/format.js";

describe("formatBytes", () => {
  it("keeps small files in bytes", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1), "1 B");
    assert.equal(formatBytes(982), "982 B");
    assert.equal(formatBytes(1023), "1,023 B");
  });

  it("steps to kB at 1024 and MB at 1024²", () => {
    assert.equal(formatBytes(1024), "1.0 kB");
    assert.equal(formatBytes(1536), "1.5 kB");
    assert.equal(formatBytes(63_329), "61.8 kB");
    assert.equal(formatBytes(1024 * 1024), "1.00 MB");
    assert.equal(formatBytes(1_048_576 * 1.5), "1.50 MB");
  });

  it("never renders a negative or absurd size", () => {
    assert.equal(formatBytes(-10), "0 B");
    assert.equal(formatBytes(Number.NaN), "0 B");
    assert.equal(formatBytes(Number.POSITIVE_INFINITY), "0 B");
  });
});

describe("exactBytes", () => {
  it("gives a grouped, rounded byte count for a tooltip", () => {
    assert.equal(exactBytes(0), "0 bytes");
    assert.equal(exactBytes(63_329.4), "63,329 bytes");
    assert.equal(exactBytes(-4), "0 bytes");
  });
});
