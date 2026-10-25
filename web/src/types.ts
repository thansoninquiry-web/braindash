export interface Health {
  ok: boolean;
  configured: boolean;
  vaultPath: string | null;
  noteCount: number | null;
  uptimeSeconds: number;
  version: string;
  /** True only when the API was started with BRAINDASH_WRITE=1. */
  writes: boolean;
  /** Where writes are accepted; null when they are off. */
  writeScope: "loopback" | null;
}

export interface SeriesPoint {
  date: string;
  count: number;
}

export type NoteArea = "career" | "life" | "ideas";
export type NoteOrigin = "me" | "ai";

/** An entry the scan saw but did not follow, and why. */
export interface SkippedEntry {
  /** Vault-relative path of the entry itself. */
  path: string;
  reason: "symlink";
}

/** A `.md` file the scan listed but could not read. */
export interface UnreadableEntry {
  /** Vault-relative path of the note. */
  path: string;
  /** Node error code such as `EACCES`, `ENOENT`, `EISDIR`, or `UNKNOWN`. */
  code: string;
}

/** One row of the vault index, as returned by `/api/notes`. */
export interface NoteSummary {
  path: string;
  title: string;
  captured: string | null;
  /** IANA zone the note records for its capture; null means the machine zone. */
  capturedZone: string | null;
  /** `next_review` frontmatter as a validated `YYYY-MM-DD`, or null. */
  nextReview: string | null;
  origin: NoteOrigin | null;
  area: NoteArea | null;
  words: number;
  bytes: number;
  keywords: string[];
  tags: string[];
}

/** One row of `/api/actions`: an action that needs a server answer. */
export interface ActionSummary {
  /** Stable id the client maps to a handler (`today`, `review`). */
  id: string;
  label: string;
  count: number;
  /** One short line, e.g. `3 notes captured` or `1 of 2 overdue`. */
  hint: string;
}

/** `/api/actions`: the rail's data-bearing actions, counted for one day. */
export interface ActionCatalogue {
  /** The calendar day the counts describe, in the chosen zone. */
  date: string;
  timeZone: string | null;
  actions: ActionSummary[];
}

/** `/api/captures/today`: what the Today's captures tile opens. */
export interface CaptureDay {
  date: string;
  timeZone: string | null;
  total: number;
  notes: NoteSummary[];
}

/** `/api/review/queue`: what the Review queue tile opens. */
export interface ReviewQueue {
  date: string;
  timeZone: string | null;
  total: number;
  /** Notes whose `next_review` is strictly before the day. */
  overdue: number;
  notes: NoteSummary[];
}

export interface NoteIndex {
  vaultPath: string;
  scannedAt: string;
  total: number;
  notes: NoteSummary[];
  /** Symlinked files and folders left out of the walk, sorted by path. */
  skipped: SkippedEntry[];
  /** Listed notes whose read failed, sorted by path. */
  unreadable: UnreadableEntry[];
}

/** One `[[wikilink]]` out of a note, split and resolved by the shared parser. */
export interface NoteLink {
  /** Text before `#` and `|`, trimmed and unescaped. */
  target: string;
  /** `[[Target#Heading]]`'s heading; null when the link names none. */
  heading: string | null;
  /** Display text after `|`; null when absent or blank. */
  alias: string | null;
  /** What the note wrote: alias, else target, else heading. */
  label: string;
  /** Vault path when it resolves, null for a broken link. */
  path: string | null;
  title: string | null;
}

/** Another note that points at this one, through a link or a shared tag. */
export interface NoteBacklink {
  path: string;
  title: string;
  via: "wikilink" | "tag";
  /** Shared tags for a tag backlink; empty for a wikilink one. */
  tags: string[];
}

/** What a save or create answers with: the note plus where it was backed up. */
export interface NoteSaveResult extends NoteDetail {
  /** Vault-relative copy of the replaced body, kept in `.trash`. */
  backup: string | null;
}

/** What a delete answers with: the note moved into `.trash`. */
export interface NoteDeleteResult {
  ok: true;
  path: string;
  size: number;
  modifiedAt: string;
  trashedTo: string;
}

/** One recoverable note in the vault's `.trash`, as `/api/trash` lists it. */
export interface TrashEntry {
  /** Trash-relative id: `<stamp>/<original path>`; what a restore sends back. */
  id: string;
  /** Vault-relative path the note would return to. */
  path: string;
  title: string;
  /** When the note was deleted, ISO. */
  trashedAt: string;
  size: number;
}

export interface TrashListing {
  /** Absolute path of the vault's `.trash`; null when nothing was deleted yet. */
  trashPath: string | null;
  total: number;
  /** Newest first. */
  entries: TrashEntry[];
}

/** What a restore answers with: the note itself, so the reader can open it. */
export interface TrashRestoreResult extends NoteDetail {
  restored: true;
}

