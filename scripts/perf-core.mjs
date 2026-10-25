/**
 * CI performance gate for the animated core.
 *
 * Boots the built dashboard against a scratch vault of 160 notes (the cloud's
 * own node cap), opens it in headless Chrome at 1440x900, forces cloud motion on,
 * and samples Chrome's performance counters over four seconds of animation. It
 * fails when the draw loop's own work per painted frame (script, style, layout)
 * exceeds the budget, and when the loop is not actually moving (too few frames,
 * or a note whose projected position never changes) — ways the core can "drop
 * below its budget" that a unit test cannot see.
 *
 * Chrome is driven over the DevTools protocol directly rather than through a
 * browser-automation dependency: Chromium is already installed on GitHub's
 * runners and on this machine, and the surface this needs is small. Set
 * `CHROME_PATH` to choose a binary; otherwise the usual Chrome/Edge/Chromium
 * install locations are searched.
 *
 * Usage: `npm run build && npm run perf:core`.
 * Tuning: `PERF_FRAME_BUDGET_MS` (default 14) is animation work per frame;
 * `PERF_MIN_FPS` (default 10) is only a liveness floor, because a headless
 * browser rasterises on the CPU; `PERF_SAMPLE_MS` (default 4000).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeFrameSample, sampleFrames } from "./frameBudget.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(root, "server", "dist", "server", "src", "index.js");
const DASHBOARD = path.join(root, "web", "dist", "index.html");

const NOTES = 160;
const VIEWPORT = { width: 1440, height: 900 };
const WARMUP_MS = 1_500;
const SAMPLE_MS = Number(process.env.PERF_SAMPLE_MS || 4_000);
/**
 * 14 of the 16.7 ms a 60 Hz frame allows, for script, style and layout. The
 * measured worst case (the 160-note cap) sits near 8 ms here; the headroom is
 * for a slower runner and for paint, which the budget deliberately excludes.
 */
const BUDGET_MS = Number(process.env.PERF_FRAME_BUDGET_MS || 14);
const MIN_FPS = Number(process.env.PERF_MIN_FPS || 10);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Counters the budget is made of; a missing one must not read as zero cost. */
const COUNTERS = ["TaskDuration", "ScriptDuration", "RecalcStyleDuration", "LayoutDuration"];

const AREAS = ["career", "life", "ideas"];

/**
 * A vault at the cloud's node cap: headings, real wikilinks (two per note) and
 * shared tags, so the draw loop has the edges and labels a large vault does.
 */
async function scratchVault() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-perf-vault-"));
  const notes = Array.from({ length: NOTES }, (_, index) => {
    const number = index + 1;
    const title = `Perf Note ${number}`;
    const first = ((index + 1) % NOTES) + 1;
    const second = ((index * 7 + 5) % NOTES) + 1;
    const captured = new Date(Date.UTC(2026, 8, 1) - index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const body = [
      "---",
      `title: ${title}`,
      `captured: ${captured}`,
      `area: ${AREAS[index % AREAS.length]}`,
      "origin: ai",
      `tags: [theme-${index % 40}]`,
      "---",
      `# ${title}`,
      "",
      `A scratch note for the frame budget, linked to [[Perf Note ${first}]] and [[Perf Note ${second}]].`,
      "",
      "The animation loop has to place, size and fade every note in this vault,",
      "move its hit target and draw the links between them, every single frame.",
      "",
    ].join("\n");
    return { relative: `notes/${String(number).padStart(3, "0")}.md`, body };
  });
  await Promise.all(
    notes.map(async ({ relative, body }) => {
      const file = path.join(vault, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body, "utf8");
    }),
  );
  return vault;
}

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

function capture(child) {
  let output = "";
  const keep = (chunk) => {
    output += chunk.toString();
    if (output.length > 20_000) output = output.slice(-20_000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  return () => output;
}

function chromeCandidates() {
  if (process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const local = process.env.LOCALAPPDATA ?? "";
    return [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}

function findChrome() {
  const explicit = process.env.CHROME_PATH?.trim();
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`CHROME_PATH points at ${explicit}, which does not exist`);
    }
    return explicit;
  }
  const found = chromeCandidates().find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error(
      "no Chrome, Edge or Chromium found; install one or set CHROME_PATH to its executable",
    );
  }
  return found;
}

