/**
 * Production smoke: boots `server/dist` against a throwaway vault, waits for the
 * real HTTP listener, and checks the routes the dashboard depends on. This is
 * deliberately not a route unit test: it proves the compiled entry, static
 * build, env handoff and filesystem scan agree with each other.
 *
 * It also proves the product's central promise rather than asserting it in a
 * README: the scratch vault is snapshotted before the server starts, and every
 * file must still have the same bytes, size and mtime after the probes. A route
 * that writes — even "just" a cache or a normalised frontmatter field — fails
 * here.
 *
 * The checkout the server is started from gets the same treatment, because a
 * vault-only walk cannot see a log, cache or config file dropped beside the
 * code. Two trees are excluded, and both for the same reason — they are not the
 * application's writes: `node_modules` (a Vite dev server caches into it, so a
 * local run beside `npm run dev` would be noise, and it dominates the walk) and
 * `.git`. Writes through a symlink are outside both proofs, since neither walk
 * follows links.
 *
 * Usage: `npm run build && npm run smoke:built`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffSnapshots, snapshotTree } from "./vaultSnapshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "server", "dist", "server", "src", "index.js");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FETCH_MS = 5_000;
/** Excluded from the checkout proof: not the app's writes, see the header. */
const REPO_IGNORE = ["node_modules", ".git"];

/**
 * A developer's own `npm run dev` can be appending to a gitignored `*.log`
 * beside the code while this proof runs; those bytes belong to that process, not
 * to the built server's probes. Root-level logs only — the app writes none, and
 * anything the server creates deeper in the tree is still reported.
 */
const isScratchLog = (relative) => !relative.includes("/") && /\.log$/i.test(relative);

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function write(vault, relative, body) {
  const file = path.join(vault, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
}

async function scratchVault() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-smoke-"));
  await write(
    vault,
    "notes/alpha.md",
    [
      "---",
      "title: Alpha Note",
      "captured: 2026-10-18 3:38 PM",
      "captured_zone: America/New_York",
      "area: career",
      "origin: ai",
      "tags: [focus, api]",
      "---",
      "# Alpha",
      "",
      "The orchard and the lantern. A link to [[Beta Note]].",
    ].join("\n"),
  );
  await write(
    vault,
    "notes/beta.md",
    [
      "---",
      "title: Beta Note",
      "captured: 2026-10-17",
      "area: life",
      "tags: focus",
      "---",
      "# Beta",
      "",
      "Back to [[Alpha Note]].",
    ].join("\n"),
  );
  await write(
    vault,
    "Daily/2026-10-19.md",
    "---\ntitle: Daily 2026-10-19\nsleep_hrs: 7.5\ndeep_work_hrs: 3\nwin: Smoke-tested the build\n---\n",
  );
  await write(
    vault,
    "Monthly/2026-10.md",
    "---\ntitle: Monthly 2026-10\nnet_worth: 12000\nsavings_rate: 0.24\n---\n",
  );
  await write(vault, "Weekly/2026-W42.md", "---\ntitle: Weekly 2026-W42\nfocus: 8\n---\n");
  return vault;
}