/** A single note plus its raw markdown, as returned by `/api/notes/:path`. */
export interface NoteDetail extends NoteSummary {
  markdown: string;
  size: number;
  modifiedAt: string;
  vaultPath: string;
  /** Resolved against the index server-side so the graph and reader agree. */
  outbound?: NoteLink[];
  backlinks?: NoteBacklink[];
}

export type SearchMatch = "title" | "tag" | "frontmatter" | "body";

/** One `/api/search` hit: enough to render a result row and open the note. */
export interface SearchHit {
  path: string;
  title: string;
  captured: string | null;
  capturedZone: string | null;
  area: NoteArea | null;
  origin: NoteOrigin | null;
  tags: string[];
  match: SearchMatch;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  total: number;
  results: SearchHit[];
  scannedAt?: string;
  hint?: string;
}

/** The note of the day, before its body is fetched. */
export interface RecallPick {
  path: string;
  title: string;
  tags: string[];
  captured: string | null;
  capturedZone: string | null;
  area: NoteArea | null;
}

export interface RecallToday {
  date: string;
  skip: number;
  total: number;
  note: RecallPick | null;
}

export interface GraphNode {
  id: string;
  title: string;
  tags: string[];
  area: NoteArea | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "wikilink" | "tag";
}

export interface VaultGraph {
  scannedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  isolated: string[];
  unresolved: string[];
  truncated: boolean;
}

/** One broken `[[wikilink]]`, with the note that wrote it. */
export interface BrokenLinkEntry {
  path: string;
  title: string;
  /** The target as written; also present in the graph's `unresolved`. */
  target: string;
  /** Alias after `|`; null when the target itself was the label. */
  alias: string | null;
}

/** Broken links that show the same label, even when they misspell the target. */
export interface BrokenLinkGroup {
  label: string;
  targets: string[];
  notes: BrokenLinkEntry[];
}

/** `/api/links/broken`: the graph's unresolved targets, grouped for repair. */
export interface BrokenLinkReport {
  scannedAt: string;
  /** One per note × broken target. */
  total: number;
  groups: BrokenLinkGroup[];
}

export type LifeWeeklyArea =
  | "health"
  | "money"
  | "business"
  | "learning"
  | "focus"
  | "relationships"
  | "habits";

/** One `Daily/YYYY-MM-DD.md`, as read by `/api/life`. Missing fields are null. */
export interface LifeDaily {
  date: string;
  sleepHrs: number | null;
  energy: number | null;
  workout: boolean;
  deepWorkHrs: number | null;
  studyHrs: number | null;
  outreachSent: number | null;
  applicationsSent: number | null;
  revenueToday: number | null;
  spendToday: number | null;
  win: string | null;
}

export interface LifeMonthly {
  month: string;
  netWorth: number | null;
  creditScore: number | null;
  creditUtilization: number | null;
  savingsRate: number | null;
}

export interface LifeWeekly {
  week: string;
  ratings: Partial<Record<LifeWeeklyArea, number>>;
}

export interface LifeData {
  vaultPath: string | null;
  scannedAt: string;
  /** True when all three sources are empty; the client swaps in demo data. */
  demo: boolean;
  folders: { daily: boolean; monthly: boolean; weekly: boolean };
  daily: LifeDaily[];
  monthly: LifeMonthly[];
  weekly: LifeWeekly[];
  warnings: string[];
}

/** `/api/mode`: the machine-local working mode, resolved by the CLI's own rules. */
export interface WorkingMode {
  mode: "work" | "home";
  /** "explicit override", "schedule", or a stale-override note. */
  source: string;
  stale: boolean;
  since: string | null;
  until: string | null;
  note: string | null;
  schedule: {
    mode: "work" | "home";
    timeZone: string;
    /** ISO weekdays, 0 = Sunday. */
    days: number[];
    start: string;
    end: string;
  };
  checkedAt: string;
}

/** One dependency row in `/api/deps`, as the CI drift check classifies it. */
export interface DepsPackage {
  name: string;
  current: string | null;
  wanted: string | null;
  latest: string | null;
  dependent: string | null;
}

/** `/api/deps`: how far the lockfile is behind its own declared ranges. */
export interface DependencyHealth {
  ok: boolean;
  checkedAt: string;
  /** In-range drift: lockfile entries behind a range `package.json` allows. */
  behind: number;
  /** Newer versions outside the declared ranges; informational only. */
  newer: number;
  stale: DepsPackage[];
  majors: DepsPackage[];
  error: string | null;
  cached: boolean;
}

export interface Stats {
  vaultPath: string;
  totalNotes: number;
  totalWords: number;
  totalBytes: number;
  largestNote: { title: string; path: string; bytes: number } | null;
  withCaptured: number;
  byArea: Record<string, number>;
  byOrigin: Record<string, number>;
  series: SeriesPoint[];
  captures30d: number;
  lastCapture: { title: string; captured: string; capturedZone: string | null } | null;
  /** Stable signature of the scan, so a poll can tell whether anything changed. */
  fingerprint: string;
  scannedAt: string;
}
