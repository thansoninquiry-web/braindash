import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildWikilinkIndex,
  findWikilinks,
  resolveWikilink,
  type Wikilink,
} from "../../shared/wikilinks.js";

export type Area = "career" | "life" | "ideas";
export type Origin = "me" | "ai";

export interface NoteMeta {
  /** Vault-relative path, POSIX separators, e.g. "notes/3-2-1-method.md". */
  path: string;
  title: string;
  captured: string | null;
  /** IANA zone recorded by the note, used as the origin of `captured` when timed. */
  capturedZone: string | null;
  /**
   * `next_review: YYYY-MM-DD` from frontmatter, validated as a real date. Null
   * when the note has none (or wrote something that is not a date), so the
   * review queue only ever lists a date it can compare.
   */
  nextReview: string | null;
  origin: Origin | null;
  area: Area | null;
  words: number;
  /** Size of the file on disk in bytes, as read during the scan. */
  bytes: number;
  /** Most frequent meaningful tokens, for index scanning. Never content-bearing. */
  keywords: string[];
  /** Normalised frontmatter tags plus inline `#tags`, lowercased and deduped. */
  tags: string[];
  /**
   * `[[wikilink]]`s parsed by the shared scanner — target, heading and alias —
   * so the graph and the reader split a link the same way.
   */
  links: Wikilink[];
  /** Raw frontmatter block, so search can match it verbatim. Internal only. */
  frontmatter: string;
}

/** A single note plus its raw markdown, as returned by `/api/notes/:path`. */
export interface NoteDetail extends NoteMeta {
  markdown: string;
  size: number;
  modifiedAt: string;
}

/** Path rejection that carries the HTTP status the route should answer with. */
export class NotePathError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "NotePathError";
    this.code = code;
    this.status = status;
  }
}

/** An entry the walk saw but did not follow, and why. */
export interface SkippedEntry {
  /** Vault-relative POSIX path of the entry itself. */
  path: string;
  /**
   * Only symlinks today. Hidden entries and `SKIP_DIRS` are policy, deliberately
   * outside the index rather than surprises, so they are not reported here.
   */
  reason: "symlink";
}

/** A `.md` file the walk listed whose read failed. */
export interface UnreadableEntry {
  /** Vault-relative POSIX path of the note. */
  path: string;
  /**
   * The node error code (`EACCES`, `ENOENT`, `EISDIR`, …), or `UNKNOWN` when the
   * failure carried none. The client maps these to plain language, so the code
   * stays stable for clients that want to distinguish a vanished file from a
   * permission problem.
   */
  code: string;
}

/** The `code` on a filesystem error, or `UNKNOWN` for anything else. */
function readErrorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && code ? code : "UNKNOWN";
}

export interface VaultScan {
  vaultPath: string;
  scannedAt: string;
  notes: NoteMeta[];
  /**
   * Entries the scan did not follow, sorted by path. Symlinks are never followed
   * (the reader's containment check rejects them too), so a linked folder's notes
   * are absent from `notes`; this list explains the absence instead of leaving it
   * looking like a bug.
   */
  skipped: SkippedEntry[];
  /**
   * Notes the walk listed but whose read failed, sorted by path. These are real
   * `.md` files that should be in the index and are not: a delete that raced the
   * read (ENOENT), a permissions problem (EACCES), a file replaced by a folder
   * (EISDIR), or an I/O error. The scan still succeeds so one locked file cannot
   * take the rest of the vault offline, but the absence is reported rather than
   * silently swallowed.
   */
  unreadable: UnreadableEntry[];
  /**
   * Raw markdown per path. Search, snippets and the graph read from this index
   * instead of re-reading the disk, so memory grows with the vault's size; a
   * personal vault of markdown notes is small enough for that to be free.
   */
  bodies: Map<string, string>;
}

const SKIP_DIRS = new Set([
  "_assets",
  "_muse",
  "braindash",
  ".obsidian",
  ".trash",
  ".git",
  "node_modules",
]);
const AREAS: Area[] = ["career", "life", "ideas"];

