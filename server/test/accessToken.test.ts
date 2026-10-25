import assert from "node:assert/strict";
import type { Request } from "express";
import { describe, it } from "node:test";
import {
  bearerToken,
  clearedCookie,
  hashToken,
  isAuthorized,
  readCookie,
  sameToken,
  sessionCookie,
  SESSION_MAX_AGE_SECONDS,
  TOKEN_COOKIE,
} from "../src/accessToken.js";

const TOKEN = "correct-horse-battery";

/** Only `headers` is read by the helpers under test. */
function request(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe("hashToken", () => {
  it("is a stable SHA-256 hex digest, not the token itself", () => {
    const digest = hashToken(TOKEN);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(hashToken(TOKEN), digest);
    assert.notEqual(digest, TOKEN);
    assert.notEqual(hashToken("another-token"), digest);
  });
});

describe("sameToken", () => {
  it("accepts an exact match and rejects everything else", () => {
    assert.equal(sameToken(TOKEN, TOKEN), true);
    assert.equal(sameToken(TOKEN, `${TOKEN} `), false);
    assert.equal(sameToken(TOKEN, TOKEN.toUpperCase()), false);
    assert.equal(sameToken("", ""), true);
    assert.equal(sameToken("", TOKEN), false);
  });

  it("does not throw on very different lengths", () => {
    assert.equal(sameToken("a", "a".repeat(4096)), false);
  });
});

describe("readCookie", () => {
  it("finds one cookie among several, with whitespace trimmed", () => {
    assert.equal(readCookie(`a=1; ${TOKEN_COOKIE}=abc123 ; b=2`, TOKEN_COOKIE), "abc123");
    assert.equal(readCookie(`${TOKEN_COOKIE}=only`, TOKEN_COOKIE), "only");
  });

  it("is null for a missing header, a missing name and an empty value", () => {
    assert.equal(readCookie(undefined, TOKEN_COOKIE), null);
    assert.equal(readCookie("a=1; b=2", TOKEN_COOKIE), null);
    assert.equal(readCookie(`${TOKEN_COOKIE}=; a=1`, TOKEN_COOKIE), null);
  });

  it("keeps a value containing = intact and takes the first duplicate", () => {
    assert.equal(readCookie("session=a=b=c", "session"), "a=b=c");
    assert.equal(readCookie(`${TOKEN_COOKIE}=first; ${TOKEN_COOKIE}=second`, TOKEN_COOKIE), "first");
  });

  it("matches names exactly, so a prefix does not count", () => {
    assert.equal(readCookie(`${TOKEN_COOKIE}_old=abc`, TOKEN_COOKIE), null);
  });
});

describe("bearerToken", () => {
  it("reads the token from a Bearer header, whatever the scheme's case", () => {
    assert.equal(bearerToken(request({ authorization: `Bearer ${TOKEN}` })), TOKEN);
    assert.equal(bearerToken(request({ authorization: `bearer ${TOKEN}` })), TOKEN);
  });

  it("is null for another scheme or a missing value", () => {
    assert.equal(bearerToken(request({ authorization: `Basic ${TOKEN}` })), null);
    assert.equal(bearerToken(request({ authorization: "Bearer" })), null);
    assert.equal(bearerToken(request({})), null);
  });
});

describe("isAuthorized", () => {
  it("accepts the raw token as a Bearer header", () => {
    assert.equal(isAuthorized(request({ authorization: `Bearer ${TOKEN}` }), TOKEN), true);
    assert.equal(isAuthorized(request({ authorization: "Bearer wrong" }), TOKEN), false);
  });

  it("accepts the cookie only when it holds the token's hash", () => {
    const good = `${TOKEN_COOKIE}=${hashToken(TOKEN)}`;
    assert.equal(isAuthorized(request({ cookie: good }), TOKEN), true);
    // The raw token in the cookie is not the shape this install issues.
    assert.equal(isAuthorized(request({ cookie: `${TOKEN_COOKIE}=${TOKEN}` }), TOKEN), false);
    // The hash of another token must not pass either.
    assert.equal(isAuthorized(request({ cookie: `${TOKEN_COOKIE}=${hashToken("other")}` }), TOKEN), false);
  });

  it("refuses a request with neither credential", () => {
    assert.equal(isAuthorized(request({}), TOKEN), false);
  });
});

describe("session cookies", () => {
  it("sets an HttpOnly, SameSite=Strict cookie holding the hash, not the token", () => {
    const cookie = sessionCookie(TOKEN);
    assert.ok(cookie.startsWith(`${TOKEN_COOKIE}=${hashToken(TOKEN)};`), cookie);
    assert.match(cookie, /; Path=\//);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; SameSite=Strict/);
    assert.match(cookie, new RegExp(`; Max-Age=${SESSION_MAX_AGE_SECONDS}$`));
    assert.equal(cookie.includes(TOKEN), false, "the secret itself must not be in the cookie");
  });

  it("clears with the same scope and Max-Age=0", () => {
    const cookie = clearedCookie();
    assert.match(cookie, new RegExp(`^${TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0$`));
  });
});
