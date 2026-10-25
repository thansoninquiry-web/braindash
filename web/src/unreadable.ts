import type { UnreadableEntry } from "./types";

/**
 * Status-strip copy for notes the walk found but could not read. Unlike a
 * skipped symlink these are real notes the person expects in the index: the
 * count is the size of the hole the scan left. The row disappears at zero
 * because there is nothing to explain, not because the failure is harmless.
 */
export function unreadableLabel(entries: readonly UnreadableEntry[]): string | null {
  if (entries.length === 0) return null;
  return `${entries.length} note${entries.length === 1 ? "" : "s"} unreadable`;
}

/** Plain language for the Node error codes the scan records. */
const READ_FAILURES: Record<string, string> = {
  EACCES: "permission denied",
  EPERM: "permission denied",
  ENOENT: "vanished before it could be read",
  EISDIR: "it is a folder, not a file",
  ENOTDIR: "a parent folder is not a folder",
  ELOOP: "too many symbolic links",
  EMFILE: "too many files open",
  ENFILE: "too many files open on the machine",
  EIO: "an I/O error",
  EBUSY: "locked by another program",
  ETXTBSY: "locked by another program",
};

/** One phrase for a failure code, falling back to a neutral sentence. */
export function readFailureMessage(code: string): string {
  return READ_FAILURES[code.toUpperCase()] ?? "the read failed";
}

/**
 * Hover title for the label: every unreadable path on its own line, with the
 * reason after an em dash. The scan already sorts by path, and that order is
 * preserved so the tooltip matches the index.
 */
export function unreadableTooltip(entries: readonly UnreadableEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map(
    (entry) => `${entry.path} — ${readFailureMessage(entry.code)} (${entry.code})`,
  );
  return `Could not be read during the scan (${entries.length}):\n${lines.join("\n")}`;
}
