/**
 * Fault injection for the vault reader, with no OS-specific fixtures.
 *
 * The interesting failures in `server/src/vault.ts` are a file that vanishes
 * between the walk and the read, a read the OS refuses, and an entry that reads
 * but is not a regular file. None can be posed as a real fixture portably — a
 * timer racing a delete flakes, permission bits mean nothing to an elevated
 * test runner, and Node fails a directory read before the type check is reached —
 * so all three are posed as named faults on the one shared `fs.promises` object
 * instead.
 *
 * A fault that never fires fails the test that declared it: a stub the code never
 * reached proves nothing. Every stub is restored in a `finally`, and the test
 * runner gives each file its own process, so nothing leaks between suites.
 */
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";

export type Fault =
  /** The path is gone: reading it raises `ENOENT`, as a delete just before the read would. */
  | { kind: "missing"; path: string }
  /** The read is refused: `EACCES`, as a file whose permissions deny this process. */
  | { kind: "denied"; path: string }
  /** Bytes are readable, but the entry is not a regular file (a directory, a socket). */
  | { kind: "not-a-file"; path: string };

/** `fs.promises` is one shared object; TypeScript marks the namespace import read-only. */
const shared = fs as unknown as {
  readFile: typeof fs.readFile;
  stat: typeof fs.stat;
};

/**
 * One spelling per file. The reader resolves what it was given through
 * `fs.realpath` before reading, and on Windows that name can differ from the one
 * a test built: the temp directory's 8.3 form (`RUNNER~1`) expands, and the drive
 * letter is normalised. Comparing canonical names keeps a declared fault attached
 * to the file it was meant for on every OS — a CI-only miss here made the
 * defensive suite pass locally and fail on the Windows runner.
 */
function canonical(file: string): string {
  const resolved = path.resolve(file);
  try {
    return realpathSync.native(resolved);
  } catch {
    // A path that genuinely is not there keeps its lexical spelling; the reader
    // resolves the same string itself, so the fault still matches.
    return resolved;
  }
}

const faultKey = (fault: Fault): string => `${fault.kind}:${canonical(fault.path)}`;

function fsError(code: string, file: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: cannot open '${file}'`) as NodeJS.ErrnoException;
  error.code = code;
  error.path = file;
  return error;
}

/** The path a call is about, or null when it passed a handle rather than a path. */
function targetOf(value: unknown): string | null {
  return typeof value === "string" ? canonical(value) : null;
}

/**
 * Runs `body` with the given faults installed, then restores the real filesystem.
 * Throws (after restoring) if any declared fault was never triggered.
 */
export async function withFsFaults<T>(faults: Fault[], body: () => Promise<T>): Promise<T> {
  const missing = new Set(faults.filter((fault) => fault.kind === "missing").map((fault) => canonical(fault.path)));
  const denied = new Set(faults.filter((fault) => fault.kind === "denied").map((fault) => canonical(fault.path)));
  const notFiles = new Set(
    faults.filter((fault) => fault.kind === "not-a-file").map((fault) => canonical(fault.path)),
  );
  const fired = new Set<string>();
  const original = { readFile: shared.readFile, stat: shared.stat };

  shared.readFile = (async (...args: unknown[]) => {
    const target = targetOf(args[0]);
    if (target && missing.has(target)) {
      fired.add(`missing:${target}`);
      throw fsError("ENOENT", String(args[0]));
    }
    if (target && denied.has(target)) {
      fired.add(`denied:${target}`);
      throw fsError("EACCES", String(args[0]));
    }
    if (target && notFiles.has(target)) {
      fired.add(`not-a-file:${target}`);
      return Buffer.from("# Not a regular file\n", "utf8");
    }
    return (original.readFile as (...rest: unknown[]) => Promise<unknown>)(...args);
  }) as unknown as typeof fs.readFile;

  shared.stat = (async (...args: unknown[]) => {
    const target = targetOf(args[0]);
    if (target && notFiles.has(target)) {
      fired.add(`not-a-file:${target}`);
      return { isFile: () => false } as unknown as Awaited<ReturnType<typeof fs.stat>>;
    }
    return (original.stat as (...rest: unknown[]) => Promise<unknown>)(...args);
  }) as unknown as typeof fs.stat;

  try {
    const result = await body();
    for (const fault of faults) {
      const key = faultKey(fault);
      if (!fired.has(key)) {
        throw new Error(`fault ${key} never fired, so the test proves nothing`);
      }
    }
    return result;
  } finally {
    Object.assign(shared, original);
  }
}
