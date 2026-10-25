import type { SkippedEntry } from "./types";

/**
 * Status-strip label for the entries a scan refused to follow. Zero is omitted
 * rather than shown as `0 skipped`: the row exists to explain why a note the
 * person can see in their folder is missing from the index, and it has nothing
 * to explain when the walk skipped nothing.
 */
export function skippedLabel(skipped: readonly SkippedEntry[]): string | null {
  if (skipped.length === 0) return null;
  return `${skipped.length} symlink${skipped.length === 1 ? "" : "s"} skipped`;
}

/**
 * Hover title for that label: every skipped path, one per line, so a native
 * tooltip stays readable instead of becoming a comma-run of long vault paths.
 * The scan already sorts `skipped` by path, and the order is preserved.
 */
export function skippedTooltip(skipped: readonly SkippedEntry[]): string {
  if (skipped.length === 0) return "";
  return `Symlinks are never followed (${skipped.length}):\n${skipped
    .map((entry) => entry.path)
    .join("\n")}`;
}
