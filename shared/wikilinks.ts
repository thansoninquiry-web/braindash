/**
 * The one resolver for `[[wikilink]]` targets.
 *
 * Two surfaces need it: the server, where it decides graph edges and the
 * reader's links-out/backlinks, and the dashboard, where it renders inline
 * wikilinks and the daily-recall body. A link that draws an edge on the cloud has
 * to be the same link the renderer opens, so the rules live here once instead of
 * drifting in two copies.
 *
 * Keys are lowercased when the index is built; `resolveWikilink` is the only
 * place that trims and lowercases a target, so callers cannot half-normalise one.
 */

/** The shape the index needs; `NoteMeta` and the client's `NoteSummary` both fit. */
export interface WikilinkNote {
  /** Vault-relative path with POSIX separators, e.g. `notes/3-2-1 method.md`. */
  path: string;
  /** Display title, which a link may use verbatim. */
  title: string;
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Builds target → path. A note answers to its title, its path without `.md`, its
 * file name as written, and that file name with its separators normalised to
 * spaces or dashes — so `[[3-2-1 method]]`, `[[3-2-1-method]]` and
 * `[[notes/3-2-1 method]]` all reach the same note, whichever form the author
 * typed and whichever form the file name uses. The first note to claim a key
 * keeps it, which makes a duplicate title resolvable but deterministic.
 */
export function buildWikilinkIndex(notes: readonly WikilinkNote[]): Map<string, string> {
  const index = new Map<string, string>();
  const add = (key: string, notePath: string) => {
    const slug = normalise(key);
    if (slug && !index.has(slug)) index.set(slug, notePath);
  };

  for (const note of notes) {
    const file = note.path.replace(/\.md$/i, "");
    const base = file.split("/").pop() ?? file;
    add(note.title, note.path);
    add(file, note.path);
    add(base, note.path);
    // Dashes, underscores and spaces are interchangeable in a written target.
    const words = base.split(/[\s_-]+/).filter(Boolean);
    if (words.length > 1) {
      add(words.join(" "), note.path);
      add(words.join("-"), note.path);
    }
  }

  return index;
}

/** Resolves a `[[target]]` written any way a note is known; null when unknown. */
export function resolveWikilink(index: ReadonlyMap<string, string>, target: string): string | null {
  return index.get(normalise(target)) ?? null;
}

/** One `[[...]]` after parsing: its parts, before any resolution. */
export interface Wikilink {
  /** What to resolve: text before `#` and `|`, trimmed and unescaped. */
  target: string;
  /** `[[Target#Heading]]`'s heading; null when the link does not name one. */
  heading: string | null;
  /** Display text after `|`; null when absent or blank. */
  alias: string | null;
  /** What the renderer shows: the alias, else the target, else the heading. */
  label: string;
}

/**
 * Regex source for one token, shared with the renderer so both surfaces accept
 * exactly the same spelling. A backslash escapes the next character, which is
 * how a literal `]`, `#` or `|` survives inside a target; an escaped opening
 * (`\[[not a link]]`) is filtered by `isEscaped` rather than by this pattern.
 * A link never spans a line, because the renderer scans one paragraph line at a
 * time and the two surfaces must not disagree about a token split across lines.
 */
export const WIKILINK_TOKEN_SOURCE = String.raw`\[\[(?:\\.|[^\\\]\r\n])+\]\]`;

/** Odd number of backslashes immediately before `index` means it is escaped. */
function isEscaped(text: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

/** Splits on the first unescaped `separator`; keeps the rest intact. */
function splitOn(value: string, separator: string): [string, string | null] {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === separator) return [value.slice(0, index), value.slice(index + 1)];
  }
  return [value, null];
}

/** Drops the backslash from `\|`, `\#`, `\[`, `\]` and `\\`. */
function unescape(value: string): string {
  return value.replace(/\\([\\[\]|#])/g, "$1");
}

/**
 * Parses the inside of a `[[...]]`: target, heading and alias, with escaped
 * separators left as literal characters. Null when there is nothing to show.
 * `[[#Heading]]` keeps its heading but has no target, so it is text rather than
 * an edge; the renderer shows its heading and the server does not link it.
 */
export function parseWikilink(inner: string): Wikilink | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const [head, aliasPart] = splitOn(trimmed, "|");
  const [targetPart, headingPart] = splitOn(head, "#");
  const target = unescape(targetPart).trim();
  const heading = headingPart === null ? null : unescape(headingPart).trim() || null;
  const alias = aliasPart === null ? null : unescape(aliasPart).trim() || null;
  const label = alias ?? (target || heading);
  if (!label) return null;
  return { target, heading, alias, label };
}

/** Every link in a block of prose, in order, including repeats. */
export function findWikilinks(text: string): Wikilink[] {
  if (!text) return [];
  const links: Wikilink[] = [];
  const pattern = new RegExp(WIKILINK_TOKEN_SOURCE, "g");
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || isEscaped(text, match.index)) continue;
    const parsed = parseWikilink(match[0].slice(2, -2));
    if (parsed) links.push(parsed);
  }
  return links;
}

/** Unique resolvable targets in a note, in first-written order. */
export function wikilinkTargets(text: string): string[] {
  const targets = new Set<string>();
  for (const link of findWikilinks(text)) if (link.target) targets.add(link.target);
  return [...targets];
}
