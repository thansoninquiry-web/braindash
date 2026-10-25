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
  cache: ReturnType<typeof createVaultApp>["cache"];
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
    cache,
    async close() {
      cache?.close();
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

async function get(base: string, route: string): Promise<{ status: number; body: Json; headers: Headers }> {
  const response = await fetch(`${base}${route}`, { headers: { accept: "application/json" } });
  const body = (await response.json()) as Json;
  return { status: response.status, body, headers: response.headers };
}

async function write(root: string, relative: string, raw: string): Promise<void> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, raw, "utf8");
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "braindash-api-"));
}

function assertError(
  response: { status: number; body: Json },
  status: number,
  code: string,
  detail?: RegExp,
): void {
  assert.equal(response.status, status);
  assert.equal(response.body.error, code);
  assert.equal(typeof response.body.detail, "string");
  if (detail) assert.match(response.body.detail, detail);
  // A thrown error's stack must never leak through the JSON shape.
  assert.equal("stack" in response.body, false);
}

/**
 * A small vault that exercises metadata, wikilinks, tags, search, graph and the
 * three life folders. The life notes are indexed too, hence six notes.
 */
async function fixtureVault(): Promise<string> {
  const root = await tempDir();
  await write(
    root,
    "notes/alpha.md",
    `---
title: Alpha Note
captured: 2026-10-18 3:38 PM
captured_zone: America/New_York
origin: ai
area: career
tags: [focus, api]
---
# Alpha Note

The orchard and the lantern. A link to [[Beta Note]].
`,
  );
  await write(
    root,
    "notes/beta.md",
    `---
title: Beta Note
captured: 2026-10-17
area: life
tags: focus
---
# Beta Note

Back to [[Alpha Note]].
`,
  );
  await write(root, "notes/gamma.md", "# Gamma Note\n\nA quiet harbour, no links at all.\n");
  await write(
    root,
    "Daily/2026-10-19.md",
    "---\ntitle: Daily 2026-10-19\nsleep_hrs: 7.5\ndeep_work_hrs: 3\nwin: Shipped the API suite\n---\n",
  );
  await write(
    root,
    "Monthly/2026-10.md",
    "---\ntitle: Monthly 2026-10\nnet_worth: 12000\nsavings_rate: 0.24\n---\n",
  );
  await write(root, "Weekly/2026-W42.md", "---\ntitle: Weekly 2026-W42\nfocus: 8\n---\n");
  return root;
}

