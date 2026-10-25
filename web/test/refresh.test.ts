import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REFRESH_OPTIONS,
  isRefreshDue,
  resolveRefreshMs,
  shouldCheckVault,
} from "../src/refresh.js";

const MINUTE = 60_000;

describe("refresh options", () => {
  it("offers a cadence for each option and a way out", () => {
    assert.deepEqual(
      REFRESH_OPTIONS.map((option) => option.id),
      ["1m", "5m", "off"],
    );
    assert.equal(resolveRefreshMs("1m"), MINUTE);
    assert.equal(resolveRefreshMs("5m"), 5 * MINUTE);
    assert.equal(resolveRefreshMs("off"), null);
  });
});

describe("isRefreshDue", () => {
  it("is never due when the dashboard is told not to check", () => {
    assert.equal(isRefreshDue(null, 10 * MINUTE, "off"), false);
    assert.equal(isRefreshDue(0, 10 * MINUTE, "off"), false);
  });

  it("is due straight away when this window has never checked", () => {
    assert.equal(isRefreshDue(null, 5_000, "1m"), true);
  });

  it("waits out the interval, then checks once per interval", () => {
    const seen = 1_000_000;
    assert.equal(isRefreshDue(seen, seen, "1m"), false);
    assert.equal(isRefreshDue(seen, seen + MINUTE - 1, "1m"), false);
    assert.equal(isRefreshDue(seen, seen + MINUTE, "1m"), true);
    assert.equal(isRefreshDue(seen, seen + 5 * MINUTE - 1, "5m"), false);
    assert.equal(isRefreshDue(seen, seen + 5 * MINUTE, "5m"), true);
  });

  it("catches up after a gap, however long the window slept", () => {
    const slept = 1_000_000;
    const woke = slept + 6 * 60 * MINUTE;
    assert.equal(isRefreshDue(slept, woke, "1m"), true);
    assert.equal(isRefreshDue(slept, woke, "5m"), true);
  });
});

describe("shouldCheckVault", () => {
  it("never checks while the window is hidden, however overdue", () => {
    const stale = 1_000_000;
    const muchLater = stale + 60 * MINUTE;
    assert.equal(
      shouldCheckVault({ hidden: true, lastCheckedAt: stale, now: muchLater }, "1m"),
      false,
    );
    assert.equal(
      shouldCheckVault({ hidden: true, lastCheckedAt: null, now: muchLater }, "1m"),
      false,
    );
  });

  it("checks a visible window once the interval has passed", () => {
    const seen = 1_000_000;
    assert.equal(
      shouldCheckVault({ hidden: false, lastCheckedAt: seen, now: seen + MINUTE }, "1m"),
      true,
    );
    assert.equal(
      shouldCheckVault({ hidden: false, lastCheckedAt: seen, now: seen + 30_000 }, "1m"),
      false,
    );
  });

  it("stays quiet when refresh is off, even in view", () => {
    assert.equal(
      shouldCheckVault({ hidden: false, lastCheckedAt: 0, now: 60 * MINUTE }, "off"),
      false,
    );
  });
});
