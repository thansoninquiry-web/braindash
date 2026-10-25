# BrainDash — SPEC

Local dashboard over an Obsidian vault. No database: the vault is the source of
truth, scanned once and kept in memory until a recursive watch on the vault
directory reports a change (with a short TTL as the fallback when watching is
unavailable). Reading is always available. Editing is opt-in
(`BRAINDASH_WRITE=1`), accepted only from this machine, and never destructive:
replaced and deleted notes are moved into the vault's `.trash`.

## Location

The app lives **outside the vault** on a local disk (for example
`C:\Users\<you>\Projects\BrainDash`). Google Drive cannot host npm's
`node_modules` (concurrent writes fail with `EBADF`/`EPERM`), and a dev server
writing caches into a synced folder is noise. The only coupling to the vault is
`VAULT_PATH`, which is read-only unless writes are explicitly enabled.

## Architecture

```
braindash/
├── package.json          # npm workspaces + concurrently; `npm run dev` starts both
├── .gitattributes        # LF in every checkout, whatever core.autocrlf says
├── .editorconfig         # editors save LF and UTF-8 before Git is involved
├── .env                  # VAULT_PATH (gitignored), loaded by the server
├── docs/SPEC.md
├── server/               # Express + TypeScript (tsx watch) — port 5181
│   └── src/
│       ├── index.ts      # env loading + listen; the production entry point
│       ├── app.ts        # Express app: routes, scan cache, static build serving
│       ├── accessToken.ts # optional shared token: hashing, cookies, the gate
│       ├── life.ts       # Daily/Monthly/Weekly reader; tolerant, never throws
│       └── vault.ts      # vault scanner, frontmatter parser, guarded note writes
├── shared/               # modules both workspaces import; compiled into server/dist
│   └── wikilinks.ts      # one [[wikilink]] parser + resolver for server + dashboard
└── web/                  # React 19 + TS + Vite — port 5180
    └── src/
        ├── App.tsx       # command-center shell + CORE/LIFE navigation
        ├── life.ts       # scoring, streaks, weekly series, alerts, demo data
        ├── lifeConfig.ts # editable targets, area definitions, score bands
        ├── ambient.ts    # generated ambient engine (Web Audio, no files)
        ├── tracks.ts     # IndexedDB track store + import acceptance rules
        ├── graphLayout.ts # deterministic area-cluster layout for the graph map
    ├── cloudVoid.ts  # one-point perspective for the hall behind the core
    ├── hallDrift.ts  # pointer parallax and travel for that hall
    ├── hallLight.ts  # the hall's time-of-day levels (strips, glow, veil)
    ├── api.ts        # JSON reads, guarded writes, session unlock and lock
    ├── access.ts     # whether the dashboard may render (token gate)
    ├── sessionLock.ts # the gate's lock, offered to the header and palette
    ├── review.ts     # how late a next_review date is (due today / overdue)
    ├── notePath.ts   # typed new-note path checks (server re-validates)
    ├── components/   # StatCard, NodeCloud, CloudVoid, QuickActions, Clock,
    │                 # SearchBar, DailyRecall, NoteReader, NoteComposer,
    │                 # SettingsPanel, LifeSection, LifeSphere, AmbientDeck, FullGraph,
    │                 # AccessGate (unlock screen), ActionPanel (captures/reviews),
    │                 # TrashPanel (recoverable notes)
    ├── useVoiceInput.ts  # Web Speech API wrapper with graceful fallback
    ├── useLockAction.ts  # lock busy/error state shared by button and palette
    ├── styles.css    # dark design tokens, five accent themes
    ├── life.css      # LIFE section + section navigation
    ├── audio.css     # sound deck (header popover)
    └── graph.css     # full-screen graph overlay
```

- **Frontend** (Vite, 5180) listens on all interfaces (`server.host: true`), so a
  phone or another machine on the LAN can open `http://<host-ip>:5180`. Every
  client call is a relative `/api/*` URL and Vite proxies it to the backend on
  loopback 5181, so the browser only ever talks to one origin in dev, the Express
  API stays off the network, and no CORS configuration is needed.
- **HTTPS is a mode, not the default.** `npm run dev:https` runs Vite with
  `mode=https`, which enables `@vitejs/plugin-basic-ssl` and a generated
  self-signed certificate. Browsers give the Web Speech API and other powerful
  features only to secure contexts, and a LAN IP over HTTP is not one; the TLS
  mode makes dictation usable from a phone after its one-time certificate
  warning. The proxy target, the loopback write gate and the scan are unchanged.
- **Backend** (Express, 5181) resolves `VAULT_PATH` from `.env` (dotenv, path with
  spaces quoted), validates it exists, and scans it.
- **Writes are opt-in and local.** `BRAINDASH_WRITE=1` adds `PUT`, `POST` and
  `DELETE` for notes; without it the API is read-only and `/api/health` says so
  (`writes: false`). Even enabled, a write must arrive over loopback: a forwarded
  LAN Host header or a foreign `Origin` is refused with `403 write_forbidden`, so
  the phone-friendly dashboard stays read-only from other devices. Replaced and
  deleted notes go to `<vault>/.trash/<stamp>/<original path>`; the scanner
  already skips `.trash`, so they leave the index but stay recoverable, and the
  dashboard's trash sheet lists them and puts one back (see **Trash and restore**).
- **No database.** One scan is kept in memory and invalidated by a recursive
  `fs.watch` on the vault root, so an unattended refresh poll that sees no change
  reads no note files at all. An event anywhere below the root marks the snapshot
  dirty and the next request rescans; concurrent requests during a rescan share
  that one read. When `fs.watch` cannot be established (an unsupported recursive
  mode or a vanished root) or the watcher later errors, the cache falls back to
  the old 5 s TTL (`SCAN_CACHE_TTL_MS` in `server/src/app.ts`) so a poll still
  notices changes.
- A single `npm run dev` runs both processes via `concurrently`. `npm run build`
  compiles `server/dist` (including `shared/wikilinks.ts` and the runtime copy of
  `scripts/mode.mjs`) and emits `web/dist`. `npm start` keeps using `tsx` for
  source runs; `npm run start:built` serves the compiled entry, with
  `BRAINDASH_ROOT` pinning the repo so `.env` and `web/dist` are found from the
  deeper output layout.

### Environment

| Variable         | Default     | Meaning |
| ---------------- | ----------- | ------- |
| `VAULT_PATH`     | —           | Folder to scan; required. Quote paths with spaces and use forward slashes (`\r`, `\n`, `\t` are dotenv escapes). |
| `BRAINDASH_WRITE`| off         | `1` enables note editing, creation and trashing. Writes are loopback-only and covered by `.trash` backups. |
| `BRAINDASH_TOKEN`| unset       | Shared token required on every `/api` read when set. The dashboard asks for it once and keeps an `HttpOnly` cookie for a week; scripts may send `Authorization: Bearer`. Unset leaves the API open. |
| `BRAINDASH_PORT` | `5181`      | API port. The generic `PORT` variable is ignored on purpose because hosts may export `PORT=0`. |
| `HOST`           | `127.0.0.1` | API bind address. |
| `BRAINDASH_ROOT` | inferred    | Repo root for `.env` and `web/dist`; `start:built` and the smoke run set it because the compiled entry sits under `server/dist/server/src`. |

### Vault safety

- `VAULT_PATH` must be a directory; otherwise the API returns `503` with
  `configured: false` and the UI shows a setup hint.
- Every resolved file path is checked to stay inside `VAULT_PATH`
  (`path.relative` must not start with `..`); traversal attempts 400.
- `/api/notes/:path` does accept a path from the client, and rejects it before
  reading anything unless it is a vault-relative `.md` path that survives both a
  lexical (`path.relative`) and a symlink-aware (`fs.realpath`) containment check.
  `%2e%2e`, `..\`, absolute paths, drive letters, hidden dirs and non-`.md` files
  are all `400`; unknown notes are `404`.
- Writes repeat that containment check on the real file and, for a new note, on
  its nearest existing parent folder, so a symlinked folder cannot redirect a
  create out of the vault. Saves write a dot-prefixed temp file beside the note
  and rename over it, so a failed save leaves the previous body intact.
- A save carries the `modifiedAt` the editor opened; if the file has moved on
  since, the API answers `409 note_conflict` instead of overwriting the newer
  version. Bodies over 1,000,000 bytes are `413`; only `application/json` is
  accepted (`415`), and a create never replaces an existing file (`409
  note_exists`).
- Deleting is a move into `.trash`, not an unlink. The vault folder itself is
  never created, renamed or removed.
- Restoring is the reverse move: the bytes are written back at the note's old
  path with `wx`, so a filename that was re-used answers `409 note_exists`
  instead of being replaced, and the note keeps its own mtime. See **Trash and
  restore**.
- The client only shows write controls when `/api/health` reports `writes: true`.
  Without it the reader renders the read-only footer and no Edit, Delete or New
  note action exists to be clicked.
- No note content is committed. `VAULT_PATH` names a folder outside the checkout,
  and `.env`, `.freebuff/`, `screenshots/`, `.tmp-*/` and any `.vault/`,
  `.obsidian/`, `.trash/`, `notes/` or `inbox/` directory inside the checkout are
  gitignored. `server/test/repoHygiene.test.ts` asserts against `git ls-files`
  that no tracked path is a vault path and that `.env` stays untracked, and
  against `git check-ignore --no-index` that the rules still cover a vault copied
  into the checkout — so the guarantee is checked, not just documented.

### Trash and restore

Delete and overwrite already kept a copy under `<vault>/.trash/<stamp>/<original
path>`, and nothing read it back. `GET /api/trash` now lists it: one entry per
`.md` file with a trash-relative id (`<stamp>/<path>`), the path a restore would
write to, the note's own heading (or its filename), the move's mtime and the
size. The walk applies the scan's policy — hidden entries and symlinks are not
followed — so a link planted in the trash cannot make the list point elsewhere. A
vault that never deleted anything has no `.trash` at all, which is an empty list
rather than an error.

`POST /api/trash/restore` takes that id, re-validates it (relative, `.md`, no
`..`, no hidden or skipped folder) and repeats the containment checks on real
paths before writing the bytes back at the old path with `wx`. A note that re-used
the filename answers `409 note_exists` and the trashed copy stays put: restoring
never replaces a newer note. The note keeps its mtime (`utimes`), so the reader's
`modifiedAt` conflict check still compares like with like, and the emptied stamp
folder is pruned so the trash does not fill with shells. Listing is a read;
restoring is a write (`403 write_disabled`, `403 write_forbidden` from another
device), which is why the dashboard offers the trash tile and palette row only
where writes are on. A restore closes the sheet and opens the restored note in
the reader — keeping both open would mean two focus traps and two claims on
`Escape`.

### Access token

`BRAINDASH_TOKEN` is unset by default, which leaves the API as it was: a
single-machine install has nothing to authenticate against. Set it and every
`/api` route except `/api/session` answers `401 { error: "unauthorized" }`
without the token — including `/api/health`, which names the vault path and the
note count, so the gate covers metadata and not only note bodies.

A browser gets in through the unlock screen `web/src/components/AccessGate.tsx`
mounts around the dashboard: `GET /api/session` answers `{ required,
authenticated }`, and `POST /api/session` with `{ token }` sets an `HttpOnly`,
`SameSite=Strict` cookie for a week. The cookie holds the token's SHA-256 rather
than the token, page scripts cannot read it, and every comparison is
constant-time via `crypto.timingSafeEqual` on fixed-length digests. A cookie is
what makes the rest of the page work without special cases: `EventSource` cannot
send a header, so the mode stream would otherwise need a token in the URL.
Scripts can skip the cookie and send `Authorization: Bearer <token>`.

Ending a session is a dashboard action rather than a browser chore. Where a
token is configured, the header shows a **lock** button beside the settings gear
and the palette lists `Lock dashboard`; both call `DELETE /api/session`, which
answers with a `Max-Age=0` cookie. That answer is also the gate's next state, so
the dashboard unmounts in the same tick: the note list, the reader and every
card leave the DOM instead of sitting behind the unlock card. The control is
rendered only where it can do something — a no-token install holds no session,
so it has no button and no palette row — and a failed request keeps the button
on screen with the API's message, because a lock that did not happen must not
look like one. It clears this browser's cookie only; the token stays valid on
every other device, and the server keeps no per-session revocation list.

What is *not* protected is the app bundle itself, served by Express or by Vite:
the gate is the data. A LAN visitor without the token sees the unlock card, not
the header, note list, graph or any vault read — the dashboard component does not
mount until the session answer allows it. That keeps one implementation for both
the Vite dev server and `start:built`; there is no second server-rendered login
page to drift from it.

This is a shared secret for a trusted network, not an account system: no users,
no per-session revocation beyond clearing the cookie, no rate limiting, and over
plain HTTP the cookie crosses the LAN unencrypted. `npm run dev:https` covers the
transport, and the token should be long and random (`node -e
"console.log(require('crypto').randomBytes(24).toString('base64url'))"`). A token
shorter than 8 characters logs a warning at startup.

### Response hardening

Every response — the JSON API and the built bundle alike — carries the same
headers from `server/src/httpSecurity.ts`: a Content-Security-Policy of
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:; media-src 'self' blob:;
connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self';
frame-ancestors 'none'`, plus `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` (the same promise for browsers older than CSP 2),
`Referrer-Policy: no-referrer` and `Permissions-Policy: microphone=(self),
camera=(), geolocation=(), payment=(), usb=()`. The app loads nothing
third-party, so nothing but `'self'` is needed; the two exemptions are real —
inline styles because panels position themselves with React `style` attributes,
and `blob:` media because imported ambient tracks play from object URLs. Framing
matters most: **Delete** and **Restore** are one click away from a note, and
`frame-ancestors 'none'` is what stops a hostile page from drawing the dashboard
in an invisible iframe under its own buttons.

Every `/api` answer is `Cache-Control: no-store`, set once by a middleware before
the routes rather than by each handler, so a note body or the vault path cannot
sit in a browser's disk cache on a shared machine. Static assets keep Express's
normal cacheability.

