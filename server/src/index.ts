import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createVaultApp } from "./app.js";
import { createDepsReader } from "./deps.js";
import { parseAllowedHosts } from "./httpSecurity.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// `start:built` and the smoke run set this because the compiled entry sits
// deeper (server/dist/server/src); source runs keep the same inferred root.
const ROOT = path.resolve(process.env.BRAINDASH_ROOT?.trim() || path.resolve(HERE, "../.."));

dotenv.config({ path: path.join(ROOT, ".env") });
dotenv.config({ path: path.join(ROOT, ".env.local"), override: true });

// BRAINDASH_PORT, not PORT: a generic PORT in the host environment must not
// silently move the API off 5181.
const PORT = Number(process.env.BRAINDASH_PORT || 5181);
const HOST = process.env.HOST ?? "127.0.0.1";
const VAULT_PATH = process.env.VAULT_PATH?.trim() || null;
// Writes are opt-in per install and, even then, loopback-only (see app.ts).
const WRITE = process.env.BRAINDASH_WRITE === "1";
// Optional: require a shared token before any API read. `npm run dev` serves the
// dashboard to the whole LAN, so this is what stops a phone (or anyone else on
// the network) from reading the vault through it.
const TOKEN = process.env.BRAINDASH_TOKEN?.trim() || null;
if (TOKEN && TOKEN.length < 8) {
  console.warn(
    "[braindash] BRAINDASH_TOKEN is short; use at least 8 characters, ideally 24 random ones",
  );
}
// Optional: extra Host names besides loopback, `.localhost` and literal addresses.
// Needed only when the dashboard is opened by a DNS name (a LAN mDNS name, say);
// IP addresses need no configuration.
const HOSTS = parseAllowedHosts(process.env.BRAINDASH_HOSTS);

const { app } = createVaultApp({
  vaultPath: VAULT_PATH,
  writes: WRITE,
  token: TOKEN,
  hosts: HOSTS,
  staticDir: path.join(ROOT, "web/dist"),
  // npm must run at the repository root, not the workspace the server happens
  // to have been started from: `npm run dev -w server` starts in server/.
  deps: createDepsReader({ cwd: ROOT }),
});

app.listen(PORT, HOST, () => {
  const vaultOk = (() => {
    if (!VAULT_PATH) return false;
    try {
      return fs.statSync(VAULT_PATH).isDirectory();
    } catch {
      return false;
    }
  })();
  console.log(`[braindash] api on http://${HOST}:${PORT} (${vaultOk ? "vault ok" : "vault NOT configured"})`);
  console.log(`[braindash] scanning ${VAULT_PATH ?? "<VAULT_PATH missing>"}`);
  console.log(
    `[braindash] edits ${WRITE ? "enabled (this machine only)" : "disabled (set BRAINDASH_WRITE=1 to enable)"}`,
  );
  console.log(
    `[braindash] access ${TOKEN ? "token required for every API read" : "open (set BRAINDASH_TOKEN to require a token)"}`,
  );
  if (HOSTS.length > 0) {
    console.log(`[braindash] also answering ${HOSTS.join(", ")}`);
  }
});