const STOPWORDS = new Set([
  "about", "after", "again", "against", "almost", "along", "also", "although", "among", "another",
  "because", "been", "before", "being", "below", "between", "both", "cannot", "could", "does",
  "doing", "done", "down", "during", "each", "either", "else", "even", "ever", "every", "from",
  "further", "have", "having", "here", "hers", "herself", "himself", "http", "https",
  "into", "itself", "just", "like", "made", "make", "many", "might", "more", "most", "much",
  "must", "myself", "need", "never", "only", "other", "others", "ought", "over", "same", "should",
  "some", "still", "such", "than", "that", "their", "theirs", "them", "themselves", "then", "there",
  "these", "they", "this", "those", "through", "thus", "under", "until", "very", "were", "what",
  "when", "where", "which", "while", "with", "within", "without", "would", "your", "yours", "yourself",
]);

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Normalises a tag: no `#`, no quotes, lowercase, safe characters only. */
function cleanTag(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface Frontmatter {
  fields: Record<string, string>;
  tags: string[];
  block: string;
}

/**
 * Reads the leading `---` block. Handles scalars, `tags: [a, b]` flow lists and
 * `tags:` followed by `  - item` block lists; anything unparseable is skipped
 * rather than thrown, so a malformed note still indexes.
 */
export function parseFrontmatter(raw: string): Frontmatter {
  if (!raw.startsWith("---")) return { fields: {}, tags: [], block: "" };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fields: {}, tags: [], block: "" };
  const block = raw.slice(3, end).trim();
  const fields: Record<string, string> = {};
  const tags: string[] = [];
  let listKey: string | null = null;

  for (const line of block.split(/\r?\n/)) {
    const item = /^\s+-\s*(.+)$/.exec(line);
    if (item?.[1] !== undefined) {
      if (listKey === "tags") {
        const tag = cleanTag(item[1]);
        if (tag) tags.push(tag);
      }
      continue;
    }

    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match?.[1]) {
      listKey = null;
      continue;
    }
    const key = match[1].toLowerCase();
    const value = (match[2] ?? "").trim();
    listKey = value === "" ? key : null;

    if (key === "tags") {
      const inline = value.replace(/^\[|\]$/g, "");
      for (const part of inline.split(",")) {
        const tag = cleanTag(part);
        if (tag) tags.push(tag);
      }
      continue;
    }
    fields[key] = value.replace(/^["']|["']$/g, "");
  }

  return { fields, tags: [...new Set(tags)], block };
}

/** Strips frontmatter and code so links and tags are read from prose only. */
function bodyOnly(raw: string): string {
  return raw
    .replace(/^---[\s\S]*?\n---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    // Inline code is rendered as code, not scanned for links, so the server
    // must not turn a documented `[[example]]` into an edge either.
    .replace(/`[^`]*`/g, " ");
}

/** Inline `#tag` tokens, excluding headings and markdown anchors. */
function extractInlineTags(raw: string): string[] {
  const tags: string[] = [];
  for (const line of bodyOnly(raw).split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) continue;
    for (const match of line.matchAll(/(?:^|\s)#([A-Za-z][\w/-]{1,})/g)) {
      const tag = cleanTag(match[1] ?? "");
      if (tag) tags.push(tag);
    }
  }
  return [...new Set(tags)];
}

/**
 * `[[Target]]`, `[[Target|alias]]` and `[[Target#heading]]` all resolve through
 * the shared parser, so the scan keeps the same parts the reader renders.
 * One entry per target: two spellings of the same note are one edge, and the
 * first spelling keeps the label the note actually wrote.
 */
function extractLinks(raw: string): Wikilink[] {
  const links: Wikilink[] = [];
  const seen = new Set<string>();
  for (const link of findWikilinks(bodyOnly(raw))) {
    if (!link.target || seen.has(link.target)) continue;
    seen.add(link.target);
    links.push(link);
  }
  return links;
}

function firstHeading(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function titleFromFilename(file: string): string {
  return file
    .replace(/\.md$/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}[_T ]?\d*[-_]?/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function asArea(value: string | undefined): Area | null {
  return value && (AREAS as string[]).includes(value) ? (value as Area) : null;
}

function asOrigin(value: string | undefined): Origin | null {
  return value === "me" || value === "ai" ? value : null;
}

/**
 * The zone a note says it was captured in (`captured_zone: America/Tokyo`).
 * A hand-written or outdated zone is treated as absent, so the timestamp still
 * falls back to the recording machine's zone instead of disappearing.
 */
function asCapturedZone(fields: Record<string, string>): string | null {
  const value = fields.captured_zone;
  return value ? resolveTimeZone(value) : null;
}

/**
 * The day a spaced-repetition queue should surface this note again. A trailing
 * time (`2026-10-24 09:00`) is accepted and dropped, because the queue works in
 * whole days; anything else is treated as absent rather than guessed at, so a
 * typo cannot put a note in the queue on an arbitrary date.
 */
function asReviewDate(fields: Record<string, string>): string | null {
  const raw = fields.next_review?.trim();
  if (!raw) return null;
  return resolveRecallDate(raw) ?? resolveRecallDate(raw.slice(0, 10));
}

/** Strips frontmatter and fenced code so metadata never leaks into keywords. */
function proseOnly(raw: string): string {
  return raw
    .replace(/^---[\s\S]*?\n---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
}

/** Top tokens by frequency; deterministic so the index is stable between scans. */
export function extractKeywords(raw: string, limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const token of proseOnly(raw).toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
    const word = token.replace(/^[-']+|[-']+$/g, "");
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

async function walk(
  dir: string,
  root: string,
  out: string[],
  skipped: SkippedEntry[],
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    // A symlink is reported, not followed — even one whose target is inside the
    // vault. Following it would index the same note twice under two paths, and
    // checking containment per link would put a realpath round-trip in the walk.
    if (entry.isSymbolicLink()) {
      skipped.push({ path: toPosix(path.relative(root, full)), reason: "symlink" });
    } else if (entry.isDirectory()) {
      await walk(full, root, out, skipped);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(toPosix(path.relative(root, full)));
    }
  }
}

/** Reads every markdown note under `vaultPath`. Never writes. */
export async function scanVault(vaultPath: string): Promise<VaultScan> {
  const root = path.resolve(vaultPath);
  const relPaths: string[] = [];
  const skipped: SkippedEntry[] = [];
  await walk(root, root, relPaths, skipped);

  const notes: NoteMeta[] = [];
  const unreadable: UnreadableEntry[] = [];
  const bodies = new Map<string, string>();
  for (const rel of relPaths) {
    let raw: string;
    let bytes: number;
    try {
      // One read gives both the text and its exact on-disk size.
      const file = await fs.readFile(path.join(root, rel));
      raw = file.toString("utf8");
      bytes = file.byteLength;
    } catch (error) {
      // A file that disappears mid-scan must not fail the whole vault, but it
      // must not vanish from the report either: it was in the walk, so the
      // index would otherwise be quietly short one note.
      unreadable.push({ path: rel, code: readErrorCode(error) });
      continue;
    }
    const fm = parseFrontmatter(raw);
    const title = fm.fields.title || firstHeading(raw) || titleFromFilename(path.basename(rel));
    const tags = [...new Set([...fm.tags, ...extractInlineTags(raw)])];
    notes.push({
      path: rel,
      title,
      // Some notes record `created:` rather than `captured:`.
      captured: fm.fields.captured || fm.fields.created || null,
      capturedZone: asCapturedZone(fm.fields),
      nextReview: asReviewDate(fm.fields),
      origin: asOrigin(fm.fields.origin),
      area: asArea(fm.fields.area),
      words: raw.split(/\s+/).filter(Boolean).length,
      bytes,
      keywords: extractKeywords(raw),
      tags,
      links: extractLinks(raw),
      frontmatter: fm.block,
    });
    bodies.set(rel, raw);
  }

  notes.sort((a, b) => a.path.localeCompare(b.path));
  // readdir order is platform-dependent; sorting keeps the API response
  // identical between scans of the same tree.
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  unreadable.sort((a, b) => a.path.localeCompare(b.path));
  return {
    vaultPath: root,
    scannedAt: new Date().toISOString(),
    notes,
    skipped,
    unreadable,
    bodies,
  };
}

/**
 * Turns a request path into an absolute file path that is provably inside the
 * vault. Rejects traversal, absolute paths, and non-markdown files before any
 * filesystem read happens; symlink escapes are caught by `readNote`.
 */
export function resolveNotePath(root: string, requested: string): string {
  const raw = requested.trim();
  if (!raw) throw new NotePathError("invalid_path", "A note path is required");
  if (raw.includes("\0")) throw new NotePathError("invalid_path", "Path contains a null byte");

  const posix = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(posix) || posix.startsWith("/") || posix.startsWith("~")) {
    throw new NotePathError("invalid_path", "Use a vault-relative path, not an absolute one");
  }

  const segments = posix.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    throw new NotePathError("invalid_path", "Path escapes the vault");
  }
  if (segments.some((segment) => segment.startsWith("."))) {
    throw new NotePathError("invalid_path", "Hidden files are outside the index");
  }
  if (segments.some((segment) => SKIP_DIRS.has(segment))) {
    throw new NotePathError("invalid_path", "That directory is outside the index");
  }

  const last = segments[segments.length - 1] ?? "";
  if (!last.toLowerCase().endsWith(".md")) {
    throw new NotePathError("not_markdown", "Only .md notes can be opened");
  }

  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, segments.join(path.sep));
  const inside = path.relative(resolvedRoot, full);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new NotePathError("invalid_path", "Path escapes the vault");
  }
  return full;
}

/** Reads one note by vault-relative path. Throws `NotePathError` for 400/404. */
export async function readNote(vaultPath: string, requested: string): Promise<NoteDetail> {
  const full = resolveNotePath(vaultPath, requested);

  let realRoot: string;
  let realFull: string;
  try {
    realRoot = await fs.realpath(path.resolve(vaultPath));
    realFull = await fs.realpath(full);
  } catch {
    throw new NotePathError("not_found", "No note at that path", 404);
  }

  // A symlink inside the vault must not become a way out of it.
  const inside = path.relative(realRoot, realFull);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new NotePathError("invalid_path", "Path escapes the vault");
  }

  let markdown: string;
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    [markdown, stat] = await Promise.all([fs.readFile(realFull, "utf8"), fs.stat(realFull)]);
  } catch {
    throw new NotePathError("not_found", "No note at that path", 404);
  }
  if (!stat.isFile()) {
    throw new NotePathError("not_found", "No note at that path", 404);
  }

  const fm = parseFrontmatter(markdown);
  const relPath = toPosix(inside);
  return {
    path: relPath,
    title: fm.fields.title || firstHeading(markdown) || titleFromFilename(path.basename(relPath)),
    captured: fm.fields.captured || fm.fields.created || null,
    capturedZone: asCapturedZone(fm.fields),
    nextReview: asReviewDate(fm.fields),
    origin: asOrigin(fm.fields.origin),
    area: asArea(fm.fields.area),
    words: markdown.split(/\s+/).filter(Boolean).length,
    // Same number as `size` below; kept on the shared NoteMeta shape.
    bytes: stat.size,
    keywords: extractKeywords(markdown),
    tags: [...new Set([...fm.tags, ...extractInlineTags(markdown)])],
    links: extractLinks(markdown),
    frontmatter: fm.block,
    markdown,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

/**
 * Writes into the vault, which is normally read-only. The API only calls these
 * when `BRAINDASH_WRITE=1` and the request arrived on loopback, so every guard
 * here is about the file itself: the path resolves inside the vault (symlinks
 * included), the note's own folder is real, and nothing is ever left half
 * written.
 */
export const MAX_NOTE_BYTES = 1_000_000;

/** Folder for overwritten and deleted notes. Already outside the scan. */
const TRASH_DIR = ".trash";

/** One write, enough for the client to refresh without re-reading the note. */
export interface NoteWriteResult {
  /** Vault-relative POSIX path actually written. */
  path: string;
  size: number;
  modifiedAt: string;
  /** Vault-relative copy kept in `.trash`, or null when nothing was replaced. */
  backup: string | null;
  /** Where a deleted note went; null for a write or create. */
  trashedTo: string | null;
}

function relativeToVault(realRoot: string, target: string): string {
  const inside = path.relative(realRoot, target);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new NotePathError("invalid_path", "Path escapes the vault");
  }
  return toPosix(inside);
}

/** A folder may be the vault root itself, unlike a note. */
function folderInsideVault(realRoot: string, target: string): void {
  const inside = path.relative(realRoot, target);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new NotePathError("invalid_path", "Path escapes the vault");
  }
}