/** The small slice of the DevTools protocol this check needs. */
class Devtools {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
      } catch {
        return;
      }
      if (typeof message.id !== "number") return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
    });
  }

  static async open(url) {
    if (typeof WebSocket !== "function") {
      throw new Error("the perf check needs Node 22+ for its built-in WebSocket");
    }
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error(`could not open ${url}`)), {
        once: true,
      });
    });
    return new Devtools(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Already closing.
    }
  }
}

async function evaluate(session, expression, awaitPromise = false) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(`page evaluation failed: ${description}`);
  }
  return result.result.value;
}

/**
 * Whether the first note's projected position changes over `waitMs`. A draw
 * loop that stopped (or motion that stayed off) would otherwise make the gate
 * look fast: no per-frame work is exactly what an idle cloud costs.
 */
async function cloudIsMoving(session, waitMs = 400) {
  return await evaluate(
    session,
    `new Promise((resolve) => {
      const read = () => {
        const node = document.querySelector('circle.cloud-node');
        return node ? node.getAttribute('cx') + ',' + node.getAttribute('cy') : '';
      };
      const before = read();
      setTimeout(() => {
        const after = read();
        resolve(before.length > 0 && after.length > 0 && before !== after);
      }, ${waitMs});
    })`,
    true,
  );
}

async function waitFor(label, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(
    `timed out after ${timeoutMs} ms waiting for ${label}` +
      (lastError ? ` (last error: ${lastError.message})` : ""),
  );
}

