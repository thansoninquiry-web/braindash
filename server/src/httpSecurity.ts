/**
 * The response and request half of the dashboard's hardening.
 *
 * Two jobs, both deliberately independent of the token: a token is optional, so
 * an install without one still has to be safe to open in a browser. The first
 * job is the headers every answer carries — without them a hostile page can
 * frame the dashboard and put its own controls over **Delete**, or a browser can
 * sniff a note body as HTML. The second is deciding which `Host` names this API
 * answers to at all: a DNS-rebinding page resolves its own domain to
 * 127.0.0.1, becomes same-origin by the browser's reckoning, and reads the vault
 * through the default (tokenless) install.
 */
import net from "node:net";
import type { NextFunction, Request, Response } from "express";

/** Hostnames that always mean this machine. IPv6 keeps its brackets. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Deliberately `'self'` only: the app loads no third-party script, font, frame
 * or image. Two narrow exemptions are real rather than laziness: inline styles,
 * because every panel positions itself with a React `style` attribute, and
 * `blob:` media, because the imported ambient tracks play from an object URL.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The microphone stays available to this origin because voice capture asks for
 * it; everything the dashboard never uses is switched off outright.
 */
export const PERMISSIONS_POLICY =
  "microphone=(self), camera=(), geolocation=(), payment=(), usb=()";

/**
 * Applied before any route, so a JSON body, an error page and the built SPA all
 * carry the same policy. `X-Frame-Options` repeats `frame-ancestors` for
 * browsers that predate CSP level 2.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  next();
}

/**
 * Note bodies, the vault path and the note count are per-machine data. Nothing
 * under `/api` should survive in a browser's or proxy's disk cache, so the
 * freshness rule is one header rather than a per-route decision that a new
 * route can forget.
 */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  next();
}

/** Host header without its port; IPv6 literals keep their brackets. */
export function hostnameOf(hostHeader: string | undefined): string | null {
  const host = (hostHeader ?? "").trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  // Several colons mean a bare IPv6 literal (`::1`, `fe80::1`), which cannot
  // carry a port in that form; a host:port pair has exactly one.
  if ((host.match(/:/g) ?? []).length > 1) return host;
  return host.split(":")[0] || null;
}

/** `BRAINDASH_HOSTS="brainbox.local:5181, notes.lan"` → two lowercased entries. */
export function parseAllowedHosts(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Whether a Host header names this machine, a literal address, or an allowed name. */
export function isAllowedHost(
  hostHeader: string | undefined,
  extraHosts: readonly string[] = [],
): boolean {
  const name = hostnameOf(hostHeader);
  if (!name) return false;
  if (LOOPBACK_HOSTNAMES.has(name)) return true;
  // RFC 6761 reserves `.localhost`: every browser resolves it to loopback and no
  // attacker can own a name beneath it, so any suffix is this machine too.
  if (name.endsWith(".localhost")) return true;
  // A literal address cannot be a rebinding domain — the attacker's page would
  // have to be served from the victim's own address. This is also what lets a
  // phone open the LAN view at http://192.168.x.x:5180 through the Vite proxy.
  if (net.isIP(name.replace(/^\[/, "").replace(/\]$/, "")) !== 0) return true;
  // Configured entries may pin a port (`notes.lan:5181`) or allow every port of
  // a name (`notes.lan`); both are compared lowercased.
  const full = (hostHeader ?? "").trim().toLowerCase();
  return extraHosts.some((entry) => entry === name || entry === full);
}

/** Whether a Host header is a loopback name — the write gate's stricter rule. */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  const name = hostnameOf(hostHeader);
  return name !== null && LOOPBACK_HOSTNAMES.has(name);
}

/**
 * Refuses an `/api` request whose `Host` is not this machine, with the same
 * JSON error shape as every other refusal. It is not authentication: a local
 * name is still readable unless a token is set — it only closes the gap a
 * hostile web page reaches through the browser.
 */
export function hostGuard(extraHosts: readonly string[] = []) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isAllowedHost(req.headers.host, extraHosts)) {
      next();
      return;
    }
    res.status(403).json({
      error: "host_not_allowed",
      detail:
        "This dashboard only answers at a local hostname or address. Add the name to BRAINDASH_HOSTS to serve it.",
    });
  };
}