function cleanMarkdown(markdown: unknown): string {
  if (typeof markdown !== "string") {
    throw new NotePathError("invalid_markdown", "Send the note body as a `markdown` string");
  }
  if (Buffer.byteLength(markdown, "utf8") > MAX_NOTE_BYTES) {
    throw new NotePathError(
      "note_too_large",
      `Notes are limited to ${MAX_NOTE_BYTES.toLocaleString("en-US")} bytes`,
      413,
    );
  }
  return markdown;
}

/** A sortable, collision-resistant folder name for one trash operation. */
function trashStamp(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A destination under the vault's own `.trash`. The folder is created and then
 * resolved, so a `.trash` symlinked outside the vault cannot turn a backup or a
 * delete into a write somewhere else.
 */
async function trashDestination(realRoot: string, relPath: string): Promise<string> {
  const base = path.join(realRoot, TRASH_DIR);
  await fs.mkdir(base, { recursive: true });
  const realBase = await fs.realpath(base);
  folderInsideVault(realRoot, realBase);
  return path.join(realBase, trashStamp(), ...relPath.split("/"));
}

/**
 * The nearest existing ancestor of a not-yet-created path has to be real and
 * inside the vault too: a symlinked parent must not become an escape hatch for
 * a new note. Checked before `mkdir`, so nothing is created outside first.
 */
async function existingDirInside(realRoot: string, dir: string): Promise<string> {
  let current = dir;
  for (;;) {
    try {
      const stat = await fs.stat(current);
      if (!stat.isDirectory()) {
        throw new NotePathError("invalid_path", "A parent of that path is not a directory");
      }
      folderInsideVault(realRoot, await fs.realpath(current));
      return current;
    } catch (error) {
      if (error instanceof NotePathError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) {
        throw new NotePathError("invalid_path", "Path escapes the vault");
      }
      current = parent;
    }
  }
}

/**
 * Writes next to the target and renames over it, so a failed save leaves the
 * previous note intact instead of a half-written file. The temp name starts
 * with a dot, which also keeps a crash's leftovers out of the index.
 */
async function writeAtomically(full: string, markdown: string): Promise<void> {
  const temp = path.join(
    path.dirname(full),
    `.${path.basename(full)}.braindash-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    await fs.writeFile(temp, markdown, "utf8");
    await fs.rename(temp, full);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Replaces one note's markdown. `baseModifiedAt` is the mtime the client read;
 * when the file has moved on since, the write is refused rather than silently
 * overwriting someone else's save. The previous body is copied to `.trash`
 * first, so even an accepted overwrite is recoverable.
 */
export async function writeNote(
  vaultPath: string,
  requested: string,
  markdown: string,
  baseModifiedAt: string | null = null,
): Promise<NoteWriteResult> {
  const body = cleanMarkdown(markdown);
  const full = resolveNotePath(vaultPath, requested);

  let realRoot: string;
  let realFull: string;
  try {
    realRoot = await fs.realpath(path.resolve(vaultPath));
    realFull = await fs.realpath(full);
  } catch {
    throw new NotePathError("not_found", "No note at that path", 404);
  }
  const relPath = relativeToVault(realRoot, realFull);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(realFull);
  } catch {
    throw new NotePathError("not_found", "No note at that path", 404);
  }
  if (!stat.isFile()) throw new NotePathError("not_found", "No note at that path", 404);
  if (baseModifiedAt && stat.mtime.toISOString() !== baseModifiedAt) {
    throw new NotePathError(
      "note_conflict",
      "The note changed on disk since it was opened; reload it before saving",
      409,
    );
  }

  const backup = await trashDestination(realRoot, relPath);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.copyFile(realFull, backup);
  await writeAtomically(realFull, body);

  const after = await fs.stat(realFull);
  return {
    path: relPath,
    size: after.size,
    modifiedAt: after.mtime.toISOString(),
    backup: toPosix(path.relative(realRoot, backup)),
    trashedTo: null,
  };
}

/** Creates a new markdown note, refusing to replace an existing one. */
export async function createNote(
  vaultPath: string,
  requested: string,
  markdown = "",
): Promise<NoteWriteResult> {
  const body = cleanMarkdown(markdown);
  const full = resolveNotePath(vaultPath, requested);

  let realRoot: string;
  try {
    realRoot = await fs.realpath(path.resolve(vaultPath));
  } catch {
    throw new NotePathError("not_found", "The vault folder is not readable", 404);
  }

  try {
    await fs.stat(full);
    throw new NotePathError("note_exists", "A note already exists at that path", 409);
  } catch (error) {
    if (error instanceof NotePathError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await existingDirInside(realRoot, path.dirname(full));
  await fs.mkdir(path.dirname(full), { recursive: true });
  const realDir = await fs.realpath(path.dirname(full));
  folderInsideVault(realRoot, realDir);

  const target = path.join(realDir, path.basename(full));
  try {
    // `wx` is the last line of defence against a note that appeared between the
    // stat above and this write.
    await fs.writeFile(target, body, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new NotePathError("note_exists", "A note already exists at that path", 409);
    }
    throw error;
  }

  const stat = await fs.stat(target);
  return {
    path: relativeToVault(realRoot, target),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    backup: null,
    trashedTo: null,
  };
}

/**
 * Moves one note into the vault's `.trash` folder, preserving its relative path
 * under a timestamped folder. `.trash` is already skipped by the scan, so the
 * note disappears from the dashboard but is never erased.
 */
export async function deleteNote(
  vaultPath: string,
  requested: string,
): Promise<NoteWriteResult> {
  const full = resolveNotePath(vaultPath, requested);

  let realRoot: string;
  let realFull: string;
  try {
    realRoot = await fs.realpath(path.resolve(vaultPath));
    realFull = await fs.realpath(full);
  } catch {
    throw new NotePathError("not_found", "No note at that path", 404);
  }
  const relPath = relativeToVault(realRoot, realFull);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(realFull);
  } catch {
    throw new NotePathError("not_found", "No note at that path", 404);
  }
  if (!stat.isFile()) throw new NotePathError("not_found", "No note at that path", 404);

  const trashed = await trashDestination(realRoot, relPath);
  await fs.mkdir(path.dirname(trashed), { recursive: true });
  await fs.rename(realFull, trashed);

  return {
    path: relPath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    backup: null,
    trashedTo: toPosix(path.relative(realRoot, trashed)),
  };
}

/**
 * One note in the vault's `.trash`, as the dashboard lists it.
 *
 * Deletion has always been a move into `.trash/<stamp>/<original path>` rather
 * than an unlink, so the vault already held a recovery copy; nothing could read
 * it back. This is that view: enough to say what was deleted, when, and where it
 * would return to.
 */
export interface TrashEntry {
  /** Trash-relative POSIX id: `<stamp>/<original path>`. */
  id: string;
  /** Vault-relative path a restore would write to. */
  path: string;
  /** The note's own heading, or its filename when it has none. */
  title: string;
  /** When the note moved into the trash (the file's mtime). */
  trashedAt: string;
  size: number;
}

export interface TrashListing {
  /** Absolute path of the vault's `.trash`; null when nothing was ever deleted. */
  trashPath: string | null;
  total: number;
  /** Newest first; ties by id so the order is stable across scans. */
  entries: TrashEntry[];
}

/**
 * The title a trashed note still carries. Only the head of the file is read — a
 * heading is near the top — so listing a large trash does not read every note in
 * full just to label it.
 */
async function trashedTitle(file: string, relPath: string): Promise<string> {
  try {
    const head = (await fs.readFile(file, "utf8")).slice(0, 4096);
    return firstHeading(head) ?? titleFromFilename(path.basename(relPath));
  } catch {
    return path.basename(relPath).replace(/\.md$/i, "");
  }
}

/** Collects the `.md` files under one stamp folder, honouring the scan's policy. */
async function collectTrashed(
  dir: string,
  stamp: string,
  prefix: string,
  out: TrashEntry[],
): Promise<void> {
  // A stamp folder removed between the listing and this read is simply gone.
  const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!items) return;
  for (const item of items) {
    // Same rule as the vault walk: hidden entries and symlinks are not followed,
    // so a link planted in the trash cannot make the list point elsewhere.
    if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      await collectTrashed(full, stamp, `${prefix}${item.name}/`, out);
      continue;
    }
    if (!item.isFile() || !item.name.toLowerCase().endsWith(".md")) continue;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    const rel = `${prefix}${item.name}`;
    out.push({
      id: `${stamp}/${rel}`,
      path: rel,
      title: await trashedTitle(full, rel),
      trashedAt: stat.mtime.toISOString(),
      size: stat.size,
    });
  }
}

/**
 * Everything recoverable right now. An install that never deleted a note has no
 * `.trash` at all, which is an empty list rather than an error.
 */
export async function listTrash(vaultPath: string): Promise<TrashListing> {
  const realRoot = await fs.realpath(path.resolve(vaultPath));
  const base = path.join(realRoot, TRASH_DIR);

  let stamps: string[];
  try {
    stamps = (await fs.readdir(base, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { trashPath: null, total: 0, entries: [] };
    }
    throw error;
  }

  const entries: TrashEntry[] = [];
  for (const stamp of stamps) await collectTrashed(path.join(base, stamp), stamp, "", entries);
  entries.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt) || a.id.localeCompare(b.id));
  return { trashPath: base, total: entries.length, entries };
}

/**
 * Splits a trash id into the stamp folder and the note path underneath it. The
 * rules mirror `resolveNotePath`: relative, POSIX, `.md`, no `..`, no hidden or
 * skipped folder. The filesystem checks that follow repeat the containment test
 * on real paths, so a symlink inside the trash cannot redirect a restore.
 */
export function parseTrashId(requested: string): { stamp: string; segments: string[] } {
  const raw = requested.trim();
  if (!raw) throw new NotePathError("invalid_path", "A trash id is required");
  if (raw.includes("\0")) throw new NotePathError("invalid_path", "Path contains a null byte");

  const posix = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(posix) || posix.startsWith("/") || posix.startsWith("~")) {
    throw new NotePathError("invalid_path", "Use a trash-relative id, not an absolute one");
  }
  const segments = posix.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length < 2 || segments.some((segment) => segment === "..")) {
    throw new NotePathError("invalid_path", "Path escapes the trash");
  }
  if (segments.some((segment) => segment.startsWith("."))) {
    throw new NotePathError("invalid_path", "Hidden paths are outside the trash");
  }
  if (segments.some((segment) => SKIP_DIRS.has(segment))) {
    throw new NotePathError("invalid_path", "That directory is outside the trash");
  }
  if (!(segments[segments.length - 1] ?? "").toLowerCase().endsWith(".md")) {
    throw new NotePathError("not_markdown", "Only .md notes can be restored");
  }
  return { stamp: segments[0] as string, segments: segments.slice(1) };
}

/** Removes emptied folders from the bottom up, stopping at the trash root. */
async function pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
  let current = dir;
  while (current !== stopAt && current.startsWith(`${stopAt}${path.sep}`)) {
    try {
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/**
 * Puts a trashed note back where it came from. The copy is written with `wx` so
 * an existing note at that path is never replaced — a re-used filename answers
 * `409 note_exists` and the trashed copy stays put. The note keeps its mtime, so
 * the reader's conflict check still compares like with like, and an emptied
 * stamp folder is pruned so the trash does not fill with shells.
 */
export async function restoreTrashNote(
  vaultPath: string,
  requested: string,
): Promise<{ path: string; size: number; modifiedAt: string }> {
  const { stamp, segments } = parseTrashId(requested);
  const realRoot = await fs.realpath(path.resolve(vaultPath));

  let realBase: string;
  try {
    realBase = await fs.realpath(path.join(realRoot, TRASH_DIR));
  } catch {
    throw new NotePathError("not_found", "There is no trash to restore from", 404);
  }
  folderInsideVault(realRoot, realBase);

  const source = path.join(realBase, stamp, ...segments);
  const relToTrash = path.relative(realBase, source);
  if (relToTrash.startsWith("..") || path.isAbsolute(relToTrash)) {
    throw new NotePathError("invalid_path", "Path escapes the trash");
  }

  let realSource: string;
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    realSource = await fs.realpath(source);
    stat = await fs.stat(realSource);
  } catch {
    throw new NotePathError("not_found", "That note is not in the trash", 404);
  }
  if (!stat.isFile()) throw new NotePathError("not_found", "That note is not in the trash", 404);
  const insideTrash = path.relative(realBase, realSource);
  if (insideTrash.startsWith("..") || path.isAbsolute(insideTrash)) {
    throw new NotePathError("invalid_path", "Path escapes the trash");
  }

  const destination = path.resolve(realRoot, ...segments);
  folderInsideVault(realRoot, destination);
  const parent = path.dirname(destination);
  // Prove the nearest existing ancestor is real and inside the vault before
  // anything is created, then re-resolve the folder that now exists.
  await existingDirInside(realRoot, parent);
  await fs.mkdir(parent, { recursive: true });
  const realParent = await fs.realpath(parent);
  folderInsideVault(realRoot, realParent);
  const target = path.join(realParent, path.basename(destination));

  const body = await fs.readFile(realSource);
  try {
    await fs.writeFile(target, body, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new NotePathError("note_exists", "A note already exists at that path", 409);
    }
    throw error;
  }

  await fs.utimes(target, stat.atime, stat.mtime).catch(() => undefined);
  // The copy is the note now. A failed unlink would leave a duplicate in the
  // trash, which is the harmless direction to fail in.
  await fs.unlink(realSource).catch(() => undefined);
  await pruneEmptyDirs(path.dirname(realSource), realBase);

  const written = await fs.stat(target);
  return {
    path: relativeToVault(realRoot, target),
    size: written.size,
    modifiedAt: written.mtime.toISOString(),
  };
}

export interface SearchHit {
  path: string;
  title: string;
  captured: string | null;
  capturedZone: string | null;
  area: Area | null;
  origin: Origin | null;
  tags: string[];
  /** Which field matched first, best-ranked field wins. */
  match: "title" | "tag" | "frontmatter" | "body";
  /** Plain-text excerpt around the match, from the note body. */
  snippet: string;
}

/** Builds a one-line excerpt centred on the first match, if there is one. */
function makeSnippet(text: string, needle: string, radius = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const index = needle ? flat.toLowerCase().indexOf(needle) : -1;
  const start = index === -1 ? 0 : Math.max(0, index - radius);
  const end = index === -1 ? Math.min(flat.length, radius * 2) : Math.min(flat.length, index + needle.length + radius);
  const slice = flat.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${slice}${end < flat.length ? "…" : ""}`;
}

/**
 * Case-insensitive search across title, tags, raw frontmatter and body text.
 * Results are ranked by which field matched, then alphabetically, so the most
 * deliberate matches surface first.
 */
export function searchNotes(scan: VaultScan, query: string, limit = 30): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const rank: Record<SearchHit["match"], number> = { title: 0, tag: 1, frontmatter: 2, body: 3 };
  const hits: SearchHit[] = [];

  for (const note of scan.notes) {
    const body = stripFrontmatterForSearch(scan.bodies.get(note.path) ?? "");
    let match: SearchHit["match"] | null = null;
    if (note.title.toLowerCase().includes(needle)) match = "title";
    else if (note.tags.some((tag) => tag.includes(needle))) match = "tag";
    else if (note.frontmatter.toLowerCase().includes(needle)) match = "frontmatter";
    else if (body.toLowerCase().includes(needle)) match = "body";
    if (!match) continue;

    hits.push({
      path: note.path,
      title: note.title,
      captured: note.captured,
      capturedZone: note.capturedZone,
      area: note.area,
      origin: note.origin,
      tags: note.tags,
      match,
      snippet: makeSnippet(body, needle),
    });
  }

  hits.sort((a, b) => rank[a.match] - rank[b.match] || a.title.localeCompare(b.title));
  return hits.slice(0, Math.max(limit, 0));
}

/** Body text without the frontmatter block, used for snippets. */
function stripFrontmatterForSearch(raw: string): string {
  return raw.startsWith("---") ? raw.replace(/^---[\s\S]*?\n---/, "") : raw;
}

/** FNV-1a: small, stable and dependency-free, so a day's pick never drifts. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface RecallPick {
  path: string;
  title: string;
  tags: string[];
  captured: string | null;
  capturedZone: string | null;
  area: Area | null;
}

/**
 * One note for the given calendar day: seeded by the date so it is stable all
 * day, and shifted by `skip` (wrapping) so "Skip" can offer another note today.
 */
export function pickDaily(scan: VaultScan, dateKey: string, skip = 0): RecallPick | null {
  const ordered = [...scan.notes].sort((a, b) => a.path.localeCompare(b.path));
  const total = ordered.length;
  if (total === 0) return null;
  const offset = ((fnv1a(dateKey) % total) + Math.trunc(skip)) % total;
  const note = ordered[(offset + total) % total];
  if (!note) return null;
  return {
    path: note.path,
    title: note.title,
    tags: note.tags,
    captured: note.captured,
    capturedZone: note.capturedZone,
    area: note.area,
  };
}

export type GraphEdgeType = "wikilink" | "tag";

export interface GraphNode {
  id: string;
  title: string;
  tags: string[];
  /** Carried through so the cloud can keep colouring nodes by area. */
  area: Area | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: GraphEdgeType;
}

const MAX_TAG_EDGES = 600;

/**
 * The index is rebuilt per scan, not per request: the graph and every note open
 * reuse it. The resolver itself is `shared/wikilinks.ts`, so the dashboard's
 * inline links resolve exactly the way this graph draws them.
 */
const indexCache = new WeakMap<VaultScan, Map<string, string>>();

function indexFor(scan: VaultScan): Map<string, string> {
  const cached = indexCache.get(scan);
  if (cached) return cached;
  const index = buildWikilinkIndex(scan.notes);
  indexCache.set(scan, index);
  return index;
}

/** One `[[wikilink]]` from a note, resolved against the index when possible. */
export interface ResolvedLink extends Wikilink {
  /** Vault path when the target resolves to a note, otherwise null. */
  path: string | null;
  title: string | null;
}

/** Another note that points at this one, and how. */
export interface Backlink {
  path: string;
  title: string;
  /** An explicit `[[wikilink]]`, or a tag both notes carry. */
  via: GraphEdgeType;
  /** Shared tags for a tag backlink; empty for a wikilink one. */
  tags: string[];
}

export interface NoteConnections {
  outbound: ResolvedLink[];
  backlinks: Backlink[];
}

/**
 * Links out of one note and the notes that point back at it. Wikilinks come
 * first in both directions because someone wrote them deliberately; tag links
 * are the looser association the cloud also draws as dashed edges.
 */
export function noteConnections(scan: VaultScan, note: NoteMeta): NoteConnections {
  const index = indexFor(scan);
  const byPath = new Map(scan.notes.map((entry) => [entry.path, entry]));

  const outbound: ResolvedLink[] = note.links.map((link) => {
    const linked = resolveWikilink(index, link.target);
    return { ...link, path: linked, title: linked ? (byPath.get(linked)?.title ?? null) : null };
  });

  const backlinks: Backlink[] = [];
  const seen = new Set<string>([note.path]);
  for (const other of scan.notes) {
    if (seen.has(other.path)) continue;
    const linksHere = other.links.some((link) => resolveWikilink(index, link.target) === note.path);
    if (!linksHere) continue;
    seen.add(other.path);
    backlinks.push({ path: other.path, title: other.title, via: "wikilink", tags: [] });
  }

  const tags = new Set(note.tags);
  if (tags.size > 0) {
    for (const other of scan.notes) {
      if (seen.has(other.path)) continue;
      const shared = other.tags.filter((tag) => tags.has(tag));
      if (shared.length === 0) continue;
      seen.add(other.path);
      backlinks.push({ path: other.path, title: other.title, via: "tag", tags: shared });
    }
  }

  backlinks.sort((a, b) =>
    a.via === b.via ? a.title.localeCompare(b.title) : a.via === "wikilink" ? -1 : 1,
  );
  return { outbound, backlinks };
}

/**
 * Nodes plus edges: a `wikilink` edge where one note links to another, and a
 * `tag` edge between notes sharing a tag. A pair that is both is reported once
 * as a wikilink edge so the cloud never draws duplicate lines. Broken wikilinks
 * are collected separately instead of becoming dangling edges.
 */
export function buildGraph(scan: VaultScan): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  isolated: string[];
  unresolved: string[];
  truncated: boolean;
} {
  const nodes: GraphNode[] = scan.notes.map((note) => ({
    id: note.path,
    title: note.title,
    tags: note.tags,
    area: note.area,
  }));

  // Shared with the reader, so an edge on the cloud is an openable link.
  const byKey = indexFor(scan);

  const edges = new Map<string, GraphEdge>();
  const unresolved = new Set<string>();
  const addEdge = (source: string, target: string, type: GraphEdgeType) => {
    if (source === target) return;
    // Keyed on the unordered pair so a link and a shared tag never double up.
    const key = [source, target].sort().join("\u0000");
    const existing = edges.get(key);
    // One edge per pair; a real link outranks a shared tag.
    if (existing && !(existing.type === "tag" && type === "wikilink")) return;
    if (type === "wikilink") {
      // Keep the direction: source links to target.
      edges.set(key, { source, target, type });
      return;
    }
    const [first, second] = [source, target].sort();
    edges.set(key, { source: first ?? source, target: second ?? target, type });
  };

  for (const note of scan.notes) {
    for (const link of note.links) {
      const resolved = resolveWikilink(byKey, link.target);
      if (resolved) addEdge(note.path, resolved, "wikilink");
      else unresolved.add(link.target);
    }
  }

  const byTag = new Map<string, string[]>();
  for (const note of scan.notes) {
    for (const tag of note.tags) {
      const group = byTag.get(tag) ?? [];
      group.push(note.path);
      byTag.set(tag, group);
    }
  }

  let truncated = false;
  for (const group of byTag.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (edges.size >= MAX_TAG_EDGES) {
          truncated = true;
          break;
        }
        const from = group[i];
        const to = group[j];
        if (from && to) addEdge(from, to, "tag");
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  const connected = new Set<string>();
  for (const edge of edges.values()) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  return {
    nodes,
    edges: [...edges.values()],
    isolated: nodes.filter((node) => !connected.has(node.id)).map((node) => node.id),
    unresolved: [...unresolved].sort(),
    truncated,
  };
}

/** One broken `[[wikilink]]`, kept with the note that wrote it. */
export interface BrokenLinkEntry {
  /** Vault-relative path of the note containing the link. */
  path: string;
  title: string;
  /** Target as written; it also appears in the graph's `unresolved` list. */
  target: string;
  /** Alias written after `|`; null when the target itself was the label. */
  alias: string | null;
}

/**
 * Broken links that share the words the reader shows. A group is keyed by the
 * alias (or bare target) each note wrote, not by the target it intended: two
 * notes can misspell the same note differently (`[[Road Map|plan]]` and
 * `[[roadmap|plan]]`) and still ask for the same thing on screen, which is the
 * unit a person can actually repair.
 */
export interface BrokenLinkGroup {
  /** What the links display: the first spelling written for this label. */
  label: string;
  /** Distinct unresolved targets written under this label, sorted. */
  targets: string[];
  /** Notes carrying this label, sorted by title then path. */
  notes: BrokenLinkEntry[];
}

export interface BrokenLinkReport {
  /** One per note × broken target; a note repeating a target counts once. */
  total: number;
  /** Most-broken labels first, then alphabetical. */
  groups: BrokenLinkGroup[];
}

/**
 * Groups the graph's unresolved targets by the alias each note wrote. Uses the
 * same index and resolver as `buildGraph`, so every target here is in its
 * `unresolved` list and a link that resolves can never appear.
 */
export function buildBrokenLinkReport(scan: VaultScan): BrokenLinkReport {
  const byKey = indexFor(scan);
  const groups = new Map<
    string,
    { label: string; targets: Set<string>; notes: BrokenLinkEntry[] }
  >();
  // The real scanner keeps one entry per target per note; the report keeps the
  // same rule so a hand-built scan can never inflate a count.
  const seen = new Set<string>();

  for (const note of scan.notes) {
    for (const link of note.links) {
      if (!link.target || resolveWikilink(byKey, link.target)) continue;
      const written = `${note.path}\u0000${link.target}`;
      if (seen.has(written)) continue;
      seen.add(written);
      const label = link.label.trim();
      if (!label) continue;
      // Labels differing only by case are one heading in the report; the first
      // spelling the scan reaches names the group.
      const key = label.toLowerCase();
      const group = groups.get(key) ?? { label, targets: new Set<string>(), notes: [] };
      group.targets.add(link.target);
      group.notes.push({
        path: note.path,
        title: note.title,
        target: link.target,
        alias: link.alias,
      });
      groups.set(key, group);
    }
  }

  const ordered: BrokenLinkGroup[] = [...groups.values()].map((group) => ({
    label: group.label,
    targets: [...group.targets].sort((a, b) => a.localeCompare(b)),
    notes: group.notes.sort(
      (a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path),
    ),
  }));

  // A repair queue, not a dictionary: the label the most notes wrote comes first.
  ordered.sort((a, b) => b.notes.length - a.notes.length || a.label.localeCompare(b.label));

  return {
    total: ordered.reduce((sum, group) => sum + group.notes.length, 0),
    groups: ordered,
  };
}

interface CapturedParts {
  year: number;
  /** Zero-based, as `Date` expects. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** False for a bare `YYYY-MM-DD`, which is a calendar fact rather than an instant. */
  hasTime: boolean;
}

function parseCapturedParts(value: string | null): CapturedParts | null {
  if (!value) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, meridiem] = match;
  let hour = h ? Number(h) : 0;
  if (meridiem?.toUpperCase() === "PM" && hour < 12) hour += 12;
  if (meridiem?.toUpperCase() === "AM" && hour === 12) hour = 0;
  const parts: CapturedParts = {
    year: Number(y),
    month: Number(mo) - 1,
    day: Number(d),
    hour,
    minute: mi ? Number(mi) : 0,
    hasTime: Boolean(h),
  };
  const probe = new Date(parts.year, parts.month, parts.day, parts.hour, parts.minute);
  return Number.isNaN(probe.getTime()) ? null : parts;
}

