import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { createVaultApp, type VaultAppOptions } from "../src/app.js";
import { hashToken, SESSION_MAX_AGE_SECONDS, TOKEN_COOKIE } from "../src/accessToken.js";

type Json = Record<string, any>;

interface Running {
  base: string;
  close(): Promise<void>;
}

/** Starts the real Express app on an ephemeral loopback port. */
async function start(options: VaultAppOptions = {}): Promise<Running> {
  const { app, cache } = createVaultApp({ staticDir: null, vaultPath: null, ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      cache?.close();
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

async function call(
  base: string,
  route: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Json; cookie: string | null }> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${base}${route}`, { ...init, headers });
  const body = (await response.json()) as Json;
  return { status: response.status, body, cookie: response.headers.get("set-cookie") };
}

/** The `name=value` half of a Set-Cookie header, for the next request. */
function credential(setCookie: string | null): string {
  assert.ok(setCookie, "expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

const TOKEN = "correct-horse-battery";

describe("without a token", () => {
  it("reports that no token is required and leaves the API open", async () => {
    const running = await start();
    try {
      const session = await call(running.base, "/api/session");
      assert.equal(session.status, 200);
      assert.deepEqual(session.body, { required: false, authenticated: false });
      assert.equal(session.cookie, null);

      const health = await call(running.base, "/api/health");
      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);
    } finally {
      await running.close();
    }
  });

  it("treats a posted token as a no-op rather than an error", async () => {
    const running = await start();
    try {
      const posted = await call(running.base, "/api/session", {
        method: "POST",
        body: JSON.stringify({ token: TOKEN }),
      });
      assert.equal(posted.status, 200);
      assert.deepEqual(posted.body, { required: false, authenticated: false });
      assert.equal(posted.cookie, null);
    } finally {
      await running.close();
    }
  });
});

describe("with a token", () => {
  it("answers /api/session without the token but locks every data route", async () => {
    const running = await start({ token: TOKEN });
    try {
      const session = await call(running.base, "/api/session");
      assert.equal(session.status, 200);
      assert.deepEqual(session.body, { required: true, authenticated: false });
      assert.equal(session.cookie, null);

      for (const route of ["/api/health", "/api/notes", "/api/stats", "/api/mode", "/api/deps"]) {
        const locked = await call(running.base, route);
        assert.equal(locked.status, 401, `${route} should be locked`);
        assert.equal(locked.body.error, "unauthorized");
        assert.match(locked.body.detail, /access token/);
        assert.equal(locked.cookie, null);
      }
    } finally {
      await running.close();
    }
  });

  it("rejects a wrong token without setting a cookie or echoing the secret", async () => {
    const running = await start({ token: TOKEN });
    try {
      const rejected = await call(running.base, "/api/session", {
        method: "POST",
        body: JSON.stringify({ token: `${TOKEN}-wrong` }),
      });
      assert.equal(rejected.status, 401);
      assert.equal(rejected.body.error, "bad_token");
      assert.equal(rejected.cookie, null);
      assert.equal(JSON.stringify(rejected.body).includes(TOKEN), false);

      const empty = await call(running.base, "/api/session", { method: "POST", body: "{}" });
      assert.equal(empty.status, 401);
      assert.equal(empty.body.error, "bad_token");
    } finally {
      await running.close();
    }
  });

  it("unlocks the API with the cookie the correct token sets", async () => {
    const running = await start({ token: TOKEN });
    try {
      const unlocked = await call(running.base, "/api/session", {
        method: "POST",
        body: JSON.stringify({ token: TOKEN }),
      });
      assert.equal(unlocked.status, 200);
      assert.deepEqual(unlocked.body, { required: true, authenticated: true });
      const setCookie = unlocked.cookie ?? "";
      assert.ok(setCookie.startsWith(`${TOKEN_COOKIE}=${hashToken(TOKEN)};`), setCookie);
      assert.match(setCookie, /; HttpOnly/);
      assert.match(setCookie, /; SameSite=Strict/);
      assert.match(setCookie, new RegExp(`; Max-Age=${SESSION_MAX_AGE_SECONDS}`));
      assert.equal(setCookie.includes(TOKEN), false, "the secret must not be in the cookie");

      const cookie = credential(unlocked.cookie);
      const session = await call(running.base, "/api/session", { headers: { cookie } });
      assert.deepEqual(session.body, { required: true, authenticated: true });

      const health = await call(running.base, "/api/health", { headers: { cookie } });
      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);
    } finally {
      await running.close();
    }
  });

  it("accepts the raw token as a Bearer header, for curl and scripts", async () => {
    const running = await start({ token: TOKEN });
    try {
      const health = await call(running.base, "/api/health", {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);
    } finally {
      await running.close();
    }
  });

  it("refuses a forged cookie, including the raw token in cookie position", async () => {
    const running = await start({ token: TOKEN });
    try {
      const forged = await call(running.base, "/api/health", {
        headers: { cookie: `${TOKEN_COOKIE}=deadbeef` },
      });
      assert.equal(forged.status, 401);

      const raw = await call(running.base, "/api/health", {
        headers: { cookie: `${TOKEN_COOKIE}=${TOKEN}` },
      });
      assert.equal(raw.status, 401);
    } finally {
      await running.close();
    }
  });

  it("clears the session on DELETE", async () => {
    const running = await start({ token: TOKEN });
    try {
      const unlocked = await call(running.base, "/api/session", {
        method: "POST",
        body: JSON.stringify({ token: TOKEN }),
      });
      const cookie = credential(unlocked.cookie);

      const cleared = await call(running.base, "/api/session", { method: "DELETE", headers: { cookie } });
      assert.equal(cleared.status, 200);
      assert.deepEqual(cleared.body, { required: true, authenticated: false });
      assert.match(cleared.cookie ?? "", /^braindash_token=;/);
      assert.match(cleared.cookie ?? "", /Max-Age=0/);

      const after = await call(running.base, "/api/health", {
        headers: { cookie: credential(cleared.cookie) },
      });
      assert.equal(after.status, 401);
    } finally {
      await running.close();
    }
  });
});