function capture(child) {
  let output = "";
  const keep = (chunk) => {
    output += chunk.toString();
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  return () => output;
}

async function waitForHealth(base, child, output) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with ${child.exitCode}\n${output()}`);
    }
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Still starting; the listener is what we are waiting for.
    }
    await sleep(100);
  }
  throw new Error(`server did not become healthy within 15s\n${output()}`);
}

async function main() {
  if (!existsSync(entry)) {
    throw new Error(`no built server at ${entry}; run npm run build first`);
  }

  const vault = await scratchVault();
  // Taken after the fixture is written and before the server can open the
  // folder, so startup scans are covered as well as the probes below.
  const before = await snapshotTree(vault);
  assert.ok(before.length >= 5, `snapshot only found ${before.length} files`);
  // The same walk over the checkout, taken at the same moment: from here on,
  // any new or changed file beside the code is the server's doing.
  const treeBefore = await snapshotTree(root, { ignore: REPO_IGNORE, ignoreFile: isScratchLog });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child = null;

  try {
    child = spawn(process.execPath, [entry], {
      cwd: root,
      env: {
        ...process.env,
        BRAINDASH_ROOT: root,
        VAULT_PATH: vault,
        BRAINDASH_PORT: String(port),
        HOST: "127.0.0.1",
        // An explicit empty value beats a token in the developer's `.env`:
        // dotenv does not overwrite a variable that is already set, so the
        // smoke always boots the default, token-free install it asserts.
        BRAINDASH_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = capture(child);
    await waitForHealth(base, child, output);

    const json = async (route, status = 200) => {
      const response = await fetch(`${base}${route}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_MS),
      });
      assert.equal(response.status, status, `${route}: status`);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/, `${route}: JSON content type`);
      return response.json();
    };

    const health = await json("/api/health");
    assert.equal(health.ok, true, "health ok");
    assert.equal(health.configured, true, "health configured");
    assert.equal(health.noteCount, 5, "health counts the scratch notes");
    assert.equal(health.vaultPath, vault, "health reports the scratch vault");

    const notes = await json("/api/notes");
    assert.equal(notes.total, 5, "notes total");
    const alpha = notes.notes.find((note) => note.path === "notes/alpha.md");
    assert.ok(alpha, "alpha is indexed");
    assert.equal(alpha.title, "Alpha Note");
    assert.equal(alpha.capturedZone, "America/New_York");
    assert.equal(alpha.area, "career");
    assert.deepEqual(alpha.tags, ["focus", "api"]);
    assert.equal("markdown" in alpha, false, "the index stays lightweight");

    const note = await json("/api/notes/notes/alpha.md");
    assert.equal(note.path, "notes/alpha.md");
    assert.equal(note.title, "Alpha Note");
    assert.match(note.markdown, /orchard and the lantern/);
    assert.deepEqual(note.outbound, [
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
      note.backlinks.map((link) => ({ path: link.path, via: link.via })),
      [{ path: "notes/beta.md", via: "wikilink" }],
    );

    const search = await json("/api/search?q=orchard");
    assert.equal(search.total, 1, "search total");
    assert.equal(search.results[0].path, "notes/alpha.md");
    assert.equal(search.results[0].match, "body");
    assert.match(search.results[0].snippet, /orchard/i);

    const graph = await json("/api/graph");
    assert.equal(graph.nodes.length, 5, "graph node count");
    assert.equal(graph.unresolved.length, 0, "all links resolve");
    assert.ok(
      graph.edges.some(
        (edge) =>
          edge.type === "wikilink" &&
          ((edge.source === "notes/alpha.md" && edge.target === "notes/beta.md") ||
            (edge.source === "notes/beta.md" && edge.target === "notes/alpha.md")),
      ),
      "alpha and beta are linked",
    );

    const broken = await json("/api/links/broken");
    assert.equal(broken.total, 0, "the scratch vault has no broken links");
    assert.deepEqual(broken.groups, []);

    const recall = await json("/api/recall/today?date=2026-10-19&skip=0");
    assert.equal(recall.total, 5, "recall sees the whole scratch vault");
    assert.equal(recall.date, "2026-10-19");
    assert.ok(recall.note && typeof recall.note.path === "string", "recall returns a note");

    const life = await json("/api/life");
    assert.equal(life.demo, false, "life uses the scratch folders");
    assert.deepEqual(life.folders, { daily: true, monthly: true, weekly: true });
    assert.equal(life.daily[0].win, "Smoke-tested the build");
    assert.equal(life.monthly[0].month, "2026-10");
    assert.equal(life.weekly[0].week, "2026-W42");

    const mode = await json("/api/mode");
    assert.ok(mode.mode === "work" || mode.mode === "home", "mode resolves");
    assert.equal(typeof mode.schedule.timeZone, "string");

    // `/api/deps` shells out to npm through the copied `scripts/check-deps.mjs`,
    // so this is also the check that build-server.mjs placed it where the
    // compiled import expects. Whatever the registry says is fine here: the
    // route reports a failed check in the payload, never as a 5xx.
    const depsResponse = await fetch(`${base}/api/deps`, { signal: AbortSignal.timeout(25_000) });
    assert.equal(depsResponse.status, 200, "deps route answers");
    const deps = await depsResponse.json();
    assert.equal(typeof deps.ok, "boolean", "deps says whether the check ran");
    assert.equal(typeof deps.behind, "number", "deps reports a count");
    assert.ok(Array.isArray(deps.stale), "deps reports its rows");

    // The rail's two data-bearing actions, and the lists they open. Counts depend
    // on the scratch vault's dates, so only the shape is asserted here.
    const actions = await json("/api/actions");
    assert.equal(actions.actions.length, 2, "two data-bearing actions");
    assert.equal(actions.actions[0].id, "today", "today's captures is first");
    assert.equal(typeof actions.actions[0].count, "number", "today's count is a number");

    const captures = await json("/api/captures/today");
    assert.ok(Array.isArray(captures.notes), "today's captures is a list");
    assert.equal(captures.total, captures.notes.length, "captures total matches the list");

    const reviews = await json("/api/review/queue");
    assert.ok(Array.isArray(reviews.notes), "the review queue is a list");
    assert.equal(typeof reviews.overdue, "number", "the queue reports how many are overdue");

    const missing = await json("/api/does-not-exist", 404);
    assert.equal(missing.error, "not_found");

    const page = await fetch(`${base}/`, { signal: AbortSignal.timeout(FETCH_MS) });
    assert.equal(page.status, 200, "built dashboard is served");
    assert.match(page.headers.get("content-type") ?? "", /text\/html/, "dashboard content type");
    assert.match(await page.text(), /<title>BrainDash<\/title>/, "dashboard title");

    const favicon = await fetch(`${base}/favicon.svg`, { signal: AbortSignal.timeout(FETCH_MS) });
    assert.equal(favicon.status, 200, "favicon is served");
    assert.match(favicon.headers.get("content-type") ?? "", /image\/svg\+xml/, "favicon content type");

    // Last, so it covers every probe above and the server's own startup scan.
    // The vault is read-only by contract; this is the run that proves it.
    const changed = diffSnapshots(before, await snapshotTree(vault));
    assert.deepEqual(changed, [], `the probes changed the scratch vault: ${changed.join("; ")}`);

    // And nothing was written outside it either: no cache, log or config in the
    // checkout the server was started from.
    const outside = diffSnapshots(
      treeBefore,
      await snapshotTree(root, { ignore: REPO_IGNORE, ignoreFile: isScratchLog }),
    );
    assert.deepEqual(
      outside,
      [],
      `the probes wrote outside the scratch vault: ${outside.join("; ")}`,
    );

    console.log(
      `[smoke] built server ok: ${notes.total} notes, ${graph.edges.length} edges, ` +
        `vault unchanged (${before.length} files), checkout unchanged ` +
        `(${treeBefore.length} files), HTTP ${base}`,
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      const stopped = await Promise.race([
        new Promise((resolve) => child.once("exit", () => resolve(true))),
        sleep(2_000).then(() => false),
      ]);
      if (!stopped) {
        child.kill("SIGKILL");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          sleep(1_000),
        ]);
      }
    }
    await fs.rm(vault, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[smoke] FAILED");
  console.error(error);
  process.exit(1);
});
