/**
 * The keyboard command palette's catalogue and matching rules, kept out of the
 * component so the ranking can be tested without a browser. Everything here is
 * pure: the palette fetches note hits itself, but which row a query puts first,
 * and what ↑/↓ does at the ends of the list, is decided here.
 */

/** One row the palette can run: a dashboard command or a note to open. */
export interface PaletteEntry {
  /** Unique in the list. Commands use their id, notes their vault path. */
  id: string;
  /** What the row says first: a command name or a note title. */
  label: string;
  /** One quiet line under the label. */
  detail: string;
  group: "Commands" | "Notes";
  /** Words that should find the row without being painted (`theme`, `refresh`). */
  keywords?: string;
}

/** The command ids the app's runner switches on. */
export const PALETTE_COMMANDS = [
  "rescan",
  "settings",
  "graph",
  "random",
  "today",
  "review",
  "compose",
  "trash",
  "core",
  "life",
  "lock",
] as const;

export type PaletteCommandId = (typeof PALETTE_COMMANDS)[number];

/** What the catalogue needs to know to offer the right commands. */
export interface PaletteState {
  /** Writes are on, so `New note` is available. */
  writable: boolean;
  /** The graph has answered, so the full-screen map can open. */
  graphReady: boolean;
  /** A token install holds a session, so it can be dropped. */
  lockable: boolean;
  /** `/api/actions` today row; null until the catalogue answers. */
  today: { count: number } | null;
  /** `/api/actions` review row; null until the catalogue answers. */
  review: { count: number } | null;
}

/**
 * The commands, in the order an empty palette lists them. Actions that cannot
 * run are left out rather than shown dead: a missing graph is a second of
 * waiting, not a command the person needs to discover and then lose.
 */
export function paletteCommands(state: PaletteState): PaletteEntry[] {
  const commands: PaletteEntry[] = [
    {
      id: "rescan",
      label: "Rescan vault",
      detail: "Read the folder from disk now",
      group: "Commands",
      keywords: "refresh reload scan vault",
    },
    {
      id: "today",
      label: "Today's captures",
      detail: state.today ? `${state.today.count} captured today` : "Open today's captures",
      group: "Commands",
      keywords: "captures daily notes",
    },
    {
      id: "review",
      label: "Review queue",
      detail: state.review ? `${state.review.count} due · oldest first` : "Open the review queue",
      group: "Commands",
      keywords: "next_review due overdue",
    },
    {
      id: "random",
      label: "Open a random note",
      detail: "Let the vault choose",
      group: "Commands",
      keywords: "shuffle surprise",
    },
  ];

  if (state.graphReady) {
    commands.push({
      id: "graph",
      label: "Open full graph",
      detail: "Every note and link as a map",
      group: "Commands",
      keywords: "map links fullscreen",
    });
  }

  if (state.writable) {
    commands.push(
      {
        id: "compose",
        label: "New note",
        detail: "Write a markdown note into the vault",
        group: "Commands",
        keywords: "create write composer",
      },
      {
        id: "trash",
        label: "Open trash",
        detail: "Restore a deleted note",
        group: "Commands",
        keywords: "recover deleted restore undo",
      },
    );
  }

  commands.push(
    {
      id: "settings",
      label: "Open settings",
      detail: "Accent, clock, motion, refresh",
      group: "Commands",
      keywords: "theme clock zone motion refresh preferences",
    },
    {
      id: "core",
      label: "Go to Core",
      detail: "Vault statistics and recall",
      group: "Commands",
      keywords: "vault dashboard home",
    },
    {
      id: "life",
      label: "Go to Life",
      detail: "Seven areas, streaks and ratings",
      group: "Commands",
      keywords: "areas streaks review",
    },
  );

  // Last, and only where a token installs a session: locking is not something
  // to land on by pressing Enter at the top of an empty palette.
  if (state.lockable) {
    commands.push({
      id: "lock",
      label: "Lock dashboard",
      detail: "Drop this browser's session",
      group: "Commands",
      keywords: "sign out signout log out logout session token",
    });
  }

  return commands;
}

