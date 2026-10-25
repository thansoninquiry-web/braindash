import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { createVaultApp } from "../src/app.js";
import { createDepsReader, ERROR_TTL_MS, OK_TTL_MS, type DependencyHealth, type DepsReader } from "../src/deps.js";
import type { DriftReport, OutdatedEntry } from "../../scripts/check-deps.mjs";

function row(overrides: Partial<OutdatedEntry> = {}): OutdatedEntry {
  return {
    name: "vite",
    current: "6.3.4",
    wanted: "6.4.4",
    latest: "6.4.4",
    type: "devDependencies",
    dependent: "web",
    ...overrides,
  };
}

function staleReport(): DriftReport {
  return {
    // classifyOutdated sorts by name; the fixture keeps that order so the
    // reader is not credited with sorting it does not do.
    inRange: [row({ name: "react", current: "19.0.0", wanted: "19.1.0" }), row()],
    outOfRange: [row({ name: "express", current: "4.22.3", wanted: "4.22.3", latest: "5.3.0", dependent: "server" })],
  };
}

const FIXED = Date.UTC(2026, 9, 21, 5, 0, 0);

function clock(start = FIXED) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

async function start(deps: DepsReader) {
  const { app } = createVaultApp({ staticDir: null, vaultPath: null, deps });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

describe("deps — turning the drift report into the card's payload", () => {
  it("reports the count behind, the informational majors and sorted rows", async () => {
    const reader = createDepsReader({
      now: () => FIXED,
      collect: async () => ({ ok: true, report: staleReport() }),
    });
    const health = await reader.read();
    assert.equal(health.ok, true);
    assert.equal(health.behind, 2);
    assert.equal(health.newer, 1);
    assert.deepEqual(
      health.stale.map((entry) => [entry.name, entry.current, entry.wanted]),
      [
        ["react", "19.0.0", "19.1.0"],
        ["vite", "6.3.4", "6.4.4"],
      ],
    );
    assert.deepEqual(health.majors.map((entry) => entry.name), ["express"]);
    assert.equal(health.cached, false);
    assert.equal(health.checkedAt, new Date(FIXED).toISOString());
    assert.equal(health.error, null);
  });

  it("caches a good answer for the full window and then refreshes", async () => {
    const time = clock();
    let calls = 0;
    const reader = createDepsReader({
      now: time.now,
      collect: async () => {
        calls += 1;
        return { ok: true, report: staleReport() };
      },
    });

    const first = await reader.read();
    const second = await reader.read();
    assert.equal(calls, 1);
    assert.equal(second.cached, true, "the second answer comes from the cache");
    assert.equal(second.behind, first.behind);

    time.advance(OK_TTL_MS - 1);
    await reader.read();
    assert.equal(calls, 1, "still inside the window");

    time.advance(2);
    const fresh = await reader.read();
    assert.equal(calls, 2);
    assert.equal(fresh.cached, false);
  });

  it("lets Recheck skip the cache", async () => {
    let calls = 0;
    let behind = 1;
    const reader = createDepsReader({
      collect: async () => {
        calls += 1;
        const inRange = Array.from({ length: behind }, (_, index) => row({ name: `package-${index}` }));
        return { ok: true, report: { inRange, outOfRange: [] } };
      },
    });
    assert.equal((await reader.read()).behind, 1);
    behind = 2;
    const forced = await reader.read({ refresh: true });
    assert.equal(calls, 2);
    assert.equal(forced.behind, 2);
    assert.equal(forced.cached, false);
  });

  it("caches a failure briefly so a broken registry is not asked on every poll", async () => {
    const time = clock();
    let calls = 0;
    let healthy = false;
    const reader = createDepsReader({
      now: time.now,
      collect: async () => {
        calls += 1;
        return healthy ? { ok: true, report: staleReport() } : { ok: false, error: "npm outdated failed (exit 1)" };
      },
    });

    const failed = await reader.read();
    assert.equal(failed.ok, false);
    assert.equal(failed.behind, 0);
    assert.match(failed.error ?? "", /npm outdated failed/);
    await reader.read();
    assert.equal(calls, 1, "an error is still cached");

    time.advance(ERROR_TTL_MS + 1);
    healthy = true;
    const recovered = await reader.read();
    assert.equal(calls, 2);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.behind, 2);
  });

  it("shares one npm run between concurrent requests", async () => {
    let calls = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = createDepsReader({
      collect: async () => {
        calls += 1;
        await gate;
        return { ok: true, report: staleReport() };
      },
    });

    const [a, b] = [reader.read(), reader.read()];
    release();
    const [first, second] = await Promise.all([a, b]);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
  });

  it("turns a throwing collector into an unavailable answer instead of an exception", async () => {
    const reader = createDepsReader({
      collect: async () => {
        throw new Error("spawn npm ENOENT");
      },
    });
    const health = await reader.read();
    assert.equal(health.ok, false);
    assert.match(health.error ?? "", /spawn npm ENOENT/);
  });
});

describe("deps — the route", () => {
  it("serves the payload uncached and forwards refresh", async () => {
    const refreshes: boolean[] = [];
    const health: DependencyHealth = {
      ok: true,
      checkedAt: new Date(FIXED).toISOString(),
      behind: 2,
      newer: 1,
      stale: [{ name: "vite", current: "6.3.4", wanted: "6.4.4", latest: "6.4.4", dependent: "web" }],
      majors: [],
      error: null,
      cached: false,
    };
    const running = await start({
      async read({ refresh = false } = {}) {
        refreshes.push(refresh);
        return health;
      },
    });
    try {
      const response = await fetch(`${running.base}/api/deps`, { headers: { accept: "application/json" } });
      const body = (await response.json()) as DependencyHealth;
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(body.behind, 2);
      assert.equal(body.stale[0]?.name, "vite");

      await fetch(`${running.base}/api/deps?refresh=1`);
      assert.deepEqual(refreshes, [false, true]);
    } finally {
      await running.close();
    }
  });

  it("answers even when the vault is not configured", async () => {
    const running = await start({
      async read() {
        return {
          ok: false,
          checkedAt: new Date(FIXED).toISOString(),
          behind: 0,
          newer: 0,
          stale: [],
          majors: [],
          error: "npm outdated failed (exit 1)",
          cached: false,
        };
      },
    });
    try {
      const response = await fetch(`${running.base}/api/deps`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as DependencyHealth;
      assert.equal(body.ok, false);
      assert.match(body.error ?? "", /npm outdated failed/);
    } finally {
      await running.close();
    }
  });
});
