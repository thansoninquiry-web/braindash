const numberFormat = new Intl.NumberFormat("en-US");

/**
 * Bytes on disk, binary units: "982 B", "2.7 kB", "1.04 MB".
 *
 * Shared so the vault rail, the reader metadata and the index trail all quote
 * the same number for the same file. One decimal from the kB step keeps a note
 * grain at a glance; two at MB keeps large notes distinguishable.
 */
export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${numberFormat.format(Math.round(value))} B`;
}

/** Exact byte count for a `title` tooltip beside a rounded size. */
export function exactBytes(value: number): string {
  return `${numberFormat.format(Math.max(0, Math.round(value)))} bytes`;
}
