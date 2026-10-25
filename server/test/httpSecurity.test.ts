import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createVaultApp, type VaultAppOptions } from "../src/app.js";
import {
  CONTENT_SECURITY_POLICY,
  hostnameOf,
  isAllowedHost,
  parseAllowedHosts,
  PERMISSIONS_POLICY,
} from "../src/httpSecurity.js";

interface Running {
  base: string;
  port: string;
  close(): Promise<void>;
}

async function start(options: VaultAppOptions = {}): Promise<Running> {
  const { app, cache } = createVaultApp({ staticDir: null, watch: null, ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no ephemeral port");
  return {
    base: `http://127.0.0.1:${address.port}`,
    port: String(address.port),
    async close() {
      cache?.close();
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

/** A request whose Host header the caller picks — `fetch` refuses to set it. */
function callWithHost(
  base: string,
  route: string,
  host: string | undefined,
  method: "GET" | "POST" = "GET",
): Promise<Answer> {
  const url = new URL(`${base}${route}`);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...(host === undefined ? {} : { host }),
          accept: "application/json",
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers, text });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function tempDir(prefix = "braindash-security-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("host allow-list — the pure rule", () => {
  it("accepts every name that can only mean this machine", () => {
    for (const host of [
      "localhost",
      "LocalHost:5180",
      "127.0.0.1",
      "127.0.0.1:5181",
      "[::1]:5180",
      "::1",
      "dashboard.localhost:5180",
      "anything.localhost",
    ]) {
      assert.equal(isAllowedHost(host), true, `${host} should be allowed`);
    }
  });

  it("accepts literal addresses, so a phone on the LAN still connects", () => {
    assert.equal(isAllowedHost("192.168.4.20:5180"), true);
    assert.equal(isAllowedHost("[fe80::1]:5180"), true);
    assert.equal(isAllowedHost("100.101.102.103:5181"), true);
  });

  it("refuses a domain, including one that merely looks like an address", () => {
    for (const host of [
      undefined,
      "",
      " ",
      "rebind.example",
      "rebind.example:5180",
      "127.0.0.1.nip.io",
      "localhost.evil.example",
      "localhostified",
    ]) {
      assert.equal(isAllowedHost(host), false, `${String(host)} should be refused`);
    }
  });

  it("only answers configured names on the port they were pinned to", () => {
    const hosts = ["brainbox.local:5181", "notes.lan"];
    assert.equal(isAllowedHost("brainbox.local:5181", hosts), true);
    assert.equal(isAllowedHost("BrainBox.local:5181", hosts), true);
    assert.equal(isAllowedHost("brainbox.local:5180", hosts), false);
    assert.equal(isAllowedHost("brainbox.local", hosts), false);
    // A bare entry allows the name on any port.
    assert.equal(isAllowedHost("notes.lan:5180", hosts), true);
    assert.equal(isAllowedHost("notes.lan", hosts), true);
    assert.equal(isAllowedHost("other.lan", hosts), false);
  });

  it("splits BRAINDASH_HOSTS into lowercased names", () => {
    assert.deepEqual(parseAllowedHosts(" BrainBox.local:5181 , notes.lan ,, "), [
      "brainbox.local:5181",
      "notes.lan",
    ]);
    assert.deepEqual(parseAllowedHosts(undefined), []);
    assert.deepEqual(parseAllowedHosts(null), []);
    assert.deepEqual(parseAllowedHosts("   "), []);
  });

  it("strips a port without cutting an IPv6 literal short", () => {
    assert.equal(hostnameOf("Example.COM:80"), "example.com");
    assert.equal(hostnameOf("[::1]:5181"), "[::1]");
    assert.equal(hostnameOf("[fe80::1]"), "[fe80::1]");
    assert.equal(hostnameOf(""), null);
    assert.equal(hostnameOf(undefined), null);
  });
});

describe("security headers — every answer", () => {
  it("hardens an API read and keeps it out of caches", async () => {
    const root = await tempDir();
    const running = await start({ vaultPath: root });
    try {
      const answer = await callWithHost(running.base, "/api/health", `127.0.0.1:${running.port}`);
      assert.equal(answer.status, 200);
      assert.equal(answer.headers["content-security-policy"], CONTENT_SECURITY_POLICY);
      assert.equal(answer.headers["x-content-type-options"], "nosniff");
      assert.equal(answer.headers["x-frame-options"], "DENY");
      assert.equal(answer.headers["referrer-policy"], "no-referrer");
      assert.equal(answer.headers["permissions-policy"], PERMISSIONS_POLICY);
      assert.equal(answer.headers["cache-control"], "no-store");
      assert.equal(answer.headers["x-powered-by"], undefined);
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("sends the same policy with the built dashboard, not only the JSON", async () => {
    const dist = await tempDir("braindash-dist-");
    await fs.writeFile(
      path.join(dist, "index.html"),
      "<!doctype html><html><body><div id=\"root\"></div></body></html>",
      "utf8",
    );
    const running = await start({ staticDir: dist });
    try {
      const answer = await callWithHost(running.base, "/", `127.0.0.1:${running.port}`);
      assert.equal(answer.status, 200);
      assert.match(answer.headers["content-type"] ?? "", /text\/html/);
      assert.equal(answer.headers["content-security-policy"], CONTENT_SECURITY_POLICY);
      assert.equal(answer.headers["x-frame-options"], "DENY");
      assert.equal(answer.headers["referrer-policy"], "no-referrer");
      // Static assets stay cacheable; only the API is no-store.
      assert.doesNotMatch(answer.headers["cache-control"] ?? "", /no-store/);
    } finally {
      await running.close();
      await fs.rm(dist, { recursive: true, force: true });
    }
  });

  it("allows inline styles and blob media but no inline or third-party script", () => {
    assert.match(CONTENT_SECURITY_POLICY, /(^|; )script-src 'self'(;|$)/);
    assert.match(CONTENT_SECURITY_POLICY, /style-src 'self' 'unsafe-inline'/);
    assert.match(CONTENT_SECURITY_POLICY, /media-src 'self' blob:/);
    assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
    assert.match(CONTENT_SECURITY_POLICY, /base-uri 'none'/);
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-eval/);
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /https?:/);
    assert.match(PERMISSIONS_POLICY, /microphone=\(self\)/);
    assert.match(PERMISSIONS_POLICY, /camera=\(\)/);
  });

  it("marks every API answer no-store, including the open session probe", async () => {
    const root = await tempDir();
    const running = await start({ vaultPath: root });
    try {
      for (const route of ["/api/session", "/api/health", "/api/notes", "/api/trash"]) {
        const answer = await callWithHost(running.base, route, `127.0.0.1:${running.port}`);
        assert.equal(answer.status, 200, `${route} should answer`);
        assert.equal(answer.headers["cache-control"], "no-store", `${route} should not be cached`);
      }
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("host guard — the request rule", () => {
  it("turns away a rebinding Host, on the health read and the session probe", async () => {
    const root = await tempDir();
    const running = await start({ vaultPath: root });
    try {
      for (const route of ["/api/health", "/api/session", "/api/notes"]) {
        const answer = await callWithHost(running.base, route, "rebind.example:5181");
        assert.equal(answer.status, 403, `${route} should refuse a foreign Host`);
        assert.equal(JSON.parse(answer.text).error, "host_not_allowed");
        assert.equal(answer.headers["cache-control"], "no-store");
        assert.equal(answer.headers["content-security-policy"], CONTENT_SECURITY_POLICY);
      }
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("still answers a LAN address and the dashboard it proxies", async () => {
    const root = await tempDir();
    const running = await start({ vaultPath: root });
    try {
      const lan = await callWithHost(running.base, "/api/health", "192.168.1.184:5180");
      assert.equal(lan.status, 200);
      assert.equal(JSON.parse(lan.text).configured, true);
      const localhost = await callWithHost(running.base, "/api/health", `localhost:${running.port}`);
      assert.equal(localhost.status, 200);
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("answers a name only when it was configured, on the pinned port", async () => {
    const root = await tempDir();
    const running = await start({ vaultPath: root, hosts: ["brainbox.local:5181"] });
    try {
      const allowed = await callWithHost(running.base, "/api/health", "brainbox.local:5181");
      assert.equal(allowed.status, 200);
      const wrongPort = await callWithHost(running.base, "/api/health", "brainbox.local:5180");
      assert.equal(wrongPort.status, 403);
      assert.equal(JSON.parse(wrongPort.text).error, "host_not_allowed");
    } finally {
      await running.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
