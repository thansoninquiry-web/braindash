import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createVaultApp } from "../src/app.js";

type Json = Record<string, any>;

interface Running {
  base: string;
  close(): Promise<void>;
}

async function start(vaultPath: string, writes = true): Promise<Running> {
  const { app, cache } = createVaultApp({ vaultPath, staticDir: null, writes });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no ephemeral port");
  return {
    base: `http://127.0.0.1:${address.port}`,
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
  method: "GET" | "POST" | "DELETE",
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

/** The same call with a caller-chosen Host header, which fetch will not set. */
function callWithHost(
  base: string,
  route: string,
  method: "GET" | "POST" | "DELETE",
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
          ...(payload === null ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) as Json });
        });
      },
    );
    request.on("error", reject);
    if (payload !== null) request.write(payload);
    request.end();
  });
}

const ALPHA = "# Alpha\n\nOriginal body with [[Beta]].\n";

async function tempVault(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-trash-"));
  await fs.mkdir(path.join(root, "notes"));
  await fs.writeFile(path.join(root, "notes", "alpha.md"), ALPHA, "utf8");
  await fs.writeFile(path.join(root, "notes", "beta.md"), "# Beta\n\nTarget.\n", "utf8");
  return root;
}

/** Trash-relative ids of everything recoverable, for asserting absence. */
async function trashedIds(root: string): Promise<string[]> {
  const trash = path.join(root, ".trash");
  try {
    const entries = await fs.readdir(trash, { recursive: true });
    return entries
      .map((entry) => entry.split(path.sep).join("/"))
      .filter((entry) => entry.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

describe("trash — listing", () => {
  it("is an empty list on a vault that never deleted a note", async () => {
    const root = await tempVault();
    const running = await start(root);
    try {
      const listed = await call(running.base, "/api/trash", "GET");
      assert.equal(listed.status, 200);
      assert.deepEqual(listed.body, { trashPath: null, total: 0, entries: [] });
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("names what a delete kept, where it would return, and how big it is", async () => {
    const root = await tempVault();
    const before = await fs.stat(path.join(root, "notes", "alpha.md"));
    const running = await start(root);
    try {
      const removed = await call(running.base, "/api/notes/notes/alpha.md", "DELETE");
      assert.equal(removed.status, 200);

      const listed = await call(running.base, "/api/trash", "GET");
      assert.equal(listed.status, 200);
      assert.equal(listed.body.total, 1);
      const entries = listed.body.entries as Json[];
      const entry = entries[0] as Json;
      assert.equal(entries.length, 1);
      assert.equal(entry.path, "notes/alpha.md");
      assert.equal(entry.title, "Alpha");
      assert.equal(entry.size, before.size);
      assert.match(entry.id, /^[^/]+\/notes\/alpha\.md$/, "id is <stamp>/<original path>");
      assert.ok(
        Math.abs(Date.parse(entry.trashedAt) - before.mtimeMs) < 5_000,
        "the stamp is the move, not the scan",
      );

      await assert.rejects(fs.readFile(path.join(root, "notes", "alpha.md"), "utf8"));
      assert.deepEqual(await trashedIds(root), [`${entry.id.split("/")[0]}/notes/alpha.md`]);
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("trash — restore", () => {
  it("puts the exact bytes back and empties the stamp folder", async () => {
    const root = await tempVault();
    const before = await fs.stat(path.join(root, "notes", "alpha.md"));
    const running = await start(root);
    try {
      await call(running.base, "/api/notes/notes/alpha.md", "DELETE");
      const listed = await call(running.base, "/api/trash", "GET");
      const id = (listed.body.entries as Json[])[0]?.id as string;

      const restored = await call(running.base, "/api/trash/restore", "POST", { id });
      assert.equal(restored.status, 201);
      assert.equal(restored.body.restored, true);
      assert.equal(restored.body.path, "notes/alpha.md");
      assert.equal(restored.body.markdown, ALPHA);

      assert.equal(await fs.readFile(path.join(root, "notes", "alpha.md"), "utf8"), ALPHA);
      const after = await fs.stat(path.join(root, "notes", "alpha.md"));
      assert.ok(
        Math.abs(after.mtimeMs - before.mtimeMs) < 5,
        "the note keeps its own timestamp, so conflict checks still compare like with like",
      );

      assert.deepEqual(await trashedIds(root), [], "the copy left the trash");
      const stamps = await fs.readdir(path.join(root, ".trash"));
      assert.deepEqual(stamps, [], "an emptied stamp folder is pruned");
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to replace a note that re-used the filename", async () => {
    const root = await tempVault();
    const running = await start(root);
    try {
      await call(running.base, "/api/notes/notes/alpha.md", "DELETE");
      const listed = await call(running.base, "/api/trash", "GET");
      const id = (listed.body.entries as Json[])[0]?.id as string;

      const recreated = await call(running.base, "/api/notes", "POST", {
        path: "notes/alpha.md",
        markdown: "# Alpha again\n",
      });
      assert.equal(recreated.status, 201);

      const conflict = await call(running.base, "/api/trash/restore", "POST", { id });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error, "note_exists");
      assert.equal(
        await fs.readFile(path.join(root, "notes", "alpha.md"), "utf8"),
        "# Alpha again\n",
        "the newer note is untouched",
      );
      const still = await call(running.base, "/api/trash", "GET");
      assert.equal(still.body.total, 1, "and the trashed copy is still there");
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("answers 404 for an id that is not in the trash", async () => {
    const root = await tempVault();
    const running = await start(root);
    try {
      const missing = await call(running.base, "/api/trash/restore", "POST", {
        id: "2026-01-01T00-00-00-000Z-abcdef/notes/ghost.md",
      });
      assert.equal(missing.status, 404);
      assert.equal(missing.body.error, "not_found");
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ids that try to leave the trash or name a non-note", async () => {
    const root = await tempVault();
    const running = await start(root);
    try {
      const ids = [
        "../alpha.md",
        "/etc/passwd",
        "stamp/../../notes/alpha.md",
        ".trash/notes/alpha.md",
        "stamp/notes/alpha.txt",
        "",
      ];
      for (const id of ids) {
        const rejected = await call(running.base, "/api/trash/restore", "POST", { id });
        assert.equal(rejected.status, 400, JSON.stringify(id));
        assert.ok(
          ["invalid_path", "not_markdown"].includes(rejected.body.error as string),
          `${id} → ${rejected.body.error}`,
        );
      }
      assert.equal(
        await fs.readFile(path.join(root, "notes", "alpha.md"), "utf8"),
        ALPHA,
        "nothing was moved by a rejected id",
      );
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("is a write: off by default, and refused from another device", async () => {
    const root = await tempVault();
    const readOnly = await start(root, false);
    try {
      const listed = await call(readOnly.base, "/api/trash", "GET");
      assert.equal(listed.status, 200, "listing is a read");
      const refused = await call(readOnly.base, "/api/trash/restore", "POST", { id: "x/y.md" });
      assert.equal(refused.status, 403);
      assert.equal(refused.body.error, "write_disabled");
    } finally {
      // The same vault is reopened below, so it is removed once, at the end.
      await readOnly.close();
    }

    const local = await start(root);
    try {
      const fromLan = await callWithHost(
        local.base,
        "/api/trash/restore",
        "POST",
        "192.168.1.184:5180",
        { id: "x/y.md" },
      );
      assert.equal(fromLan.status, 403);
      assert.equal(fromLan.body.error, "write_forbidden");

      const onLoopback = await call(local.base, "/api/trash/restore", "POST", { id: "x/y.md" });
      assert.equal(onLoopback.status, 404, "allowed through the gate, then not found");
    } finally {
      await local.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