function metricsOf(response) {
  return Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value]));
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function readDevtoolsPort(profile, child, output) {
  const activePort = path.join(profile, "DevToolsActivePort");
  await waitFor("Chrome's DevTools port", async () => {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited with ${child.exitCode}\n${output()}`);
    }
    const text = await fs.readFile(activePort, "utf8");
    return text.split("\n")[0]?.trim().length > 0;
  }, 15_000);
  const [port, wsPath] = (await fs.readFile(activePort, "utf8")).split("\n");
  if (!port || !wsPath) throw new Error("Chrome wrote an incomplete DevToolsActivePort");
  return { port: Number(port), wsPath: wsPath.trim() };
}

async function openPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(`Chrome refused a new tab: HTTP ${response.status}`);
  }
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error("Chrome returned no page websocket URL");
  return Devtools.open(target.webSocketDebuggerUrl);
}

async function main() {
  if (!existsSync(ENTRY)) throw new Error(`no built server at ${ENTRY}; run npm run build first`);
  if (!existsSync(DASHBOARD)) {
    throw new Error(`no built dashboard at ${DASHBOARD}; run npm run build first`);
  }
  if (!Number.isFinite(BUDGET_MS) || BUDGET_MS <= 0) {
    throw new Error(`PERF_FRAME_BUDGET_MS must be a positive number, got ${process.env.PERF_FRAME_BUDGET_MS}`);
  }

  const chromePath = findChrome();
  const vault = await scratchVault();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-perf-chrome-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let server = null;
  let chrome = null;
  let session = null;
  let serverOutput = () => "";
  let chromeOutput = () => "";

  try {
    server = spawn(process.execPath, [ENTRY], {
      cwd: root,
      env: {
        ...process.env,
        BRAINDASH_ROOT: root,
        VAULT_PATH: vault,
        BRAINDASH_PORT: String(port),
        HOST: "127.0.0.1",
        // The measured session is a read-only dashboard, like the product's.
        BRAINDASH_WRITE: "0",
        // Same reason as the smoke's: a token in the developer's `.env` must not
        // turn the measurement into a screenshot of the unlock screen.
        BRAINDASH_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverOutput = capture(server);
    await waitFor(
      "the built server",
      async () => {
        if (server.exitCode !== null) {
          throw new Error(`server exited with ${server.exitCode}\n${serverOutput()}`);
        }
        try {
          const response = await fetch(`${base}/api/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          return response.ok;
        } catch {
          return false;
        }
      },
      20_000,
    );

    chrome = spawn(
      chromePath,
      [
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-dev-shm-usage",
        "--disable-sync",
        "--disable-features=Translate,MediaRouter,OptimizationHints",
        // GitHub's Ubuntu image can restrict unprivileged user namespaces, so
        // Chrome's sandbox may not start there. The page is this repository's
        // own dashboard on a loopback port, and the profile is disposable.
        ...(process.env.CI ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
        "--hide-scrollbars",
        "--mute-audio",
        `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
        "--force-device-scale-factor=1",
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    chromeOutput = capture(chrome);
    const devtools = await readDevtoolsPort(profile, chrome, chromeOutput);
    session = await openPage(devtools.port);

    const version = await session.send("Browser.getVersion").catch(() => null);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("Performance.enable");
    await session.send("Network.enable");
    // The dependency card shells out to npm on first read; that is a separate
    // cost from the draw loop and must not land inside the sample window.
    await session.send("Network.setBlockedURLs", { urls: ["*/api/deps*"] });
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await session.send("Page.navigate", { url: `${base}/` });
    await waitFor("the dashboard document", async () => {
      return (await evaluate(session, "document.readyState")) === "complete";
    });
    await waitFor("the cloud to mount", async () => {
      return await evaluate(session, "Boolean(document.querySelector('.cloud-svg'))");
    });

    // The app reads the preference at mount, so set it and reload rather than
    // trying to click through the settings panel.
    await evaluate(session, "localStorage.setItem('braindash.motion', 'on'); true");
    await session.send("Page.reload", { ignoreCache: false });
    await waitFor("the reloaded dashboard", async () => {
      return (await evaluate(session, "document.readyState")) === "complete";
    });
    await waitFor(
      `the cloud to show ${NOTES} notes`,
      async () => {
        const count = await evaluate(
          session,
          "document.querySelectorAll('circle.cloud-node').length",
        );
        return typeof count === "number" && count >= NOTES;
      },
      25_000,
    );
    // Let fonts, the first graph repaint and the clock settle before sampling.
    await sleep(WARMUP_MS);
    if (!(await cloudIsMoving(session))) {
      throw new Error("the cloud is drawn but not moving; cloud motion may have failed to start");
    }

    await evaluate(
      session,
      `(() => {
        window.__perf = { frames: 0, start: performance.now() };
        const step = () => {
          window.__perf.frames += 1;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        return true;
      })()`,
    );
    const before = metricsOf(await session.send("Performance.getMetrics"));
    await sleep(SAMPLE_MS);
    const after = metricsOf(await session.send("Performance.getMetrics"));
    const page = await evaluate(
      session,
      `({
        frames: window.__perf.frames,
        elapsedMs: performance.now() - window.__perf.start,
        nodes: document.querySelectorAll('circle.cloud-node').length,
        edges: document.querySelectorAll('line.cloud-edge').length,
      })`,
    );
    if (!(await cloudIsMoving(session))) {
      throw new Error("the cloud stopped moving during the sample; the draw loop did not survive it");
    }

    for (const name of COUNTERS) {
      if (typeof before[name] !== "number" || typeof after[name] !== "number") {
        throw new Error(`Chrome did not report the ${name} counter`);
      }
    }
    const delta = (name) => Math.max(0, after[name] - before[name]);
    const sample = sampleFrames({
      taskMs: delta("TaskDuration") * 1000,
      layoutMs: delta("LayoutDuration") * 1000,
      styleMs: delta("RecalcStyleDuration") * 1000,
      scriptMs: delta("ScriptDuration") * 1000,
      frames: page.frames,
      elapsedMs: page.elapsedMs,
    });
    const verdict = judgeFrameSample(sample, {
      budgetMs: BUDGET_MS,
      minFps: MIN_FPS,
    });

    console.log(
      `[perf] ${page.nodes} notes · ${page.edges} edges · ${VIEWPORT.width}x${VIEWPORT.height} · ` +
        `${version?.product ?? "Chrome"}`,
    );
    console.log(
      `[perf] ${sample.frames} frames in ${sample.seconds.toFixed(2)} s — ${sample.fps.toFixed(1)} fps ` +
        `(liveness floor ${MIN_FPS})`,
    );
    console.log(
      `[perf] animation ${sample.animationMsPerFrame.toFixed(2)} ms/frame ` +
        `(budget ${BUDGET_MS.toFixed(1)}) · script ${sample.scriptMsPerFrame.toFixed(2)} · ` +
        `style ${sample.styleMsPerFrame.toFixed(2)} · layout ${sample.layoutMsPerFrame.toFixed(2)} · ` +
        `main thread ${sample.taskMsPerFrame.toFixed(2)} total`,
    );

    if (!verdict.ok) {
      for (const reason of verdict.reasons) console.error(`[perf] FAILED: ${reason}`);
      console.error(`[perf] server log:\n${serverOutput()}`);
      if (chromeOutput().trim()) console.error(`[perf] chrome log:\n${chromeOutput()}`);
      process.exitCode = 1;
      return;
    }
    console.log("[perf] ok: the animated core stays inside its frame budget");
  } finally {
    session?.close();
    stop(chrome);
    stop(server);
    await sleep(200);
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
    await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error("[perf] FAILED");
  console.error(error);
  process.exit(1);
});
