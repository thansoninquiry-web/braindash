/**
 * Runs a workspace's `node:test` suite through the tsx loader.
 *
 * Two things make a bare `node --test` not enough:
 *  - the sources are TypeScript, so Node needs `--import tsx`;
 *  - tsx picks the JSX runtime from tsconfig, and `web/tsconfig.json` is a
 *    solution-style file (`files: []`) that it ignores, so the web suite passes
 *    its app tsconfig here instead of relying on autodetection.
 *
 * Setting the env var from an npm script is not portable on Windows, which is
 * why this tiny wrapper exists.
 *
 * Usage: `node scripts/run-tests.mjs [--coverage] [tsconfig.json] [filter...]`.
 * A filter is a case-insensitive substring of a test file's path, so
 * `npm test -w web -- cloudLabel` runs one file and
 * `npm test -w server -- vault` runs the vault suites. `--coverage` turns on
 * Node's built-in V8 coverage report for the files the tests load.
 *
 * In CI the output is tee'd through this process so the runner's final totals
 * can be saved to `.ci/tests-<workspace>.json` (see `ci-summary.mjs`): the
 * summary step runs after this one and cannot read a transcript it never saw.
 * The reporter is pinned to `spec` there, which is what the totals parser reads.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseTestTotals } from "./ci-summary.mjs";

const args = process.argv.slice(2);
// A path ending in .json is the tsconfig; anything else narrows the file list,
// except the coverage switch, which configures the runner itself.
const tsconfig = args.find((arg) => /\.json$/i.test(arg));
const coverage = args.includes("--coverage");
const filters = args
  .filter((arg) => arg !== tsconfig && arg !== "--coverage")
  .map((arg) => arg.toLowerCase())
  .filter(Boolean);

const env = { ...process.env };
if (tsconfig) env.TSX_TSCONFIG_PATH = path.resolve(process.cwd(), tsconfig);

// GitHub sets CI=true; a local `npm test` keeps its inherited stdio and writes
// nothing, so the working tree stays clean outside CI.
const capture = Boolean(env.CI) && env.CI !== "0" && env.CI !== "false";

// Listed explicitly: the runner does not reliably expand a directory (or a
// glob, on older Node) once tsx's resolver is in front of it.
function testFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(full));
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const all = testFiles(path.resolve(process.cwd(), "test")).sort();
if (all.length === 0) {
  console.error("no test/*.test.ts(x) files found");
  process.exit(1);
}

const relative = (file) => path.relative(process.cwd(), file).split(path.sep).join("/");
const files = filters.length
  ? all.filter((file) => filters.some((filter) => relative(file).toLowerCase().includes(filter)))
  : all;

if (files.length === 0) {
  console.error(`no test file matches ${filters.map((filter) => JSON.stringify(filter)).join(", ")}`);
  console.error("available:");
  for (const file of all) console.error(`  ${relative(file)}`);
  process.exit(1);
}

if (filters.length) console.error(`running ${files.length} of ${all.length} test files`);

const coverageFlags = coverage ? ["--experimental-test-coverage"] : [];
// Tap is Node's default once stdout is a pipe; spec is what a person reads and
// what the totals parser expects.
const reporterFlags = capture ? ["--test-reporter=spec"] : [];

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...reporterFlags, ...coverageFlags, ...files],
  {
    cwd: process.cwd(),
    env,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  },
);

let transcript = "";
if (capture) {
  child.stdout.on("data", (chunk) => {
    transcript += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr.pipe(process.stderr);
}

/** The workspace root: the nearest package.json that declares workspaces. */
function repoRoot(start) {
  let dir = start;
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.workspaces) return dir;
    } catch {
      // Keep walking: only the root package.json has workspaces.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start, "..");
    dir = parent;
  }
}

/** Saves the totals for `ci-summary.mjs`; a write failure must not fail the run. */
function saveTotals() {
  const totals = parseTestTotals(transcript);
  if (!totals) return;
  try {
    const dir = path.join(repoRoot(process.cwd()), ".ci");
    mkdirSync(dir, { recursive: true });
    const workspace = path.basename(process.cwd());
    writeFileSync(
      path.join(dir, `tests-${workspace}.json`),
      `${JSON.stringify({ workspace, ...totals }, null, 2)}\n`,
    );
  } catch (error) {
    console.error(`[tests] could not save totals: ${(error && error.message) || error}`);
  }
}

child.on("close", (code, signal) => {
  if (capture) saveTotals();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