describe("API routes — configured vault", () => {
  let root = "";
  let server: Running;

  before(async () => {
    root = await fixtureVault();
    server = await start({ vaultPath: root, watch: null });
  });

  after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reports health with the resolved vault and note count", async () => {
    const response = await get(server.base, "/api/health");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.configured, true);
    assert.equal(response.body.vaultPath, root);
    assert.equal(response.body.noteCount, 6);
    assert.equal(typeof response.body.uptimeSeconds, "number");
    assert.equal(response.body.version, "0.1.0");
  });

  it("serves stats with the totals, series and fingerprint", async () => {
    const response = await get(server.base, "/api/stats");
    assert.equal(response.status, 200);
    assert.equal(response.body.totalNotes, 6);
    assert.equal(response.body.withCaptured, 2);
    assert.deepEqual(response.body.byArea, { career: 1, life: 1, ideas: 0, unset: 4 });
    assert.equal(response.body.series.length, 30);
    assert.equal(typeof response.body.fingerprint, "string");
    assert.ok(response.body.fingerprint.length > 0);
    assert.equal(response.body.lastCapture?.title, "Alpha Note");
    assert.equal(response.body.lastCapture?.capturedZone, "America/New_York");
    assert.equal(response.body.vaultPath, root);
  });

  it("accepts a valid timezone and tolerates a malformed one", async () => {
    const tokyo = await get(server.base, "/api/stats?tz=Asia%2FTokyo");
    assert.equal(tokyo.status, 200);
    assert.equal(tokyo.body.totalNotes, 6);

    const malformed = await get(server.base, "/api/stats?tz=Not%2FAZone");
    assert.equal(malformed.status, 200);
    assert.equal(malformed.body.totalNotes, 6);
  });

  it("lists note summaries in path order without bodies", async () => {
    const response = await get(server.base, "/api/notes");
    assert.equal(response.status, 200);
    assert.equal(response.body.total, 6);
    const paths = response.body.notes.map((note: Json) => note.path) as string[];
    assert.deepEqual(paths, [...paths].sort((a, b) => a.localeCompare(b)));
    const alpha = response.body.notes.find((note: Json) => note.path === "notes/alpha.md");
    assert.ok(alpha, "alpha is indexed");
    assert.equal(alpha.title, "Alpha Note");
    assert.equal(alpha.capturedZone, "America/New_York");
    assert.equal(alpha.origin, "ai");
    assert.equal(alpha.area, "career");
    assert.deepEqual(alpha.tags, ["focus", "api"]);
    assert.equal(typeof alpha.words, "number");
    assert.equal(typeof alpha.bytes, "number");
    assert.equal("markdown" in alpha, false);
    assert.equal("frontmatter" in alpha, false);
    // Nothing was linked in this vault, but the field is always present so a
    // client can tell "no skips" from "the server did not say".
    assert.deepEqual(response.body.skipped, []);
    // Same for notes whose read failed: an empty list, not a missing field.
    assert.deepEqual(response.body.unreadable, []);
  });

  it("opens a note with its connections and vault root", async () => {
    const response = await get(server.base, "/api/notes/notes/alpha.md");
    assert.equal(response.status, 200);
    assert.equal(response.body.path, "notes/alpha.md");
    assert.equal(response.body.title, "Alpha Note");
    assert.match(response.body.markdown, /The orchard and the lantern/);
    assert.equal(typeof response.body.size, "number");
    assert.equal(response.body.vaultPath, path.resolve(root));

    assert.deepEqual(response.body.outbound, [
      {
        target: "Beta Note",
        heading: null,
        alias: null,
        label: "Beta Note",
        path: "notes/beta.md",
        title: "Beta Note",
      },
    ]);
    assert.deepEqual(
      response.body.backlinks.map((link: Json) => ({
        path: link.path,
        via: link.via,
      })),
      [{ path: "notes/beta.md", via: "wikilink" }],
    );
  });

  it("rejects a missing note, a non-markdown path and traversal with the documented shapes", async () => {
    const missing = await get(server.base, "/api/notes/notes/nope.md");
    assertError(missing, 404, "not_found", /No note at that path/);

    const notMarkdown = await get(server.base, "/api/notes/notes/alpha.txt");
    assertError(notMarkdown, 400, "not_markdown", /Only \.md notes/);

    const traversal = await get(server.base, "/api/notes/..%2F..%2Fsecret.md");
    assertError(traversal, 400, "invalid_path");
  });

  it("searches titles, tags, frontmatter and bodies", async () => {
    const bodyHit = await get(server.base, "/api/search?q=orchard");
    assert.equal(bodyHit.status, 200);
    assert.equal(bodyHit.body.query, "orchard");
    assert.equal(bodyHit.body.total, 1);
    assert.equal(bodyHit.body.results[0].path, "notes/alpha.md");
    assert.equal(bodyHit.body.results[0].match, "body");
    assert.match(bodyHit.body.results[0].snippet, /orchard/i);
    assert.equal(bodyHit.body.results[0].capturedZone, "America/New_York");
    assert.equal(typeof bodyHit.body.scannedAt, "string");

    const tagHit = await get(server.base, "/api/search?q=focus");
    assert.equal(tagHit.status, 200);
    assert.ok(tagHit.body.total >= 2);
    assert.equal(tagHit.body.results[0].match, "tag");
    assert.ok(tagHit.body.results.some((hit: Json) => hit.path === "Weekly/2026-W42.md"));

    const none = await get(server.base, "/api/search?q=zzzz-nothing");
    assert.equal(none.status, 200);
    assert.equal(none.body.total, 0);
    assert.deepEqual(none.body.results, []);
  });

  it("explains a search with no query instead of scanning", async () => {
    const response = await get(server.base, "/api/search");
    assert.equal(response.status, 200);
    assert.equal(response.body.query, "");
    assert.equal(response.body.total, 0);
    assert.deepEqual(response.body.results, []);
    assert.equal(response.body.hint, "Pass ?q=<term>");
  });

  it("picks a deterministic daily note and rotates on skip", async () => {
    const first = await get(server.base, "/api/recall/today?date=2026-10-19&skip=0");
    assert.equal(first.status, 200);
    assert.equal(first.body.date, "2026-10-19");
    assert.equal(first.body.skip, 0);
    assert.equal(first.body.total, 6);
    assert.equal(typeof first.body.note.path, "string");
    assert.ok(Array.isArray(first.body.note.tags));

    const again = await get(server.base, "/api/recall/today?date=2026-10-19&skip=0");
    assert.deepEqual(again.body.note, first.body.note, "same day and skip pick the same note");

    const skipped = await get(server.base, "/api/recall/today?date=2026-10-19&skip=1");
    assert.equal(skipped.body.skip, 1);
    assert.notEqual(skipped.body.note.path, first.body.note.path);
  });

  it("falls back to the server day for a malformed date and clamps a negative skip", async () => {
    const response = await get(server.base, "/api/recall/today?date=nope&skip=-4");
    assert.equal(response.status, 200);
    assert.match(response.body.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(response.body.skip, 0);
  });

  it("builds the graph from wikilinks and tags", async () => {
    const response = await get(server.base, "/api/graph");
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.scannedAt, "string");
    assert.equal(response.body.nodes.length, 6);
    assert.equal(response.body.truncated, false);
    assert.deepEqual(response.body.unresolved, []);

    const pair = ["notes/alpha.md", "notes/beta.md"].sort().join("|");
    const edge = response.body.edges.find(
      (entry: Json) => [entry.source, entry.target].sort().join("|") === pair,
    );
    assert.ok(edge, "alpha and beta are linked");
    assert.equal(edge.type, "wikilink");
    assert.ok(response.body.isolated.includes("notes/gamma.md"));
  });

  it("returns life metrics from the three folders", async () => {
    const response = await get(server.base, "/api/life");
    assert.equal(response.status, 200);
    assert.equal(response.body.demo, false);
    assert.deepEqual(response.body.folders, { daily: true, monthly: true, weekly: true });
    assert.equal(response.body.daily.length, 1);
    assert.equal(response.body.daily[0].sleepHrs, 7.5);
    assert.equal(response.body.daily[0].deepWorkHrs, 3);
    assert.equal(response.body.daily[0].win, "Shipped the API suite");
    assert.equal(response.body.monthly[0].savingsRate, 24);
    assert.equal(response.body.weekly[0].ratings.focus, 8);
    assert.deepEqual(response.body.warnings, []);
  });

  it("serves the local working mode without caching it", async () => {
    const response = await get(server.base, "/api/mode");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(["work", "home"].includes(response.body.mode));
    assert.equal(typeof response.body.source, "string");
    assert.equal(typeof response.body.checkedAt, "string");
    assert.equal(response.body.schedule.timeZone, "America/New_York");
    assert.ok(Array.isArray(response.body.schedule.days));
  });

  it("answers the action catalogue and unknown routes with JSON", async () => {
    const actions = await get(server.base, "/api/actions");
    assert.equal(actions.status, 200);
    assert.deepEqual(
      actions.body.actions.map((action: Json) => action.id),
      ["today", "review"],
    );

    const unknown = await get(server.base, "/api/nope");
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, { error: "not_found" });
  });
});

