import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createVaultApp, type VaultAppOptions } from "../src/app.js";
import { modeSignature } from "../src/modeStream.js";
import { readWorkingMode, type WorkingMode } from "../src/workingMode.js";

type Mode = "work" | "home";

function modePayload(mode: Mode, overrides: Partial<WorkingMode> = {}): WorkingMode {
  return {
    mode,
    source: "explicit override",
    stale: false,
    since: "2026-10-21T11:00:00.000Z",
    until: null,
    note: null,
    schedule: {
      mode: "home",
      timeZone: "America/New_York",
      days: [1, 2, 3, 4, 5],
      start: "08:30",
      end: "17:30",
    },
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

interface Running {
  base: string;
  close(): Promise<void>;
}

async function start(options: VaultAppOptions = {}): Promise<Running> {
  const { app, cache } = createVaultApp({ vaultPath: null, staticDir: null, ...options });
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

/** Reads `event:`/`data:` frames, skipping comments and the retry hint. */
class SseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  async next(timeoutMs = 2_000): Promise<{ event: string; data: string } | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const boundary = this.buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const frame = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 2);
        if (!frame || frame.startsWith(":")) continue;
        const event = /^event:\s*(.+)$/m.exec(frame)?.[1] ?? "message";
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s?/, ""))
          .join("\n");
        if (!data) continue;
        return { event, data };
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const chunk = await readWithin(this.reader, remaining);
      if (!chunk) return null;
      this.buffer += this.decoder.decode(chunk, { stream: true });
    }
  }

  async cancel(): Promise<void> {
    try {
      await this.reader.cancel();
    } catch {
      // Already cancelled by an aborted fetch.
    }
  }
}

function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result.done ? null : result.value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(
  base: string,
): Promise<{ response: Response; sse: SseReader; abort: AbortController }> {
  const abort = new AbortController();
  const response = await fetch(`${base}/api/mode/stream`, {
    headers: { accept: "text/event-stream" },
    signal: abort.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.ok(response.body, "the stream has a body");
  return { response, sse: new SseReader(response.body), abort };
}

/** Writes `mode: <mode>` atomically, as `npm run mode` effectively does. */
async function writeModeState(dir: string, mode: Mode): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const body = `mode: ${mode}\nsince: ${new Date().toISOString()}\n`;
  const temporary = path.join(dir, `.working-mode-${Date.now()}-${Math.random()}`);
  await fs.writeFile(temporary, body, "utf8");
  await fs.rename(temporary, path.join(dir, "working-mode"));
}

describe("modeSignature", () => {
  it("ignores checkedAt, so a re-read that changed nothing is not a repaint", () => {
    const first = modePayload("home");
    const second = { ...first, checkedAt: new Date(Date.now() + 5_000).toISOString() };
    assert.equal(modeSignature(first), modeSignature(second));
  });

  it("moves when anything the badge can show changes", () => {
    const base = modePayload("home");
    const changes: Partial<WorkingMode>[] = [
      { mode: "work" },
      { source: "schedule" },
      { stale: true },
      { since: null },
      { until: "2026-10-21T19:00:00.000Z" },
      { note: "back in an hour" },
      { schedule: { ...base.schedule, mode: "work" } },
      { schedule: { ...base.schedule, start: "09:00" } },
    ];
    for (const change of changes) {
      assert.notEqual(modeSignature({ ...base, ...change }), modeSignature(base), JSON.stringify(change));
    }
  });
});

describe("GET /api/mode/stream", () => {
  it("sends the current mode at connect and a flip without a client poll", async () => {
    let current = modePayload("home", { checkedAt: "2026-10-21T11:00:00.000Z" });
    const running = await start({
      mode: () => current,
      modeWatchPath: null,
      modeStreamIntervalMs: 20,
    });
    const { sse, abort } = await connect(running.base);

    try {
      const first = await sse.next();
      assert.ok(first, "the first frame arrives");
      assert.equal(first.event, "mode");
      assert.equal(JSON.parse(first.data).mode, "home");

      current = modePayload("work", { checkedAt: "2026-10-21T11:00:01.000Z" });
      const flip = await sse.next(1_000);
      assert.ok(flip, "the change is pushed");
      assert.equal(JSON.parse(flip.data).mode, "work");
      assert.equal(JSON.parse(flip.data).checkedAt, "2026-10-21T11:00:01.000Z");

      // The stream re-reads every 20 ms; unchanged content must not keep sending.
      await sleep(100);
      assert.equal(await sse.next(120), null, "no duplicate frame for an unchanged mode");
    } finally {
      abort.abort();
      await sse.cancel();
      await running.close();
    }
  });

  it("pushes a state-file write even when the cadence is far slower", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "braindash-mode-stream-"));
    const stateDir = path.join(root, ".freebuff");
    await writeModeState(stateDir, "work");

    const running = await start({
      mode: () => readWorkingMode({ root }),
      // fs.watch is the only thing that can deliver this inside three seconds.
      modeWatchPath: stateDir,
      modeStreamIntervalMs: 10_000,
    });
    const { sse, abort } = await connect(running.base);

    try {
      const first = await sse.next();
      assert.ok(first, "the first frame arrives");
      assert.equal(JSON.parse(first.data).mode, "work");

      await writeModeState(stateDir, "home");
      const flip = await sse.next(3_000);
      assert.ok(flip, "the file change is pushed by the watcher");
      assert.equal(JSON.parse(flip.data).mode, "home");
      assert.equal(JSON.parse(flip.data).source, "explicit override");
    } finally {
      abort.abort();
      await sse.cancel();
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
