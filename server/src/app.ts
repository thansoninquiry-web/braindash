import path from "node:path";
import fs from "node:fs";
import express, { type Express, type Request, type Response } from "express";
import { clearedCookie, isAuthorized, sameToken, sessionCookie } from "./accessToken.js";
import { createDepsReader, type DepsReader } from "./deps.js";
import { hostGuard, isLoopbackHost, noStore, securityHeaders } from "./httpSecurity.js";
import { emptyLife, readLife } from "./life.js";
import { MODE_STATE_DIR, readWorkingMode, type WorkingMode } from "./workingMode.js";
import { createModeStream } from "./modeStream.js";
import { VaultCache, type VaultWatcher } from "./vaultCache.js";
import {
  buildBrokenLinkReport,
  buildGraph,
  buildStats,
  capturesOnDay,
  dayKeyInZone,
  localDayKey,
  reviewQueue,
  noteConnections,
  NotePathError,
  pickDaily,
  readNote,
  createNote,
  deleteNote,
  listTrash,
  restoreTrashNote,
  resolveRecallDate,
  resolveTimeZone,
  scanVault,
  searchNotes,
  writeNote,
  type NoteConnections,
  type NoteMeta,
  type VaultScan,
} from "./vault.js";

/** Freshness window used only while no filesystem watcher is running. */
export const SCAN_CACHE_TTL_MS = 5_000;

export type WatchFactory = (
  onChange: () => void,
  onError: () => void,
) => VaultWatcher | null;