/** Parses "YYYY-MM-DD h:MM AM/PM" / "YYYY-MM-DD" in local time; null if unparseable. */
export function parseCaptured(value: string | null): Date | null {
  const parts = parseCapturedParts(value);
  if (!parts) return null;
  return new Date(parts.year, parts.month, parts.day, parts.hour, parts.minute);
}

/** Milliseconds that `zone` is ahead of UTC at that instant. */
function zoneOffsetMs(date: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((piece) => piece.type === type)?.value ?? "0");
  const asUTC = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour") % 24,
    part("minute"),
    part("second"),
  );
  return asUTC - date.getTime();
}

/**
 * The instant a wall clock in `zone` refers to. Two passes, because the offset
 * itself depends on the instant being solved for (the hour around a DST change).
 */
function zonedInstant(parts: CapturedParts, zone: string): Date {
  const wallClock = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute);
  const firstOffset = zoneOffsetMs(new Date(wallClock), zone);
  const secondOffset = zoneOffsetMs(new Date(wallClock - firstOffset), zone);
  return new Date(wallClock - secondOffset);
}

/**
 * The instant a note's `captured` stamp refers to. A timed stamp with a
 * recorded zone is read in that zone; without one it falls back to the
 * machine's zone, which is where the vault was written. Date-only stamps are
 * calendar facts, so they parse at local midnight and never shift a day.
 */
