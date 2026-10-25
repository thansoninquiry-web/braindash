import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { diffSnapshots, snapshotTree } from "../../scripts/vaultSnapshot.mjs";

/** A throwaway tree, removed whatever the test does. */
async function withTree(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-snapshot-"));
  try {
    for (const [relative, body] of Object.entries(files)) {
      const file = path.join(root, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body, "utf8");
    }
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const VAULT = {
  "notes/alpha.md": "---\ntitle: Alpha\n---\nThe orchard.\n",
  "notes/beta.md": "---\ntitle: Beta\n---\nBack to Alpha.\n",
  "Daily/2026-10-19.md": "---\nwin: smoke\n---\n",
};

describe("snapshotTree", () => {
  it("lists every file with slash paths, sorted, nested ones included", async () => {
    await withTree(VAULT, async (root) => {
      const files = await snapshotTree(root);
      assert.deepEqual(
        files.map((file) => file.path),
        ["Daily/2026-10-19.md", "notes/alpha.md", "notes/beta.md"],
      );
      for (const file of files) {
        assert.match(file.sha256, /^[0-9a-f]{64}$/, `${file.path}: sha256`);
        assert.ok(file.size > 0, `${file.path}: size`);
        assert.ok(Number.isFinite(file.mtimeMs), `${file.path}: mtime`);
      }
      // The size is the real byte count, not a character count.
      const alpha = files.find((file) => file.path === "notes/alpha.md");
      assert.equal(alpha?.size, Buffer.byteLength(VAULT["notes/alpha.md"]));
    });
  });

  it("is stable across two reads of an untouched tree", async () => {
    await withTree(VAULT, async (root) => {
      const first = await snapshotTree(root);
      const second = await snapshotTree(root);
      assert.deepEqual(diffSnapshots(first, second), []);
      assert.deepEqual(second, first);
    });
  });

  it("skips ignored directories and every file under them", async () => {
    await withTree(
      {
        ...VAULT,
        "node_modules/pkg/index.js": "module.exports = 1;\n",
        ".git/HEAD": "ref: refs/heads/main\n",
      },
      async (root) => {
        const files = await snapshotTree(root, { ignore: ["node_modules", ".git"] });
        assert.deepEqual(
          files.map((file) => file.path),
          ["Daily/2026-10-19.md", "notes/alpha.md", "notes/beta.md"],
        );
      },
    );
  });

  it("ignores one nested path without ignoring its siblings", async () => {
    await withTree(
      {
        "web/dist/index.html": "built\n",
        "web/src/main.ts": "source\n",
        "server/dist/index.js": "built\n",
      },
      async (root) => {
        const files = await snapshotTree(root, { ignore: ["web/dist"] });
        assert.deepEqual(
          files.map((file) => file.path),
          ["server/dist/index.js", "web/src/main.ts"],
        );
      },
    );
  });

  it("still sees a write beside the ignored paths", async () => {
    await withTree(
      { "node_modules/pkg/index.js": "dep\n", "notes/alpha.md": "note\n" },
      async (root) => {
        const before = await snapshotTree(root, { ignore: ["node_modules"] });
        await fs.writeFile(path.join(root, "notes/alpha.md"), "changed\n", "utf8");
        await fs.writeFile(path.join(root, "server.log"), "log\n", "utf8");
        const changes = diffSnapshots(
          before,
          await snapshotTree(root, { ignore: ["node_modules"] }),
        );
        assert.ok(changes.includes("server.log: added"), changes.join("; "));
        assert.ok(changes.includes("notes/alpha.md: content changed"), changes.join("; "));
      },
    );
  });

  it("skips files the caller's predicate names, not just whole subtrees", async () => {
    await withTree(
      { ...VAULT, "dev.log": "appended by a dev server\n", "notes/keep.log": "in the vault\n" },
      async (root) => {
        const files = await snapshotTree(root, {
          // The smoke exempts root-level scratch logs only; a log inside the
          // vault is still a finding.
          ignoreFile: (relative) => !relative.includes("/") && relative.endsWith(".log"),
        });
        assert.deepEqual(
          files.map((file) => file.path),
          ["Daily/2026-10-19.md", "notes/alpha.md", "notes/beta.md", "notes/keep.log"],
        );
      },
    );
  });

  it("does not follow a directory link, which would read as EISDIR", async () => {
    await withTree(VAULT, async (root) => {
      try {
        await fs.symlink(
          path.join(root, "notes"),
          path.join(root, "linked-notes"),
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch {
        return; // This machine will not create links; nothing to assert.
      }
      const files = await snapshotTree(root);
      assert.deepEqual(
        files.map((file) => file.path),
        ["Daily/2026-10-19.md", "notes/alpha.md", "notes/beta.md"],
      );
    });
  });
});

describe("diffSnapshots", () => {
  it("reports nothing for an identical tree", async () => {
    await withTree(VAULT, async (root) => {
      assert.deepEqual(diffSnapshots(await snapshotTree(root), await snapshotTree(root)), []);
    });
  });

  it("catches a rewritten note as changed content and size", async () => {
    await withTree(VAULT, async (root) => {
      const before = await snapshotTree(root);
      await fs.writeFile(path.join(root, "notes/alpha.md"), "rewritten\n", "utf8");
      const changes = diffSnapshots(before, await snapshotTree(root));
      assert.ok(changes.includes("notes/alpha.md: content changed"), changes.join("; "));
      assert.ok(changes.some((line) => line.startsWith("notes/alpha.md: size ")), changes.join("; "));
    });
  });

  it("catches an added and a removed file by name", async () => {
    await withTree(VAULT, async (root) => {
      const before = await snapshotTree(root);
      await fs.writeFile(path.join(root, "notes/gamma.md"), "new\n", "utf8");
      await fs.rm(path.join(root, "notes/beta.md"));
      const changes = diffSnapshots(before, await snapshotTree(root));
      assert.ok(changes.includes("notes/gamma.md: added"), changes.join("; "));
      assert.ok(changes.includes("notes/beta.md: removed"), changes.join("; "));
    });
  });

  it("catches a metadata-only touch, where the bytes never moved", async () => {
    await withTree(VAULT, async (root) => {
      const before = await snapshotTree(root);
      const alpha = path.join(root, "notes/alpha.md");
      const when = new Date("2020-01-02T03:04:05.000Z");
      await fs.utimes(alpha, when, when);
      const after = await snapshotTree(root);
      const changes = diffSnapshots(before, after);
      assert.deepEqual(changes, ["notes/alpha.md: mtime changed"]);
    });
  });
});
