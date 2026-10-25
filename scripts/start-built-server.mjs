/**
 * Starts the compiled server from `server/dist`.
 *
 * The build keeps the source-relative layout (`server/dist/server/src/index.js`)
 * so `shared/wikilinks.js` resolves the same way it does from `server/src`.
 * That means the compiled entry cannot infer the repository root by walking two
 * directories up, so it gets `BRAINDASH_ROOT` explicitly. Source runs
 * (`npm start`, `npm run dev`) keep using `tsx` and their existing inference.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "server", "dist", "server", "src", "index.js");

if (!existsSync(entry)) {
  console.error(`[braindash] no built server at ${entry}; run npm run build first`);
  process.exit(1);
}

const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: { ...process.env, BRAINDASH_ROOT: root },
  stdio: "inherit",
});

// Keep Ctrl+C and CI cancellation from orphaning the compiled server.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
