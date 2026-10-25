/**
 * Builds the server into `server/dist`.
 *
 * `tsconfig.build.json` uses `rootDir: ".."` because `server/src/vault.ts`
 * imports `shared/wikilinks.ts`; the output therefore keeps the source-relative
 * shape (`server/dist/server/src`, `server/dist/shared`). `workingMode.ts` and
 * `deps.ts` also import `scripts/*.mjs`, which tsc does not copy, so the runtime
 * modules are placed where the compiled imports expect them.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "server");
const outDir = path.join(serverDir, "dist");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

rmSync(outDir, { recursive: true, force: true });

const compiled = spawnSync(process.execPath, [tsc, "-p", path.join(serverDir, "tsconfig.build.json")], {
  cwd: serverDir,
  stdio: "inherit",
});
if (compiled.error) {
  console.error(compiled.error);
  process.exit(1);
}
if (compiled.status !== 0) process.exit(compiled.status ?? 1);

mkdirSync(path.join(outDir, "scripts"), { recursive: true });
for (const name of ["mode.mjs", "check-deps.mjs"]) {
  cpSync(path.join(root, "scripts", name), path.join(outDir, "scripts", name));
}

console.log("[braindash] built server -> server/dist");