describe("API routes — broken links", () => {
  let server: Running;
  let root: string;

  before(async () => {
    root = await tempDir();
    await write(root, "notes/a.md", "# A\n\nSee [[Missing Note|roadmap]] and [[Ghost]].\n");
    await write(
      root,
      "notes/b.md",
      "# B\n\nAlso [[Other Ghost|roadmap]] and [[Beta Note]].\n",
    );
    await write(root, "notes/beta.md", "# Beta Note\n\nThis one exists.\n");
    server = await start({ vaultPath: root, watch: null });
  });

  after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("groups unresolved targets by the alias each note wrote", async () => {
    const response = await get(server.base, "/api/links/broken");
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.scannedAt, "string");
    assert.equal(response.body.total, 3);
    assert.deepEqual(response.body.groups, [
      {
        label: "roadmap",
        targets: ["Missing Note", "Other Ghost"],
        notes: [
          { path: "notes/a.md", title: "A", target: "Missing Note", alias: "roadmap" },
          { path: "notes/b.md", title: "B", target: "Other Ghost", alias: "roadmap" },
        ],
      },
      {
        label: "Ghost",
        targets: ["Ghost"],
        notes: [{ path: "notes/a.md", title: "A", target: "Ghost", alias: null }],
      },
    ]);
  });

  it("reports exactly what the graph calls unresolved", async () => {
    const report = await get(server.base, "/api/links/broken");
    const graph = await get(server.base, "/api/graph");
    const targets = new Set<string>(
      report.body.groups.flatMap((group: Json) => group.targets as string[]),
    );
    assert.deepEqual([...targets].sort(), graph.body.unresolved);
  });
});

