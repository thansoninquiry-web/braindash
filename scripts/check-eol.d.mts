/**
 * Types for `check-eol.mjs`, the line-ending gate over the index and the
 * working tree.
 */

/** One tracked file as `git ls-files --eol` describes it. */
export interface TrackedFile {
  /** Path as Git reports it, relative to the repository root. */
  path: string;
  /** Index line ending: `lf`, `crlf`, `mixed`, `none` or `-text`. */
  index: string;
  /** Working-tree line ending: the same vocabulary. */
  worktree: string;
  /** Effective attribute: `/text`, `/-text`, `/binary` or `/unspecified`. */
  attr: string;
  /** Declared `eol=lf` / `eol=crlf`, when a rule declares one. */
  eol?: string;
}

/** The check's outcome, for callers that must not throw. */
export type EolOutcome =
  | {
      ok: true;
      /** Repository root the paths are relative to. */
      root: string;
      files: TrackedFile[];
      /** Tracked files Git treats as text. */
      text: number;
      binary: number;
      /** Text files whose rule asks for CRLF; skipped by design. */
      declaredCrlf: number;
      /** Text files with CRLF on disk. */
      offenders: TrackedFile[];
      /** Text files whose staged blob holds CRLF. Both lists empty means pass. */
      blobs: TrackedFile[];
    }
  | { ok: false; error: string };

/** Parses `git ls-files --eol -z`; throws on a record it does not recognise. */
export function parseEolList(stdout: string): TrackedFile[];

/** Whether Git treats the path as binary (`-text`, the `binary` macro). */
export function isBinaryFile(file: TrackedFile): boolean;

/** Text files ending lines with CRLF on disk, minus those declared `eol=crlf`. */
export function crlfOffenders(files: readonly TrackedFile[]): TrackedFile[];

/** Text files whose staged blob carries CRLF, minus those declared `eol=crlf`. */
export function crlfBlobs(files: readonly TrackedFile[]): TrackedFile[];

/** 1-based line numbers ending in CRLF; a lone CR does not count. */
export function crlfLines(data: Buffer | Uint8Array): number[];

/** Runs the check over `cwd` (default: this repository). */
export function collectEol(options?: { cwd?: string }): EolOutcome;