The same `/api` middleware refuses a request whose `Host` is not this machine: a
loopback name (`localhost`, `127.0.0.1`, `::1`, any `*.localhost`), any literal
IPv4/IPv6 address, or a name listed in `BRAINDASH_HOSTS`. Anything else is
`403 host_not_allowed`, `/api/session` included, so the probe cannot be used to
fingerprint an install. This is not authentication — the token still decides who
reads — it closes DNS rebinding: a hostile page resolves its own domain to
`127.0.0.1`, becomes same-origin by the browser's reckoning and would otherwise
read a tokenless install's whole vault. Literal addresses stay allowed because a
phone opening `http://192.168.x.x:5180` sends one and no attacker can serve a
page from the victim's own address; a DNS name on the LAN needs the env var,
where a bare entry matches any port and `name:port` pins one.

The Vite dev server sends the same policy from `web/vite.config.ts`, with one
narrow difference: `script-src 'self' 'unsafe-inline'` and `connect-src 'self'
ws: wss:`, because the React refresh preamble is an inline module and HMR needs
a websocket. The built server, which serves the HTML itself, sends the strict
policy above.

### Vault model

A note is any `*.md` under `VAULT_PATH`, recursively, excluding dot-directories
and `_assets` binaries. Markdown only — `.pdf`/`.docx` are ignored. Symlinked
files and directories are **not followed**, even when the target is inside the
vault: following one would index the same note twice under two paths, and the
walk does not run a `realpath` per entry. Each link the walk meets is returned in
the scan's `skipped` array (`{ path, reason: "symlink" }`, sorted by path) and in
`/api/notes`, so a note visible in the folder but absent from the index has an
explanation. A listed `.md` file whose read fails is a different kind of absence:
it was meant to be indexed. Those files are collected in the scan's `unreadable`
array (`{ path, code }`, where `code` is the Node error such as `EACCES`,
`ENOENT` or `EISDIR`, or `UNKNOWN`), sorted by path, and served in `/api/notes`
beside `skipped`. The scan still succeeds — one locked file must not take the
rest of the vault offline — but it no longer swallows the failure silently.
Hidden entries and `SKIP_DIRS` are policy, not surprises, and are not listed.
Frontmatter is the block between leading `---` fences:

```
---
captured: 2026-10-15 7:00 PM
captured_zone: America/New_York
next_review: 2026-11-12
origin: ai | me
area: career | life | ideas
---
```

Missing/partial frontmatter is tolerated: fields become `null` and the note is
still counted. `title` falls back to the first `# heading`, then the filename slug.
`captured_zone` is optional and records the IANA zone the wall clock was written
in; an unknown or malformed zone is treated as absent, so the stamp still falls
back to the machine that wrote the vault. `next_review` is an optional
`YYYY-MM-DD` (a trailing time is accepted and dropped); it is the only input to
the review queue, and anything that is not a real date is treated as absent so a
typo can never schedule a note on an arbitrary day.

## API (all JSON; reads always unless a token is set, writes opt-in and loopback-only)

| Method | Path              | Purpose |
| ------ | ----------------- | ------- |
| GET    | `/api/session`    | `{ required, authenticated }`: whether a token is configured and whether this request presented it. The only route outside the gate, and it reveals nothing else |
| POST   | `/api/session`    | Unlock: `{ token }` sets the `HttpOnly`, `SameSite=Strict` cookie for a week (holding the token's SHA-256, not the token). `401 bad_token` otherwise |
| DELETE | `/api/session`    | Clears this browser's cookie (`Max-Age=0`) and answers `{ required, authenticated: false }`; this is what the header's lock button and the palette's `Lock dashboard` call. Other devices keep their own cookies |
| GET    | `/api/health`     | Liveness, `vaultPath`, `configured`, note count, `writes` (whether *this client* may write; false on the LAN even when enabled) and `writeScope` (`loopback` or null) |
| GET    | `/api/mode`       | Machine-local working mode from `.freebuff/working-mode`: `mode`, `source`, `stale`, `since`, `until`, `note`, the `schedule` it resolved against, `checkedAt`; `no-store`, and `200` even when `VAULT_PATH` is unset |
| GET    | `/api/mode/stream`| The same payload as `text/event-stream`: an initial `event: mode` frame, then one per real change (all fields except `checkedAt` compared), an `fs.watch` on `.freebuff/` plus a one-second re-resolve for schedule and `until` boundaries; `retry: 3000`, comment heartbeats every 20 s, `Cache-Control: no-store, no-transform`. Stays `200` with an unset `VAULT_PATH` |
| GET    | `/api/deps`       | Dependency health from the same check the CI drift job runs: `behind` (in-range), `newer`, `stale`/`majors` rows, `checkedAt`, `error`; `no-store`, `200` with `ok: false` when npm cannot answer, and `?refresh=1` runs npm instead of the 15-minute cache |
| GET    | `/api/stats`      | Totals, area/origin breakdown, 30-day capture sparkline, last capture (with its `capturedZone`), `totalBytes`, `largestNote`, and `fingerprint` (a cheap signature of the scan the unattended refresh gates on); `?tz=IANA` buckets the sparkline and `captures30d` in that zone (validated, malformed values keep the server clock) |
| GET    | `/api/notes`      | Note summaries (`path`, `title`, `captured`, `capturedZone`, `nextReview`, `origin`, `area`, `words`, `keywords`) plus `skipped` symlinks (`path`, `reason`) and `unreadable` listed notes (`path`, error `code`), both sorted |
| GET    | `/api/notes/:path`| One note, raw markdown + parsed metadata (`capturedZone` included; path validated inside vault), plus `outbound` links (`target`, `heading`, `alias`, `label`, resolved `path`/`title`) and `backlinks` resolved against the index |
| PUT    | `/api/notes/:path`| Replace a note (writes on, loopback only): `{ markdown, baseModifiedAt? }`. Answers the re-read note plus `backup` (the `.trash` copy). `409 note_conflict` when the file changed since `baseModifiedAt` |
| POST   | `/api/notes`      | Create a note: `{ path, markdown? }`; `201` with the new note, `409 note_exists` rather than replacing one |
| DELETE | `/api/notes/:path`| Move a note into `.trash`; answers `{ ok, path, trashedTo }` |
| GET    | `/api/trash`      | Everything recoverable, newest first: `trashPath` (null when nothing was deleted), `total` and `entries` (`id` = `<stamp>/<original path>`, `path`, `title`, `trashedAt`, `size`). A read: a token install can look without edit rights |
| POST   | `/api/trash/restore`| Put `{ id }` back at its old path (writes on, loopback only). Answers `201` with the restored note, `409 note_exists` when a newer note took the filename, `404 not_found` when the id is not in the trash |
| GET    | `/api/search?q=`  | Case-insensitive search of title, tags, frontmatter and body; per-hit `match`, `snippet`, `captured` and `capturedZone` |
| GET    | `/api/recall/today`| Date-seeded daily note; `?skip=n` rotates to another for the same day, `?date=YYYY-MM-DD` sets the day (validated, ignored when malformed); the pick carries `capturedZone` |
| GET    | `/api/graph`      | `nodes` (id, title, tags, area) + `edges` (`wikilink`/`tag`) built from the notes' own `[[wikilinks]]`, `isolated`, `unresolved` |
| GET    | `/api/links/broken` | The graph's `unresolved` targets grouped by the label each note wrote: `total`, `groups` (`label`, distinct `targets`, `notes` with `path`, `title`, `target`, `alias`) |
| GET    | `/api/life`       | `daily`, `monthly`, `weekly` entries read from `Daily/`, `Monthly/`, `Weekly/`; `demo` flag, folder flags, warnings. Always `200` — a missing vault is an empty snapshot |
| GET    | `/api/actions`    | The rail's server-backed actions for one day (`?tz=`, `?date=`, both validated): `date`, `timeZone`, `actions` (`id`, `label`, `count`, `hint`); `no-store`. `today` counts `/api/captures/today`, `review` counts the due part of `/api/review/queue` |
| GET    | `/api/captures/today` | Notes captured on that day, newest first: `date`, `timeZone`, `total`, `notes` (summaries with `nextReview`). Timed stamps are converted into the requested zone; a bare date keeps its written day; a note with no stamp is absent |
| GET    | `/api/review/queue` | Notes whose `next_review` is on or before the day, oldest first: `date`, `timeZone`, `total`, `overdue`, `notes`. A malformed or missing `next_review` never enters the queue |

Error shape: `{ "error": string, "detail"?: string }` with `400`, `401`, `403`,
`404`, `409`, `413`, `415`, `500`, `503`; `401 unauthorized` (any gated
route) and `401 bad_token` (the unlock POST) appear only when `BRAINDASH_TOKEN`
is set. A 500 uses the route's own code
(`vault_scan_failed`, `search_failed`, `graph_failed`, `recall_failed`,
`note_read_failed`, `note_write_failed`, `trash_failed`, `trash_restore_failed`,
`actions_failed`, `captures_failed`, `review_failed`), and the `/api/stats` 503 also carries
`configured: false`. A failed broken-link report is `broken_links_failed`. Writes
add `write_disabled` and `write_forbidden` (403), `invalid_markdown` (400),
`note_conflict`/`note_exists` (409), `note_too_large` (413) and
`unsupported_media_type` (415). An unknown `/api/*`
path or a method with no handler answers a JSON `404 { "error": "not_found" }`
even when Express is serving the built web app — the SPA fallback only owns
non-API routes. `/api/health` and `/api/stats` accept `?refresh=1`, which
invalidates the watch-backed scan cache before answering: the manual **Rescan
vault** button sends it, so a click always reads the disk even when the watcher
saw nothing. Background polls never send it.

### Search

`tags` are parsed from frontmatter in both shapes — a block list under `tags:`
and a flow list `tags: [a, b]` — trimmed, lowercased, de-duplicated. A note's
searchable text is its title, tags, raw frontmatter values and body (code fences
kept; they are often the only place a term appears). Every hit reports which
field matched, best first: `title` > `tag` > `frontmatter` > `body`, then
alphabetically by title. At most 30 hits are returned. The snippet is a window
around the first match in the body, cut on a word boundary with `…` on the side
that was trimmed; the client highlights the term in title and snippet.

### Daily recall

The pick is deterministic: `fnv1a(yyyy-mm-dd) % totalNotes`, plus `skip`, over the
index sorted by path — stable for every request in a calendar day and new
tomorrow, with no stored state. `skip` is a client-held counter, so "skip" is
reproducible on reload rather than random. The response carries the full
markdown, but the card hides it until **Reveal** — the title and tags are the
only things shown first.

### Captured timestamps

The vault records a wall clock, optionally with the zone it was written in:
`captured: 2026-10-18 3:38 PM` and `captured_zone: America/New_York`. One
formatter in `web/src/clock.ts` turns that into text for every surface that shows
it — the reader's metadata strip, search hits, the daily-recall stamp and the
index-trail date (`formatCapturedStamp` / `formatCapturedDay`):

- **With a time**, the value is read in the note's own `captured_zone` when it
  records one, otherwise in the machine's zone (`recordedZone`, the system zone by
  default), and displayed in the zone chosen in Settings, with that zone's real
  abbreviation and the chosen hour cycle: `Oct 18, 2026 · 3:38 PM EDT` becomes
  `Oct 19, 2026 · 4:38 AM GMT+9` in Tokyo. `zonedInstant` solves the offset in two
  passes so the hour either side of a DST change lands correctly. The recording
  zone travels with the note: `/api/notes`, the reader, search hits, the recall
  pick and the index trail all carry `capturedZone`, and a malformed field is
  treated as absent rather than dropping the stamp. The reader names that zone
  beside the converted stamp (`3:38 PM EDT · America/New_York`), so the conversion
  has a visible origin; `capturedZoneLabel` returns it only for a timed stamp whose
  note recorded one, and the label stays even when the chosen zone matches. The
  index trail prints that origin on a second line inside the row (`captured in
  America/New_York`), so the converted day explains itself while tabbing and is
  read as part of the row's name instead of appearing only in the hover tooltip
  (`trailTooltip`, which keeps the same fact for pointer users).
- **Date only**, the stamp is a calendar fact rather than an instant, so it is
  formatted at noon UTC and keeps the day it was written on in any zone. Otherwise
  a bare `2026-10-18` would drift to the 17th in Honolulu.
- **Unparseable** values return `null` and each caller falls back to its own text
  (`undated`, `no captured date`), so a hand-written stamp is never swallowed. The
  original string stays on the element's `title` attribute.

The `modifiedAt` footer stamp is a true instant and already formats through the
same zone and hour cycle.

**The capture counts use the same day.** The 30-day sparkline, its total and the
`+N today` delta are bucketed in `web/src/clock.ts` (`buildCaptureSeries`, via
`capturedDayKey`) from the note index the dashboard already holds. The window ends
on `zoneDayKey()`, so in Honolulu it ends on the 18th while New York's ends on the
19th; a timed capture is first read in its note's `captured_zone` (or the machine
zone), then counted on the day that instant falls on in the selected zone, and a
date-only capture keeps its written day. The trail is ordered by the same
converted instants, not by the raw strings. `/api/stats` accepts the same zone as
`?tz=IANA` and buckets `series`/`captures30d` there (`captureSeries`), so its
response is a correct fallback before `/api/notes` arrives rather than a
server-local view. The client sends `activeTimeZone()` on every stats request and
re-fetches once when the zone changes; `resolveTimeZone` validates the parameter,
and a missing or malformed zone keeps the historical server clock. The client
memo is keyed on the zone's calendar day as well as the clock, checked every 30
seconds, so a dashboard left open past midnight re-buckets instead of keeping
yesterday's window; the unattended stats check compares the series before its
fingerprint early-return and repaints the cards when the window moved without the
vault changing.

**The day belongs to the reader, not the server.** The client sends
`?date=YYYY-MM-DD` from `zoneDayKey()` (`web/src/clock.ts`), the calendar day in
the zone chosen in Settings, with `""` meaning the system zone. `resolveRecallDate()`
on the server accepts only a real date — month 13, February 30th and a year zero
all fall back to `localDayKey()` — so a malformed query can never seed an empty
bucket, and a script that sends no date behaves as before. The card's date tag
shows the zone's day (`2026-10-18`), which is also what the server echoes back.
Consequences: at 23:30 in New York with Tokyo selected, recall is already on
tomorrow's note, matching the header clock; switching zones re-seeds the pick and
resets `skip`; and a dashboard left open across the zone's midnight changes notes
without a reload (the card polls the day every 30 seconds).