export interface VaultAppOptions {
  /** Vault root, or null/undefined to serve the unconfigured responses. */
  vaultPath?: string | null;
  /**
   * Watcher factory. `undefined` uses the real `fs.watch` on the vault; `null`
   * disables watching so the 5 s TTL is the freshness rule (tests, and hosts
   * where recursive watching is unavailable).
   */
  watch?: WatchFactory | null;
  /** Defaults to `SCAN_CACHE_TTL_MS`; the tests use the default. */
  fallbackTtlMs?: number;
  /** Injectable clock for the cache's TTL, used by the API tests. */
  now?: () => number;
  /** Fault injection for the scan; defaults to the real read-only scanner. */
  scan?: (vaultPath: string) => Promise<VaultScan>;
  /** Built web app to serve for non-API routes; null in API-only tests. */
  staticDir?: string | null;
  /**
   * Dependency-health reader. Defaults to the real cached npm check; tests pass
   * a stub so no suite talks to the registry or spawns npm.
   */
  deps?: DepsReader;
  /**
   * Allow note writes. Off by default: a scan-only install stays read-only.
   * Even when on, writes are accepted from loopback only.
   */
  writes?: boolean;
  /**
   * Shared access token. Undefined/null leaves the API open, which is what a
   * single-machine install wants; set, every API route needs the token (header
   * or the session cookie the unlock screen posts for).
   */
  token?: string | null;
  /**
   * Extra `Host` names to answer besides loopback, `.localhost` and literal
   * addresses (from `BRAINDASH_HOSTS`). A hostname on the LAN is the case this
   * exists for; a bare entry allows any port, `name:port` pins one.
   */
  hosts?: readonly string[];
  /** Fault injection for the working mode; defaults to the real reader. */
  mode?: () => WorkingMode;
  /**
   * Where the mode stream watches for a change. Defaults to `.freebuff/`;
   * `null` disables the watcher and leaves the one-second cadence (tests).
   */
  modeWatchPath?: string | null;
  /** Mode-stream cadence; tests shorten it to keep a change under a second. */
  modeStreamIntervalMs?: number;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

/**
 * Writes are a same-machine privilege. The dashboard may be on the LAN, where
 * Vite proxies `/api` from another device, so the socket address alone is not
 * enough: the forwarded Host header and, when present, the Origin must be
 * loopback too. A browser on another machine sends its own hostname here.
 */
function isLocalRequest(req: Request): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (!isLoopbackHost(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!isLoopbackHost(new URL(origin).hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export interface VaultApp {
  app: Express;
  cache: VaultCache<VaultScan> | null;
}

/**
 * Watches the vault root recursively, so a note saved anywhere below it dirties
 * the cache. Recursive `fs.watch` is supported on Windows, macOS and Linux
 * (Node 20); an unsupported filesystem returns null and the TTL takes over.
 */
function watchVault(
  root: string,
  onChange: () => void,
  onError: () => void,
  fallbackTtlMs: number,
): VaultWatcher | null {
  try {
    const watcher = fs.watch(root, { recursive: true }, onChange);
    watcher.on("error", (error: Error) => {
      console.warn(`[braindash] vault watch failed: ${error.message}; polling again`);
      onError();
    });
    console.log(`[braindash] watching ${root} for changes`);
    return { close: () => watcher.close() };
  } catch (error) {
    console.warn(
      `[braindash] cannot watch ${root} (${(error as Error).message}); ` +
        `falling back to a ${fallbackTtlMs} ms cache`,
    );
    return null;
  }
}

/**
 * Builds the read-only API. Kept separate from `index.ts` so the suite can
 * start the real routes on an ephemeral port with a temporary vault, an
 * injectable clock and no filesystem watcher — the only way to exercise the
 * 5 s fallback cache end to end without sleeping.
 */
export function createVaultApp(options: VaultAppOptions = {}): VaultApp {
  const vaultPath = options.vaultPath?.trim() || null;
  const fallbackTtlMs = options.fallbackTtlMs ?? SCAN_CACHE_TTL_MS;
  const watchFactory =
    options.watch === null
      ? undefined
      : options.watch ??
        (vaultPath ? (change, fail) => watchVault(vaultPath, change, fail, fallbackTtlMs) : undefined);

  const app = express();
  app.disable("x-powered-by");
  // Before every route and both servers' output: a policy a future endpoint
  // cannot forget. The token gate protects data; these protect the browser.
  app.use(securityHeaders);
  const allowedHosts = options.hosts ?? [];
  // `/api` only answers a Host that names this machine (a literal address, a
  // loopback name or BRAINDASH_HOSTS). A DNS-rebinding page reaches loopback
  // with its own domain in that header, and this is what turns it away — no
  // token required, so a default install is covered too.
  app.use("/api", noStore, hostGuard(allowedHosts));
  const writesEnabled = options.writes ?? false;
  const accessToken = options.token?.trim() || null;
  // The note body is the only JSON the API accepts; 1 MB is ~1000 pages of
  // markdown and far below anything the editor can produce by accident.
  const jsonBody = express.json({ limit: "1mb" });
  app.use(jsonBody);
  const readVault = options.scan ?? scanVault;
  const depsReader = options.deps ?? createDepsReader();
  const readMode = options.mode ?? (() => readWorkingMode());
  const modeStream = createModeStream({
    read: readMode,
    watchPath: options.modeWatchPath === undefined ? MODE_STATE_DIR : options.modeWatchPath,
    intervalMs: options.modeStreamIntervalMs,
  });

  const vaultCache = vaultPath
    ? new VaultCache<VaultScan>({
        scan: () => readVault(vaultPath),
        watch: watchFactory,
        fallbackTtlMs,
        now: options.now,
      })
    : null;

  /** `?refresh=1` backs the manual Rescan button, which expects a real disk read. */
  function wantsRescan(query: Record<string, unknown>): boolean {
    return query.refresh === "1";
  }

  function vaultConfigured(): boolean {
    if (!vaultPath) return false;
    try {
      return fs.statSync(vaultPath).isDirectory();
    } catch {
      return false;
    }
  }

  async function getScan(): Promise<VaultScan> {
    if (!vaultConfigured() || !vaultPath || !vaultCache) {
      throw Object.assign(new Error("VAULT_PATH is not set to a readable directory"), {
        status: 503,
      });
    }
    return vaultCache.get();
  }

  /**
   * The gate itself. `/api/session` below is deliberately outside it: the
   * dashboard has to be able to ask whether a token is required before it can
   * show the unlock screen, and the answer is two booleans and nothing else.
   * Everything else — including `/api/health`, which names the vault path and
   * the note count — is behind the token when one is configured.
   */
  function sessionPayload(req: Request) {
    return {
      required: accessToken !== null,
      authenticated: accessToken !== null && isAuthorized(req, accessToken),
    };
  }

  app.get("/api/session", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(sessionPayload(req));
  });

  // The unlock screen posts the token once and gets an HttpOnly cookie back. The
  // token is never stored in the page, echoed in a response, or written to a log.
  app.post("/api/session", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!accessToken) {
      // Nothing to unlock; a 404 would make the screen look broken on an install
      // that simply has no token set.
      res.json({ required: false, authenticated: false });
      return;
    }
    const presented = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!presented || !sameToken(presented, accessToken)) {
      res.status(401).json({ error: "bad_token", detail: "That access token was not accepted." });
      return;
    }
    res.setHeader("Set-Cookie", sessionCookie(accessToken));
    res.json({ required: true, authenticated: true });
  });

