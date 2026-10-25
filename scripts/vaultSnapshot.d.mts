/**
 * Types for `vaultSnapshot.mjs`, the smoke run's read-only proof.
 */

/** One file in a snapshot. */
export interface VaultFile {
  /** Slash-separated path relative to the snapshot root, for stable messages. */
  path: string;
  size: number;
  /** Millisecond stamp from `stat`, compared exactly. */
  mtimeMs: number;
  /** Lowercase hex SHA-256 of the file's bytes. */
  sha256: string;
}

export interface SnapshotOptions {
  /**
   * Slash-separated paths relative to the root whose file and directory
   * subtrees are skipped. Symlinks are always skipped, never followed.
   */
  ignore?: readonly string[];
  /**
   * Per-file skip, for noise a path list cannot name (root-level dev logs).
   * Receives the slash-separated path relative to the root.
   */
  ignoreFile?: (relative: string) => boolean;
}

/** Every file under `root`, sorted by path. */
export function snapshotTree(root: string, options?: SnapshotOptions): Promise<VaultFile[]>;

/** Differences between two snapshots; empty means nothing changed. */
export function diffSnapshots(before: readonly VaultFile[], after: readonly VaultFile[]): string[];