### Graph

Nodes are every indexed note (the cloud displays at most 160, busiest first).
An edge exists when note A's body contains a `[[wikilink]]` that resolves to note
B — by title, filename slug or path, case-insensitively — or when A and B share a
normalised tag. Wikilink edges keep their direction; tag edges are unordered.
A pair that is both is drawn once, as a wikilink edge, and self-links are dropped.
Wikilink targets that resolve to nothing go into `unresolved` instead of becoming
edges or crashing; a note with no edges is listed in `isolated` and renders as a
dimmer, smaller node. `truncated` flags the 600 edge safety cap on shared-tag
pairs, so a huge vault cannot explode the response.

Note summaries carry `keywords`: the six most frequent tokens of the body (length
≥ 4, stopwords and code fences removed), ranked by count then alphabetically so a
rescan of an unchanged vault yields an identical index.

`/api/notes/:path` takes a vault-relative POSIX path and resolves it before any
read: absolute paths, `..`, hidden directories (`_assets`, `.obsidian`, …) and
non-`.md` targets are `400`; a missing note is `404`. `fs.realpath` plus
`path.relative` on both the target and the vault root means a symlink cannot be
used to read outside the vault: a link that resolves elsewhere is `400
invalid_path`, a dangling link is `404` (the resolved read fails, not the
containment check), and a link that stays inside reads normally under its real
path. All read paths stay in the vault; nothing in this project ever writes to it.

### Broken links

`/api/links/broken` reads the same scan and resolver as `/api/graph`, then groups
`unresolved` targets by the label the note wrote — the alias after `|` when one
exists, otherwise the bare target. Labels are folded case-insensitively for the
grouping (two spellings of the same word are one heading, named by the first
spelling the scan reaches) while `targets` keeps every distinct written target,
so two notes that misspell the same idea the same way share a group and one
target written under two aliases appears in both. Notes are sorted by title then
path, and groups by note count then label, because the report is a repair queue:
the label the most notes got wrong comes first. `total` counts one per note ×
target, matching the scan's one-entry-per-target rule, so a note repeating the
same target cannot inflate the number. Every target reported is guaranteed to be
in the graph's `unresolved` list and a resolving link can never appear; a unit
test and the API suite both assert that union rather than restating it.

The dashboard's **Link health** card in the right rail shows the count, the first
three labels with their note counts and when the check last ran, and opens a
report dialog. Each group lists its unresolved targets as `[[target]]` chips and
one row per note — title, the exact link the note wrote (`[[target|alias]]`) and
its path — and a row opens that note in the reader. The card and the dialog read
the endpoint on mount, whenever a poll sees a new vault fingerprint and on a
manual **Rescan vault** (the same `vaultVersion` the recall card follows), and
the dialog is read-only: it never rewrites a note. Empty means every wikilink resolves; a failed read leaves
the reason in the card instead of replacing the dashboard with an error.

### Life data

The life section reads three sibling folders under `VAULT_PATH`, each a set of
markdown notes with YAML frontmatter: `Daily/YYYY-MM-DD.md`, `Monthly/YYYY-MM.md`
and `Weekly/YYYY-Www.md`. The reader never throws: a missing folder, unreadable
file or absent field becomes empty data, and the response carries folder flags and
up to eight non-fatal warnings. Files whose name starts with `_` (the templates)
are ignored, and their bodies are never parsed as data.

Numeric fields tolerate `$1,200`, `1 200` and `1200`; percent fields accept `24%`
and `0.24` as the same 24. `workout` accepts `true`/`yes`/`1` and treats anything
else as false. Weekly ratings clamp to 1–10. Daily notes are dated by filename
(falling back to a `date:` field), monthly by filename, weekly from the ISO week in
the filename.

Scoring lives in the client (`web/src/life.ts`) against targets in
`web/src/lifeConfig.ts`: each metric scores `min(value / target, 1)`, flipped for
lower-is-better metrics (credit utilization, spend), averaged across an area's
metrics and the seven days ending today, then shown 0–100. A missing daily field
scores zero; a missing monthly field is skipped rather than counted as a failure.
Areas: **Health** (sleep, energy, workout), **Money** (net revenue daily; net worth,
credit score, utilization, savings rate monthly), **Business** (outreach,
applications, any positive revenue), **Learning** (study hours), **Focus** (deep
work hours), **Relationships** (the weekly self-rating only, ×10) and **Habits**
(workout + win logged per day). The overall score is the mean of the seven. Streaks
count consecutive calendar days (workout, study hours > 0, a non-empty `win`),
remembering the best run; a missing today does not break a streak until the day is
over. Alerts fire when an area's weekly rating falls two weeks running or its
7-day score is under 40. Weekly ratings are charted for the last eight weeks. When
all three folders are empty the client substitutes deterministic demo data and
shows a **DEMO DATA** badge; nothing is written to the vault.

## Design — "command center"

Near-black canvas, one accent per theme, faint grid, monospace small-caps
labels. Three columns on desktop, stacked on narrow screens.

Design tokens (orange default): `--bg #040507`, `--panel #0a0d10`, `--line #1d2226`,
`--accent #ff8a3d`, `--accent-bright #ffb877`, `--accent-dim #b6682c`, `--text`
near-white, `--muted` grey; fonts `IBM Plex Mono` (labels, figures) and system sans for
prose. `--accent`, `--accent-rgb` and every node colour are written onto
`<html>` by `themes.ts`, so a theme swap repaints chrome, glows, sparklines and
the cloud in one pass. Five accents ship: orange (default), jarvis, amber,
crimson, ice; node areas keep three distinguishable shades within each. The core
renders no literal colour at all: area dots, the spark field, the untagged-node
fallback and the dashed shared-tag edges all resolve through these tokens.

1. **Header bar** — wordmark `BRAINDASH` with milestone tag, vault status dot, segmented
   accent pills, settings button, live clock top right (12-hour by default,
   `6:30:05 PM`, switchable to `18:30:05`, ticking every second, monospace, accent
   colour, with the zone abbreviation under the date). Beside the icons sits the
   **working-mode badge** — a dot, `WORK` or `HOME`, and how it was decided
   (`manual`, `auto`, `stale`) — reading `/api/mode`. It is a disclosure, not a
   mode switch: the mode is switched with `npm run mode`, which also writes the
   switch log. Opening it shows the full reason in the clock's own zone (`since`,
   `until`, note, and what the weekly schedule alone would answer; with no override
   it names the schedule), a **Notices** switch that mirrors Settings, and any
   flips collected while those notices were muted (see the notice paragraph). A
   failed read shows a dashed `MODE` badge instead of a banner. The first answer comes from `/api/mode`; from then on the
   dashboard keeps `/api/mode/stream` open, so a flip caused by `npm run mode` is
   pushed within a second, and the server's own re-resolve catches a schedule
   boundary or an expiring override. A one-minute poll and a refocus fetch remain
   as fallbacks for a browser without `EventSource` and for a stream that stays
   down; both are independent of the vault refresh cadence. The same payload sets the browser
   tab identity: the title leads with the mode and carries its provenance —
   `Work (manual) · BrainDash`, `Home (stale) · BrainDash`, `Work (auto) ·
   BrainDash` — so a truncated unfocused tab keeps both the answer and the reason
   (`Work (manual) · Bra…`). The favicon is an inline SVG data URL with a filled
   tile, a large **W** or **H** (orange or teal) and a small provenance mark in the
   top-right corner: a filled dot for a by-hand override, a hollow ring for one
   that lapsed back to the schedule, and nothing for the ordinary scheduled case,
   so the letter stays uncluttered. Before `/api/mode` answers it stays a neutral
   **B** on grey with no mark — "no answer yet" is not "set automatically" —
   backed by `web/public/favicon.svg` until React mounts. Letter, fill and mark
   shape each carry their own information, so none of it depends on colour, and
   the generated icon needs no extra route or asset request. `tabIdentity` derives
   all of it from the same payload as the header badge, so the two cannot
   disagree; the App keys its DOM write on the mode and source, so a poll that
   changes nothing does not rewrite the title and favicon every minute. A mode flip after the first answer also raises a short notice
   pinned to the bottom of the viewport: `Working mode: Work` or `Home`, the
   `manual` / `auto` / `stale` source, and one sentence about what changed. It is
   anchored low because the top strip is where the accent switch, the mode badge
   and the settings button live: a nine-second overlay there would sit on top of
   controls, while the bottom only ever covers the footer line.
   `role="status"` with
   `aria-live="polite"` announces it to assistive technology, a close button
   dismisses it, and it clears itself after nine seconds. The timer does not run
   while the document is hidden, so a flip that happens behind another window is
   still readable on return. A **Mute** button beside the close sets a
   session-scoped silence (`web/src/modeNoticeMute.ts`, `sessionStorage`): the
   open tab stops announcing flips, a reload of that tab keeps the choice, and a
   new window starts with notices on again because a mode change is worth seeing
   once. Settings carries the same switch as a Shown/Muted radiogroup, and the
   badge's own panel carries it too, so the silence is reversible without
   reopening devtools. A muted tab does not drop the flip: `modeChangeNotice`
   still names the new mode and reason, and that notice plus the payload's
   `checkedAt` is prepended to a capped backlog in
   `web/src/modeNoticeHistory.ts`. The badge summary grows a small `↺ N` count;
   the panel lists the backlog newest first, up to three changes, each with the
   mode, its `manual`/`auto`/`stale` source, the time formatted in the clock's
   zone, and the same behaviour/reason sentence a notice would have used. A
   **Clear** button empties the backlog. The list lives in `sessionStorage` under
   its own key, so the mute and the flips it hid share one per-tab lifetime and a
   reload keeps both; records are shape-checked on read so a malformed or older
   value cannot break the header, and unmuting leaves the backlog in place until
   it is cleared (nothing is replayed as a notice). The badge's polite live region
   is a separate visually hidden element, so opening the history does not
   re-announce the mode. Blocked storage degrades to the mounted state rather
   than throwing. Source-only changes and a failed `/api/mode` read are not
   treated as mode changes.

   The **status strip** beneath the header is the scan's own readout: a dot for
   the core's state, `Vault connected`/`offline`, note and word counts, the
   resolved vault path and the `Synced` stamp. When the walk skipped entries it
   also carries `N symlinks skipped` — and nothing at all at zero, because the
   row exists to explain why a note visible in the folder is absent from the
   index, not to report an empty category. Its hover tooltip (`title`) lists
   every skipped path one per line under `Symlinks are never followed (N):`, and
   the same strings are exposed via `aria-label` with line breaks flattened so a
   screen reader hears the list. The paths come from the `skipped` array of the
   same `/api/notes` response that produced the note count, so the two cannot
   disagree; `skippedLabel` and `skippedTooltip` in `web/src/skipped.ts` build the
   copy, and the "hidden at zero" rule is unit-tested rather than left to a JSX
   condition. Notes whose read failed get a second row from the same response:
   `N notes unreadable`, in the failure colour rather than the accent, because a
   gap in the index is not a policy choice. Its tooltip lists every path with the
   failure in plain language and the raw code — `permission denied (EACCES)`,
   `vanished before it could be read (ENOENT)` — and is exposed through
   `aria-label` with the newlines flattened. `web/src/unreadable.ts` owns that copy
   and the code-to-language map, so an unrecognised code still shows itself instead
   of being rounded to "error".

2. **Search bar** — full-width under the status strip. Debounced query against
   `/api/search`, results grouped as an overlay list: title, capture date, the
   field that matched, and a snippet with the term highlighted. A hit whose note
   recorded a `captured_zone` prints that IANA name under the converted date, in
   the same hairline mono as the reader, so a stamp converted into the chosen
   clock zone still says where it was written. `↑`/`↓` move through hits,
   `Enter` opens one in the reader, `Escape` closes. The mic button
   dictates into the same box via the Web Speech API (`SpeechRecognition` /
   `webkitSpeechRecognition`): unsupported browsers, denied microphone permission
   and no-speech all surface as a short inline message instead of a dead button,
   and each blocked state names the way out — a browser with no recognition API
   points at the keyboard's own dictation key, a refused permission at site
   settings. A **non-secure context** is its own state: a phone on
   `http://<lan-ip>:5180` never gets a mic prompt, so the button reads `HTTPS`,
   is disabled, and the line says the address must be `https://` (or
   `localhost`) — served by `npm run dev:https` — while the keyboard's mic keeps
   working, rather than blaming a permission the person never saw.
3. **Left rail — stat cards.** 3–4 cards, each: small-caps label, big figure,
   delta/caption, and an inline SVG sparkline: Notes indexed, Captures (30d),
   Word volume,   Vault size, and the vault's area mix as a meter. Vault size is the
   sum of the `.md` byte lengths read during the scan (not a recursive `du` of the
   folder), shown as total, average per note, and the largest note — which opens
   that note when clicked. The rail reads as live tracking rather than a static
   report: every row carries a clipping-layer sweep of accent light that crosses it
   on a 7.2 s beat, delayed 0.34 s per card so one band travels down the four rows;
   the header's `Vault data` tag gains a small beating lamp (quiet when automatic
   refresh is off); and each figure is keyed by its own text, so a poll that really
   changed it remounts the node and replays a short rise-and-flash, while an
   unchanged figure never moves. Each sparkline draws itself once, left to right,
   when its data arrives (`pathLength="1"`, so no JS measures the line), and its
   newest bucket keeps a slow pulse; a poll that returns the same shape never
   restarts the draw, because the SVG is not remounted. All of it is gated by
   `.is-animated` — the app's motion choice, not a second setting of its own.
   Search hits arrive in a short cascade, their delay capped after the tenth row so
   a long result list still settles
   quickly.
