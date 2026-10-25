/**
 * Server-sent events for the working mode.
 *
 * The mode is machine-local state changed by `npm run mode` in a terminal, so a
 * dashboard that only polls `/api/mode` can lag a flip by a minute. This stream
 * pushes the resolved mode to every open dashboard instead: a change to
 * `.freebuff/working-mode` is broadcast as soon as the filesystem reports it,
 * and a one-second re-resolve covers the two changes no file event announces —
 * a schedule boundary and an override's `until` expiring.
 *
 * The stream sends a payload only when something the badge can show actually
 * changed (`checkedAt` is excluded from the signature), and a comment heartbeat
 * keeps idle proxies from closing the connection.
 */
import fs from "node:fs";
import type { Request, Response } from "express";
import type { WorkingMode } from "./workingMode.js";

/** Re-resolve cadence, so a schedule or expiry flip lands within a second. */
export const MODE_STREAM_INTERVAL_MS = 1_000;
/** Comment cadence; well under the usual 30–60 s idle timeout of dev proxies. */
export const MODE_STREAM_HEARTBEAT_MS = 20_000;

export interface ModeStreamOptions {
  /** Reads the current mode; never expected to throw, but a throw is tolerated. */
  read: () => WorkingMode;
  /** Directory or file to watch for an immediate change; null uses the cadence alone. */
  watchPath?: string | null;
  /** Defaults to `MODE_STREAM_INTERVAL_MS`; tests shorten it. */
  intervalMs?: number;
  /** Defaults to `MODE_STREAM_HEARTBEAT_MS`. */
  heartbeatMs?: number;
}

export interface ModeStream {
  /** Express handler for `GET /api/mode/stream`. */
  handler(req: Request, res: Response): void;
  /** Releases the timer and watcher; safe to call more than once. */
  close(): void;
}

/**
 * The fields a connected dashboard repaints on. `checkedAt` moves on every read
 * and must not count as a change, or the stream would push once a second.
 */
export function modeSignature(mode: WorkingMode): string {
  return JSON.stringify([
    mode.mode,
    mode.source,
    mode.stale,
    mode.since,
    mode.until,
    mode.note,
    mode.schedule?.mode,
    mode.schedule?.timeZone,
    mode.schedule?.days,
    mode.schedule?.start,
    mode.schedule?.end,
  ]);
}

export function createModeStream(options: ModeStreamOptions): ModeStream {
  const intervalMs = options.intervalMs ?? MODE_STREAM_INTERVAL_MS;
  const heartbeatMs = options.heartbeatMs ?? MODE_STREAM_HEARTBEAT_MS;
  const watchPath = options.watchPath ?? null;

  const clients = new Set<Response>();
  let timer: NodeJS.Timeout | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let watcher: fs.FSWatcher | null = null;
  /** Signature last sent, so an unchanged mode never repaints a dashboard. */
  let lastSignature = "";
  /** Last payload, replayed to a client that connects mid-stream. */
  let current: WorkingMode | null = null;

  function readSafely(): WorkingMode | null {
    try {
      return options.read();
    } catch {
      return null;
    }
  }

  function send(res: Response, mode: WorkingMode): boolean {
    try {
      res.write(`event: mode\ndata: ${JSON.stringify(mode)}\n\n`);
      return true;
    } catch {
      return false;
    }
  }

  function stopWatcher(): void {
    const active = watcher;
    watcher = null;
    try {
      active?.close();
    } catch {
      // Already closed by a failed watch.
    }
  }

  function refresh(): void {
    const mode = readSafely();
    if (!mode) return;
    const signature = modeSignature(mode);
    if (signature === lastSignature) return;
    lastSignature = signature;
    current = mode;
    for (const res of [...clients]) {
      if (!send(res, mode)) clients.delete(res);
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(refresh, intervalMs);
    timer.unref?.();
    heartbeat = setInterval(() => {
      for (const res of [...clients]) {
        try {
          res.write(": ping\n\n");
        } catch {
          clients.delete(res);
        }
      }
    }, heartbeatMs);
    heartbeat.unref?.();
    if (!watchPath) return;
    try {
      watcher = fs.watch(watchPath, () => refresh());
      watcher.on("error", () => stopWatcher());
    } catch {
      // The cadence still catches the change; a missing directory is not fatal.
      watcher = null;
    }
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    stopWatcher();
    lastSignature = "";
    current = null;
  }

  function handler(_req: Request, res: Response): void {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    // `no-transform` matters in dev: a buffering proxy would defeat the stream.
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    // EventSource's own retry hint, so a dropped stream reconnects promptly.
    res.write("retry: 3000\n\n");

    const initial = current ?? readSafely();
    if (initial) {
      lastSignature = modeSignature(initial);
      current = initial;
      send(res, initial);
    }

    clients.add(res);
    if (!timer) start();

    res.on("close", () => {
      clients.delete(res);
      if (clients.size === 0) stop();
    });
  }

  return { handler, close: stop };
}
