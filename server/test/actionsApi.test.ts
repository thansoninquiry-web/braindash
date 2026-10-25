import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createVaultApp, type VaultAppOptions } from "../src/app.js";

type Json = Record<string, any>;

interface Running {
  base: string;
  close(): Promise<void>;
}

/** Starts the real Express app on an ephemeral loopback port. */
async function start(options: VaultAppOptions = {}): Promise<Running> {
  const { app, cache } = createVaultApp({ staticDir: null, ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      cache?.close();
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

async function get(base: string, route: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${base}${route}`, { headers: { accept: "application/json" } });
  return { status: response.status, body: (await response.json()) as Json };
}

async function write(root: string, relative: string, raw: string): Promise<void> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, raw, "utf8");
}

/**
 * A vault whose captures sit near a zone boundary: `midday.md` is the 21st in
 * UTC and the 22nd in Kiritimati (+14), which is what proves the day is
 * converted rather than taken from the server clock.
 */
async function fixtureVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-actions-"));
  await write(
    root,
    "notes/today-timed.md",
    "---\ntitle: Today Timed\ncaptured: 2026-10-21 9:00 AM\ncaptured_zone: UTC\nnext_review: 2026-10-21\n---\nBody.\n",
  );
  await write(root, "notes/today-dated.md", "---\ntitle: Today Dated\ncaptured: 2026-10-21\n---\nBody.\n");
  await write(
    root,
    "notes/midday.md",
    "---\ntitle: Midday\ncaptured: 2026-10-21 12:00\ncaptured_zone: UTC\nnext_review: 2026-10-19\n---\nBody.\n",
  );
  await write(
    root,
    "notes/yesterday.md",
    "---\ntitle: Yesterday\ncaptured: 2026-10-20 9:00 AM\ncaptured_zone: UTC\n---\nBody.\n",
  );
  await write(root, "notes/future.md", "---\ntitle: Future\nnext_review: 2026-11-30\n---\nBody.\n");
  await write(root, "notes/bad.md", "---\ntitle: Bad Review\nnext_review: next week\n---\nBody.\n");
  await write(root, "notes/undated.md", "---\ntitle: Undated\n---\nBody.\n");
  return root;
}

let vault = "";
let app: Running | null = null;

before(async () => {
  vault = await fixtureVault();
  app = await start({ vaultPath: vault });
});

after(async () => {
  await app?.close();
  if (vault) await fs.rm(vault, { recursive: true, force: true });
});

function running(): Running {
  assert.ok(app, "the app should be running");
  return app;
}

describe("/api/captures/today", () => {
  it("lists the chosen day's captures, newest first, in the requested zone", async () => {
    const { status, body } = await get(running().base, "/api/captures/today?tz=UTC&date=2026-10-21");
    assert.equal(status, 200);
    assert.equal(body.date, "2026-10-21");
    assert.equal(body.timeZone, "UTC");
    assert.equal(body.total, 3);
    assert.deepEqual(
      body.notes.map((note: Json) => note.title),
      ["Midday", "Today Timed", "Today Dated"],
    );
    // The summary shape carries the review date too, so a row can show it.
    assert.equal(body.notes[0]?.nextReview, "2026-10-19");
  });

  it("moves a capture to the next day when the zone is ahead of UTC", async () => {
    const late = await get(
      running().base,
      "/api/captures/today?tz=Pacific/Kiritimati&date=2026-10-22",
    );
    assert.equal(late.status, 200);
    assert.deepEqual(
      late.body.notes.map((note: Json) => note.title),
      ["Midday"],
    );

    const sameUtcDay = await get(
      running().base,
      "/api/captures/today?tz=Pacific/Kiritimati&date=2026-10-21",
    );
    assert.equal(
      sameUtcDay.body.notes.some((note: Json) => note.title === "Midday"),
      false,
      "12:00 UTC is already the 22nd in +14",
    );
  });

  it("falls back to a real day when the date is malformed", async () => {
    const { status, body } = await get(running().base, "/api/captures/today?tz=UTC&date=not-a-day");
    assert.equal(status, 200);
    assert.match(body.date, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("/api/review/queue", () => {
  it("returns the due notes oldest first, with the overdue count", async () => {
    const { status, body } = await get(running().base, "/api/review/queue?tz=UTC&date=2026-10-21");
    assert.equal(status, 200);
    assert.equal(body.total, 2);
    assert.equal(body.overdue, 1);
    assert.deepEqual(
      body.notes.map((note: Json) => note.title),
      ["Midday", "Today Timed"],
    );
    assert.deepEqual(
      body.notes.map((note: Json) => note.nextReview),
      ["2026-10-19", "2026-10-21"],
    );
  });

  it("drops a future or malformed review date instead of guessing", async () => {
    const { body } = await get(running().base, "/api/review/queue?tz=UTC&date=2026-12-01");
    const titles = body.notes.map((note: Json) => note.title);
    assert.equal(titles.includes("Future"), true, "by December the future date is due");
    assert.equal(titles.includes("Bad Review"), false, "a non-date never enters the queue");
  });

  it("is empty before the first review date", async () => {
    const { body } = await get(running().base, "/api/review/queue?tz=UTC&date=2026-09-01");
    assert.equal(body.total, 0);
    assert.equal(body.overdue, 0);
    assert.deepEqual(body.notes, []);
  });
});

describe("/api/actions", () => {
  it("counts both actions for one day and describes them", async () => {
    const { status, body } = await get(running().base, "/api/actions?tz=UTC&date=2026-10-21");
    assert.equal(status, 200);
    assert.equal(body.date, "2026-10-21");
    assert.deepEqual(
      body.actions.map((action: Json) => [action.id, action.count]),
      [
        ["today", 3],
        ["review", 2],
      ],
    );
    assert.match(body.actions[0].hint, /3 notes captured/);
    assert.match(body.actions[1].hint, /1 of 2 overdue/);
  });

  it("says nothing is due instead of returning an empty catalogue", async () => {
    const { body } = await get(running().base, "/api/actions?tz=UTC&date=2026-09-01");
    assert.deepEqual(
      body.actions.map((action: Json) => action.count),
      [0, 0],
    );
    assert.match(body.actions[0].hint, /Nothing captured/);
    assert.match(body.actions[1].hint, /Nothing due/);
  });

  it("is vault-backed: all three routes answer 503 when VAULT_PATH is unset", async () => {
    const bare = await start({ vaultPath: null });
    try {
      for (const route of ["/api/actions", "/api/captures/today", "/api/review/queue"]) {
        const { status, body } = await get(bare.base, route);
        assert.equal(status, 503, route);
        assert.equal(body.error, "vault_not_configured", route);
      }
    } finally {
      await bare.close();
    }
  });
});