4. **Center — vault core.** A spiral galaxy rather than a flat diagram or a
   uniform ball, per `docs/reference/jarvis.png` and
   `docs/reference/core-galaxy.png`. One glowing node per indexed note sits on a
   projected 3D disk wound into four logarithmic arms (`web/src/galaxy.ts`),
   nearly face-on (resting pitch 0.9 rad) so both arms stay readable. The dust is
   three populations — a dense bulge, arm dust that widens with radius, and a
   faint field between the arms — plus ~900 soft gas blobs under the sharp stars,
   which is what gives an arm a body instead of a beaded edge. `galaxyStars` and
   `galaxyHaze` are pure and seeded, so a rescan never reshuffles the sky. The
   stars are intentionally neutral (`--star`) while the gas takes the accent: the
   theme colours the room, not the galaxy. The disk is drawn in its **own SVG
   layer** with a single CSS transform per frame (`scale(zoom, zoom·tilt)
   rotate(yaw)`), so thousands of stars are composited instead of repainted —
   measured ~31 → ~105 fps in headless Chrome at 10,246 circles, mean frame 9.5 ms
   — while the notes'
   per-frame attribute writes stay on the small SVG above it. Its viewBox is the
   frame's own pixel size (measured with a `ResizeObserver`), and the disk radius
   is clamped to the room it has, so a wide window gets a wide galaxy rather than
   a letterboxed drawing. Each node is a white core falling off through its area
   colour to nothing (a radial gradient, not a per-frame `feGaussianBlur`), and
   the core is a hot white knot with a gas wash around it. It hangs in an
   **empty hall**: a one-point-perspective room drawn behind the disk
   (`web/src/cloudVoid.ts`,
   `web/src/components/CloudVoid.tsx`) from one vanishing point on the horizon —
   four planes (roof, two side walls, floor), a cross-seam grid on the roof and
   floor whose spacing is harmonic in depth so the panels crowd toward the
   horizon, upright wall seams, ceiling panels that brighten toward the far end,
   a lit floor sheen widening toward the viewer, and a dark doorway at the end.
   Every guide ends on that doorway's edge, so the room can never come apart. The
   layer is decorative (`aria-hidden`), sits under the sphere with
   `pointer-events: none`, and is faded into the page at all four edges by a CSS
   overlay, so it reads as open space instead of a framed picture. The hall is
   not frozen, though: as the pointer moves, the sphere's near face swings one
   way and the hall slides the other, on the same eased pointer value
   (`web/src/hallDrift.ts`, 16 px across and 10 px down at full deflection,
   clamped at the frame edge), so the two layers separate and the room reads as
   distance rather than a backdrop. The layer carries a 20 px bleed under the frame
   (`inset: -20px`), wider than the travel, so a translated edge can never
   uncover the frame behind it; with motion off the hall returns to centre.
   The room also keeps the hour (`web/src/hallLight.ts`): the ceiling strips,
   the doorway glow and the floor sheen are scaled by a smoothstep curve over
   this device's local wall clock — night until 05:00, lifting through dawn to
   07:00, full by day, dimming from 18:00 and dark again at 21:00 — with the
   strips down to 28% and the doorway to 50% at the darkest hour, so the door
   stays the brightest thing in the room. A black veil over every layer adds
   the last 16% at night, which is what makes the whole hall, not just its
   lamps, read as unlit. The sample is local on purpose: the Settings zone is a
   display preference for note dates, while the hall is the room the screen is
   in. `HallScene` takes the lighting as a prop and the default export resamples
   it every 30 s, so the change is gradual enough that no single tick is
   visible; nothing else in the stage moves.
   Apart from that drift the stage is still; only the notes move — and the
   core's heartbeat. The bulge breathes, an
   ambient ring expands every 4.6 s while the core is idle (the same `pulseFrame`
   as a scan, at a quarter of the alpha), and a crest travels outward through the
   notes with a 2.4 rad radial delay, lifting and brightening each as it arrives,
   while the links shimmer faintly. With motion off the still frame has none of it;
   a scan's ring stays faster and brighter than the heartbeat. A note the scan has
   just found, rather than a scan itself, gets its own arrival: it starts at the
   bulge and flies out to its slot — scaling the disk coordinates keeps its angle,
   so the flight runs along its assigned arm — while a ring in its area colour
   expands from its dot and fades (`web/src/newNotes.ts`, 1.6 s, ease-out with a
   squared spark). The detection compares the path set of the last graph with the
   new one, so a rescan that only reordered or relinked notes flares nothing;
   paths are compared rather than indices because the connectivity-ordered layout
   reshuffles slots. At most eight arrivals flare: a bulk import or a vault switch
   is a rescan, and the first real graph after mount is only a baseline. The
   flare is skipped entirely with motion off, so the still frame stays still. Each note also drifts on its own slow sine of
   ±5.4 units vertically and ±2.6 across, independent of the sphere's rotation,
   and a soft ellipse of accent light pools on the floor below the disk: the
   levitation cues. Nodes are projected in 3D with slow yaw, gentle pitch and
   depth-scaled size and opacity, and the dust takes a fraction of the notes'
   rotation (`sparkPose`, 0.35 of the yaw and of the varying pitch), so the idle
   drift and the pointer tilt slide it more slowly: the pale field reads as a
   layer behind the nodes rather than a second shell. The disk tilts toward the
   pointer for parallax. Hovering a node lifts it and swaps the
   title beneath the core for that note. That label is a **fixed slot** — two title
   lines and two caption lines, always — because the sphere is a flex sibling: a
   title long enough to wrap to a third line would shrink the frame and shift every
   node under the pointer. Instead the title steps down through sizes
   (`web/src/cloudLabel.ts`, 30 px to a 13 px floor) until it fits two lines, and is
   clamped with the full name in its tooltip past that. The fit measures **real glyph
   advances** (`web/src/cloudTitleMetrics.ts`) with a canvas using the heading's own
   font, weight, `text-transform`, tracking and first-line indent, instead of
   assuming an em per character; `--cloud-title-tracking` and
   `--cloud-title-indent` stay authored as lengths in `styles.css` so they can be
   resolved against each candidate size. Wrapping is still modelled greedily at
   whitespace, hyphen and dash break points, with `overflow-wrap: anywhere` inside a
   word that cannot fill a line. The slot is measured with a `ResizeObserver` on the
   column, so the fitting follows the rails, the window and the responsive
   breakpoints, and `document.fonts` triggers a re-measure once a webfont has
   loaded. Clicking a node **frames its cluster**:
   the camera eases until that note faces the camera (yaw takes the short way
   round, pitch is clamped, and the residual is recomputed every frame so pointer
   parallax and the idle drift are compensated rather than fought), the zoom
   nudges in to 1.12x, the note and its direct wikilink/tag neighbours stay lit
   while every other node fades, and the edges inside the cluster brighten. An
   **Open “Title”** button appears under the core; clicking the same node again
   opens the note. The Open and **Motion paused** buttons share one 22 px action
   row that is reserved even when empty, so selecting a cluster cannot change the
   frame's height and shrink the sphere; when both are present they sit side by
   side, and a long label ellipsises inside the row rather than widening it.
   Clicking empty space or `Escape` releases the focus and
   restores the zoom that was pulled in. While the vault is scanning or a note is
   reading, the core pulses — one accent ring expands from 0.94x to 1.30x the
   sphere radius and fades, the nodes breathe together, and the ring is held for
   1.1 s after a fast local scan so the pulse is actually seen. The pulse obeys
   the motion setting; a still core does not animate it. The sphere is
   also directly manipulable: dragging turns it (yaw and pitch, pitch clamped to
   ±1.15 rad). A release does not stop wherever the flick happened to end: the
   pointer's angular velocity seeds a critically damped spring (`settleStep`) that
   lands on the nearest note-facing pose (`nearestPose`), so the sphere comes to
   rest with a note centred instead of at an arbitrary angle. The landing then
   holds for 0.9 s: `advanceAmbient` withholds that much ambient time, so the pose
   stays exactly where the spring left it and the centred note can be read before
   the drift resumes. The focus slot names that note from the release onward — its
   title, with `Settled · path` beneath — so a centred dot reads as a note rather
   than an anonymous spark; hovering another note still takes the label, and a new
   drag, a click or `R` clears it. Precedence lives in `cloudFocusIndex`: hover,
   then the landed note, then a clicked cluster, then the keyboard cursor. A
   landing also drops an older clicked cluster and restores the zoom it pulled in,
   so the name in the slot and any Open button cannot disagree. A new
   drag or `R` cancels the hold too, and the withheld time is kept as an offset, so
   the drift picks up from the held pose instead of jumping forward by the beat.
   Notes whose facing
   pitch is past the tilt limit cannot be centred, so they are only candidates when
   nothing else exists (a two-note vault sits on the poles); the pose then faces one
   with the pitch parked on the clamp. The inherited velocity is capped so a flick
   cannot become a carousel, and the settle gives up after 1.1 s in case a clamp
   stalls it. With motion off, the
   same settle runs on its own frames because the main loop is not running.
   Dragging past a 5 px
   threshold suppresses the click that follows, so a rotate never opens a note it
   happens to end on. The wheel (and `+`/`-`) zooms between 0.55x and 2.6x about
   the sphere's centre — dot radii grow with `sqrt(zoom)` so the ball stays
   coherent — and `R`/`0` snaps back to the default pose. The wheel listener is
   native and non-passive so it can `preventDefault` the page scroll. Pointer
   capture is taken only once a gesture passes the drag threshold: capturing on
   press retargets the following `click` to the SVG, so a plain press on a node
   would never open it. Pointer focus paints no outline at all (Chrome's default
   `auto` ring draws a bright box around the whole SVG); the accent
   `:focus-visible` ring is for keyboard focus only. The core is a
   single tab stop: arrow keys move a cursor (which overrides a resting hover and
   releases a click focus),
   `Enter` opens the framed or cursor note, `Escape` clears both the cursor and
   the cluster focus, and the open note's node keeps an accent ring. Positions are written straight to the SVG elements in a
   `requestAnimationFrame` loop, so React never re-renders per frame; the frame's
   `cx`/`cy`/`r`/`opacity` are not props for exactly this reason. When motion is
   off, the loop never starts: one frame is painted and re-painted on hover or
   cursor changes, so the core stays fully interactive. Motion defaults to the OS
   `prefers-reduced-motion` setting and is overridden by the local preference
   (System / On / Off). Each dot also carries an invisible ~27 px hit disc, because
   the visible dot is only 3–8 px on screen. Before the index arrives it falls back
   to a synthetic sphere whose nodes open nothing. Edges are the graph's real
   `wikilink`/`tag` pairs. Hovering swaps the core title for the note, brightens the
   node via CSS (so it still works on the reduced-motion still frame) and lifts its
   incident edges inside the draw loop.