describe("API routes — scan cache", () => {
  it("serves a snapshot for 5 s without a watcher, then rescans", async () => {
    const root = await tempDir();
    await write(root, "one.md", "# One\n\nFirst note.\n");
    let clock = 0;
    const server = await start({ vaultPath: root, watch: null, now: () => clock });
    try {
      const first = await get(server.base, "/api/notes");
      assert.equal(first.body.total, 1);
      const scannedAt = first.body.scannedAt;

      await write(root, "two.md", "# Two\n\nSecond note.\n");

      // Literal milliseconds, not the exported constant: changing the default
      // away from 5 s should fail this test rather than move its boundary.
      clock += 4_999;
      const cached = await get(server.base, "/api/notes");
      assert.equal(cached.body.total, 1, "still cached one millisecond before 5 s");
      assert.equal(cached.body.scannedAt, scannedAt, "the snapshot itself is reused");

      clock += 2;
      const rescanned = await get(server.base, "/api/notes");
      assert.equal(rescanned.body.total, 2, "the default 5 s TTL expired");
    } finally {
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("lets ?refresh=1 bypass the cache on health and stats", async () => {
    const root = await tempDir();
    await write(root, "one.md", "# One\n");
    const server = await start({ vaultPath: root, watch: null });
    try {
      await get(server.base, "/api/notes");
      await write(root, "two.md", "# Two\n");

      const cachedHealth = await get(server.base, "/api/health");
      assert.equal(cachedHealth.body.noteCount, 1, "health reads the cached scan");

      const refreshedHealth = await get(server.base, "/api/health?refresh=1");
      assert.equal(refreshedHealth.body.noteCount, 2);

      const cachedStats = await get(server.base, "/api/stats");
      assert.equal(cachedStats.body.totalNotes, 2);

      await write(root, "three.md", "# Three\n");
      const refreshedStats = await get(server.base, "/api/stats?refresh=1");
      assert.equal(refreshedStats.body.totalNotes, 3);

      const after = await get(server.base, "/api/notes");
      assert.equal(after.body.total, 3, "the refreshed scan replaced the snapshot");
    } finally {
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rescans immediately after a watcher event", async () => {
    const root = await tempDir();
    await write(root, "one.md", "# One\n");
    const events: Array<() => void> = [];
    const server = await start({
      vaultPath: root,
      watch: (onChange) => {
        events.push(onChange);
        return { close: () => {} };
      },
    });
    try {
      const first = await get(server.base, "/api/notes");
      assert.equal(first.body.total, 1);

      await write(root, "two.md", "# Two\n");
      const cached = await get(server.base, "/api/notes");
      assert.equal(cached.body.total, 1, "the watcher has not reported the new file yet");

      assert.equal(events.length, 1, "the app installed the watcher");
      events[0]?.();
      const rescanned = await get(server.base, "/api/notes");
      assert.equal(rescanned.body.total, 2);
    } finally {
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("API routes — scan failures", () => {
  let root = "";
  let server: Running;

  before(async () => {
    root = await tempDir();
    await write(root, "one.md", "# One\n\nReadable even when the index is not.\n");
    server = await start({
      vaultPath: root,
      watch: null,
      scan: async () => {
        throw new Error("disk on fire");
      },
    });
  });

  after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns a 500 with the route's own code when the scan throws", async () => {
    const stats = await get(server.base, "/api/stats");
    assertError(stats, 500, "vault_scan_failed", /disk on fire/);
    assert.equal(stats.body.configured, true);

    const notes = await get(server.base, "/api/notes");
    assertError(notes, 500, "vault_scan_failed", /disk on fire/);
    assert.equal("configured" in notes.body, false);

    const search = await get(server.base, "/api/search?q=one");
    assertError(search, 500, "search_failed", /disk on fire/);

    const graph = await get(server.base, "/api/graph");
    assertError(graph, 500, "graph_failed", /disk on fire/);

    const recall = await get(server.base, "/api/recall/today");
    assertError(recall, 500, "recall_failed", /disk on fire/);
  });

  it("keeps health and a direct note read usable without the index", async () => {
    const health = await get(server.base, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.configured, true);
    assert.equal(health.body.noteCount, null, "a failed scan is reported as no count");

    const note = await get(server.base, "/api/notes/one.md");
    assert.equal(note.status, 200);
    assert.match(note.body.markdown, /Readable even when the index is not/);
    assert.deepEqual(note.body.outbound, []);
    assert.deepEqual(note.body.backlinks, [], "a scan failure degrades links, not the read");
  });
});

describe("API routes — unconfigured vault", () => {
  let server: Running;

  before(async () => {
    server = await start({ vaultPath: null, watch: null });
  });

  after(async () => {
    await server.close();
  });

  it("keeps health, mode, life and search-without-query working", async () => {
    const health = await get(server.base, "/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(
      {
        ok: health.body.ok,
        configured: health.body.configured,
        vaultPath: health.body.vaultPath,
        noteCount: health.body.noteCount,
      },
      { ok: true, configured: false, vaultPath: null, noteCount: null },
    );

    const mode = await get(server.base, "/api/mode");
    assert.equal(mode.status, 200);

    const search = await get(server.base, "/api/search");
    assert.equal(search.status, 200);
    assert.equal(search.body.hint, "Pass ?q=<term>");

    const life = await get(server.base, "/api/life");
    assert.equal(life.status, 200);
    assert.equal(life.body.demo, true);
    assert.equal(life.body.vaultPath, null);
    assert.ok(life.body.warnings.some((warning: string) => /VAULT_PATH is not set/.test(warning)));
  });

  it("returns 503 vault_not_configured from every scan-backed route", async () => {
    const notes = await get(server.base, "/api/notes");
    assertError(notes, 503, "vault_not_configured", /VAULT_PATH/);
    assert.equal("configured" in notes.body, false);

    const stats = await get(server.base, "/api/stats");
    assertError(stats, 503, "vault_not_configured", /VAULT_PATH/);
    assert.equal(stats.body.configured, false);

    const search = await get(server.base, "/api/search?q=anything");
    assertError(search, 503, "vault_not_configured", /VAULT_PATH/);

    const graph = await get(server.base, "/api/graph");
    assertError(graph, 503, "vault_not_configured", /VAULT_PATH/);

    const broken = await get(server.base, "/api/links/broken");
    assertError(broken, 503, "vault_not_configured", /VAULT_PATH/);

    const recall = await get(server.base, "/api/recall/today");
    assertError(recall, 503, "vault_not_configured", /VAULT_PATH/);

    const note = await get(server.base, "/api/notes/notes/alpha.md");
    assertError(note, 503, "vault_not_configured", /VAULT_PATH/);
  });

  it("keeps the action catalogue vault-backed and unknown routes JSON", async () => {
    const actions = await get(server.base, "/api/actions");
    assertError(actions, 503, "vault_not_configured", /VAULT_PATH/);

    const unknown = await get(server.base, "/api/nope");
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, { error: "not_found" });
  });
});

describe("API routes — static app serving", () => {
  let staticDir = "";
  let server: Running;

  before(async () => {
    staticDir = await tempDir();
    await write(staticDir, "index.html", '<!doctype html><html><body><div id="root"></div></body></html>');
    await write(staticDir, "assets/app.js", "console.log('app');\n");
    server = await start({ vaultPath: null, watch: null, staticDir });
  });

  after(async () => {
    await server.close();
    await fs.rm(staticDir, { recursive: true, force: true });
  });

  it("serves the built app for pages and assets", async () => {
    const index = await fetch(`${server.base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await index.text(), /<div id="root">/);

    const deepLink = await fetch(`${server.base}/life`);
    assert.equal(deepLink.status, 200);
    assert.match(await deepLink.text(), /<div id="root">/, "unknown paths fall back to the SPA");

    const asset = await fetch(`${server.base}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
  });

  it("keeps an unknown API path and method as JSON 404s", async () => {
    const unknown = await get(server.base, "/api/nope");
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, { error: "not_found" });

    // POST /api/notes is the create endpoint now; PATCH is still unknown.
    const wrongMethod = await fetch(`${server.base}/api/notes`, { method: "PATCH" });
    assert.equal(wrongMethod.status, 404);
    assert.deepEqual(await wrongMethod.json(), { error: "not_found" });
  });
});

describe("API routes — a vault path that is not a directory", () => {
  let root = "";
  let server: Running;

  before(async () => {
    root = await tempDir();
    await write(root, "not-a-vault.md", "# A file, not a vault\n");
    server = await start({ vaultPath: path.join(root, "not-a-vault.md"), watch: null });
  });

  after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("treats it as unconfigured rather than scanning it", async () => {
    const health = await get(server.base, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.configured, false);
    assert.equal(health.body.noteCount, null);

    const notes = await get(server.base, "/api/notes");
    assertError(notes, 503, "vault_not_configured", /VAULT_PATH/);
  });
});