  app.delete("/api/session", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Set-Cookie", clearedCookie());
    res.json({ required: accessToken !== null, authenticated: false });
  });

  if (accessToken) {
    app.use("/api", (req, res, next) => {
      if (isAuthorized(req, accessToken)) {
        next();
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.status(401).json({
        error: "unauthorized",
        detail: "This dashboard needs its access token. Reload the page to enter it.",
      });
    });
  }

  app.get("/api/health", async (req, res) => {
    const configured = vaultConfigured();
    let noteCount: number | null = null;
    if (configured) {
      try {
        if (wantsRescan(req.query)) vaultCache?.invalidate();
        noteCount = (await getScan()).notes.length;
      } catch {
        noteCount = null;
      }
    }
    res.json({
      ok: true,
      configured,
      vaultPath: vaultPath ?? null,
      noteCount,
      uptimeSeconds: Math.round(process.uptime()),
      version: "0.1.0",
      // Per client, not global: a phone on the LAN sees the same dashboard with
      // writes off, and its UI hides the editing controls instead of offering
      // buttons the API will refuse.
      writes: writesEnabled && isLocalRequest(req),
      writeScope: writesEnabled ? "loopback" : null,
    });
  });

  // Local state, not vault state: this answers even when VAULT_PATH is unset, and
  // a change on disk is visible without a restart. `/api/mode/stream` below is
  // how an open dashboard hears about it without waiting for the fallback poll.
  app.get("/api/mode", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(readMode());
  });

  // The same payload as a live stream: `npm run mode` in a terminal reaches the
  // header in milliseconds rather than on the next one-minute poll. A schedule
  // boundary or an expiring override is caught by the stream's own re-resolve.
  app.get("/api/mode/stream", modeStream.handler);

  // Toolchain, not vault: the dashboard's dependency card reads the same npm
  // check the weekly drift job runs. `?refresh=1` backs its Recheck button and
  // is the only way to skip the 15-minute cache.
  app.get("/api/deps", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await depsReader.read({ refresh: wantsRescan(req.query) }));
  });

  app.get("/api/stats", async (req, res) => {
    try {
      if (wantsRescan(req.query)) vaultCache?.invalidate();
      const scan = await getScan();
      // The dashboard sends the zone chosen in Settings so its series and
      // captures30d are bucketed there even before /api/notes arrives. A missing
      // or malformed zone keeps the historical server-local behaviour.
      const timeZone = resolveTimeZone(req.query.tz);
      res.json({ vaultPath: scan.vaultPath, ...buildStats(scan, { timeZone }) });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      res.status(status).json({
        error: status === 503 ? "vault_not_configured" : "vault_scan_failed",
        detail: (error as Error).message,
        configured: status !== 503,
      });
    }
  });

  function sendVaultError(res: Response, error: unknown, fallbackCode: string): void {
    if (error instanceof NotePathError) {
      res.status(error.status).json({ error: error.code, detail: error.message });
      return;
    }
    const status = (error as { status?: number }).status ?? 500;
    res.status(status).json({
      error: status === 503 ? "vault_not_configured" : fallbackCode,
      detail: (error as Error).message,
    });
  }

  /**
   * One note plus its links and vault path, the shape both the reader and a
   * successful save answer with, so neither needs a second request.
   */
  async function notePayload(requested: string) {
    const note = await readNote(vaultPath as string, requested);
    let connections: NoteConnections = { outbound: [], backlinks: [] };
    try {
      connections = noteConnections(await getScan(), note);
    } catch {
      connections = { outbound: [], backlinks: [] };
    }
    return { ...note, ...connections, vaultPath: path.resolve(vaultPath as string) };
  }

  /**
   * Refuses a write unless the feature is on and the request is local. Answers
   * already sent, so callers only need `if (rejectWrite(req, res)) return;`.
   */
  function rejectWrite(req: Request, res: Response): boolean {
    if (!vaultConfigured()) {
      res.status(503).json({
        error: "vault_not_configured",
        detail: "VAULT_PATH is not set to a readable directory",
      });
      return true;
    }
    if (!writesEnabled) {
      res.status(403).json({
        error: "write_disabled",
        detail: "Set BRAINDASH_WRITE=1 and restart the API to edit notes",
      });
      return true;
    }
    if (!isLocalRequest(req)) {
      res.status(403).json({
        error: "write_forbidden",
        detail: "Notes can only be edited from the machine running the API",
      });
      return true;
    }
    return false;
  }

  /** A JSON body is required; a plain form post must not reach the editor. */
  function requireJson(req: Request, res: Response): boolean {
    if (req.is("application/json")) return false;
    res.status(415).json({
      error: "unsupported_media_type",
      detail: "Send the note as JSON: { markdown: string }"
    });
    return true;
  }

  function summarise(note: NoteMeta) {
    return {
      path: note.path,
      title: note.title,
      captured: note.captured,
      capturedZone: note.capturedZone,
      nextReview: note.nextReview,
      origin: note.origin,
      area: note.area,
      words: note.words,
      bytes: note.bytes,
      keywords: note.keywords,
      tags: note.tags,
    };
  }

  app.get("/api/search", async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (!query.trim()) {
      res.json({ query, total: 0, results: [], hint: "Pass ?q=<term>" });
      return;
    }
    try {
      const scan = await getScan();
      const results = searchNotes(scan, query);
      res.json({
        query,
        total: results.length,
        scannedAt: scan.scannedAt,
        results,
      });
    } catch (error) {
      sendVaultError(res, error, "search_failed");
    }
  });

  app.get("/api/recall/today", async (req, res) => {
    const rawSkip = typeof req.query.skip === "string" ? Number(req.query.skip) : 0;
    const skip = Number.isFinite(rawSkip) ? Math.max(0, Math.trunc(rawSkip)) : 0;
    try {
      const scan = await getScan();
      // The client sends the day in its own zone; the server's clock is only the
      // fallback for callers that do not know one (scripts, curl).
      const date = resolveRecallDate(req.query.date) ?? localDayKey(new Date());
      const note = pickDaily(scan, date, skip);
      res.json({ date, skip, total: scan.notes.length, note });
    } catch (error) {
      sendVaultError(res, error, "recall_failed");
    }
  });

  app.get("/api/graph", async (_req, res) => {
    try {
      const scan = await getScan();
      res.json({ scannedAt: scan.scannedAt, ...buildGraph(scan) });
    } catch (error) {
      sendVaultError(res, error, "graph_failed");
    }
  });

  // The graph's unresolved targets, grouped by the alias each note wrote, so a
  // broken link can be repaired at the label a person recognises rather than at
  // every spelling separately.
  app.get("/api/links/broken", async (_req, res) => {
    try {
      const scan = await getScan();
      res.json({ scannedAt: scan.scannedAt, ...buildBrokenLinkReport(scan) });
    } catch (error) {
      sendVaultError(res, error, "broken_links_failed");
    }
  });

  app.get("/api/notes", async (_req, res) => {
    try {
      const scan = await getScan();
      res.json({
        vaultPath: scan.vaultPath,
        scannedAt: scan.scannedAt,
        total: scan.notes.length,
        notes: scan.notes.map(summarise),
        // Two kinds of absence, kept apart: the walk deliberately did not
        // follow a link, or a listed note could not be read at all.
        skipped: scan.skipped,
        unreadable: scan.unreadable,
      });
    } catch (error) {
      sendVaultError(res, error, "vault_scan_failed");
    }
  });

  app.get("/api/notes/:path(*)", async (req, res) => {
    if (!vaultConfigured() || !vaultPath) {
      res.status(503).json({
        error: "vault_not_configured",
        detail: "VAULT_PATH is not set to a readable directory",
      });
      return;
    }
    try {
      // Links ride along with the body so opening a note is still one request.
      // A note is readable without the index, so a scan failure degrades to no
      // connections rather than failing the read.
      res.json(await notePayload(req.params.path ?? ""));
    } catch (error) {
      sendVaultError(res, error, "note_read_failed");
    }
  });

  // Replace one note. `baseModifiedAt` is the stamp the editor loaded: a file
  // that changed in the meantime answers 409 instead of being overwritten.
  app.put("/api/notes/:path(*)", async (req, res) => {
    if (rejectWrite(req, res)) return;
    if (requireJson(req, res)) return;
    const markdown = (req.body as { markdown?: unknown } | undefined)?.markdown;
    const baseModifiedAt =
      (req.body as { baseModifiedAt?: unknown } | undefined)?.baseModifiedAt;
    try {
      const written = await writeNote(
        vaultPath as string,
        req.params.path ?? "",
        markdown as string,
        typeof baseModifiedAt === "string" ? baseModifiedAt : null,
      );
      vaultCache?.invalidate();
      const payload = await notePayload(written.path);
      res.json({ ...payload, backup: written.backup });
    } catch (error) {
      sendVaultError(res, error, "note_write_failed");
    }
  });

  // A new note at a path the person types. Existing files are never replaced.
  app.post("/api/notes", async (req, res) => {
    if (rejectWrite(req, res)) return;
    if (requireJson(req, res)) return;
    const body = req.body as { path?: unknown; markdown?: unknown } | undefined;
    const requested = typeof body?.path === "string" ? body.path : "";
    const markdown = typeof body?.markdown === "string" ? body.markdown : "";
    try {
      const created = await createNote(vaultPath as string, requested, markdown);
      vaultCache?.invalidate();
      const payload = await notePayload(created.path);
      res.status(201).json(payload);
    } catch (error) {
      sendVaultError(res, error, "note_create_failed");
    }
  });

  // Deletion is a move into the vault's `.trash`, not an erase.
  app.delete("/api/notes/:path(*)", async (req, res) => {
    if (rejectWrite(req, res)) return;
    try {
      const removed = await deleteNote(vaultPath as string, req.params.path ?? "");
      vaultCache?.invalidate();
      res.json({ ok: true, ...removed });
    } catch (error) {
      sendVaultError(res, error, "note_delete_failed");
    }
  });

  // What deleting kept: the `.trash` list, newest first. Reading it is a read —
  // a token install can look without edit rights — while restoring is a write.
  app.get("/api/trash", async (_req, res) => {
    if (!vaultConfigured() || !vaultPath) {
      res.status(503).json({
        error: "vault_not_configured",
        detail: "VAULT_PATH is not set to a readable directory",
      });
      return;
    }
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await listTrash(vaultPath));
    } catch (error) {
      sendVaultError(res, error, "trash_failed");
    }
  });

  // Restore answers with the note itself, so the client can open it without a
  // second request. `note_exists` means the filename was re-used, not lost.
  app.post("/api/trash/restore", async (req, res) => {
    if (rejectWrite(req, res)) return;
    if (requireJson(req, res)) return;
    const id = (req.body as { id?: unknown } | undefined)?.id;
    try {
      const restored = await restoreTrashNote(vaultPath as string, typeof id === "string" ? id : "");
      vaultCache?.invalidate();
      const payload = await notePayload(restored.path);
      res.status(201).json({ ...payload, restored: true });
    } catch (error) {
      sendVaultError(res, error, "trash_restore_failed");
    }
  });

  // Life metrics are read from Daily/, Monthly/ and Weekly/ on every poll. A
  // missing folder or vault is an empty snapshot, not an error: the section shows
  // its demo badge instead of an offline banner.
  app.get("/api/life", async (_req, res) => {
    if (!vaultPath) {
      res.json(emptyLife(null, "VAULT_PATH is not set — showing demo data"));
      return;
    }
    try {
      res.json(await readLife(vaultPath));
    } catch (error) {
      res.json(emptyLife(path.resolve(vaultPath), (error as Error).message));
    }
  });

  /**
   * The day the client is asking about: its own calendar day when it sends one
   * (validated, so a typo cannot shift the window), otherwise today in the zone
   * it chose, otherwise the server's day. Both routes below use the same rule,
   * so "today" on a tile and the list it opens can never be different days.
   */
  function requestedDay(req: Request, timeZone: string | null): string {
    return (
      resolveRecallDate(req.query.date) ??
      (timeZone ? dayKeyInZone(new Date(), timeZone) : null) ??
      localDayKey(new Date())
    );
  }

  /**
   * The rail's data-bearing actions and their counts, in one small request. The
   * catalogue is intentionally narrow: Random note, Full graph, New note and
   * Themes are client-side and need no answer from the vault. Unknown ids
   * belong to a newer server, which the client ignores.
   */
  app.get("/api/actions", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const scan = await getScan();
      const timeZone = resolveTimeZone(req.query.tz);
      const date = requestedDay(req, timeZone);
      const captured = capturesOnDay(scan.notes, date, { timeZone }).length;
      const review = reviewQueue(scan.notes, date);
      res.json({
        date,
        timeZone,
        actions: [
          {
            id: "today",
            label: "Today's captures",
            count: captured,
            hint:
              captured === 0
                ? "Nothing captured on this day"
                : `${captured} note${captured === 1 ? "" : "s"} captured`,
          },
          {
            id: "review",
            label: "Review queue",
            count: review.due.length,
            hint:
              review.due.length === 0
                ? "Nothing due"
                : review.overdue > 0
                  ? `${review.overdue} of ${review.due.length} overdue`
                  : `${review.due.length} due today`,
          },
        ],
      });
    } catch (error) {
      sendVaultError(res, error, "actions_failed");
    }
  });

  // What the Today's captures tile opens. A note with no `captured` stamp has no
  // day to belong to, so it is absent rather than listed under an invented one.
  app.get("/api/captures/today", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const scan = await getScan();
      const timeZone = resolveTimeZone(req.query.tz);
      const date = requestedDay(req, timeZone);
      const notes = capturesOnDay(scan.notes, date, { timeZone });
      res.json({ date, timeZone, total: notes.length, notes: notes.map(summarise) });
    } catch (error) {
      sendVaultError(res, error, "captures_failed");
    }
  });

  // What the Review queue tile opens: notes whose own `next_review` has arrived.
  // A queue is a reading list, not a scheduler — advancing the date is an edit to
  // the note's frontmatter, which only a loopback write-enabled install can make.
  app.get("/api/review/queue", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const scan = await getScan();
      const timeZone = resolveTimeZone(req.query.tz);
      const date = requestedDay(req, timeZone);
      const review = reviewQueue(scan.notes, date);
      res.json({
        date,
        timeZone,
        total: review.due.length,
        overdue: review.overdue,
        notes: review.due.map(summarise),
      });
    } catch (error) {
      sendVaultError(res, error, "review_failed");
    }
  });

  // The SPA fallback below must not swallow a mistyped API call: a client asking
  // for JSON should get JSON, not the dashboard's index.html.
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

  // A malformed editor payload is the client's fault, not a server fault, and
  // should still be JSON rather than Express's HTML error page.
  app.use((error: Error & { type?: string }, _req: Request, res: Response, next: (err?: unknown) => void) => {
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: "invalid_json", detail: "The request body is not valid JSON" });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "note_too_large", detail: "The note body is too large" });
      return;
    }
    next(error);
  });

  const staticDir = options.staticDir;
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get("*", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  }

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  return { app, cache: vaultCache };
}
