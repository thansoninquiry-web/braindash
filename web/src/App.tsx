import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActionPanel, { type ActionKind } from "./components/ActionPanel";
import AmbientDeck from "./components/AmbientDeck";
import BrokenLinks from "./components/BrokenLinks";
import Clock from "./components/Clock";
import CommandPalette from "./components/CommandPalette";
import DependencyHealthCard from "./components/DependencyHealth";
import FullGraph from "./components/FullGraph";
import DailyRecall from "./components/DailyRecall";
import NodeCloud, { type CloudState } from "./components/NodeCloud";
import NoteComposer from "./components/NoteComposer";
import NoteReader, { type HeadingRequest } from "./components/NoteReader";
import QuickActions from "./components/QuickActions";
import SearchBar from "./components/SearchBar";
import SettingsPanel from "./components/SettingsPanel";
import StatCard from "./components/StatCard";
import TrailRow from "./components/TrailRow";
import TrashPanel from "./components/TrashPanel";
import LifeSection from "./components/LifeSection";
import LockButton from "./components/LockButton";
import ModeNotice from "./components/ModeNotice";
import Starfield from "./components/Starfield";
import WorkingModeBadge from "./components/WorkingModeBadge";
import { buildWikilinkIndex, resolveWikilink as lookupWikilink } from "../../shared/wikilinks";
import { encodeNotePath, getJson, sendJson } from "./api";
import { formatBytes } from "./format";
import {
  activeTimeZone,
  buildCaptureSeries,
  capturedInstant,
  formatDateKey,
  formatClockTime,
  zoneDayKey,
  readStoredHour12,
  readStoredTimeZone,
  saveHour12,
  saveTimeZone,
} from "./clock";
import { modeChangeNotice, tabIdentity, type ModeChangeNotice } from "./modeBadge";
import {
  paletteCommands,
  type PaletteCommandId,
  type PaletteEntry,
} from "./palette";
import { MODE_STREAM_EVENT, MODE_STREAM_URL, parseModeFrame } from "./modeStream";
import { readNoticeMuted, saveNoticeMuted } from "./modeNoticeMute";
import {
  readNoticeHistory,
  rememberModeChange,
  saveNoticeHistory,
  type ModeChangeRecord,
} from "./modeNoticeHistory";
import { skippedLabel, skippedTooltip } from "./skipped";
import { unreadableLabel, unreadableTooltip } from "./unreadable";
import { readStoredMotion, resolveMotion, saveMotion, type MotionPref } from "./motion";
import { useLockAction } from "./useLockAction";
import {
  readStoredRefresh,
  resolveRefreshMs,
  saveRefresh,
  shouldCheckVault,
  type RefreshPref,
} from "./refresh";
import {
  applyTheme,
  hourBucket,
  readStoredTheme,
  readStoredThemeMode,
  resolveTheme,
  saveTheme,
  saveThemeMode,
  systemColorScheme,
  THEMES,
  type ThemeId,
  type ThemeMode,
} from "./themes";
import type {
  ActionCatalogue,
  CaptureDay,
  DependencyHealth,
  Health,
  NoteDeleteResult,
  NoteDetail,
  NoteIndex,
  NoteSaveResult,
  NoteSummary,
  ReviewQueue,
  SkippedEntry,
  Stats,
  UnreadableEntry,
  VaultGraph,
  WorkingMode,
} from "./types";

const numberFormat = new Intl.NumberFormat("en-US");

/**
 * How often the dashboard wakes to ask whether a vault check is due. The check
 * itself is paced by the chosen interval; this ticker is fast so a tab that was
 * hidden, throttled or asleep catches up as soon as it is looked at again.
 */
const REFRESH_TICK_MS = 15_000;

/**
 * Fallback cadence for the working mode. The stream below is what makes a flip
 * immediate; this poll covers a browser without `EventSource` and answers again
 * after a stream that stays down, without ever competing with the badge update.
 */
const MODE_POLL_MS = 60_000;
/** How long a mode-change notice stays before dismissing itself. */
const MODE_NOTICE_MS = 9_000;

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return numberFormat.format(value);
}

/**
 * The time-dependent part of `Stats`: the 30-day window moves at midnight even
 * when the vault itself has not changed, so the refresh gate has to notice it.
 */
function seriesKey(series: Stats["series"]): string {
  return series.map((point) => `${point.date}:${point.count}`).join("|");
}

