import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import http from "node:http";
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

async function start(options: VaultAppOptions = {}): Promise<Running> {
  const { app, cache } = createVaultApp({ staticDir: null, writes: true, ...options });
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

async function call(
  base: string,
  route: string,
  method: "GET" | "PUT" | "POST" | "DELETE",
  body?: unknown,
): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Json };
}

/** A request with a caller-chosen Host header, which fetch refuses to set. */
function callWithHost(
  base: string,
  route: string,
  method: "GET" | "PUT" | "POST" | "DELETE",
  host: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> {
  const url = new URL(`${base}${route}`);
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          host,
          accept: "application/json",
          ...(payload === null
            ? {}
            : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) as Json });
        });
      },
    );
    request.on("error", reject);
    request.end(payload ?? undefined);
  });
}

async function tempVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-write-"));
  await fs.mkdir(path.join(root, "notes"), { recursive: true });
  await fs.writeFile(
    path.join(root, "notes", "alpha.md"),
    "# Alpha\n\nOriginal body with [[Beta]].\n",
    "utf8",
  );
  return root;
}

async function trashEntries(root: string): Promise<string[]> {
  const trash = path.join(root, ".trash");
  try {
    const entries = await fs.readdir(trash, { recursive: true });
    return entries
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => `.trash/${entry.split(path.sep).join("/")}`);
  } catch {
    return [];
  }
}