5. **Right rail — daily recall, then quick actions, then link health and dependency health.** The
   recall card leads with the day's title and tags, then **Reveal** (full body +
   capture date, with the note's recorded zone named beside the converted stamp)
   and **Skip** (`skip + 1`). Below it: Open random note, Full graph,
   Today's captures, Review queue, Rescan, Copy vault path. The two data-bearing
   tiles carry a live count from `/api/actions` and open a sheet listing the day's
   captures or the notes due for review; a row opens the reader. Last is the
   **dependency health** card: how many lockfile entries are behind a range
   `package.json` already allows, up to three of them as `name current → wanted`, a
   line when newer majors exist outside the declared ranges, and when the check ran
   beside a **Recheck** button. It reads `/api/deps`, which runs the same
   `check-deps.mjs` comparison as the weekly CI job and caches the answer for 15
   minutes (a failure for one), so the card and the drift issue can never disagree
   about what counts as behind. It loads independently of the vault cards — an npm
   registry round trip must not delay the notes — and a failed check stays in the
   card as a one-line reason instead of raising the vault-offline banner. The
   **link health** card above it reads `/api/links/broken` and counts the graph's
   unresolved wikilinks, previews up to three labels, and opens the grouped
   report described under [Broken links](#broken-links).
6. **Footer** — write-mode notice (read-only, or editing enabled on this machine),
   note count, cache age.
7. **Settings overlay** — right-side dialog opened by the header button. Holds a
   **Theme source** radiogroup (Auto / Manual) captioned with the signal Auto used
   and the palette it landed on, the accent picker (five swatch cards,
   `role="radiogroup"`; each card's strip previews five bands of the palette it
   would paint — accent, bright, dim, untagged node and spark field — so a card
   shows what the core actually renders, dark untagged shade included. Every card
   also carries a visually hidden sentence naming each band and its hex value, so
   the preview is not visual-only), a **Clock**
section
   (IANA time-zone select with a System option, plus a 12/24-hour radiogroup) and a
   **Vault refresh** radiogroup (Every minute / Every 5 minutes / Off) and a
   **Cloud motion** radiogroup (System / On / Off). Clock choices persist as
   `braindash.timeZone` / `braindash.hour12`, motion as `braindash.motion` and the
   refresh cadence as `braindash.refresh`; closes on
   scrim click or `Escape`, returns focus to the trigger.
8. **Reader** — full-height centred dialog with metadata (captured time in the
   chosen zone with the note's recorded zone beside it, the note's size on disk),
   rendered markdown and working wikilinks, with focus trapping and `Escape` to
   close. Index-trail rows quote the same size and the same zone-aware date, so
   both are visible before opening it. When writes are enabled it also carries
   **Edit** (raw-markdown textarea, Save/Cancel, unsaved-changes guard) and
   **Delete** (a two-step `Move to .trash` confirmation). Saves send the
   `modifiedAt` the reader opened, so an external edit is a visible conflict
   instead of a silent overwrite; a successful save replaces the note in place
   without a loading flash. **New note** lives in Quick access and opens the same
   panel with a path field and a starter draft.
9. **Full graph** — the `Full graph` tile opens a full-screen, non-scrolling map
   dialog (z-index above the dashboard, body scroll frozen while open) with its own
   pan/zoom state, edge focus and a click-through to the reader. See below.
10. **Command palette** — `⌘K` / `Ctrl+K`, or the small key cap beside the settings
    gear, opens a launcher over the dashboard: the commands that can run right now,
    plus note hits from the same `/api/search` index the header uses. Typing filters
    both, ↑/↓ move, Enter runs, `Escape` closes and focus returns where it was. See
    below.

### Full graph

`web/src/graphLayout.ts` places each note once, deterministically: notes are grouped
by area into fixed corners (career top, life right, ideas bottom, untagged left) and
spiralled outward by golden angle with hubs nearest the centre. No simulation and no
randomness, so the map is identical on every poll and a user's pan survives the
five-second refresh. The first open (and the `⤢` button, or `0`) fits the whole
layout into the canvas; after that the view is the user's. It has a heartbeat, all
CSS and no frame loop: each node's halo breathes on a delay from its index, and
once every 4.6 s one faint ring expands from the middle while every note answers
with a small ring and a brief lift of its dot. The delays are not index-based for
that wave — `web/src/graphPulse.ts` measures each note's distance from the
bounding-box centre over the ring's reach, so the crest travels outward through
the field and a note near the rim answers last. Hovering a node shortens its
halo's period instead of freezing it, and a focused shared-tag edge crawls its
own dashes (solid wikilinks stay still), so the two link kinds read differently.
With cloud motion off every one of these stops; a still map is still fully
interactive.

Interaction is split between pointer and keyboard on purpose:

- **Pan** from empty canvas only, so a click on a note is never a failed drag; the
  pointer is captured and the delta converted with `getScreenCTM`, which keeps the
  drag exactly 1:1 with the pointer at any zoom.
- **Zoom** with the wheel (non-passive listener, anchored on the cursor so the point
  under it stays put) or the `+`/`-` buttons and keys, clamped to 0.3×–4×; the
  current scale shows beside the controls.
- **Edge focus** on hover or keyboard focus: the edge, its two notes and the chip
  naming the pair (`A → B · wikilink`, or `A — B · shared tag`) stay lit, every other
  edge and note dims. Because Chromium does not reliably emit focus events for SVG
  shapes, `E`/`Shift+E` steps through edges from anywhere in the dialog — that is the
  guaranteed keyboard route, with the hit lines still tabbable where it works.
- **Node hover** lights that note's edges and labels the note plus its neighbours;
  clicking opens the note in the reader and closes the map.

The header carries counts (notes, edges, isolated, and whether tag edges were
truncated by the server cap) and a per-area legend; `Escape` closes and returns
focus to the tile that opened it. The map is client-side only — the same
`/api/graph` payload the sphere uses, with no extra request.

Glow is layered `box-shadow`/`filter: drop-shadow` in the accent colour at low
opacity; no neon cyan/purple or green.

### Command palette

`⌘K` / `Ctrl+K` (or the `⌘K` key cap in the header) opens a spotlight-style
launcher; the shortcut does nothing while another dialog is open, because two
modals would mean two focus traps and two claims on `Escape`. The panel is a
`role="dialog"` with a combobox input that keeps focus: arrow keys move an
`aria-activedescendant` over the rows, Enter runs the selected one, `Escape` and
the scrim close it, and focus returns to whatever opened it.

The command list is data, not a menu written out in JSX: `web/src/palette.ts`
builds it from live dashboard state, so `Today's captures` and `Review queue`
carry the counts `/api/actions` just returned, `New note` appears only when
writes are on, and `Open full graph` only once the graph has answered. The
commands are Rescan, Today's captures, Review queue, Open a random note, the full
graph, New note, Settings, the Core/Life sections, and — on a token install —
`Lock dashboard`; each one calls the same handler its button in the rail or
header calls, so the two cannot drift. The lock is last on purpose: the first
Enter on an empty palette must not be the row that ends the session.

Typing above an empty box searches notes through `/api/search` with the same
180 ms debounce as the header search; a hit is a row labelled with the note's
title and path, and running it opens the reader. Commands stay above note hits,
and a typed query caps each group (nine commands, six notes) so a long search
cannot push every command off the list. An empty query is a menu, not a search:
it lists every command the status line counts, so a tenth command (the lock) is
not the row a cap would hide. Matching is case- and spacing-insensitive and ranked: an exact
label beats a prefix, a prefix beats a word start, a word start beats a substring,
and a scattered subsequence (letters in order) is last — but that fuzzy run only
applies to a command's label or keywords, never its hint line, where it would
pull unrelated rows into the list. A note hit is not itself scored against
commands: the two groups are ranked separately and concatenated, because acting
is what the palette is for.

### Unattended refresh

The intended deployment is a dashboard left open for hours, so it re-checks the
vault on its own. The cadence is a local preference (Settings → **Vault refresh**:
every minute — the default — every five minutes, or off) and the check is cheap and
change-gated: the client polls `/api/stats`, whose payload carries `fingerprint`, a
signature of the scan built from every note's path, size, title, frontmatter fields
(including `captured_zone`) and body keywords. When the fingerprint is unchanged
the poll ends there — one small request, no file reads (the server answers from
the watch-backed cache), no state written, so a focused cluster, an open recall
note and the graph's pan all survive. Only when it moves are `/api/health`, `/api/notes`, `/api/graph`
re-read, the stats replaced and the vault version bumped (which is what makes the
recall card re-pick). Every completed check also bumps a refresh token that makes
the LIFE section re-read `/api/life`, independently of the fingerprint: a Daily or
Monthly edit that leaves the scan index identical still reaches the screen.

Two rules keep it from being a nuisance. A hidden window never checks, however long
it has been open (`shouldCheckVault` in `web/src/refresh.ts`), and the ticker is fast
(15 s) while the interval is long, so a tab that was throttled or asleep asks "is it
time?" the moment it is looked at rather than waiting a full interval from whenever
the browser last ran the timer. A background check that fails is silent: the last
good data stays on screen and the status bar's `Synced` stamp simply stops advancing.

### Full screen

The intended deployment is a dashboard left open on a 1920x1080 monitor in F11, so
the shell is fitted rather than merely responsive. Above 1280x1000 the app switches
to a `100vh` column: no page scrollbar, no clipped rail, and the rails get their
own overflow as a safety net. The metric rhythm compresses (tighter rows, 27 px
figures, 9 px trail padding) so that four vitals, the area meter and the index trail
clear 1080p; slack is absorbed by anchoring the trail to the bottom of the left rail
and the vault actions to the bottom of the right rail. Past 1600x1055 the numbers and
sparklines step up (30 px figures, 44 px sparklines, 34 px clock, 296/286 px rails)
and the skill tiles stretch into large buttons that take the right rail's slack. On a
shorter or narrower window the ordinary scrolling document is used instead, so nothing
is ever hidden behind a clipped overflow.

Ambient motion is limited to a slow cloud
drift and a pulsing status dot; the only user-driven motion is direct manipulation
of the core, which still works as a still frame when motion is off (a drag turns
and settles it, zoom snaps instead of easing). Ambient drift and the arrival/pulse animations are off whenever motion resolves to
still — `Off`, or `System` on a machine asking for reduced motion — while an
explicit `On` keeps them running, including the vitals sweep and sparklines.

### Look — "JARVIS HUD"

`docs/reference/jarvis.png` is the visual reference: a near-black canvas
(`--bg #040507`), white type, and one lime/chartreuse accent (`#d7e04f`, sampled
from the image) carrying every glow. Layout cues taken from it: a wordmark with a
milestone tag, a centered segmented pill switch, an oversized clock with the date
underneath, a dot-separated status strip, borderless metric rows with a delta chip
and a tick-marked sparkline, a segmented meter with a 0–100 scale, a clickable
index trail, a 2x2 grid of quick-action tiles, and a state pill row under the core.
The accent picker in the header and the swatch grid in Settings drive the same
`ThemeId`; orange is the default and the fallback for a fresh profile. The header
picker stays label-only (the active pill is filled with the accent); the Settings
cards carry the colour preview, with the untagged-node shade and the spark tint
behind a panel-coloured seam so the chrome trio and the two cloud colours read as
different groups.

## Themes

Accent palettes live in `web/src/themes.ts` as a typed `THEMES` tuple and are applied
by setting CSS custom properties on `<html>`. Orange is the fallback used when
nothing is stored (the tuple order is presentation only):

| Theme   | Accent    | Bright    | Dim       | Spark     |
| ------- | --------- | --------- | --------- | --------- |
| Jarvis  | `#d7e04f` | `#f3f79c` | `#8d9a2f` | `#bdb3d6` |
| Orange  | `#ff8a3d` | `#ffb877` | `#b6682c` | `#a1c7dc` |
| Amber   | `#f0b24a` | `#ffd391` | `#ab7a2c` | `#a8b7d5` |
| Crimson | `#e8554f` | `#ff948c` | `#a33a35` | `#a3cbc9` |
| Ice     | `#63c8e8` | `#a9e7fb` | `#3a8ba6` | `#d9b6a4` |

Each theme also ships five node colours: three area shades (`--node-career`,
`--node-life`, `--node-ideas`), `--node-unset` for notes with no area, and
`--node-dust` for the decorative spark field. `--node-unset` is the accent mixed
into the canvas at the tone that lands near 0.075 relative luminance — so untagged
nodes read as recessive in every theme instead of as one fixed grey — and it also
paints the area-mix "unset" segment and the dashed tag edges in the cloud.
`--node-dust` is the one token deliberately outside the accent's hue family: each
palette's spark is a pale, muted complement (≈170–180° away in hue, saturation
≤ 0.5, luminance above 0.35), so the ~150 decorative sparks read as their own depth
layer instead of a dimmer copy of the notes. Distance is judged in CIEDE2000
rather than hue degrees, because two pale pastels can sit 120° apart on the wheel
and still look alike: every spark is at least 25 ΔE2000 from every node shade of
its own palette, and the five sparks are at least 10 ΔE2000 from each other. The
sparks stay paler and less saturated than every node shade so they never compete
with a real note; `web/test/themes.test.ts` holds all three invariants.
`--accent-rgb` exists because translucent glows use `rgb(var(--accent-rgb) / α)`.

### Theme source

Which palette is painted is a two-part decision, stored as `braindash.themeMode`
(`auto` by default) plus the manual accent in `braindash.theme`. Both are applied in
`main.tsx` before the first render so the default never flashes.

**Auto** reads the OS colour-scheme preference and the wall clock. The preference
sets the tone of the palette — a light desktop wants the bright pair, a dark one the
calm pair — and the hour picks within it, so a dashboard left open keeps shifting as
the day moves. The canvas itself stays near-black in every case; this is an accent
choice, not a light/dark skin.

| Signal                | 05–11 dawn | 11–17 day | 17–21 dusk | 21–05 night |
| --------------------- | ---------- | --------- | ---------- | ----------- |
| OS prefers light      | Amber      | Jarvis    | Amber      | Jarvis      |
| OS prefers dark       | Amber      | Orange    | Crimson    | Ice         |
| No preference reported| Amber      | Orange    | Crimson    | Ice         |

Auto re-resolves on a `prefers-color-scheme` change, on a one-minute interval, and
when the window regains focus or becomes visible — so an overnight dashboard follows
the clock without a reload. When no signal can be read at all (no `matchMedia` and
no usable clock) it falls back to the saved manual accent rather than guessing.

**Manual** pins that accent. Choosing an accent — from the header pills or the
Settings grid — is an explicit choice, so it switches the mode to Manual and is
remembered; the header keeps highlighting whichever accent is actually painted, in
either mode.

Themes change presentation only — no vault access. Storage failures (private mode)
fall back to Orange for the session.

## Note reader

The reader is a right-side dialog (`role="dialog"`, `aria-modal`, Escape to close,
Tab contained, focus returned to the trigger) showing the note's title, area,
origin, capture date (with the zone it was written in when one was recorded), word
count, **size on disk**, keywords and link counts above
the rendered body. Sizes come from the scan's `bytes`/`size` fields and are printed
by one shared formatter (`web/src/format.ts`), so the rail total, an index-trail
row and this strip never disagree; the exact byte count is the `title` tooltip.

**Editing** is an opt-in layer on the same dialog. When `/api/health` reports
`writes: true`, the header adds **Edit** and **Delete**; Edit swaps the rendered
body for a raw-markdown textarea with Save/Cancel and an unsaved-changes guard,
and Delete asks once (`Move to .trash`) before calling `DELETE`; the **Trash**
tile opens the sheet of what that kept and restores one note, which then opens in
the reader (the sheet closes first, so only one dialog owns focus). A save sends the
`baseModifiedAt` the dialog loaded, so a file changed by Obsidian meanwhile is a
`409` message beside the draft instead of a lost version; the previous body is
already in `.trash` before the new one is renamed into place. Quick access adds a
**New note** tile whenever writes are on: the same panel with a path field (the
pure `web/src/notePath.ts` check adds `.md`, rejects absolutes, `..` and hidden
folders; the API re-validates) and a starter draft, posted to `POST /api/notes`
and opened in the reader. From another device the dashboard keeps its read-only
copy, and the controls are absent because the health payload says so — even a
hand-made request is refused by the loopback check in the API.

Below the body it lists the note's place in the graph: **Links out** (every
`[[wikilink]]` in the note, resolved to the note it opens, with unresolved targets
collected as inert chips rather than silently dropped, each row labelled with the
alias the note wrote) and **Backlinks** (notes
that link here, then notes sharing a tag — labelled `links here` or `shares #tag`).
Rows are buttons that load that note into the same reader. Both the token grammar
and the resolution come from `shared/wikilinks.ts` — imported by the server for
graph edges, backlinks and the scan's `links`, and by the dashboard for inline
links and the daily-recall body — so a link that draws an edge on the cloud is
exactly the link the reader renders. `parseWikilink` splits one token into target,
heading and alias and honours backslash escapes, and `findWikilinks` scans prose
with that same grammar. The scan stores those parsed links (one per target, first
spelling kept), so nothing is re-split downstream: `[[Beta#Top|B]]` reaches the
reader as target `Beta`, heading `Top`, alias and label `B`, and the **Links out**
row shows `B` exactly as the inline link does; `[[a\|b]]` is the literal target
`a|b`, an escaped `\[[not a link]]` stays text, and `[[#Heading]]` keeps its
heading but has no target, so it renders as text and never becomes an edge. Keys
are lowercased when the index is built and `resolveWikilink` trims/lowercases the
target, so neither side can half-normalise a link.

