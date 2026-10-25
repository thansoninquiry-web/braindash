import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * The built server sends the strict policy from `server/src/httpSecurity.ts`.
 * The dev server serves the HTML itself, and Vite's React refresh preamble is an
 * inline module script, so dev needs `'unsafe-inline'` for scripts and a
 * websocket origin for HMR. Everything else — framing, sniffing, referrers,
 * permissions — is the same policy, so the page behaves the same in both.
 */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const DEV_HEADERS = {
  "Content-Security-Policy": DEV_CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "microphone=(self), camera=(), geolocation=(), payment=(), usb=()",
};

/**
 * `npm run dev` stays on HTTP for the machine itself. `npm run dev:https` (mode
 * `https`) serves the same app over TLS with a generated self-signed
 * certificate, because browsers only expose the microphone and other powerful
 * APIs to a secure context — a phone opening `http://<lan-ip>:5180` is not one.
 * The proxy still targets the loopback API, and the API still refuses writes
 * from anything but loopback, so HTTPS changes the origin, not the trust model.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "https" ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5180,
    strictPort: true,
    headers: DEV_HEADERS,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5181",
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 5180,
    strictPort: true,
    headers: DEV_HEADERS,
  },
}));