describe("note writes — the gate", () => {
  it("stays read-only unless the app is started with writes", async () => {
    const root = await tempVault();
    const running = await start({ vaultPath: root, writes: false });
    try {
      const health = await call(running.base, "/api/health", "GET");
      assert.equal(health.body.writes, false);
      assert.equal(health.body.writeScope, null);
      const put = await call(running.base, "/api/notes/notes/alpha.md", "PUT", { markdown: "# Changed\n" });
      assert.equal(put.status, 403);
      assert.equal(put.body.error, "write_disabled");
      assert.equal(
        await fs.readFile(path.join(root, "notes", "alpha.md"), "utf8"),
        "# Alpha\n\nOriginal body with [[Beta]].\n",
      );
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a write forwarded from another device on the LAN", async () => {
    const root = await tempVault();
    const running = await start({ vaultPath: root });
    try {
      // The LAN view is told it is read-only, so it never offers the controls.
      const remoteHealth = await callWithHost(
        running.base,
        "/api/health",
        "GET",
        "192.168.1.184:5180",
      );
      assert.equal(remoteHealth.body.writes, false);
      assert.equal(remoteHealth.body.writeScope, "loopback");

      const put = await callWithHost(
        running.base,
        "/api/notes/notes/alpha.md",
        "PUT",
        "192.168.1.184:5180",
        { markdown: "# From the LAN\n" },
      );
      assert.equal(put.status, 403);
      assert.equal(put.body.error, "write_forbidden");
      assert.equal(
        await fs.readFile(path.join(root, "notes", "alpha.md"), "utf8"),
        "# Alpha\n\nOriginal body with [[Beta]].\n",
      );

      // The same request on loopback is the one that is allowed.
      const local = await call(running.base, "/api/notes/notes/alpha.md", "PUT", {
        markdown: "# From this machine\n",
      });
      assert.equal(local.status, 200);
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a form-encoded body before it can reach a note", async () => {
    const root = await tempVault();
    const running = await start({ vaultPath: root });
    try {
      const response = await fetch(`${running.base}/api/notes/notes/alpha.md`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "markdown=# nope",
      });
      assert.equal(response.status, 415);
      const body = (await response.json()) as Json;
      assert.equal(body.error, "unsupported_media_type");
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("note writes — save, create, delete", () => {
  it("rewrites a note, answers with the new body, and keeps the old one in .trash", async () => {
    const root = await tempVault();
    const running = await start({ vaultPath: root });
    try {
      const opened = await call(running.base, "/api/notes/notes/alpha.md", "GET");
      assert.equal(opened.status, 200);
      const saved = await call(running.base, "/api/notes/notes/alpha.md", "PUT", {
        markdown: "# Alpha\n\nRewritten, with [[Beta]] intact.\n",
        baseModifiedAt: opened.body.modifiedAt,
      });

      assert.equal(saved.status, 200);
      assert.equal(saved.body.markdown, "# Alpha\n\nRewritten, with [[Beta]] intact.\n");
      assert.equal(saved.body.path, "notes/alpha.md");
      assert.equal(saved.body.outbound[0]?.target, "Beta", "the save answers with the note's links too");
      assert.match(saved.body.backup, /^\.trash\//);
      assert.equal(
        await fs.readFile(path.join(root, "notes", "alpha.md"), "utf8"),
        "# Alpha\n\nRewritten, with [[Beta]] intact.\n",
      );
      const trashed = await trashEntries(root);
      assert.equal(trashed.length, 1);
      assert.ok(trashed[0]?.endsWith("notes/alpha.md"), "the backup keeps the note's path");
      const backupBody = await fs.readFile(path.join(root, trashed[0] as string), "utf8");
      assert.equal(backupBody, "# Alpha\n\nOriginal body with [[Beta]].\n");

      // The save invalidated the scan, so the index serves the new body.
      const reopened = await call(running.base, "/api/notes/notes/alpha.md", "GET");
      assert.equal(reopened.body.markdown, saved.body.markdown);
      assert.equal(reopened.body.modifiedAt, saved.body.modifiedAt);
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a note that changed since it was opened", async () => {
    const root = await tempVault();
    const running = await start({ vaultPath: root });
    try {
      const stale = new Date("2026-01-01T00:00:00.000Z").toISOString();
      const conflict = await call(running.base, "/api/notes/notes/alpha.md", "PUT", {
        markdown: "# Stale save\n",
        baseModifiedAt: stale,
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error, "note_conflict");
      assert.equal(
        await fs.readFile(path.join(root, "notes", "alpha.md"), "utf8"),
        "# Alpha\n\nOriginal body with [[Beta]].\n",
      );
      assert.deepEqual(await trashEntries(root), [], "a refused save leaves no backup");
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("creates a note in a new folder without replacing anything", async () => {
    const root = await tempVault();
    const running = await start({ vaultPath: root });
    try {
      const created = await call(running.base, "/api/notes", "POST", {
        path: "ideas/fresh idea.md",
        markdown: "# Fresh idea\n\nWritten from the dashboard.\n",
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.path, "ideas/fresh idea.md");
      assert.equal(created.body.markdown, "# Fresh idea\n\nWritten from the dashboard.\n");
      assert.ok(
        (await fs.stat(path.join(root, "ideas", "fresh idea.md"))).isFile(),
        "the parent folder is created",
      );

      const again = await call(running.base, "/api/notes", "POST", {
        path: "ideas/fresh idea.md",
        markdown: "# Replacement\n",
      });
      assert.equal(again.status, 409);
      assert.equal(again.body.error, "note_exists");

      const escape = await call(running.base, "/api/notes", "POST", {
        path: "../outside.md",
        markdown: "# Escape\n",
      });
      assert.equal(escape.status, 400);
      assert.equal(escape.body.error, "invalid_path");
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("moves a deleted note into .trash and drops it from the index", async () => {
    const root = await tempVault();
    const running = await start({ vaultPath: root });
    try {
      const removed = await call(running.base, "/api/notes/notes/alpha.md", "DELETE");
      assert.equal(removed.status, 200);
      assert.match(removed.body.trashedTo, /^\.trash\//);
      assert.equal(
        await fs.stat(path.join(root, "notes", "alpha.md")).then(() => true, () => false),
        false,
      );

      const trashed = await trashEntries(root);
      assert.equal(trashed.length, 1);
      assert.ok(trashed[0]?.endsWith("notes/alpha.md"));
      assert.equal(
        await fs.readFile(path.join(root, trashed[0] as string), "utf8"),
        "# Alpha\n\nOriginal body with [[Beta]].\n",
      );

      const gone = await call(running.base, "/api/notes/notes/alpha.md", "GET");
      assert.equal(gone.status, 404);
      const index = await call(running.base, "/api/notes", "GET");
      assert.equal(index.body.total, 0);
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal, hidden folders and non-markdown saves", async () => {
    const root = await tempVault();
    const running = await start({ vaultPath: root });
    try {
      for (const route of [
        "/api/notes/.obsidian/secret.md",
        "/api/notes/.trash/old.md",
        "/api/notes/notes/alpha.txt",
      ]) {
        const response = await call(running.base, route, "PUT", { markdown: "# nope\n" });
        assert.equal(response.status, 400, route);
      }
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("answers a body above the note limit with 413", async () => {
    const root = await tempVault();
    const running = await start({ vaultPath: root });
    try {
      const tooBig = "x".repeat(1_000_001);
      const response = await call(running.base, "/api/notes/notes/alpha.md", "PUT", {
        markdown: tooBig,
      });
      assert.equal(response.status, 413);
      assert.equal(response.body.error, "note_too_large");
      assert.equal(
        await fs.readFile(path.join(root, "notes", "alpha.md"), "utf8"),
        "# Alpha\n\nOriginal body with [[Beta]].\n",
      );
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