/** The instant a row was captured, read in its note's own recorded zone. */
function capturedTime(note: NoteSummary): number {
  return capturedInstant(note.captured, note.capturedZone ?? undefined)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

/** Newest first; rows without a usable stamp sort last, ties by title. */
function byCapturedDesc(a: NoteSummary, b: NoteSummary): number {
  const at = capturedTime(a);
  const bt = capturedTime(b);
  if (at !== bt) return bt - at;
  return a.title.localeCompare(b.title);
}

/** The dialog state for one quick action; null while it is closed. */
interface ActionPanelState {
  kind: ActionKind;
  date: string;
  notes: NoteSummary[];
  loading: boolean;
  error: string | null;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  /** Symlinks the walk refused to follow; zero hides the status row. */
  const [skipped, setSkipped] = useState<SkippedEntry[]>([]);
  /** Listed notes whose read failed; zero hides the status row. */
  const [unreadable, setUnreadable] = useState<UnreadableEntry[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [deps, setDeps] = useState<DependencyHealth | null>(null);
  const [depsLoading, setDepsLoading] = useState(true);
  const [workingMode, setWorkingMode] = useState<WorkingMode | null>(null);
  const [modeNotice, setModeNotice] = useState<ModeChangeNotice | null>(null);
  /** Flips that arrived while muted, kept on the badge instead of shown. */
  const [modeHistory, setModeHistory] = useState<ModeChangeRecord[]>(() => readNoticeHistory());
  /** Session-scoped: silences the notice until this tab is closed. */
  const [noticesMuted, setNoticesMuted] = useState<boolean>(() => readNoticeMuted());
  const [note, setNote] = useState<NoteDetail | null>(null);
  /** `[[Note#Heading]]` asked for a heading in the note being opened. */
  const [noteHeading, setNoteHeading] = useState<HeadingRequest | null>(null);
  const headingNonce = useRef(0);
  /** Retried after a failed read with the heading the link asked for. */
  const lastHeading = useRef<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [lastNotePath, setLastNotePath] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  /** The recoverable notes in `.trash`; mounted only while open. */
  const [trashOpen, setTrashOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());
  const [manualTheme, setManualTheme] = useState<ThemeId>(() => readStoredTheme());
  // Re-resolved on an OS colour-scheme flip, on the minute, and on refocus, so a
  // dashboard left open overnight follows the clock without a reload.
  const [autoTick, setAutoTick] = useState(0);
  const [motion, setMotion] = useState<MotionPref>(() => readStoredMotion());
  const [timeZone, setTimeZone] = useState<string>(() => readStoredTimeZone());
  const [hour12, setHour12] = useState<boolean>(() => readStoredHour12());
  const [refresh, setRefresh] = useState<RefreshPref>(() => readStoredRefresh());
  /** Bumped only when the vault really changed, so a poll never resets the UI. */
  const [vaultVersion, setVaultVersion] = useState(0);
  /** Bumped on every completed vault check, so LIFE follows the same cadence. */
  const [refreshTick, setRefreshTick] = useState(0);
  /** The gate's session, if this install has one; the header shows the lock and
   *  the palette offers it only then. */
  const lockAction = useLockAction();
  /** Wall-clock stamp of the last successful check, and its in-flight guard. */
  const lastCheckedAt = useRef<number | null>(null);
  const checking = useRef(false);
  /** The last mode that answered, so the first fetch is not announced as a flip. */
  const lastKnownMode = useRef<WorkingMode | null>(null);
  /** Fingerprint of the scan the loaded data came from. */
  const fingerprint = useRef<string | null>(null);
  /** Buckets of the stats currently painted; a new day is a real change. */
  const appliedSeries = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  /** The keyboard launcher; `⌘K` / `Ctrl+K` toggles it. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Counts for the two server-backed quick actions. */
  const [actions, setActions] = useState<ActionCatalogue | null>(null);
  const [actionPanel, setActionPanel] = useState<ActionPanelState | null>(null);
  // Which top-level section is showing. `#life` survives a reload and the back button.
  const [section, setSection] = useState<"core" | "life">(() =>
    window.location.hash === "#life" ? "life" : "core",
  );
  const animate = resolveMotion(motion);
  const clock = useMemo(() => ({ timeZone, hour12 }), [timeZone, hour12]);
  // The poll hands back a fresh object every minute, and the tab prints only two
  // of its fields, so it is keyed on those: an unchanged mode must not rewrite
  // the title and favicon on every poll.
  const tab = useMemo(
    () => tabIdentity(workingMode),
    [workingMode?.mode, workingMode?.source],
  );
  const zone = activeTimeZone(clock);
  /** The zone the next stats request should ask for; a ref keeps fetches stable. */
  const requestedZone = useRef(zone);
  requestedZone.current = zone;
  /**
   * The calendar day in the chosen zone. The capture window ends on it, and a
   * vault poll does not fire at midnight (the fingerprint has not moved), so
   * this state is what makes an open dashboard re-bucket for the new day.
   */
  const [zoneDay, setZoneDay] = useState(() => zoneDayKey(new Date(), clock));
  useEffect(() => {
    const sync = () => setZoneDay(zoneDayKey(new Date(), clock));
    sync();
    const timer = window.setInterval(sync, 30_000);
    return () => window.clearInterval(timer);
  }, [clock]);

  useEffect(() => {
    const onHash = () => setSection(window.location.hash === "#life" ? "life" : "core");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goSection = useCallback((next: "core" | "life") => {
    setSection(next);
    const hash = next === "life" ? "#life" : "#core";
    if (window.location.hash !== hash) window.location.hash = hash;
  }, []);

  // `⌘K` / `Ctrl+K` opens the launcher from anywhere on the dashboard. It stays
  // closed while another dialog is up: two modals would mean two focus traps and
  // two things claiming Escape.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setPaletteOpen((current) => {
        if (current) return false;
        if (noteOpen || settingsOpen || graphOpen || composerOpen || actionPanel) return false;
        return true;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [noteOpen, settingsOpen, graphOpen, composerOpen, actionPanel]);

  /** Stats are bucketed server-side too, so every request names the chosen zone. */
  const statsUrl = useCallback(
    (forZone: string, fresh = false) =>
      `/api/stats?tz=${encodeURIComponent(forZone)}${fresh ? "&refresh=1" : ""}`,
    [],
  );

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const forZone = requestedZone.current;
      const [healthData, statsData] = await Promise.all([
        getJson<Health>(`/api/health${fresh ? "?refresh=1" : ""}`),
        getJson<Stats>(statsUrl(forZone, fresh)),
      ]);
      setHealth(healthData);
      setError(null);
      setFetchedAt(new Date());
      // A zone change during the first request owns the newer series; applying
      // this response would put the cards back on the old calendar.
      if (requestedZone.current === forZone) {
        setStats(statsData);
        appliedSeries.current = seriesKey(statsData.series);
        fingerprint.current = statsData.fingerprint;
        lastCheckedAt.current = Date.now();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNotes = useCallback(async (): Promise<NoteSummary[] | null> => {
    setNotesLoading(true);
    try {
      const data = await getJson<NoteIndex>("/api/notes");
      setNotes(data.notes);
      setSkipped(data.skipped ?? []);
      setUnreadable(data.unreadable ?? []);
      setNotesError(null);
      return data.notes;
    } catch (cause) {
      setNotesError(cause instanceof Error ? cause.message : "Unknown error");
      return null;
    } finally {
      setNotesLoading(false);
    }
  }, []);

  const loadGraph = useCallback(async () => {
    try {
      setGraph(await getJson<VaultGraph>("/api/graph"));
    } catch {
      // The cloud falls back to a synthetic sphere when the graph is unavailable.
      setGraph(null);
    }
  }, []);

  /**
   * Dependency health is a registry round trip, so it loads on its own rather
   * than blocking the vault cards. `fresh` backs the card's Recheck button and
   * is the only request that skips the server's cache.
   */
  const loadDeps = useCallback(async (fresh = false) => {
    setDepsLoading(true);
    try {
      setDeps(await getJson<DependencyHealth>(`/api/deps${fresh ? "?refresh=1" : ""}`));
    } catch (cause) {
      // A toolchain check that cannot answer is the card's business, not the
      // vault banner's: the notes may be perfectly readable.
      setDeps({
        ok: false,
        checkedAt: new Date().toISOString(),
        behind: 0,
        newer: 0,
        stale: [],
        majors: [],
        error: cause instanceof Error ? cause.message : "Dependency check unavailable",
        cached: false,
      });
    } finally {
      setDepsLoading(false);
    }
  }, []);

  /**
   * The quick actions' counts. One small request, and the effect below refreshes
   * it only when something that can change the counts changed: a real vault
   * change (`vaultVersion`), the calendar day moving in the chosen zone, or the
   * zone itself. A five-second poll does not ask again.
   */
  const loadActions = useCallback(async () => {
    const params = new URLSearchParams({
      tz: requestedZone.current,
      date: zoneDayKey(new Date(), clock),
    });
    try {
      setActions(await getJson<ActionCatalogue>(`/api/actions?${params.toString()}`));
    } catch {
      // The tiles read "waiting for the vault index" instead of inventing counts.
      setActions(null);
    }
  }, [clock]);

  useEffect(() => {
    void load();
    void loadNotes();
    void loadGraph();
    void loadDeps();
  }, [load, loadNotes, loadGraph, loadDeps]);

  useEffect(() => {
    void loadActions();
  }, [loadActions, vaultVersion, zoneDay]);

  // Changing the clock's zone re-buckets the client series immediately; this
  // refreshes the server fallback too, so the cards never show two calendars.
  // Skipped on mount because `load()` already asked for the initial zone.
  const statsZone = useRef(zone);
  useEffect(() => {
    if (statsZone.current === zone) return;
    statsZone.current = zone;
    let cancelled = false;
    void (async () => {
      try {
        const statsData = await getJson<Stats>(statsUrl(zone));
        if (cancelled) return;
        setStats(statsData);
        setFetchedAt(new Date());
        appliedSeries.current = seriesKey(statsData.series);
        fingerprint.current = statsData.fingerprint;
        lastCheckedAt.current = Date.now();
      } catch {
        // Keep the last stats; the next unattended check retries in the new zone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zone, statsUrl]);

  const loadMode = useCallback(async () => {
    try {
      setWorkingMode(await getJson<WorkingMode>("/api/mode"));
    } catch {
      // A missing badge is better than a banner: the vault is the dashboard's job.
      setWorkingMode(null);
    }
  }, []);

  // Switching mode happens outside the browser, so the header has to hear about
  // it. The stream pushes the resolved mode as soon as `npm run mode` touches
  // the state file (or a schedule boundary passes); the slow poll stays as a
  // fallback for a browser without `EventSource` and as a safety net if the
  // stream cannot connect. A refocus still asks immediately — someone walked
  // back to the machine.
  useEffect(() => {
    void loadMode();
    const id = window.setInterval(() => void loadMode(), MODE_POLL_MS);
    const onFocus = () => void loadMode();
    window.addEventListener("focus", onFocus);

    let stream: EventSource | null = null;
    if (typeof EventSource !== "undefined") {
      try {
        stream = new EventSource(MODE_STREAM_URL);
        stream.addEventListener(MODE_STREAM_EVENT, (event) => {
          const next = parseModeFrame((event as MessageEvent<string>).data);
          // A malformed frame is not a mode: keep the last good one.
          if (next) setWorkingMode(next);
        });
      } catch {
        stream = null;
      }
    }

    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      stream?.close();
    };
  }, [loadMode]);

  // A dashboard left behind another window still has to answer "am I at work?"
  // from the tab strip alone, so title and favicon follow the same mode payload.
  useEffect(() => {
    document.title = tab.title;
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.append(icon);
    }
    icon.type = "image/svg+xml";
    icon.href = tab.icon;
  }, [tab]);

  // The badge alone is easy to miss. A real work/home flip gets one short
  // notice; the first answer and source-only changes stay quiet.
  useEffect(() => {
    if (!workingMode) return;
    const previous = lastKnownMode.current;
    lastKnownMode.current = workingMode;
    if (!previous || previous.mode === workingMode.mode) return;
    const change = modeChangeNotice(previous, workingMode);
    if (!change) return;
    // A muted tab keeps the flip on the badge instead. Unmuting does not replay
    // it: the backlog is the record, and this stays true across a reload.
    if (noticesMuted) {
      setModeHistory((history) =>
        rememberModeChange(history, change, workingMode.checkedAt),
      );
      return;
    }
    setModeNotice(change);
  }, [workingMode, noticesMuted]);

  // The backlog shares the mute's per-tab lifetime, so a reload keeps both the
  // silence and the flips it hid.
  useEffect(() => {
    saveNoticeHistory(modeHistory);
  }, [modeHistory]);

  // Do not let the notice expire unseen behind another window: the timer starts
  // only while visible, and a return to the tab gets the full reading time.
  useEffect(() => {
    if (!modeNotice) return;
    let timer: number | null = null;
    const arm = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (document.hidden) return;
      timer = window.setTimeout(() => setModeNotice(null), MODE_NOTICE_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [modeNotice]);

  /**
   * One unattended check. `/api/stats` carries a fingerprint of the scan, so the
   * notes index, graph and health are only re-read when it actually moved: an
   * idle dashboard costs one small request and repaints nothing, which is what
   * keeps a focused cluster, an open recall note and the graph's pan intact.
   */
  const checkVault = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const forZone = requestedZone.current;
      const statsData = await getJson<Stats>(statsUrl(forZone));
      // The user picked another zone while this was in flight; its fetch wins.
      if (forZone !== requestedZone.current) return;
      lastCheckedAt.current = Date.now();
      setFetchedAt(new Date());
      // LIFE re-reads on the dashboard's cadence, not only when the scan's
      // fingerprint moved: a Daily/Monthly edit that leaves the index identical
      // still belongs on screen.
      setRefreshTick((tick) => tick + 1);
      const buckets = seriesKey(statsData.series);
      if (fingerprint.current === statsData.fingerprint) {
        // The vault is unchanged, but the 30-day window can still have moved
        // across midnight. Repaint the cards without re-reading anything else.
        if (appliedSeries.current === buckets) return;
        appliedSeries.current = buckets;
        setStats(statsData);
        return;
      }
      const [healthData, notesData, graphData] = await Promise.all([
        getJson<Health>("/api/health"),
        getJson<NoteIndex>("/api/notes"),
        getJson<VaultGraph>("/api/graph"),
      ]);
      fingerprint.current = statsData.fingerprint;
      appliedSeries.current = buckets;
      setHealth(healthData);
      setStats(statsData);
      setNotes(notesData.notes);
      setSkipped(notesData.skipped ?? []);
      setUnreadable(notesData.unreadable ?? []);
      setGraph(graphData);
      setError(null);
      setVaultVersion((version) => version + 1);
    } catch {
      // A background check that fails must not blank a working dashboard; the
      // Synced stamp simply stops advancing until the vault answers again.
    } finally {
      checking.current = false;
    }
  }, [statsUrl]);

  /**
   * The unattended refresh: a fast ticker that asks whether the chosen interval
   * has passed, plus focus/visibility so a throttled or sleeping tab checks the
   * moment it is looked at. Nothing runs while the window is hidden.
   */
  useEffect(() => {
    if (resolveRefreshMs(refresh) === null) return;
    const maybeCheck = () => {
      const due = shouldCheckVault(
        {
          hidden: document.visibilityState === "hidden",
          lastCheckedAt: lastCheckedAt.current,
          now: Date.now(),
        },
        refresh,
      );
      if (due) void checkVault();
    };
    const timer = window.setInterval(maybeCheck, REFRESH_TICK_MS);
    window.addEventListener("focus", maybeCheck);
    document.addEventListener("visibilitychange", maybeCheck);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", maybeCheck);
      document.removeEventListener("visibilitychange", maybeCheck);
    };
  }, [checkVault, refresh]);

  const openNote = useCallback(async (notePath: string, heading: string | null = null) => {
    setNoteOpen(true);
    setNoteLoading(true);
    setNoteError(null);
    setNote(null);
    setLastNotePath(notePath);
    lastHeading.current = heading;
    // A nonce, not just the text: clicking the same `#Heading` twice must scroll
    // again rather than look like no change happened.
    headingNonce.current += 1;
    setNoteHeading(heading ? { text: heading, nonce: headingNonce.current } : null);
    try {
      const detail = await getJson<NoteDetail>(`/api/notes/${encodeNotePath(notePath)}`);
      setNote(detail);
    } catch (cause) {
      setNoteError(cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setNoteLoading(false);
    }
  }, []);

  /**
   * Opens one of the two lists. The list is read on open rather than kept from
   * the poll, so a review date edited a minute ago is already reflected, and the
   * panel records the day it was asked about so its rows compare against the same
   * calendar the counts used.
   */
  const openActionPanel = useCallback(
    async (kind: ActionKind) => {
      const date = zoneDayKey(new Date(), clock);
      setActionPanel({ kind, date, notes: [], loading: true, error: null });
      const route = kind === "today" ? "/api/captures/today" : "/api/review/queue";
      const params = new URLSearchParams({ tz: requestedZone.current, date });
      try {
        const data = await getJson<CaptureDay | ReviewQueue>(`${route}?${params.toString()}`);
        setActionPanel((current) =>
          current && current.kind === kind
            ? { ...current, date: data.date, notes: data.notes, loading: false }
            : current,
        );
      } catch (cause) {
        setActionPanel((current) =>
          current && current.kind === kind
            ? {
                ...current,
                loading: false,
                error:
                  cause instanceof Error ? cause.message : "The vault index could not be read.",
              }
            : current,
        );
      }
    },
    [clock],
  );

  const openNoteFromPanel = useCallback(
    (path: string) => {
      setActionPanel(null);
      void openNote(path);
    },
    [openNote],
  );

  const openRandomNote = useCallback(async () => {
    const list = notes ?? (await loadNotes());
    if (!list || list.length === 0) {
      setLastNotePath(null);
      setNote(null);
      setNoteLoading(false);
      setNoteError(
        notesError ?? "The vault index is empty, so there is no note to open.",
      );
      setNoteOpen(true);
      return;
    }
    const pick = list[Math.floor(Math.random() * list.length)] ?? list[0];
    if (pick) await openNote(pick.path);
  }, [notes, notesError, loadNotes, openNote]);

  const retryNote = useCallback(() => {
    if (lastNotePath) void openNote(lastNotePath, lastHeading.current);
    else void openRandomNote();
  }, [lastNotePath, openNote, openRandomNote]);

  /**
   * `[[wikilink]]` resolution. The index is the shared one the server builds for
   * graph edges, so a link rendered here opens exactly the note an edge points at.
   */
  const wikilinkIndex = useMemo(() => buildWikilinkIndex(notes ?? []), [notes]);

  const resolveWikilink = useCallback(
    (target: string) => lookupWikilink(wikilinkIndex, target),
    [wikilinkIndex],
  );

  const closeNote = useCallback(() => setNoteOpen(false), []);

  /** True only when the API reports writes enabled; the UI stays read-only otherwise. */
  const writable = Boolean(health?.writes);

  /**
   * A save changes the note, its index row, its graph edges and the vault's
   * size, so everything that reads from the scan is refreshed together. The
   * server invalidated its cache as part of the write, so these are real reads.
   */
  const refreshAfterWrite = useCallback(() => {
    void loadNotes();
    void loadGraph();
    void load();
    setVaultVersion((version) => version + 1);
  }, [load, loadNotes, loadGraph]);

  const saveNote = useCallback(
    async (markdown: string) => {
      if (!note) return;
      const saved = await sendJson<NoteSaveResult>(
        `/api/notes/${encodeNotePath(note.path)}`,
        "PUT",
        { markdown, baseModifiedAt: note.modifiedAt },
      );
      // The save answers with the re-read note, so the reader never flickers
      // back through a loading state to show what it just wrote.
      setNote(saved);
      refreshAfterWrite();
    },
    [note, refreshAfterWrite],
  );

  const deleteCurrentNote = useCallback(async () => {
    if (!note) return;
    await sendJson<NoteDeleteResult>(`/api/notes/${encodeNotePath(note.path)}`, "DELETE");
    setNote(null);
    setNoteOpen(false);
    setLastNotePath(null);
    refreshAfterWrite();
  }, [note, refreshAfterWrite]);

  const createNote = useCallback(
    async (path: string, markdown: string) => {
      const created = await sendJson<NoteDetail>("/api/notes", "POST", { path, markdown });
      setComposerOpen(false);
      setNote(created);
      setNoteError(null);
      setNoteLoading(false);
      setNoteHeading(null);
      setLastNotePath(created.path);
      setNoteOpen(true);
      refreshAfterWrite();
    },
    [refreshAfterWrite],
  );

  // The 30-day capture window ends on "today" in the clock's zone, so the
  // sparkline and its deltas agree with the zone-aware stamps beside them.
  // `zoneDay` is a dependency so a dashboard left open past midnight no longer
  // keeps yesterday's buckets; the server-series fallback shows until notes load.
  const localCaptures = useMemo(
    () =>
      notes
        ? buildCaptureSeries(
            notes.map((entry) => ({ captured: entry.captured, zone: entry.capturedZone })),
            clock,
          )
        : null,
    [notes, clock, zoneDay],
  );
  const capturePoints = localCaptures ?? stats?.series ?? [];
  const series = capturePoints.map((point) => point.count);
  // Each bucket of the capture sparkline names its own day and count on hover,
  // so a spike can be traced to a date without opening anything.
  const seriesLabels = capturePoints.map(
    (point) =>
      `${formatDateKey(point.date) ?? point.date} · ${point.count} ${
        point.count === 1 ? "capture" : "captures"
      }`,
  );
  const captures30d = localCaptures
    ? series.reduce((sum, count) => sum + count, 0)
    : (stats?.captures30d ?? 0);
  // Notes indexed grows monotonically; captures is a daily count. Give each
  // card its own shape instead of reusing the daily series twice.
  const undated = stats ? Math.max(stats.totalNotes - captures30d, 0) : 0;
  let running = undated;
  const indexSeries = series.map((count) => {
    running += count;
    return running;
  });
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  /** Picking an accent is an explicit choice, so it leaves Auto behind. */
  const selectTheme = useCallback((id: ThemeId) => {
    setManualTheme(id);
    saveTheme(id);
    setThemeMode("manual");
    saveThemeMode("manual");
  }, []);
  const selectThemeMode = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    saveThemeMode(mode);
  }, []);
  const selectMotion = useCallback((pref: MotionPref) => {
    setMotion(pref);
    saveMotion(pref);
  }, []);
  const selectTimeZone = useCallback((zone: string) => {
    setTimeZone(zone);
    saveTimeZone(zone);
  }, []);
  const selectHour12 = useCallback((twelve: boolean) => {
    setHour12(twelve);
    saveHour12(twelve);
  }, []);
  const selectRefresh = useCallback((pref: RefreshPref) => {
    setRefresh(pref);
    saveRefresh(pref);
  }, []);
  /** Muting is immediate: the notice on screen is the one being silenced. */
  const selectNoticesMuted = useCallback((muted: boolean) => {
    setNoticesMuted(muted);
    saveNoticeMuted(muted);
    setModeNotice(null);
  }, []);
  /** Clears the badge's backlog without touching whether notices are muted. */
  const clearModeHistory = useCallback(() => setModeHistory([]), []);
  /** The button promises a fresh disk read, so it ignores the watch cache. */
  const rescan = useCallback(() => {
    void (async () => {
      await load(true);
      await Promise.all([loadNotes(), loadGraph()]);
      // A manual rescan is a new index even when the poll's fingerprint gate
      // would have stayed quiet, so every card that follows the vault (recall,
      // link health) refreshes with the click instead of on the next poll.
      setVaultVersion((version) => version + 1);
    })();
  }, [load, loadNotes, loadGraph]);
  /**
   * The palette's commands are rebuilt from the live dashboard state, so a count
   * or the presence of `New note` matches what the rail is showing. Notes arrive
   * from the palette's own search, not this list.
   */
  const commands = useMemo(
    () =>
      paletteCommands({
        writable,
        graphReady: graph !== null,
        lockable: lockAction.lockable,
        today: actions?.actions.find((action) => action.id === "today") ?? null,
        review: actions?.actions.find((action) => action.id === "review") ?? null,
      }),
    [writable, graph, actions, lockAction.lockable],
  );

  const runPaletteEntry = useCallback(
    (entry: PaletteEntry) => {
      setPaletteOpen(false);
      if (entry.group === "Notes") {
        void openNote(entry.id);
        return;
      }
      switch (entry.id as PaletteCommandId) {
        case "rescan":
          rescan();
          break;
        case "settings":
          setSettingsOpen(true);
          break;
        case "graph":
          setGraphOpen(true);
          break;
        case "random":
          void openRandomNote();
          break;
        case "today":
          void openActionPanel("today");
          break;
        case "review":
          void openActionPanel("review");
          break;
        case "compose":
          setComposerOpen(true);
          break;
        case "trash":
          setTrashOpen(true);
          break;
        case "core":
          goSection("core");
          break;
        case "life":
          goSection("life");
          break;
        case "lock":
          lockAction.run();
          break;
        default:
          break;
      }
    },
    [openNote, rescan, openRandomNote, openActionPanel, goSection, lockAction],
  );

  /**
   * A restore changes the vault in a way the poll would notice only later: the
   * note is fresh, so this is the manual-rescan path, then the panel closes and
   * the restored note opens. Closing first keeps one dialog — and one focus
   * trap — alive at a time.
   */
  const restoredFromTrash = useCallback(
    (path: string) => {
      setTrashOpen(false);
      void (async () => {
        await load(true);
        await Promise.all([loadNotes(), loadGraph()]);
        setVaultVersion((version) => version + 1);
        void openNote(path);
      })();
    },
    [load, loadNotes, loadGraph, openNote],
  );

  const scheme = systemColorScheme();
  const theme = useMemo(
    () => resolveTheme(themeMode, manualTheme),
    // autoTick is the re-resolve trigger for the clock; the scheme is read fresh.
    [themeMode, manualTheme, autoTick],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (themeMode !== "auto") return;
    const bump = () => {
      setAutoTick((tick) => tick + 1);
    };
    let media: MediaQueryList | null = null;
    try {
      media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
    } catch {
      media = null;
    }
    media?.addEventListener("change", bump);
    const timer = window.setInterval(bump, 60_000);
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", bump);
    return () => {
      media?.removeEventListener("change", bump);
      window.clearInterval(timer);
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [themeMode, scheme]);

  /** Which signal Auto used, for the Settings caption. */
  const autoSource =
    scheme === null
      ? `clock · ${hourBucket(new Date())}`
      : `OS ${scheme} · ${hourBucket(new Date())}`;

  const vaultPath = stats?.vaultPath ?? health?.vaultPath ?? null;
  const noteCount = stats?.totalNotes ?? health?.noteCount ?? 0;
  const avgWords = stats && stats.totalNotes > 0 ? Math.round(stats.totalWords / stats.totalNotes) : 0;
  const avgBytes = stats && stats.totalNotes > 0 ? Math.round(stats.totalBytes / stats.totalNotes) : 0;
  // Null when the walk skipped nothing; the status row is not a zero counter.
  const skippedRow = skippedLabel(skipped);
  // Same rule for the notes the scan found but could not read.
  const unreadableRow = unreadableLabel(unreadable);

  // One honest state for the core readout: what the app is doing right now.
  const coreState: CloudState = error
    ? "error"
    : noteLoading
      ? "reading"
      : loading || notesLoading
        ? "scanning"
        : "idle";

  const areaMix = (["career", "life", "ideas", "unset"] as const).map((key) => ({
    key,
    count: stats?.byArea[key] ?? 0,
  }));
  const areaTotal = areaMix.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const leadingArea = [...areaMix]
    .filter((entry) => entry.key !== "unset")
    .sort((a, b) => b.count - a.count)[0];
  const leadingShare = leadingArea ? Math.round((leadingArea.count / areaTotal) * 100) : 0;
  const todayCaptures = series[series.length - 1] ?? 0;
  const trail = notes ? [...notes].filter((note_) => note_.captured).sort(byCapturedDesc).slice(0, 3) : [];

  return (
    <div className="app">
      <Starfield />
      {modeNotice ? (
        <ModeNotice
          notice={modeNotice}
          onDismiss={() => setModeNotice(null)}
          onMute={() => selectNoticesMuted(true)}
        />
      ) : null}
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1 className="brand-name">
              BrainDash<span className="brand-tag">/m3</span>
            </h1>
            <p className="brand-sub">Second brain · command center</p>
          </div>
        </div>

        <div className="mode-switch" role="radiogroup" aria-label="Accent theme">
          {THEMES.map((option) => {
            const active = option.id === theme;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`mode-pill${active ? " is-active" : ""}`}
                onClick={() => selectTheme(option.id)}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <WorkingModeBadge
          mode={workingMode}
          clock={clock}
          history={modeHistory}
          onClearHistory={clearModeHistory}
          noticesMuted={noticesMuted}
          onSelectNoticesMuted={selectNoticesMuted}
        />

        <AmbientDeck />

        <button
          type="button"
          className="palette-trigger"
          onClick={() => setPaletteOpen(true)}
          aria-label="Open the command palette"
          aria-haspopup="dialog"
          title="Command palette · ⌘K / Ctrl+K"
        >
          <span aria-hidden="true">⌘K</span>
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open settings"
          aria-haspopup="dialog"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M4 7h10M18 7h2M4 17h4M12 17h8M4 12h6M14 12h6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <circle cx="16" cy="7" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="9" cy="17" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>

        <LockButton />

        <Clock prefs={clock} />
      </header>

      <div className="statusbar">
        <span className="status-item">
          <span
            className={`status-dot ${error ? "is-off" : loading || notesLoading ? "is-busy" : "is-on"}`}
            aria-hidden="true"
          />
          Core · {coreState.toUpperCase()}
        </span>
        <span className="status-item">Vault {error ? "offline" : "connected"}</span>
        <span className="status-item">{numberFormat.format(noteCount)} notes</span>
        <span className="status-item">{compact(stats?.totalWords ?? 0)} words</span>
        {skippedRow ? (
          <span
            className="status-item status-skipped"
            title={skippedTooltip(skipped)}
            aria-label={skippedTooltip(skipped).replace(/:\n/g, ": ").replace(/\n/g, "; ")}
          >
            {skippedRow}
          </span>
        ) : null}
        {unreadableRow ? (
          <span
            className="status-item status-unreadable"
            title={unreadableTooltip(unreadable)}
            aria-label={unreadableTooltip(unreadable).replace(/:\n/g, ": ").replace(/\n/g, "; ")}
          >
            {unreadableRow}
          </span>
        ) : null}
        <span
          className="status-item status-path"
          title={vaultPath ?? "VAULT_PATH missing"}
        >
          {vaultPath ? vaultPath : "path not configured"}
        </span>
        <span className="statusbar-spacer" />
        <span className="status-item status-stamp">
          Synced {fetchedAt ? formatClockTime(fetchedAt, clock) : "—"}
        </span>
      </div>

      <nav className="section-nav" role="tablist" aria-label="Sections">
        <button
          type="button"
          role="tab"
          aria-selected={section === "core"}
          className={`section-tab${section === "core" ? " is-active" : ""}`}
          onClick={() => goSection("core")}
        >
          Core<span className="section-tab-hint">Vault</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "life"}
          className={`section-tab${section === "life" ? " is-active" : ""}`}
          onClick={() => goSection("life")}
        >
          Life<span className="section-tab-hint">7 areas</span>
        </button>
      </nav>

      {section === "core" ? (
        <>
      <SearchBar onOpenNote={(path) => void openNote(path)} clock={clock} />

      {error ? (
        <div className="banner banner-error" role="alert">
          <span className="banner-label">Vault offline</span>
          <p>{error}</p>
          <p className="banner-hint">
            Set <code>VAULT_PATH</code> in <code>braindash/.env</code> to the absolute path of your vault
            folder (quote paths with spaces), then hit Rescan.
          </p>
        </div>
      ) : null}

      <main className="grid">
        <section className="rail rail-left" aria-label="Vault statistics">
          <div className="rail-head">
            <h2 className="rail-title">System vitals</h2>
            <span
              className={`rail-tag rail-live${animate ? " is-animated" : ""}${
                refresh === "off" ? " is-paused" : ""
              }`}
              title={refresh === "off" ? "Automatic refresh off" : "Refreshing automatically"}
            >
              <span className="rail-live-dot" aria-hidden="true" />
              Vault data
            </span>
          </div>

          <StatCard
            label="Notes indexed"
            value={loading && !stats ? "—" : numberFormat.format(noteCount)}
            caption={`${stats?.withCaptured ?? 0} carrying a captured date`}
            delta={`+${numberFormat.format(captures30d)} /30d`}
            spark={indexSeries}
            animate={animate}
          />

          <StatCard
            label="Captures · 30d"
            value={loading && !stats ? "—" : numberFormat.format(captures30d)}
            caption={stats?.lastCapture ? `Latest: ${stats.lastCapture.title}` : "No captures in window"}
            delta={`+${numberFormat.format(todayCaptures)} today`}
            spark={series}
            sparkLabels={seriesLabels}
            animate={animate}
          />

          <StatCard
            label="Word volume"
            value={loading && !stats ? "—" : compact(stats?.totalWords ?? 0)}
            caption={`≈ ${numberFormat.format(avgWords)} words per note`}
            delta={`${numberFormat.format(stats?.totalNotes ?? 0)} notes`}
            animate={animate}
          />

          <StatCard
            label="Vault size"
            value={loading && !stats ? "—" : formatBytes(stats?.totalBytes ?? 0)}
            caption={`Markdown on disk · ≈ ${formatBytes(avgBytes)} per note`}
            delta={`${numberFormat.format(stats?.totalNotes ?? 0)} files`}
            animate={animate}
            footer={
              stats?.largestNote ? (
                <button
                  type="button"
                  className="metric-link"
                  onClick={() => void openNote(stats.largestNote!.path)}
                  title={`Open ${stats.largestNote.path}`}
                >
                  Largest: {stats.largestNote.title}
                  <span className="metric-link-size">{formatBytes(stats.largestNote.bytes)}</span>
                </button>
              ) : null
            }
          />

          <div className="meter">
            <div className="meter-head">
              <span className="metric-label">Vault · area mix</span>
              <span className="rail-tag">Frontmatter</span>
            </div>
            <div className="meter-value">
              {leadingShare}
              <span className="meter-unit">% {leadingArea?.key ?? "untagged"}</span>
            </div>
            <div
              className="meter-bar"
              role="img"
              aria-label={areaMix
                .map((entry) => `${entry.key} ${entry.count}`)
                .join(", ")}
            >
              {areaMix
                .filter((entry) => entry.count > 0)
                .map((entry) => (
                  <span
                    key={entry.key}
                    className={`meter-seg area-${entry.key}`}
                    style={{ flexGrow: entry.count }}
                  />
                ))}
            </div>
            <div className="meter-scale" aria-hidden="true">
              {["0", "25", "50", "75", "100"].map((tick) => (
                <span key={tick}>{tick}</span>
              ))}
            </div>
          </div>

          <div className="rail-head rail-head-sub">
            <h2 className="rail-title">Index trail</h2>
            <span className="rail-tag">{notes ? `${notes.length} indexed` : "pending"}</span>
          </div>

          <ul className="trail">
            {trail.map((entry) => (
              <li key={entry.path}>
                <TrailRow
                  entry={entry}
                  clock={clock}
                  onOpen={() => void openNote(entry.path)}
                />
              </li>
            ))}
            {trail.length === 0 ? <li className="trail-empty">No captures in the index yet</li> : null}
          </ul>
        </section>

        <NodeCloud
          noteCount={noteCount}
          graph={graph}
          byArea={stats?.byArea ?? {}}
          focusTitle="Vault Network"
          focusCaption={
            stats
              ? `${numberFormat.format(stats.totalNotes)} notes · latest: ${stats.lastCapture?.title ?? "—"} · ${numberFormat.format(captures30d)} captures / 30d`
              : "Awaiting vault scan"
          }
          activePath={note?.path ?? null}
          state={coreState}
          animate={animate}
          onEnableMotion={() => selectMotion("on")}
          onOpenNote={(path) => void openNote(path)}
        />

        <div className="rail rail-right">
          <DailyRecall
            resolveWikilink={resolveWikilink}
            onOpenNote={(path) => void openNote(path)}
            vaultVersion={vaultVersion}
            clock={clock}
          />

          <QuickActions
            onRescan={rescan}
            busy={loading}
            vaultPath={vaultPath}
            onOpenRandom={() => void openRandomNote()}
            notesBusy={notesLoading}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenGraph={() => setGraphOpen(true)}
            graphReady={Boolean(graph)}
            writable={writable}
            onNewNote={() => setComposerOpen(true)}
            onOpenTrash={() => setTrashOpen(true)}
            actions={actions}
            onTodayCaptures={() => void openActionPanel("today")}
            onOpenReview={() => void openActionPanel("review")}
          />

          <BrokenLinks vaultVersion={vaultVersion} onOpenNote={(path) => void openNote(path)} />

          <DependencyHealthCard
            deps={deps}
            loading={depsLoading}
            checkedLabel={deps ? `Checked ${formatClockTime(new Date(deps.checkedAt), clock)}` : ""}
            onRecheck={() => void loadDeps(true)}
          />
        </div>
      </main>
        </>
      ) : (
        <LifeSection animate={animate} clock={clock} refreshTick={refreshTick} refresh={refresh} />
      )}

      <footer className="footer">
        <span>{writable ? "Writes enabled" : "Read-only session"}</span>
        <span>·</span>
        <span>
          {writable ? "Edits are limited to this machine" : "Nothing is written to the vault"}
        </span>
        <span className="footer-spacer" />
        <span className="footer-mono">BrainDash v0.1.0 · M3</span>
      </footer>

      {actionPanel ? (
        <ActionPanel
          open
          kind={actionPanel.kind}
          date={actionPanel.date}
          notes={actionPanel.notes}
          loading={actionPanel.loading}
          error={actionPanel.error}
          clock={clock}
          onOpenNote={openNoteFromPanel}
          onClose={() => setActionPanel(null)}
        />
      ) : null}

      <FullGraph
        open={graphOpen}
        graph={graph}
        animate={animate}
        onClose={() => setGraphOpen(false)}
        onOpenNote={(path) => void openNote(path)}
      />

      <NoteReader
        open={noteOpen}
        note={note}
        error={noteError}
        loading={noteLoading}
        onClose={closeNote}
        onRetry={retryNote}
        resolveWikilink={resolveWikilink}
        onOpenNote={(path, heading) => void openNote(path, heading)}
        headingRequest={noteHeading}
        clock={clock}
        writes={writable}
        onSave={saveNote}
        onDelete={deleteCurrentNote}
      />

      <NoteComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreate={createNote}
      />

      <TrashPanel
        open={trashOpen}
        clock={clock}
        writable={writable}
        version={vaultVersion}
        onRestored={restoredFromTrash}
        onClose={() => setTrashOpen(false)}
      />

      <SettingsPanel
        open={settingsOpen}
        theme={theme}
        themeMode={themeMode}
        autoSource={autoSource}
        onSelectMode={selectThemeMode}
        onSelect={selectTheme}
        motion={motion}
        onSelectMotion={selectMotion}
        clock={clock}
        onSelectTimeZone={selectTimeZone}
        onSelectHour12={selectHour12}
        refresh={refresh}
        onSelectRefresh={selectRefresh}
        noticesMuted={noticesMuted}
        onSelectNoticesMuted={selectNoticesMuted}
        onClose={closeSettings}
      />

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onRun={runPaletteEntry}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