/** Lowercase, trimmed, single-spaced: both sides of every comparison. */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * How well `haystack` answers `needle`, or null when it does not. A label that
 * starts with the query beats one that contains it, which beats a scattered
 * subsequence — the usual order, and enough for a list this short.
 */
function scoreField(haystack: string, needle: string, fuzzy = true): number | null {
  if (!needle) return 0;
  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 90 - Math.min(haystack.length - needle.length, 20) * 0.1;
  const word = haystack.indexOf(` ${needle}`);
  if (word !== -1) return 80 - Math.min(word, 20) * 0.1;
  const at = haystack.indexOf(needle);
  if (at !== -1) return 60 - Math.min(at, 20) * 0.1;
  if (!fuzzy) return null;

  // Every character in order, skipping what it has to. A short query would
  // otherwise match almost anything; the gap penalty keeps "zzz" out of it.
  let cursor = 0;
  let gaps = 0;
  let last = -1;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return null;
    if (last !== -1) gaps += found - last - 1;
    last = found;
    cursor = found + 1;
  }
  return 40 - Math.min(gaps, 30) * 0.5;
}

/**
 * A row's best reason to appear. The label is what the row is; keywords are
 * aliases for it; the detail line is a hint and ranks lowest.
 */
export function entryScore(entry: PaletteEntry, query: string): number | null {
  const needle = normalise(query);
  if (!needle) return 0;

  // A scattered run is a real hit in a name or alias but only noise in the
  // hint line, so the detail needs the literal word.
  const scores = [
    scoreField(normalise(entry.label), needle),
    scoreField(normalise(entry.keywords ?? ""), needle),
    scoreField(normalise(entry.detail), needle, false),
  ];
  const label = scores[0];
  const keywords = scores[1];
  const detail = scores[2];
  const best = Math.max(
    label ?? Number.NEGATIVE_INFINITY,
    keywords === null ? Number.NEGATIVE_INFINITY : keywords * 0.8,
    detail === null ? Number.NEGATIVE_INFINITY : detail * 0.5,
  );
  return Number.isFinite(best) ? best : null;
}

/**
 * The rows a query should show, best first, capped at `limit`. With no query the
 * list keeps its catalogue order (an empty palette is a menu, not a ranking);
 * with one, a label match outranks a keyword match, and commands win ties
 * because acting is what the palette is for.
 */
export function rankPalette(
  entries: readonly PaletteEntry[],
  query: string,
  limit = 9,
): PaletteEntry[] {
  const needle = normalise(query);
  if (!needle) return entries.slice(0, Math.max(limit, 0));

  return entries
    .map((entry) => ({ entry, score: entryScore(entry, needle) }))
    .filter((row): row is { entry: PaletteEntry; score: number } => row.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.entry.group !== b.entry.group) return a.entry.group === "Commands" ? -1 : 1;
      return a.entry.label.localeCompare(b.entry.label);
    })
    .slice(0, Math.max(limit, 0))
    .map((row) => row.entry);
}

/**
 * The rows the palette shows: commands first, then note hits from the same
 * query. An empty query is a menu, so every command the caption counts is
 * listed — the cap is for a search, where a long list would bury the best match.
 * A token install offers ten commands, one more than that cap, and the lock it
 * adds must not be the row the cap hides.
 */
export function paletteRows(
  commands: readonly PaletteEntry[],
  notes: readonly PaletteEntry[],
  query: string,
  commandLimit = 9,
  noteLimit = 6,
): PaletteEntry[] {
  const typed = query.trim().length > 0;
  return [
    ...rankPalette(commands, query, typed ? commandLimit : commands.length),
    ...rankPalette(notes, query, noteLimit),
  ];
}

/**
 * One step of ↑/↓ over a list that wraps. Zero rows stay at zero, so an empty
 * palette does not move a selection that is not there.
 */
export function stepIndex(active: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return ((active + delta) % count + count) % count;
}
