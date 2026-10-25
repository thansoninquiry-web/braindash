import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VaultCache } from "../src/vaultCache.js";

type WatchMode = "ok" | "none" | "throws";

interface HarnessOptions {
  ttlMs?: number;
  watchMode?: WatchMode;
  scan?: () => Promise<number>;
}

/** A cache over a fake vault, with a manually fired watcher and clock. */
function harness({ ttlMs = 5_000, watchMode = "ok", scan }: HarnessOptions = {}) {
  let clock = 0;
  let scans = 0;
  let closes = 0;
  let watchAttempts = 0;
  let onChange: (() => void) | null = null;
  let onError: (() => void) | null = null;

  const cache = new VaultCache<number>({
    scan:
      scan ??
      (async () => {
        scans += 1;
        return scans;
      }),
    watch: (change, fail) => {
      watchAttempts += 1;
      onChange = change;
      onError = fail;
      if (watchMode === "throws") throw new Error("recursive watch unsupported");
      if (watchMode === "none") return null;
      return { close: () => { closes += 1; } };
    },
    fallbackTtlMs: ttlMs,
    now: () => clock,
  });

  return {
    cache,
    scans: () => scans,
    closes: () => closes,
    watchAttempts: () => watchAttempts,
    advance: (ms: number) => {
      clock += ms;
    },
    change: () => onChange?.(),
    failWatcher: () => onError?.(),
  };
}

/** A promise the test resolves by hand, for interleaving with a scan. */
function gate(): { promise: Promise<number>; open: (value: number) => void } {
  let open: (value: number) => void = () => {};
  const promise = new Promise<number>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("VaultCache — watching", () => {
  it("scans once and serves the snapshot while the watch is quiet", async () => {
    const vault = harness();
    assert.equal(await vault.cache.get(), 1);
    // The TTL is not the freshness rule while the watcher is alive.
    vault.advance(60 * 60_000);
    assert.equal(await vault.cache.get(), 1);
    assert.equal(vault.scans(), 1);
    assert.equal(vault.cache.isWatching, true);
    assert.equal(vault.watchAttempts(), 1);
  });

  it("rescans once after a change event, then serves the new snapshot", async () => {
    const vault = harness();
    await vault.cache.get();
    vault.change();
    assert.equal(await vault.cache.get(), 2);
    assert.equal(await vault.cache.get(), 2);
    assert.equal(vault.scans(), 2);
  });

  it("does not lose an event that lands mid-scan", async () => {
    const first = gate();
    let calls = 0;
    const vault = harness({
      scan: async () => {
        calls += 1;
        return calls === 1 ? first.promise : 2;
      },
    });

    const pending = vault.cache.get();
    vault.change();
    first.open(1);
    assert.equal(await pending, 1);
    // The snapshot is kept, but the event arrived after the scan began, so the
    // next request must read the vault again rather than trust it.
    assert.equal(await vault.cache.get(), 2);
  });

  it("waits for a rescan instead of serving the snapshot being replaced", async () => {
    const second = gate();
    let calls = 0;
    const vault = harness({
      scan: async () => {
        calls += 1;
        return calls === 1 ? 1 : second.promise;
      },
    });

    await vault.cache.get();
    vault.change();
    const rescan = vault.cache.get();
    const during = vault.cache.get();
    assert.equal(
      await Promise.race([during.then(() => "resolved"), Promise.resolve("pending")]),
      "pending",
      "a second caller must not read the old snapshot while the rescan runs",
    );
    second.open(2);
    assert.equal(await rescan, 2);
    assert.equal(await during, 2);
  });

  it("coalesces concurrent misses into one scan", async () => {
    const pendingScan = gate();
    let calls = 0;
    const vault = harness({
      scan: async () => {
        calls += 1;
        return pendingScan.promise;
      },
    });

    const a = vault.cache.get();
    const b = vault.cache.get();
    pendingScan.open(7);
    assert.deepEqual(await Promise.all([a, b]), [7, 7]);
    assert.equal(calls, 1, "both callers share the in-flight read");
    assert.equal(await vault.cache.get(), 7);
  });

  it("retries after a failed scan instead of serving a stale snapshot", async () => {
    let fail = true;
    let calls = 0;
    const vault = harness({
      scan: async () => {
        calls += 1;
        if (fail) throw new Error("vault exploded");
        return calls;
      },
    });

    await assert.rejects(vault.cache.get(), /vault exploded/);
    fail = false;
    assert.equal(await vault.cache.get(), 2);
  });

  it("rescans on demand when a manual rescan invalidates the cache", async () => {
    const vault = harness();
    await vault.cache.get();
    vault.cache.invalidate();
    assert.equal(await vault.cache.get(), 2);
    assert.equal(await vault.cache.get(), 2);
  });

  it("stops watching on close and falls back to the TTL", async () => {
    const vault = harness();
    await vault.cache.get();
    vault.cache.close();
    assert.equal(vault.cache.isWatching, false);
    assert.equal(vault.closes(), 1);

    vault.advance(5_001);
    assert.equal(await vault.cache.get(), 2);
    assert.equal(vault.watchAttempts(), 1, "a closed watcher is not restarted");
  });
});

describe("VaultCache — fallbacks", () => {
  it("uses the TTL when the platform has no watcher", async () => {
    const vault = harness({ watchMode: "none", ttlMs: 5_000 });
    assert.equal(await vault.cache.get(), 1);
    vault.advance(4_999);
    assert.equal(await vault.cache.get(), 1);
    vault.advance(2);
    assert.equal(await vault.cache.get(), 2);
    assert.equal(vault.cache.isWatching, false);
  });

  it("uses the TTL when starting the watcher throws", async () => {
    const vault = harness({ watchMode: "throws", ttlMs: 5_000 });
    assert.equal(await vault.cache.get(), 1);
    vault.advance(5_001);
    assert.equal(await vault.cache.get(), 2);
    assert.equal(vault.cache.isWatching, false);
  });

  it("rescans once and switches to the TTL after the watcher dies", async () => {
    const vault = harness({ ttlMs: 5_000 });
    await vault.cache.get();
    vault.failWatcher();
    assert.equal(vault.cache.isWatching, false);
    assert.equal(vault.closes(), 1, "the failed watcher is closed");

    // Events may have been missed before the error, so the next get rescans.
    assert.equal(await vault.cache.get(), 2);
    vault.advance(4_000);
    assert.equal(await vault.cache.get(), 2);
    vault.advance(1_500);
    assert.equal(await vault.cache.get(), 3);
  });
});