function capturedInstant(note: NoteMeta, fallbackZone: string | null = null): Date | null {
  const parts = parseCapturedParts(note.captured);
  if (!parts) return null;
  // The note's own zone wins; a vault written with no field keeps the machine
  // clock (or a caller-supplied origin) so old notes behave exactly as before.
  const origin = note.capturedZone ?? fallbackZone;
  if (parts.hasTime && origin) {
    try {
      return zonedInstant(parts, origin);
    } catch {
      // A bad zone should not lose the stamp; fall back to the local clock.
    }
  }
  return parseCaptured(note.captured);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** The calendar day at `date` in `timeZone`, as `YYYY-MM-DD`; null for an unknown zone. */
export function dayKeyInZone(date: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: string) => parts.find((piece) => piece.type === type)?.value ?? "";
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

/** `YYYY-MM-DD` shifted by whole days; noon UTC keeps DST out of the arithmetic. */
export function shiftDayKey(key: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match?.[1] || !match[2] || !match[3]) return key;
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12),
  );
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/**
 * An IANA zone from a query string, or null. Validated by asking `Intl` to
 * format in it, so a typo falls back to the server clock instead of throwing a
 * 500 mid-response.
 */
export function resolveTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const zone = value.trim();
  if (!zone || zone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

export interface CaptureSeriesOptions {
  /** Bucket by this IANA zone; omitted or null keeps the server's local clock. */
  timeZone?: string | null;
  /** Origin for timed notes that record no zone of their own. */
  recordedZone?: string | null;
  /** The window's end instant; injectable so tests are not clock-dependent. */
  now?: Date;
}

/**
 * Last `days` calendar days of capture counts, oldest first, as `YYYY-MM-DD`
 * labels. With a `timeZone` the window ends on that zone's today and a timed
 * capture counts on the day the instant falls on there; a bare date keeps the
 * day it was written on. Without one this is the original server-local view.
 */
export function captureSeries(
  notes: NoteMeta[],
  days = 30,
  options: CaptureSeriesOptions = {},
): { date: string; count: number }[] {
  if (!Number.isFinite(days) || days <= 0) return [];
  const now = options.now ?? new Date();
  // An unknown zone is treated as "no zone": the local-clock path still works.
  const zonedEnd = options.timeZone ? dayKeyInZone(now, options.timeZone) : null;
  const zone = zonedEnd ? options.timeZone ?? null : null;
  const endKey = zonedEnd ?? localDayKey(now);
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i -= 1) buckets.set(shiftDayKey(endKey, -i), 0);

  for (const note of notes) {
    const key = captureDayKey(note, zone, options.recordedZone ?? null);
    if (key && buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets].map(([date, count]) => ({ date, count }));
}

/**
 * The calendar day a capture belongs to. A bare date is already a day, so it
 * keeps the day it was written on; a timed stamp is converted into the display
 * zone (or the machine's clock when there is none). Null when the note has no
 * usable stamp, so it can never be counted on an invented day.
 */
function captureDayKey(
  note: NoteMeta,
  zone: string | null,
  recordedZone: string | null,
): string | null {
  const parts = parseCapturedParts(note.captured);
  if (!parts) return null;
  if (!parts.hasTime) return `${parts.year}-${pad2(parts.month + 1)}-${pad2(parts.day)}`;
  const captured = capturedInstant(note, recordedZone);
  if (!captured) return null;
  return zone ? dayKeyInZone(captured, zone) : localDayKey(captured);
}

/**
 * Every note captured on `dateKey`, newest first. Timed notes come first by
 * their converted instant; a bare-date note has no instant to order by, so it
 * follows them by title. This is the same day rule the 30-day series uses, so a
 * note appearing in "today" also lands in today's bucket of the sparkline.
 */
export function capturesOnDay(
  notes: NoteMeta[],
  dateKey: string,
  options: CaptureSeriesOptions = {},
): NoteMeta[] {
  const now = options.now ?? new Date();
  // An unknown zone falls back to the machine clock, exactly as the series does.
  const zone =
    options.timeZone && dayKeyInZone(now, options.timeZone) ? options.timeZone : null;
  const recordedZone = options.recordedZone ?? null;
  const picks = notes.filter((note) => captureDayKey(note, zone, recordedZone) === dateKey);

  const instantOf = (note: NoteMeta): number => {
    const parts = parseCapturedParts(note.captured);
    if (!parts?.hasTime) return Number.NEGATIVE_INFINITY;
    return capturedInstant(note, recordedZone)?.getTime() ?? Number.NEGATIVE_INFINITY;
  };

  return picks.sort((a, b) => {
    const at = instantOf(a);
    const bt = instantOf(b);
    if (at !== bt) return bt > at ? 1 : -1;
    return a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
  });
}

/**
 * The review queue for `dateKey`: every note whose `next_review` is on or
 * before that day, oldest first. `overdue` is the part strictly before it, so
 * the panel can say "2 due · 1 overdue" without re-deriving the rule.
 */
export function reviewQueue(
  notes: NoteMeta[],
  dateKey: string,
): { due: NoteMeta[]; overdue: number } {
  const due = notes
    .filter((note) => note.nextReview !== null && note.nextReview <= dateKey)
    .sort(
      (a, b) =>
        (a.nextReview ?? "").localeCompare(b.nextReview ?? "") ||
        a.title.localeCompare(b.title) ||
        a.path.localeCompare(b.path),
    );
  return {
    due,
    overdue: due.filter((note) => note.nextReview !== null && note.nextReview < dateKey).length,
  };
}

export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates a `date` query value from the client, which sends the calendar day
 * of the reader's own time zone rather than the server's. Returns null for
 * anything that is not a real date, so the caller falls back to the local day
 * and a bad query can never shift the recall into an empty bucket.
 */
export function resolveRecallDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = DAY_KEY.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * A cheap, stable signature of what a scan saw: every note's path, size, title,
 * frontmatter fields and body keywords.
 *
 * The dashboard polls `/api/stats` and only re-reads the rest of the vault when
 * this changes, so it must be identical for an unchanged vault and must move when
 * a note is edited. Hashing file contents would be stricter, at the cost of a
 * second pass over every file on every poll; keywords already fold the body in.
 */
export function scanFingerprint(notes: NoteMeta[]): string {
  const shape = [...notes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((note) =>
      [
        note.path,
        note.bytes,
        note.title,
        note.captured ?? "",
        note.capturedZone ?? "",
        note.nextReview ?? "",
        note.area ?? "",
        note.origin ?? "",
        note.tags.join("\u0001"),
        note.keywords.join("\u0001"),
      ].join("|"),
    )
    .join("\u0002");
  return fnv1a(shape).toString(16).padStart(8, "0");
}

export function buildStats(scan: VaultScan, options: CaptureSeriesOptions = {}) {
  const byArea: Record<string, number> = { career: 0, life: 0, ideas: 0, unset: 0 };
  const byOrigin: Record<string, number> = { me: 0, ai: 0, unset: 0 };
  let words = 0;
  let totalBytes = 0;
  let largestNote: { title: string; path: string; bytes: number } | null = null;
  let lastCapture: { title: string; captured: string; capturedZone: string | null } | null = null;
  let lastCaptureDate: Date | null = null;

  for (const note of scan.notes) {
    byArea[note.area ?? "unset"] = (byArea[note.area ?? "unset"] ?? 0) + 1;
    byOrigin[note.origin ?? "unset"] = (byOrigin[note.origin ?? "unset"] ?? 0) + 1;
    words += note.words;
    totalBytes += note.bytes;
    if (
      !largestNote ||
      note.bytes > largestNote.bytes ||
      // Ties resolve by path, so a rescan of the same vault never flips the pick.
      (note.bytes === largestNote.bytes && note.path.localeCompare(largestNote.path) < 0)
    ) {
      largestNote = { title: note.title, path: note.path, bytes: note.bytes };
    }
    const captured = capturedInstant(note, options.recordedZone ?? null);
    if (captured && note.captured && (!lastCaptureDate || captured > lastCaptureDate)) {
      lastCaptureDate = captured;
      lastCapture = { title: note.title, captured: note.captured, capturedZone: note.capturedZone };
    }
  }

  const series = captureSeries(scan.notes, 30, options);
  return {
    totalNotes: scan.notes.length,
    totalWords: words,
    totalBytes,
    largestNote,
    withCaptured: scan.notes.filter((n) => n.captured).length,
    byArea,
    byOrigin,
    series,
    captures30d: series.reduce((sum, point) => sum + point.count, 0),
    lastCapture,
    fingerprint: scanFingerprint(scan.notes),
    scannedAt: scan.scannedAt,
  };
}