Markdown is rendered by `web/src/markdown.tsx`, a dependency-free subset:
headings, paragraphs, lists, blockquotes, fenced code, rules, inline `code`,
**bold**, *italic*, `[text](url)` and `[[wikilinks]]`. It emits React nodes and
never HTML, so note content cannot inject markup; only `http(s)` URLs become
anchors. Wikilinks resolve against the index by title, file name or path without
the extension, with dashes, underscores and spaces interchangeable in the file name
(`[[ai-school]]` and `[[Ai school]]` reach the same note); unknown targets render as
inert text. A backslash escapes punctuation, so `\[[not a link]]` stays literal and
`[[a\|b]]` keeps its pipe; other backslashes (a Windows path, say) are left alone.
Frontmatter is stripped from the body and shown as metadata instead.

A `[[Note#Heading]]` link opens the note *and lands on that heading*. Once the
body has arrived, the reader scrolls its own box (`.reader-body`) so the line
sits 14 px below its top edge; `scrollIntoView` is deliberately not used because
it can also move the document behind the dialog. The link text and the heading
text are reduced to the same comparable slug by `web/src/headingTarget.ts`
(lowercase, whitespace folded to dashes, punctuation dropped, inline emphasis,
code and wikilink labels stripped), so `#My Heading`, `#my-heading`, `#What's
next?` and a heading written `**What's next?**` all agree; the same slug becomes
the `data-heading` attribute on every rendered heading, so link and target cannot
drift. Only the first heading with that slug is marked and scrolled to, because a
document may repeat `## Notes`. The request carries a nonce as well as the text,
so clicking the same heading link twice scrolls again instead of looking like no
change. The destination holds an accent highlight for 2.2 s; with reduced motion
the fade is replaced by the same steady mark, because the answer to "where did I
go?" is information rather than decoration. A heading-only `[[#Heading]]` has no
target to open and stays text.

## Tests

`npm test` runs the `node:test` suites with no test framework installed. A
filter narrows the run to matching files, so `npm test -w server -- vault` runs
the vault suites and `npm test -w web -- cloudLabel` runs one file; a filter that
matches nothing lists what is available and exits non-zero. GitHub Actions runs the
same gate — `npm run check:eol`, `npm run check:lockfile`, `npm ci`, typecheck,
tests, build — on every push and pull request (`.github/workflows/ci.yml`), on
both `ubuntu-latest` and `windows-latest`. The
Windows leg is the development platform: it is where `path.sep` joins, Windows
temp paths, the absent-without-Developer-Mode file symlink and the
`symlink(junction)` fallback in `vaultSymlink.test.ts` are exercised for real; the
Ubuntu leg keeps the POSIX branch covered. Line endings are deliberately *not* a
platform difference: `.gitattributes` normalizes every text file to LF (`eol=lf`)
and marks images and media binary, so both runners and every desk check out the
same bytes no matter what `core.autocrlf` is set to. `.editorconfig` asks editors
for the same result at save time — LF, UTF-8, a final newline, two-space indents,
with CRLF only for `.bat`/`.cmd`/`.ps1` — so a file is usually already correct
before Git normalizes it on commit. `npm run check:eol`
(`scripts/check-eol.mjs`) asserts the result instead of assuming it: it parses
`git ls-files --eol -z` and fails naming every tracked text file whose working-tree
copy ends a line with CRLF, with the count and the first offending line. The same
listing carries the index column, which is the blob that would be committed, so
the gate reports those too (`crlfBlobs`): a blob written past Git's filters can
hold CRLF while every checked-out copy still reads `w/lf`, and the next checkout
is what regenerates the disk from that blob — the working tree alone cannot
answer. Both halves are reported independently, the index finding first (it is
the one that travels), its count read from the blob with `git cat-file blob
:<path>` rather than from the file. Git's own text/binary decision is what
selects the files, so binary content is never inspected for `0x0d0a`, and a path
whose rule declares `eol=crlf` — the `.cmd`, `.bat` and `.ps1` launcher rules —
is skipped in both halves because the rule is the answer for it. Exit 0 is all-LF, 1 is a finding, and 2 is Git unable to answer, which never
reads as a clean tree. The parsing and comparison live in exported functions so
`server/test/checkEol.test.ts` can cover them without a repository, and the same
suite runs the check against a temporary `git init` checkout to prove it catches
a file rewritten with CRLF, catches a raw CRLF blob staged with
`hash-object --no-filters` + `update-index` while the checkout stays LF, and
leaves a declared-CRLF launcher alone.
`fail-fast: false` means both results are reported even when one fails. `check` compiles once and uploads the output —
`server/dist` and `web/dist` — as a `built-app-<os>` artifact from **each** leg.
Each platform's `smoke` restores its own copy, so the Windows artifact is a boot
input rather than only an inspection convenience; `perf` stays on the Ubuntu one.
Artifacts are kept for 14 days and replaced when the same job is re-run, because
`upload-artifact@v4` refuses a duplicate name inside one run.
The zip holds both directories at their workspace paths, so unzipping it over a
checkout that has run `npm ci` and running `npm run start:built` serves the
dashboard from exactly those bytes. The installed tree is cached rather than
rebuilt three times: every Linux job restores one `node_modules` entry keyed on
`hashFiles('package-lock.json')`, the resolved Node version and the OS, and
`npm ci` runs only when that key misses — a lockfile change, an evicted cache,
or a branch (or pull request) whose key has never been saved. `check` populates
it; `smoke` and `perf` consume it. The Windows leg
is deliberately outside the cache: npm links workspaces with junctions there,
and a tar round-trip is not worth risking that leg's install fidelity for a few
seconds. A second `smoke` job depends on that gate and runs on both platforms,
each leg downloading its own `built-app-<os>` artifact back to the same relative
paths and booting `server/dist` against a temporary vault on a free loopback
port. The matrix is the point rather than symmetry: the Windows leg is the only
one that boots the Windows-compiled entry with Windows path separators, a vault
under the Windows temp directory and `npm.cmd` behind `/api/deps`, and the Linux
artifact cannot stand in for it. `fail-fast: false` keeps both results visible
when one breaks. It asserts real responses from health, notes, note reading,
search, graph, broken links, recall, LIFE, mode, the action catalogue, `404` and
the built dashboard, so the route checks run against exactly what `check` produced rather
than a rebuild that could differ. The scratch vault is removed in a `finally`;
the port is chosen by the OS rather than hard-coded.

The smoke also proves the product's central promise instead of stating it in a
README: `scripts/vaultSnapshot.mjs` walks the scratch vault before the server
starts and records each file's SHA-256, byte size and `mtimeMs`; after every
probe the same walk runs again and `diffSnapshots` must return nothing. A route
that writes — even a cache or a normalised frontmatter field — fails the job
with `notes/alpha.md: content changed`, and a metadata-only touch reports
`mtime changed` on its own. Directories are excluded on purpose: their mtime
moves whenever a file inside them appears or disappears, which the file entries
already report. The snapshot helpers stay out of the smoke script so
`server/test/vaultSnapshot.test.ts` can exercise the comparison without booting
a server.

The same walk covers the **checkout** the server is started from, taken at the
same instant, because the vault-only proof cannot see a write that lands outside
it: a cache directory, a log file or a rewritten config beside the code now
fails the job with `<path>: added` or `<path>: content changed`. `snapshotTree`
takes an `ignore` list of slash-separated paths relative to the root; the smoke
skips `node_modules` (a Vite dev server caches into it, so a local run beside
`npm run dev` would report noise, and it dominates the walk) and `.git`. Both
walks skip symlinks rather than following them — the vault scanner has the same
rule, and a link to a directory would be read as a file and throw `EISDIR` — so
a write *through* a link is outside both proofs. The checkout proof covers the
probes and the server's startup scan; it is compared before the child is killed,
as the vault proof always has been.

A separate `perf` job turns the cloud's animation cost into a gate. It restores
the same Ubuntu artifact and the same dependency cache, boots the compiled server
against a temporary 160-note vault (the cloud's `MAX_NODES` cap), opens the built
dashboard in headless Chrome
at 1440×900 and forces the stored motion preference to `on` before a fresh load.
For four seconds it samples Chrome's cumulative `ScriptDuration`,
`RecalcStyleDuration` and `LayoutDuration` counters and divides them by the
number of frames a `requestAnimationFrame` probe counted. The budget applies to
the sum of those three — the work the draw loop owns — at **14 ms per frame** of
the 16.7 ms a 60 Hz frame allows. Paint and rasterisation are printed as the
total but are excluded on purpose: a headless runner has no GPU, so rasterising
160 note gradients and several hundred links costs an order of magnitude more
there than on the machine the dashboard runs on, and including it would make the
gate a measurement of the runner. A second, independent check is liveness: fewer
than 10 fps or fewer than 30 painted frames fails, and the first note's projected
position must change both before and after the sample, because a loop that
stopped is not a loop that got faster. The script is `scripts/perf-core.mjs`
with the arithmetic in `scripts/frameBudget.mjs`; it drives Chrome over the
DevTools protocol directly with no automation dependency, finds
Chrome/Edge/Chromium in the usual places or through `CHROME_PATH`, blocks the
dependency card's npm call so it cannot land in the sample, and removes the
scratch vault and browser profile in a `finally`. The job is Ubuntu-only because the budget is a regression
baseline for one rasteriser, not a cross-platform FPS claim.

The `check` job ends with `npm run ci:summary`, which appends a Markdown block to
the Actions run summary: per-workspace tests, passed, failed, skipped and duration
plus an aggregate row, then each artifact's file count, raw and gzipped bytes and
its three largest files. The test numbers are the runner's own totals, captured
while the suites ran — `run-tests.mjs` tees the output in CI, parses the final
`ℹ tests` / `ℹ pass` block and writes `.ci/tests-<workspace>.json`; the summary
step reads those files and never re-runs anything. `.ci/` is untracked. Build
sizes are measured from `web/dist` and `server/dist` on disk, with gzip reported
for text assets only. A missing artifact is shown as "not built" instead of zero.
Both matrix legs append their own block, labelled with `RUNNER_OS`. The script
exits 0 even when a half is missing, because a summary is evidence, not a gate.

The workflow also runs weekly (Mondays 06:00 UTC) and through *Run workflow*, and
those runs add a `drift` job that restores no npm cache and installs nothing. It
repeats `npm run check:lockfile` — `npm ci --dry-run`, which fails when
`package.json` and the lockfile disagree or a locked tarball no longer resolves —
then runs `npm run check:deps`, which compares every dependency's locked version
with what its declared range now allows. Drift inside a range fails the job and
names the packages and the `npm update` fix; a newer major version is printed and
written to the job summary but does not fail, because bumping a major is a person's
decision. The check lives in `scripts/check-deps.mjs` with its own suite, so the
comparison is tested without the network.

The verdict is also durable. `check-deps.mjs` writes the classified report to
`.ci/deps.json` (gitignored), and a following step runs `npm run drift:issue`
with `if: always()` — the check exits 1 precisely when an issue is needed. The
script keeps exactly one open issue: stale entries open it (label
`dependency-drift`) or rewrite its title and body in place, with no comment per
week because the body *is* the state; a current lockfile comments once with the
result and closes every open labelled issue. The closing comment repeats the
informational newer-majors table, which would otherwise disappear with the
issue. Duplicates are folded into the lowest-numbered issue, and a regression
after a close opens a fresh issue — so it notifies like any new issue rather than
silently reopening one nobody is watching. With no report —
npm failed, or the step never ran — the issue is left untouched rather than
closed on no evidence. The script is plain `fetch` against the REST API with the
built-in `GITHUB_TOKEN`, so there is no client dependency and no stored secret;
`issues: write` is granted to the `drift` job only, and the rest of the workflow
stays `contents: read`.

`npm run test:coverage` runs the same files with Node's built-in V8 coverage
table, including line, branch and function percentages and the uncovered line
ranges. There is no c8/Istanbul dependency and no upload. The report only counts
modules the run loaded, so a filtered run (`npm test -w server -- vault
--coverage`) is scoped to that module and its imports; use the full suite for the
whole picture. It is diagnostic, not a threshold: CI does not fail on a
percentage.

- `server/test/vault.test.ts` — `resolveNotePath` (accepted shapes; rejection of
  absolute, home, drive-letter, traversal, hidden and skipped-directory paths,
  null bytes and non-`.md` targets, with the `invalid_path` / `not_markdown`
  code and `400` status each route relies on), `extractKeywords` (frequency,
  alphabetical ties, `limit`, stopwords, the four-character floor, case and
  punctuation folding, and exclusion of frontmatter, fenced and inline code),
  `scanFingerprint` (stable whatever order the notes arrive in, and moving for a
  size, title, captured, captured zone, area, origin, tag or keyword change, and
  for an added or removed note), `parseFrontmatter` (an unterminated block is no
  frontmatter; a malformed line is skipped without losing the fields around it),
  `parseCaptured` (meridiem-aware midnight and noon, and null for empty or
  unreadable stamps), and the zone-aware stats path (`dayKeyInZone` across the date
  line, `shiftDayKey` over month/year ends, `resolveTimeZone` accepting IANA names
  and rejecting junk, `captureSeries` ending on the requested zone's today,
  keeping a bare date on its written day, bucketing a timed capture by its instant
  there, falling back to the server clock for a missing/unknown zone and for a
  recorded zone `Intl` rejects, and `buildStats` carrying the same zone into
  `captures30d`).
- `server/test/vaultSymlink.test.ts` — the symlink guard in `readNote`, against a
temporary vault and a sibling folder outside it: a directory link and a file link
that both point out are refused as `400 invalid_path` while the target stays
readable on disk (so the test cannot pass by accidental `404`), a link that stays
inside reads normally and reports the real vault-relative path, a note with no
frontmatter or heading takes its title from the file name, a directory named
`thing.md` is `404 not_found` rather than a read error, and a dangling
link is `404 not_found` rather than an escape. A symlink cycle is pinned
explicitly: a file link whose target is itself is asserted to make `fs.realpath`
raise `ELOOP` first (so the fixture cannot be mistaken for a missing file), and
`readNote` then answers `404 not_found` with a `NotePathError` — not `400` and not
a raw filesystem error. The test carries a five-second timeout, so a resolver that
ever returns fails as a hang instead of stalling the suite. Chained links are pinned too: a
two-hop directory link or a file link pointing at another file link is still
`400 invalid_path` when the chain ends outside (the outside target is asserted
readable first, so the refusal cannot pass on a `404`), a two-hop link that stays
inside opens at its final canonical path, and a dangling chain is `404` because
`realpath` never reaches a file. The same file also pins `scanVault`: a link out
is not descended, its target's body is absent from the scan, and the link appears
in `skipped` with `reason: "symlink"`; a link that stays inside is reported too
and does not duplicate `notes/inner.md`; the walk never lists what is behind
either link. The links are real filesystem
objects, not mocks; where a platform forbids creating one (Windows file symlinks
without Developer Mode, or a junction to a missing target) the test skips with
the OS error instead of failing, and any other error is raised.
- `server/test/vaultDefensive.test.ts` — the two guards in `vault.ts` that
  ordinary use cannot reach by waiting for them, posed through
  `server/test/fsFault.ts`: a small fault injector that installs named faults on
  the one shared `fs.promises` object, restores every stub in a `finally`, and
  **fails the test if a declared fault never fired** (an unexercised stub proves
  nothing). Three fault kinds exist — `missing` (the read raises `ENOENT`,
  exactly what a delete just before the read delivers), `denied` (the read raises
  `EACCES`, which permission bits cannot pose portably on every OS) and
  `not-a-file` (the read returns bytes while `stat` reports `isFile(): false`) —
  so no fixture depends on the OS, on symlinks, on privileges or on winning a
  race. The suite covers: a note the walk found but that is gone at read time
  drops out of `notes` and `bodies` while its neighbours are still read and
  titled, the scan resolves instead of throwing, and the vanished note is absent
  from `skipped` because that list means deliberate exclusion; it appears in
  `unreadable` with `code: "ENOENT"` instead; two vanished notes do not abort the
  scan and both are reported in path order; a refused read is reported as
  `EACCES` and leaves its neighbours intact; a real directory named `folder.md`
  is accepted by `resolveNotePath` and answered `404 not_found`; the `stat` guard
  *after* the read rejects a readable non-file (the case a real directory cannot
  reach, because Node fails the read with `EISDIR` first); and the notes beside
  the offending path still read normally. The runner gives each test file its own
  process, so a stub cannot leak into another suite.
- `server/test/vaultIndex.test.ts` — the index, search and recall against a
temporary vault (skipped folders and dotfiles, POSIX paths, title precedence
from frontmatter to heading to file name, `created:` standing in for
`captured:`, a valid `captured_zone` carried on the note and its search hit, an
unknown zone treated as absent, unknown areas and origins staying null, tag
normalisation and dedupe, alias and heading links collapsing to one target while
the first spelling keeps its parts,
body/size/word/keyword measurement, an empty vault, a missing vault folder); `searchNotes` (title above
tag above frontmatter above body, alphabetical ties, case folding in every field,
phrases treated literally rather than split into words, snippets with ellipses
only where they cut including the trailing mark on a long body, `limit` applied
after ranking, a note with no indexed body,
and a scan left untouched); and `pickDaily` (empty and single-note vaults,
seeding from the date rather than the input order, negative and oversized skips
wrapping, and the pick carrying the note's own metadata).
- `shared/wikilinks.ts` is covered from `server/test/wikilinks.test.ts` — the one
  parser and resolver both workspaces import: title, path, path without extension
  and file name keys, dashes/underscores/spaces crossing in both directions,
  lowercased keys with normalisation left to `resolveWikilink`, first note winning
  a duplicate title, blank keys skipped, an empty vault, an extensionless path,
  notes not mutated, and resolution folding case and padding while returning null
  for an unknown or empty target. `parseWikilink` (heading and alias splits, blank
  alias falling back to the target, extra pipes kept, escaped separators and
  brackets, heading-only and blank tokens), `findWikilinks` (order and repeats,
  escaped and even-backslash openings, unterminated and line-spanning tokens) and
  `wikilinkTargets` (trim, unescape, exact dedupe) are covered there too, plus a
  real `readNote` proving the vault scan records what the renderer splits.
- `server/test/brokenLinks.test.ts` — the graph's unresolved targets grouped for
  repair on in-memory scans: an empty vault, two misspellings sharing one alias,
  the bare target as the fallback label, case-folded labels keeping the first
  spelling, one target under two aliases in both groups, resolved links excluded,
  a repeated target counted once per note, the weight-then-alphabetical group
  order, note order by title, and the union of reported targets equal to
  `buildGraph(scan).unresolved`.
- `server/test/vaultGraph.test.ts` — the graph and its resolver on in-memory
  scans: `buildGraph` (empty vault,
unconnected notes as isolated, broken links collected and sorted instead of drawn,
self links, repeated links collapsing to one line, every resolution form,
shared tags as one edge per pair with endpoints ordered, a pair that is both
linked and tagged staying a directed wikilink, the tag-pair cap reporting
`truncated`, and no edge ever naming a note that is not a node) and
`noteConnections` (resolved and unresolved outbound links in written order, each
carrying the parsed target, heading, alias and label,
wikilink backlinks before tag backlinks whatever order the scan found them in, a
note listed once when it both links and tags, self and broken links excluded, and
same-kind backlinks sorted).
- `server/test/workingMode.test.ts` — the working-mode reader behind
  `/api/mode`: schedule boundaries to the minute in `America/New_York` in both
  EDT and EST, the date resolved in that zone rather than the machine clock, a
  fresh override beating the calendar in both directions, `until` expiry and the
  twelve-hour staleness rule, unknown modes and empty files falling back to the
  schedule, a state path that is a directory (no throw), a missing `.freebuff`,
  and the payload the badge reads (schedule block, `checkedAt`, and the calendar
  still reported while an override is in force).
- `server/test/modeStream.test.ts` — the working-mode SSE stream: the signature
  ignores `checkedAt` and moves for every field the badge can show; a client gets
  the current mode at connect and a flip is pushed with no client poll; a short
  wait across several re-reads produces no duplicate frame; the response carries
  the event-stream headers; and a state-file write is delivered by the `fs.watch`
  path even when the re-resolve cadence is set to ten seconds, which is what
  proves the CLI flip is immediate rather than merely caught by the fallback
  tick.
- `web/test/newNotes.test.ts` — the arrival flare's rules from
  `web/src/newNotes.ts`: the first scan is a baseline and flares nothing, an
  added path is found in the cloud's order, a repeated path is reported once,
  removals are not arrivals, up to eight additions count as captures while a
  larger batch (an import) does not, and the flight starts at the core with full
  spark, lands in place with the spark spent, eases out and fades monotonically,
  and clamps a clock that is early, late or a zero duration.
- `web/test/modeStream.test.ts` — the dashboard's frame guard: a complete
  payload is accepted, non-JSON, JSON that is not an object, a missing or
  unrenderable mode, a missing/malformed schedule, and a missing `source` or
  `checkedAt` are all refused so a truncated frame during reconnect cannot blank
  or corrupt the badge.
- `server/test/vaultCache.test.ts` — the watch-backed scan cache: with a quiet
  watcher the snapshot is served past the TTL, a change event causes exactly one
  rescan, an event that lands during a scan is not lost, simultaneous misses share
  one read and callers during a rescan wait for the new snapshot instead of the
  one being replaced, a failed scan keeps the cache dirty for the retry, an
  absent or dead watcher falls back to the TTL (closing the failed handle first),
  and `close` stops watching without restarting it.
- `server/test/frameBudget.test.ts` — the perf gate's arithmetic from
  `scripts/frameBudget.mjs`: per-frame costs from cumulative counters, a
  zero-frame sample reporting infinity rather than NaN, negative deltas clamped,
  passing exactly on the budget (not only under it), failing on over-budget
  animation work or a rate below the liveness floor, refusing a sample with too
  few frames before making a rate claim, a custom frame minimum, and a
  paint-heavy `TaskDuration` that must not fail a budget scoped to
  script/style/layout.
- `server/test/api.test.ts` — every route over real HTTP on an ephemeral port
  against a temporary vault: health, stats (including a valid and a malformed
  `?tz`), note summaries, one note with outbound/backlink resolution, search
  (body, tag and no-hit queries plus the empty-query hint), deterministic recall
  and skip rotation, graph edges/isolated notes, the broken-link report's
  alias groups and its agreement with the graph's `unresolved` list, life
  folders, `no-store` mode,
  and the action catalogue. It pins the error shapes and status
  codes (`400 invalid_path`/`not_markdown`, `404 not_found`, `503
  vault_not_configured`), checks the 503 body on every
  scan-backed route with no vault or a vault path that is a file, exercises the
  default 5 s cache with an injected clock (4 999 ms still cached, 5 001 ms
  rescanned), `?refresh=1` on health and stats, a watcher event forcing a rescan,
  and the static build serving pages/assets while `/api/*` misses stay JSON. A
  fault-injected scanner covers the 500 path for stats/notes/search/graph/recall,
  plus health and a direct note read staying usable with an empty link list when
  the index cannot be read.
- `server/test/dayActions.test.ts` — the day rule behind Today's captures and the
  review queue: a timed stamp converted across midnight in two zones, a bare date
  keeping its written day, notes with no stamp, newest-first ordering, the due set
  with its overdue count, `next_review` parsing in a real scan (a trailing time,
  a malformed date, an invalid month) and the fingerprint moving when the date
  does. `server/test/actionsApi.test.ts` runs all three new routes over HTTP,
  including the +14 zone case and the 503 without a vault.
- `server/test/trashApi.test.ts` — the recoverable list and restore over HTTP: an
  empty trash before anything is deleted, one entry's id/path/title/size, the
  exact bytes and preserved mtime after a restore with the stamp folder pruned,
  `409 note_exists` when the filename was re-used, `404` for an unknown id, six
  traversal/shape rejections, and the write gate (off, and from the LAN).
  `web/test/trashPanel.test.tsx` renders the sheet's list, empty, loading, read
  failure, in-flight restore, refused restore and read-only states.
- `web/test/review.test.ts` — `reviewStatus`: due today, one and many days
  overdue, a month boundary, a future date, and a missing/invalid date on either
  side. `web/test/actionPanel.test.tsx` renders both sheets and their loading,
  error and empty states; `web/test/quickActions.test.tsx` pins the live counts,
  the quiet zero and the waiting state.
- `web/test/palette.test.ts` — the launcher's pure rules: the command list and its
  count/graph/writable gates, exact vs prefix vs word vs substring vs scattered
  scoring, a hint line refusing a scattered run, keyword hits ranking under the
  label, a command winning a tie against a note, empty-query catalogue order, the
  limit, and ↑/↓ wrapping at both ends. `web/test/commandPalette.test.tsx` renders
  the dialog, combobox and option semantics, the selected first row, the group
  headings and active row, the empty message, and that a closed palette renders
  nothing.
- `web/test/markdown.test.tsx` — `renderMarkdown` block and inline output as
  static markup (heading clamping and `data-heading` slugs, paragraphs, lists,
  quotes, rules, verbatim code, frontmatter stripping, emphasis, http-only
  anchors, HTML escaping, resolved/unresolved wikilinks, the heading carried into
  the click handler, and only the first heading of a repeated name marked
  `is-target`) plus `stripFrontmatter`.
- `web/test/headingTarget.test.ts` — `headingSlug`: case, spacing and punctuation
  folding, the slug form a person copies, inline code/emphasis and wikilink labels
  stripped, non-Latin letters and digits kept, and nothing to match on.
- `web/test/cloudMotion.test.ts` — the cloud's rotation, settle and pulse maths
  from `web/src/cloudMotion.ts`: `shortestAngle` (short way round, full turns,
  always within half a turn), `facingAngles`/`focusNudge` (checked by
  re-projecting the point: centred, depth equal to its length, pitch never past
  the tilt limit), `nearestPose` (closest note, short way round the seam, pitch
  counted, poles only as a fallback, ties by index, empty cloud), `settleStep` (closes from
  rest without overshoot, carries a flick past the target and back, no time no
  movement, stops when already there), `advanceAmbient` (passes the raw clock when
  idle, freezes the drawn time for a hold, resumes from the held pose, withholds
  only the hold from a long frame), `sparkPose` (the spark layer takes a fraction
  of the yaw and of the pitch above the shared horizon, and can be stilled) and
  `pulseFrame` (starts wide and fades, repeats every period, stays in range).
- `web/test/cloudLabel.test.ts` — the focus-title fitting from
  `web/src/cloudLabel.ts`, which keeps a hover from resizing the sphere:
  `fitCloudTitle` against injected glyph metrics (a short title stays at full size
  on one line, a 45-character title steps to 27 px, greedy word wrapping picks a
  smaller size than a character count would, nothing ever reports more lines than
  the slot reserves, an extreme title clamps at the floor and is flagged for its
  tooltip, a quiet fit at the floor is not flagged, sizes stay inside the floor and
  cap, widening the column never steps the size back, an unmeasured first paint is
  full size, a blank label counts as no title, a proportional face keeps a larger
  size than monospace for the same text, looser authored tracking shrinks the fit,
  and the first line pays for its indent), plus `lengthPx` from
  `web/src/cloudTitleMetrics.ts` (em resolved per candidate size, rem/px/pt passed
  through, and a missing or unsupported unit counted as zero).
- `web/test/cloudCursor.test.ts` — the cloud's keyboard rules, extracted into
  `web/src/cloudCursor.ts` so they run without a DOM: `stepCursor` (first/last
  entry from no cursor, wrap in both directions, single note, empty cloud,
  full lap, always in range), `cloudKeyAction` (arrows, Enter/Space, `+`/`=`,
  `-`/`_`, `r`/`R`/`0`, Escape, and near-miss keys), `cloudFocusIndex` (hover
  over a landed note and a click, zero indexes not treated as missing, and the
  empty case) and `cursorTargetPath` (no cursor reads nothing, index lookup,
  sparks and empty paths unopenable).
- `server/test/life.test.ts` — the life reader against temporary vaults: missing
  folders and the demo flag, currency/percent/boolean parsing, missing fields,
  underscore templates, ordering, weekly clamping, and malformed frontmatter that
  must not throw.
- `web/test/life.test.ts` — the scoring layer: date and ISO-week helpers, metric
  clamping and lower-is-better flips, area scores over rolling windows, missing
  days vs skipped monthly fields, streaks (current anchored to today or yesterday,
  best runs), weekly series and drops, alerts, money month-over-month deltas,
  metric views, the empty snapshot and the demo generator.
- `web/test/themes.test.ts` — the palette invariants: the CSS `:root` defaults
  match the Orange theme variable for variable, so a stylesheet-only first paint
  cannot drift from `themes.ts`; the CIEDE2000 helper reproduces six published
  Sharma reference pairs; five unique spark colours, each at least 25 ΔE2000 from
  its accent and all four node shades and at least 10 ΔE2000 from every other
  palette's spark; and every spark pale (luminance > 0.35) and muted
  (saturation ≤ 0.5) so it cannot pass for a node.
- `web/test/skipped.test.ts` — the status strip's skipped-symlink copy: no row at
  zero, singular and plural counts, and a tooltip that names the count and lists
  every path on its own line in scan order.
- `web/test/unreadable.test.ts` — the status strip's unreadable-note copy: the row
  hidden only at zero, singular and plural counts, `EACCES`/`EPERM`/`ENOENT`/
  `EISDIR`/`EIO` mapped to plain language, unknown codes left visible rather than
  rounded to a generic error, and a tooltip that names the count and lists every
  path with its reason and code in scan order.
- `web/test/modeBadge.test.ts` — the header badge's wording: unknown when the
  API never answered, `auto` for a scheduled day, `manual` with both timestamps
  and the schedule disagreement called out, no false disagreement when the two
  agree, `stale` explaining that the schedule took over, the note carried
  through, and `describeSchedule` collapsing a weekday run while keeping
  scattered days, a single day, every day and no days readable — without
  mutating the payload's day list. Also `tabIdentity`: the mode leads the title
  and its provenance follows in parentheses (`Work (manual) · BrainDash`), Work
  and Home get distinct W/H glyphs and fills, the icon is a valid SVG data URL,
  a by-hand mode adds a filled corner dot while a stale one adds a hollow ring
  and the automatic case adds nothing, the mark does not replace the mode (Work
  and Home set by hand still differ), and the unknown state stays a neutral
  BrainDash with B and no mark. `modeChangeNotice`
  stays quiet for the first answer, same-mode polls and a failed read, then
  explains a work/home flip and whether it was manual, automatic or stale.
- `web/test/modeNotice.test.tsx` — the notice rendered as static markup: the
  polite status region, new mode and source wording, work/home tone class, close
  button label, and the dismiss target's button type and glyph. Also the mute
  control: its own class and label (not a second meaning for the ×) and the
  title that says when the silence ends.
- `server/test/vaultSnapshot.test.ts` — the read-only proof's rules from
  `scripts/vaultSnapshot.mjs`: every file listed once with slash paths (nested
  folders included) and sorted, real byte sizes, a 64-hex digest, and two reads
  of an untouched tree comparing equal; then the detections — rewritten content
  (and its size), an added file and a removed file by name, and an
  `utimes`-only touch that reports `mtime changed` without claiming the bytes
  moved.
- `web/test/modeNoticeMute.test.ts` — the session store from
  `web/src/modeNoticeMute.ts` against a fake store: unmuted by default even with
  no storage, a round trip for mute and unmute, exactly one key written so a
  stale value cannot impersonate the choice, and a storage that throws on read
  and write neither lies nor crashes the dashboard.
- `web/test/modeNoticeHistory.test.ts` — the muted-flip backlog: newest first,
  the three-change cap (and a zero or custom limit), no mutation of the input,
  a round trip through a fake session store, empty results for missing or
  malformed storage, invalid rows dropped while good ones survive, and a store
  that throws on read or write neither lies nor crashes the dashboard.
- `web/test/workingModeBadge.test.tsx` — the badge as static markup: every
  state is a disclosure whose summary names the mode, source and backlog size;
  the panel carries the full reason and a `role="switch"` whose checked state
  follows `noticesMuted` (Shown/Muted), the backlog is labelled and newest first
  with source and clock-formatted time, Clear appears only when a handler is
  supplied, and an unknown mode still opens with its explanation and switch.
- `web/test/settings.test.tsx` — the panel rendered as static markup: every
  palette's five swatch bands (accent, bright, dim, untagged node, spark) appear,
  five per card, in that order, each card also describes every band with its hex
  value for screen readers — the radio keeps its short theme name and points at
  that hidden sentence with `aria-describedby` — the Vault refresh radiogroup
  offers each cadence with its hint, and the mode-change notice switch shows
  Shown by default, flips to Muted when the tab is muted, and explains that the
  silence ends with the tab while its flips collect on the badge.
- `web/test/refresh.test.ts` — the unattended-refresh cadence: the offered options
  and their intervals, a window that has never checked being due immediately, the
  interval boundary both sides, catching up after a long sleep, `shouldCheckVault`
  never checking while hidden however overdue, and staying quiet when set to off.
- `web/test/clock.test.ts` — captured-stamp and zone maths: parsing the vault's
  wall-clock shapes, formatting through a recorded and a display zone, date-only
  stamps keeping their day, `capturedZoneLabel` naming a recorded zone only for a
  timed and readable stamp, `zoneDayKey`/`shiftDayKey` across seams, month ends and
  DST, and the 30-day `buildCaptureSeries` window ending on the chosen zone's day,
  with each entry read in its own recorded zone (a missing or invalid one falling
  back to the caller's zone), while a date-only entry keeps its day.
- `web/test/noteReader.test.tsx` — the reader's captured strip rendered with
  `react-dom/server`: a New York wall clock shown in Tokyo is converted across
  midnight and keeps `America/New_York` beside it, the zone stays when no
  conversion happens, and it is absent for a date-only capture, a note with no
  recorded zone, and a note with no capture at all. Also the write controls: no
  Edit/Delete and the read-only footer without `writes`, both buttons and the
  editing footer with it, no confirmation until Delete is pressed, and the
  markdown body (not the editor) until Edit is used.
- `web/test/voice.test.ts` — the voice availability rules from `web/src/voice.ts`:
  idle only when the Speech API exists *and* the page is a secure context,
  unsupported taking precedence, a plain-HTTP LAN page reported as `insecure`
  (not as a denied permission, which is what the browser's error looks like),
  the HTTPS message offering keyboard dictation instead of a dead end, the
  unsupported copy pointing at that keyboard mic, and the button blocked only
  for the two unavailable states while listening, denied and error stay
  clickable.
- `web/test/notePath.test.ts` — the typed new-note path: trimming and slash
  normalisation, `.md` added only when missing (case-insensitively), empty/current
  segments collapsed, and absolute, drive-letter, `..` and hidden-folder inputs
  refused with the hint the composer shows.
- `server/test/noteWrite.test.ts` — writing over real HTTP against a temporary
  vault: off by default (`writes: false`, `403 write_disabled`), a forwarded LAN
  Host refused while loopback succeeds, form bodies `415`, a save answering with
  the re-read note and the previous body under `.trash/<stamp>/<path>`, a stale
  `baseModifiedAt` answering `409` with no backup and no change, create making
  parent folders and refusing to replace (`409 note_exists`) or escape (`400`),
  traversal/hidden/`_assets`/non-markdown paths rejected, a delete moving the
  note to `.trash` and out of the index, and a 1,000,001-byte body `413`.
- `web/test/trail.test.ts` — the index-trail tooltip: a timed capture appends
  `· captured in <zone>`, while a date-only stamp, a missing zone and a missing
  capture keep the plain `Open <path>` text (there was no conversion to explain).
- `web/test/trailRow.test.tsx` — the row itself: a timed capture with a recorded
  zone renders a visible `captured in <zone>` line and the `has-zone` class, keeps
  the tooltip naming the path and zone, and omits the line for a date-only stamp,
  a missing zone or no capture.
- `web/test/format.test.ts` — `formatBytes` (step at 1024, no negative or absurd
  sizes) and `exactBytes` (grouped, rounded tooltip text).
- `web/test/audio.test.ts` — the sound deck's rules: volume clamping and squaring,
  percentage labels, which MIME types and extensions are accepted as tracks,
  stable track ids, and the byte label.
- `web/test/hallDrift.test.ts` — the hall's parallax from
  `web/src/hallDrift.ts`: centred at the pointer's centre, exactly opposite the
  sphere's near face, proportional between the two, clamped at full deflection (a
  pointer captured outside the frame cannot push the room further), the
  declared travel kept inside the layer's 20 px bleed, and a custom travel
  honoured.
- `web/test/hallLight.test.tsx` — the hall's time of day from
  `web/src/hallLight.ts`: darkest overnight, fully lit at noon, a smoothstep
  dawn that only rises and a dusk that only falls, strips kept dimmer than the
  doorway at night (which stays above zero), times before midnight or past it
  wrapping into the same day, a non-finite input falling back to midnight, and
  rendered opacities on the strip group, the doorway glow, the door outline and
  the night veil at 02:00 and at noon, with the ceiling's near-to-far gradient
  intact at every hour.
- `web/test/cloudVoid.test.ts` — the hall behind the core from
  `web/src/cloudVoid.ts`: a centred vanishing point, every ray mirrored about the
  centre line and aimed at the vanishing point, every ray ending exactly on the
  far doorway's edge, cross seams that crowd toward the horizon (both planes) and
  narrow as they recede, wall seams that stay upright and span both planes, the
  doorway inside the frame and straddling the horizon, ceiling panels above the
  horizon, and the whole hall re-derived for another viewport.
- `web/test/graphLayout.test.ts` — the map's layout: an empty graph, coordinates
  stable whatever order the nodes arrive in, degree counted in both directions,
  each area kept in its own corner without interpenetrating, bounds that contain
  every point, no two notes stacked on one coordinate, and `nodeRadius` growing
  with degree up to a cap.

Every suite is typechecked with the rest of the workspace (`test/` is in each
tsconfig) and run through `scripts/run-tests.mjs`, which lists the files and
loads them with the `tsx` dev dependency already in the repo.

## LIFE section

Reached from the two-tab **CORE / LIFE** navigation under the status bar; the
section is mirrored in the URL (`#life`) so a reload or the back button lands in
the same place. The vault core keeps running in the background while LIFE is open.

LIFE keeps the command-center language: a HUD strip holds the overall 7-day score
(coloured by band), today's date, a refresh-cadence indicator, source counts and the
**DEMO DATA** badge when the folders are empty. Today is `zoneDayKey()` of the
clock's zone, so the whole section (which Daily note counts as "today", the win
date, the demo series) follows the same calendar day as the header clock; date keys
are printed by `formatDateKey()`, which renders them at noon UTC so a key can never
display as the day before. Below it, three columns: alerts and
streaks (plus the weekly chart) on the left, a 3D sphere of the seven areas in the
centre, and the selected area's panel on the right. The sphere is a Fibonacci
projection with a slow yaw, depth-scaled size and opacity, a glowing halo whose
strength follows the score, and node colours from the score bands (green ≥ 70,
amber ≥ 40, red below). Nodes are buttons: click or `Enter` picks an area, and the
matching legend chip does the same. The panel shows each daily metric's today
value, 7-day average, trend arrow (this week vs last week) and a 14-day sparkline;
Money keeps its monthly figures together in a "latest month" card — net worth,
credit score, utilization and savings rate with their month-over-month change,
coloured by whether the move is good (a falling utilization is green). Monthly
numbers are deliberately not repeated as daily rows, where their sparkline would be
a flat line. The weekly chart
plots the last eight weeks of 1–10 ratings, one line per area, and the footer bar
carries the latest `win` with its date. The section follows the dashboard's refresh
cadence instead of polling on its own clock: mounting `#life` reads `/api/life`
once, and every completed vault check re-reads it, so a Daily/Monthly/Weekly edit
shows up without switching sections. With refresh Off the section reads once per
visit and then stays put, like every other panel. The last good snapshot stays on
screen if a read fails.

## Sound

A waveform button in the header opens a small, non-modal deck (Escape or a click
outside closes it; focus returns to the trigger). It has two sources, one at a time:

- **Aurora Drift**, a generated bed built with the Web Audio API on the click that
  starts it — four detuned oscillators through a slowly swept lowpass, a 55 Hz sub,
  band-passed pink noise for air, and sparse pentatonic pings through a feedback
  delay and a synthesised convolution reverb. No file, no network, and the graph is
  torn down when stopped. An `AudioContext` that never reaches `running` (no Web
  Audio) shows an error instead of pretending to play.
- **Imported tracks**: `audio/*`, `video/mp4`, `.m4v` and `.mov` are accepted, read
  into IndexedDB (`braindash-sound`: a `meta` store and a `blobs` store, so listing
  never loads file bodies) and played through a hidden `<audio>` element with an
  object URL. The list shows kind and size; the newest is first; re-importing the
  same file replaces its entry; remove deletes metadata and blob. Files stay in this
  browser, are never uploaded, and never reach the vault or the server.

Volume (0–100%, squared for a usable low end) is shared by both sources and stored
in `localStorage`; playback is never restored automatically, because audio without a
gesture is blocked. The deck lives in the header, so music keeps playing across CORE
and LIFE. The server and `/api/*` are untouched by this feature.

## Milestones

- **M0** — spec, scaffold, `.env` loading, `/api/health` + `/api/stats`,
  hello-world panel, single dev command, README, accent themes.
- **M1 (done)** — `/api/notes` + `/api/notes/:path`, the note reader, node clicks
  and the stat/sparkline rail.
- **M2 (done)** — `/api/search` with voice dictation, `/api/recall/today` with
  reveal/skip, and `/api/graph` (`wikilink` + shared-tag edges) driving the cloud,
  with isolated notes dimmed.
- **M2.5 (done)** — **LIFE** section: main navigation, `/api/life` over
  `Daily/Monthly/Weekly`, 7-day area scores, 3D area sphere with cluster detail,
  streaks, eight-week rating chart, alerts, latest-win bar, refresh on the vault
  cadence and a demo fallback with a badge.
- **M3 (done)** — the full-screen graph (deterministic area layout,
  pan/zoom/fit, edge focus), clock-aware dates everywhere (the reader, search,
  recall and trail stamps; `captured_zone` as the conversion origin; the 30-day
  series, recall day and LIFE's day in the chosen zone), opt-in note authoring
  (reader edit/conflict check, new-note composer, trash-backed delete, loopback
  write gate), the review queue from wiki `next_review`, Today's captures, the
  `/api/actions` catalogue, and the `⌘K` command palette over commands and note
  search.
