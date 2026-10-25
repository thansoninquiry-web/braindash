# BrainDash

A local command-center dashboard over an Obsidian vault. The vault is the source
of truth; there is no database and no sync service. Reading is always available.
Editing is opt-in (`BRAINDASH_WRITE=1`), limited to this machine, and keeps every
replaced or deleted note in the vault's `.trash`, where the dashboard can also put
it back.

```
React + TypeScript + Vite  ·  Express (TypeScript)  ·  zero database
```

## Working mode

Whether an agent should interrupt you or just get on with it is recorded, not
assumed: `npm run mode` shows the current mode, `npm run mode work` (away, never
block), `npm run mode home` (here, questions are fine), `npm run mode clear`
(follow the schedule). The contract is [`AGENTS.md`](AGENTS.md), the mechanics and
the reasoning are in [`docs/working-mode.md`](docs/working-mode.md), and decisions
taken without asking land in [`docs/DECISIONS.md`](docs/DECISIONS.md).

The dashboard shows the same answer in its header: a **WORK** or **HOME** badge
with a dot, tagged `manual`, `auto` or `stale`. It reads `GET /api/mode`, which
resolves the mode with the CLI's own code, so the two cannot disagree, then keeps
`GET /api/mode/stream` open as server-sent events: the state file is watched, so
`npm run mode` in a terminal reaches the badge within a second rather than on the
next poll, and a one-second re-resolve on the server catches the two changes no
file event announces — a schedule boundary and an override expiring. Clicking the
badge opens a small panel with that full reason in the clock's own zone (`since`,
`until`, note, and what the weekly schedule alone would say) plus a **Notices**
switch; the badge is not a mode switch, because switching is `npm run mode`,
which also writes the switch log. The one-minute poll stays only as a fallback
for a browser without `EventSource` and for a stream that stays down; refocusing
still asks immediately.

The mode also rides in the browser tab, where it is still visible when the
dashboard is behind another window: the title is `Work (manual) · BrainDash`,
`Home (stale) · BrainDash` and so on, and the favicon is a filled **W** or **H**
with a corner mark for provenance — a dot for a by-hand mode, a ring for a
lapsed override, nothing when the schedule decided (neutral **B**, no mark,
until `/api/mode` answers). Mode leads the title so a truncated tab keeps the
answer, and the letter, fill and mark shape all work when tab colours are dimmed
or unavailable.

A mode change while the dashboard is open is not silent either: the first
answer stays quiet, but a later Work→Home or Home→Work flip shows a short,
dismissible notice at the bottom of the window naming the new mode and its
reason (`manual`, `auto` or `stale`). It sits low so it never covers the header's
controls, dismisses itself after nine seconds, and waits until the window is
visible again if the flip happened behind another app. A **Mute** button beside
the close silences notices for the rest of that tab — the choice survives a
reload and is gone when the tab closes, because a mode flip is worth seeing once
— and the same switch lives in Settings and in the badge panel, as Shown/Muted,
when you want it back.

Muting does not lose the flips. While notices are off the badge shows a small
`↺` count; opening it lists the last three changes with the mode, its source, the
time and the same reason the notice would have given, plus **Clear**. The list
shares the mute's per-tab lifetime, so it survives a reload, and it stays on the
badge after unmuting until **Clear** is pressed; nothing is replayed as a notice.

## Release notes

### M3 — the whole vault, in your own time zone (2026-10-19)

**Full graph.** The `Full graph` tile opens a full-screen map of every note, grouped
by area into four clusters on a deterministic layout, so a five-second poll cannot
reshuffle the geography under you. Drag to pan, scroll or press `+`/`-` to zoom
around the pointer, and `0` to fit the map again. Hovering a note lights its edges;
hovering an edge — or pressing `E` / `Shift+E` — focuses that one connection, dims the
rest and names the pair and whether it is a wikilink or a shared tag. Clicking a note
opens it in the reader and closes the map; `Escape` closes and returns focus to the
tile. Notes with no links still appear, so the map is the whole vault, not just the
connected part.

**Clock-aware dates.** Every recorded time is now read through Settings → Clock
(zone and 12/24-hour): the reader's metadata, search hits, the daily-recall stamp,
the index trail and the 30-day capture sparkline's buckets. A note can record the
zone its wall clock was written in with `captured_zone: America/New_York`; that zone
is the conversion origin, and a note without one is still read in this machine's
zone. A bare date keeps its written date, an unknown zone is ignored rather than
erasing the timestamp, and the raw string stays available as the hover title. The
same chosen day decides which note Daily Recall picks, the LIFE section's "today",
the header clock and the sync stamp — so no two panels disagree about what day it
is.

**M3 is complete:** the review queue, Today's captures, the `/api/actions`
catalogue and the `⌘K` command palette shipped on 2026-10-21, below.

### M3 polish — a map with a heartbeat (2026-10-21)

**The full graph breathes.** Every 4.6 s a faint ring leaves the middle of the map
and each note answers it — a small ring opens around the note and the dot itself
lifts a fraction before settling. The answer is not on a metronome: `graphPulse.ts`
turns each note's distance from the graph's centre into a delay, so one crest
travels outward through the clusters and the rim answers last. A focused
shared-tag edge also crawls its own dashes, which sets it apart from the solid
wikilink line beside it. All of it is CSS on top of the existing halos; the map
keeps its frame loop off, and **Cloud motion → Off** (or the OS setting) stills
the whole field instead of freezing it half-lit.

**Converted stamps name their origin.** A search hit, the revealed Daily Recall
note and every index-trail row now print the zone the note recorded
(`captured_zone`) with the converted time, as the reader already did — a hit
stacks it under the date, the recall card sets it beside the stamp, and the trail
puts a `captured in America/New_York` line inside the row, so keyboard users see
it while tabbing and screen readers read it with the row instead of it living
only in a hover tooltip. A date-only capture and a note with no recorded zone
stay plain, because there was no clock conversion to explain. The search row now
also stretches its head and foot to the full width, so the stamp (and its zone)
and the path sit at the right edge as their layout always intended.

**System vitals reads live.** The four stat rows now carry a slow sweep of accent
light that crosses them one after another, a beating lamp beside `Vault data` (dim
when automatic refresh is off), and figures that rise and flash only when a poll
actually changes them — an unchanged row stays perfectly still. Their sparklines
draw in and pulse with the app's motion setting, matching the core and the graph
instead of following a separate rule. The same motion choice stills all of it:
`Off`, or `System` on a machine asking for reduced motion; an explicit `On` runs
it.

**Smaller finishing touches.** Sparklines draw themselves once when their data
arrives and their newest bucket keeps a slow pulse, without restarting on every
five-second poll. Search hits cascade in by a few milliseconds each, revealing a
Daily Recall note fades the prose up, and the tiles, trail rows and search hits
share one restrained hover language (a hairline sheen and a 2–3 px slide) rather
than a different effect per panel.

### M3 — today's captures and the review queue (2026-10-21)

**Two dead tiles are live.** Quick access now counts what is waiting: **Today's
captures** shows how many notes were captured on the day in Settings → Clock, and
**Review queue** shows how many have a `next_review` date on or before it — an
accent number when there is something to open, a quiet `0` when there is not. Both
counts come from `/api/actions`, which also returns the day it counted, so the tile
and the list it opens cannot disagree about today.

**Today's captures** opens a sheet of that day's notes, newest first: a timed
capture is converted into the chosen zone (and names its zone), a bare date stays on
the day it was written, and each row opens the note in the reader. A note with no
capture stamp is absent rather than filed under an invented day, and the empty
state says so instead of showing a bare header.

**Review queue** lists notes whose own `next_review: YYYY-MM-DD` is due, oldest
first, labelled `Due today` or `3 days overdue`. It is a reading list, not a
scheduler: advancing the date is still an edit to the note's frontmatter, so it
goes through **Edit**, and a `next_review` that is not a real date is ignored rather
than guessed at. A review date moving changes the scan fingerprint, so an open
dashboard updates the count on its next vault check — and **Rescan vault** asks
immediately — without a reload.

### M3 — the keyboard palette (2026-10-21)

**`⌘K` / `Ctrl+K` now runs the dashboard.** A small key cap sits beside the
settings gear too, so the shortcut is discoverable rather than folklore. The
launcher lists the actions that can run right now — Rescan vault, Today's
captures (with its count), Review queue (with its count), Random note, the full
graph, New note when writes are on, Settings and the Core/Life sections — and
running one calls the same handler as the rail tile or header button.

**It is also a note jump.** Typing moves the lower half to `/api/search` hits,
with the same 180 ms debounce as the header field: title and path, opened in the
reader on Enter. Matching is case- and spacing-insensitive and ranked: an exact
label beats a prefix, a prefix beats a word start, a word start beats a
substring, and a letters-in-order fuzzy run comes last. That fuzzy run only
counts in a command's name or its hidden keywords, never its hint line, so
`settings` does not drag in every command whose description happens to share the
letters. Commands always sit above note hits, because acting is what the palette
is for.

**One modal at a time.** `↑`/`↓` wrap, Enter runs, `Escape` and the scrim close,
and focus returns to the control that opened the palette. `⌘K` does nothing
while the reader, settings, composer, graph or an action sheet is open, so there
are never two focus traps or two handlers claiming `Escape`.

**Smaller finishing touches.** A typed search is capped per group (nine commands,
six notes) so it never grows taller than the panel, while an empty palette lists
every command it counts — a token install has a tenth, `Lock dashboard`, and a cap
would have hidden it. The status line names how many of each matched, and a
failed search says so in place of an empty list instead of failing silent.

## Status — M3

- Vault scanning from `VAULT_PATH`, with recursive `.md` discovery, frontmatter parsing,
  tag extraction (block and flow lists), wikilinks and note bodies for search.
  Symlinked files and folders are not followed (so a note cannot be indexed twice);
  every link the walk meets is listed in `/api/notes` under `skipped` with
  `reason: "symlink"`, instead of vanishing without a trace. A `.md` file the walk
  listed but could not read — deleted mid-scan, permission denied, replaced by a
  folder — is reported separately under `unreadable` with its Node error code, and
  is never dropped from the report as if it had never existed. When a scan skips
  anything, the status strip adds `N symlinks skipped` next to the note count, and
  hovering it lists every skipped path; unreadable notes get their own
  `N notes unreadable` row in the failure colour, with every path and reason on
  hover — so a note that is in the folder but not in the vault index says where
  to look.
- `GET /api/health`, `GET /api/mode`, `GET /api/mode/stream`, `GET /api/stats`,
  `GET /api/notes`, `GET /api/notes/:path`, `GET /api/search`,
  `GET /api/recall/today`, `GET /api/graph`, `GET /api/links/broken` and
  `GET /api/life` are live.
- **Command palette**: `⌘K` / `Ctrl+K` (or the key cap in the header) opens a
  launcher for the actions that can run and a jump to any note. Commands carry
  today's counts and appear only when they can run (`New note` needs writes, the
  full graph needs a graph); typing searches the same index as the header field,
  `↑`/`↓` move, Enter runs and `Escape` closes. It calls the same handlers as the
  tiles, so it cannot do something the visible dashboard cannot. A token install
  adds `Lock dashboard` last, the keyboard twin of the header's lock button.
- **Search** across titles, tags, frontmatter and body text, with the matching field
  named per hit and a snippet centred on the match; a hit opens the reader. A hit
  converted from a note's own `captured_zone` names that zone under its date.
  **Voice** dictation fills the search box through the Web Speech API where the
  browser provides it, and the button explains itself where it does not. The API
  needs a **secure context**, which means `localhost` or HTTPS: opening the LAN
  address over plain `http://` leaves the mic unavailable (the button says
  `HTTPS` and why), so use `npm run dev:https` when dictating from another
  device — or just use the mic key on the phone's own keyboard, which needs no
  HTTPS.
- **Daily Recall**: one deterministic note per calendar day (date-seeded), title and
  tags first, **Reveal** for the body plus capture date (also naming the note's
  recorded zone when it has one), **Skip** for another note.
  The day comes from the **time zone chosen in Settings**, not the server's clock:
  the card sends that zone's `YYYY-MM-DD` to `/api/recall/today?date=…`, shows it as
  its date tag, re-seeds when the zone changes, and rolls over at the zone's midnight
  (checked every 30 s) — so a Tokyo day with a New York server still turns over at
  Tokyo's 00:00.
- **Unattended refresh** for a dashboard left open: Settings → **Vault refresh**
  offers every minute (default), every five minutes or off. Each check is one small
  `/api/stats` request carrying a fingerprint of the scan, so the notes index, graph
  and recall are re-read only when the vault actually changed — an idle dashboard
  repaints nothing, keeps a focused cluster and an open recall note, and never
  flashes the busy state. The server serves that poll from a scan cached in memory
  and invalidated by a recursive watch on the vault directory, so an unchanged
  vault costs no file reads. A hidden window never checks, and a tab that was asleep
  catches up the moment it is looked at. The status bar's `Synced` stamp is the last
  successful check.
- Dashboard shell styled after `docs/reference/jarvis.png`: near-black canvas,
  white type, one lime accent, segmented accent switch, oversized clock, status
  strip, metric rows with tick sparklines, area meter, index trail, action tiles.
- The centrepiece is a galaxy, not a ball of dots: one glowing node per indexed
  note on a projected 3D disk wound into four logarithmic arms, nearly face-on so
  both arms stay in view, drifting on its own and tilting toward the pointer.
  Under it sit ~9,000 dust stars — a dense bulge, thin dust along the arms, and a
  faint field between them — plus ~900 soft gas blobs, so the arms read as light
  with a body instead of a string of beads. The stars stay neutral white while the
  gas takes the accent, so the theme colours the room and not the galaxy. The
  whole disk is one composited layer with a single CSS transform per frame, and it
  is sized to the stage it is given (the viewBox is the frame's own pixel size),
  so a wide window gets a wide galaxy instead of a small one floating in black.
  Lines are **real connections** — a `[[wikilink]]` between notes, or a shared tag —
  so the ball is the vault's link structure, not decoration. The resolver *and* the
  `[[...]]` token grammar are the same module the reader and inline links use
  (`shared/wikilinks.ts`), so an edge and a clickable link never disagree about what
  a target means — including aliases, `#headings` and backslash escapes. Hovering
  shows the title
  in a fixed slot that never changes size: a long note name steps down in size to fit
  two lines instead of pushing the sphere around, and the fit is measured from the
  heading's real glyphs, font and tracking rather than estimated per character.
  Clicking a node **frames its cluster** — the camera eases round until that note faces
  you, the note and its direct links stay lit while the rest fade, and an **Open
  “Title”** button appears (a second click on the node opens it too). That button
  and the motion escape hatch share a permanently reserved row, so selecting a
  cluster never resizes the sphere; long labels ellipsise. Clicking empty space or
  `Escape` lets it go. Arrow keys + `Enter` still open a note, and notes with
  no connections stay on screen as dimmer, smaller nodes. The dots are only 3–8 px
  wide, so each one carries an invisible ~27 px pointer target — hover and click are
  not a pixel hunt. The galaxy has a heartbeat: the bulge breathes, a low ring expands
  from the core every 4.6 s while it is idle, and a crest travels outward through the
  notes, lifting each as it arrives. A real scan keeps its own faster, brighter ring.
  When a scan finds notes the index did not have before, each one **flares into
  its arm**: it flies out of the bulge along its own arm while a ring in its area
  colour expands and fades over 1.6 s. Up to eight arrivals flare — a folder
  import or a vault switch is a rescan, not a capture — and the first scan after
  a reload is a baseline, so opening the dashboard never sets the cloud alight.
  With **Cloud motion → Off** (or reduced motion in the OS) the sphere is a still frame
  with none of it.
- **The stage is a room, not a card.** Behind the galaxy sits a long, empty hall
  in one-point perspective — tiled ceiling with strip lights, a concrete floor with
  a joint grid, and a dark doorway at the far end — drawn once from a single
  vanishing point (`web/src/cloudVoid.ts`) and faded into the page at every edge so
  it has no frame and no obvious end. As the core turns under the pointer, that
  hall slides a few pixels the other way, so the gap between them reads as
  distance; with **Cloud motion → Off** it stays put. The room keeps the hour,
  too: its ceiling strips and doorway glow follow this device's local clock —
  dimmed overnight, lifting through dawn from 05:00, full by day, and dimming
  again after 18:00 — with a thin veil settling over the whole room after dark,
  so a dashboard left open dims into the evening. The notes drift a little of their
  own on top of the disk's rotation, and a soft pool of accent light sits on
  the floor under it, so the galaxy reads as hanging in the air rather than
  pinned to a backdrop.
- **Grab the core**: drag anywhere on the disk to turn it and scroll (or press
  `+`/`-`) to zoom; `R` resets the view. Releasing lets the flick carry, then
  springs the disk onto the nearest note, so the gesture ends with a note
  face-on instead of at an arbitrary angle. That landing is then held for a beat
  before the ambient drift resumes, and the focus slot names the note it landed
  on — its title, with `Settled · path` beneath — so the resting pose reads as a
  note rather than an anonymous dot. A landing also releases any cluster clicked
  before it, so the name and the Open button always agree. A drag never opens the
  note it ends on, and the still sphere is just as draggable.
- **Reactive core**: while the vault scans or a note loads, an accent ring pulses out
  from the sphere and the nodes breathe, so the core visibly works rather than just
  labelling itself. The pulse is held briefly after a fast scan and respects the
  motion setting.
- **Full screen**: the shell is sized for a monitor left open in F11. From
  1280x1000 up there is no page scrollbar and nothing is clipped — the rails
  tighten, the index trail anchors to the bottom left and the vault actions to the
  bottom right, and from 1600x1055 the type, sparklines and action tiles grow into
  the extra room. Smaller windows fall back to the ordinary scrolling page.
- **Motion** follows the OS `prefers-reduced-motion` setting by default; **Settings →
  Cloud motion** overrides it (System / On / Off) and is remembered locally. Vault
  refresh is a local preference too (`braindash.refresh`). While the
  sphere is still, a “Motion paused — turn it on” button sits under it, and hovering a
  node still brightens and lifts it.
- **Full graph** (`Full graph` tile, or the graph itself): a full-screen map of
  every note, grouped by area into four clusters and laid out deterministically, so
  a poll never reshuffles it. Drag to pan, scroll or press `+`/`-` to zoom around the
  pointer, `0` to fit the whole map again; the scale is shown beside the controls.
  Hovering an edge — or pressing `E`/`Shift+E` — focuses it: that line and its two
  notes stay lit, the rest dims, and a chip names the pair and whether it is a
  wikilink or a shared tag. Hovering a note lights its edges and labels its
  neighbours. Clicking a note opens it in the reader and closes the map; `Escape`
  closes, returning focus to the tile. Notes with no links are still on the map.
  Every node's halo breathes on its own stagger, and a heartbeat ring crosses the map
  every 4.6 s, lifting each dot as the crest reaches it, so the map pulses instead of
  sitting still; pointing at a node speeds its halo up, and a focused shared-tag edge
  crawls its dashes.
- **Captured timestamps obey the clock setting.** Every place a note's recorded
  time appears — the reader's metadata, search hits, the daily-recall stamp and the
  index-trail date — is formatted through the zone and 12/24-hour choice in
  Settings, e.g. `Oct 18, 2026 · 3:38 PM EDT` becoming `Oct 19, 2026 · 4:38 AM
  GMT+9` in Tokyo. A note can record the zone its wall clock was written in with
  `captured_zone: America/New_York`; that field is the conversion origin when
  present, and values without one are read in this machine's zone. An unknown zone
  is ignored, a note that records only a date keeps that date, and the 30-day
  capture sparkline and its `+N today` delta are bucketed in the selected zone so a
  count always belongs to the date on screen (each note's own zone applies there
  too). The unformatted string stays available as the hover title.
- Reading notes: clicking a node (or a row in the index trail, or **Random note**)
  opens that note in a reader with rendered markdown. Captured notes name
  the zone they were written in beside the converted time (`America/New_York`), so
  a stamp read in another zone shows what it was converted from; the index-trail
  tooltip names the same zone (`captured in America/New_York`). The reader ends
  with the note's **links out** (unresolved `[[targets]]` kept as inert chips) and
  **backlinks** — the notes that link here or share a tag — each one clickable. A
  link row is labelled with the alias the note wrote (`[[Beta#Top|B]]` reads `B`),
  because the scan stores the target, heading and alias the renderer splits rather
  than re-reading the brackets. An inline `[[Note#Heading]]` opens the note and
  **scrolls to that heading**, which is lit for a moment so the landing is obvious;
  the words and the slug form both match, and clicking the same link again scrolls
  again. The
  reader's metadata strip reports the note's **size on disk** next to its word count,
  and each index-trail row carries the same size before its arrow; both quote the
  shared formatter (`982 B`, `3.0 kB`, `1.04 MB`) and the exact byte count on hover.
- **Response hardening.** Every answer carries a strict
  `Content-Security-Policy` (`'self'` only, plus the inline styles and `blob:`
  media the UI genuinely uses), `X-Content-Type-Options: nosniff`,
  `frame-ancestors 'none'` with `X-Frame-Options: DENY`, `Referrer-Policy:
  no-referrer` and a microphone-only `Permissions-Policy`, so another page
  cannot frame the dashboard over **Delete** or get a note body sniffed as HTML.
  Every `/api` answer is `no-store`, and `/api` only answers a `Host` that names
  this machine — loopback, `*.localhost`, a literal address, or a name in
  `BRAINDASH_HOSTS` — which turns away the DNS-rebinding page that would
  otherwise read a tokenless install. The LAN view is unaffected.
- **Shared access token (opt-in).** Setting `BRAINDASH_TOKEN` locks every API
  read, so another device on the network cannot read the vault by opening the
  same Vite address: it gets an unlock card first, and the dashboard mounts only
  after the token is accepted. The token is traded once for an `HttpOnly`
  cookie that lasts a week — the page never stores it — and scripts can send
  `Authorization: Bearer` instead. The header's **lock** button (and `Lock
  dashboard` in the command palette) ends that cookie from the dashboard itself
  and drops straight back to the unlock card, so a shared or walked-away-from
  browser needs no cookie-clearing detour; the installs with no token have no
  session, so they show no lock at all. Unset, the single-machine install is
  exactly as it was.
- **Editing the vault (opt-in).** `BRAINDASH_WRITE=1` adds **Edit** and **Delete**
  to the reader and a **New note** tile to Quick access. Saves are atomic, keep the
  previous version under `<vault>/.trash/<stamp>/`, and refuse a note that changed
  since it was opened instead of overwriting it; Delete moves the note to `.trash`.
  A **Trash** tile (and `Open trash` in the palette) lists what is recoverable —
  title, path, when it was deleted, its size — and puts one note back at its old
  path, opening it in the reader; a filename that has been re-used is refused with
  `409` rather than replaced, so a restore never overwrites newer work. Writes are
  accepted only from this machine, so the phone-friendly LAN view stays read-only. Without the flag the API and every control are read-only, and the
  dashboard says so in the footer and the reader.
- **LIFE section** (`Life` in the top navigation, `#life` in the URL): seven areas —
  Health, Money, Business, Learning, Focus, Relationships, Habits — as a small 3D
  sphere in the same HUD style as the vault core. Each node is sized, glowed and
  coloured green/amber/red by its 0–100 score over the last 7 days, and clicking one
  opens a side panel with today's value, the 7-day average, a trend arrow and a
  14-day sparkline per daily metric; Money's monthly figures (net worth, credit
  score, utilization, savings rate) sit together in a latest-month card with their
  month-over-month change, coloured green when the move is a good one. The HUD shows
  the overall score and today's date — the calendar day of the zone the clock is set
  to, so LIFE and the header clock never disagree about which day it is; the right-hand rail tracks workout / study / win streaks (current and
  best), the last eight weeks of 1–10 ratings, and warnings for an area whose weekly
  rating fell two weeks running or whose 7-day score is under 40. The footer shows
  the latest `win`.
- **Life data**: read from `Daily/YYYY-MM-DD.md`, `Monthly/YYYY-MM.md` and
  `Weekly/YYYY-Www.md` beside the vault. Missing folders, files and fields are
  treated as empty, never as errors; if all three folders are empty the section shows
  generated demo data with a **DEMO DATA** badge. LIFE re-reads `/api/life` whenever
  the dashboard's vault check runs, so it follows Settings → **Vault refresh** (every
  minute by default, or no automatic checks when off) and a revisit to `#life` reads
  once, instead of polling on its own 5-second clock. It keeps the last good
  snapshot if a read fails. Templates live in each folder (`_template.md`), and
  targets are one edit away in `web/src/lifeConfig.ts`. The app itself still only
  reads.
- **Sound deck** (waveform button in the header): a generated ambient bed —
  detuned pad, slow filter sweep, pink-noise air and sparse pentatonic pings through
  a synthesised reverb — that needs no file and never touches the network. The same
  deck imports your own audio (`mp3`, `m4a`, `aac`, `ogg`, `opus`, `wav`, `flac`) and
  **mp4**/**m4v**/**mov** audio tracks, keeps them in IndexedDB in this browser, and
  plays them through a hidden audio element; importing a file plays it immediately,
  the newest lists first, and each row has play/stop and remove. Volume is shared by
  both sources and remembered; nothing auto-plays on load because browsers block
  audio without a click. Nothing is uploaded and nothing is written to the vault.
- **Vault size** in the left rail: total bytes of the `.md` files the scan read,
  the average per note, and a one-click **largest note** shortcut that opens it.
- **Link health** in the right rail: the graph's broken `[[wikilinks]]`, counted and
  grouped by the words each note shows — the alias when it wrote one, otherwise the
  bare target. Two notes that misspell the same intended note the same way share a
  group even when their targets differ (`[[Missing Note|roadmap]]` and
  `[[Other Ghost|roadmap]]` are one `roadmap` group), so the report names the label
  to fix instead of repeating the same mistake per target. The card previews three
  labels; **Report** opens the full list, where each group shows its unresolved
  targets as `[[…]]` chips and one row per note with the link it actually wrote and
  its path. Clicking a row opens the note in the reader. It reads
  `/api/links/broken`, follows every rescan, and never writes to the vault.
- **Dependency health** in the right rail: how many lockfile entries are behind a
  range `package.json` already allows, from the same `npm outdated` comparison the
  weekly CI drift job runs (`/api/deps`, cached for 15 minutes; **Recheck** forces a
  fresh run). It names up to three packages as `current → wanted`, mentions newer
  majors that sit outside the declared ranges, and keeps a failed check in the card
  as a one-line reason rather than pretending the lockfile is clean. It reads this
  repository, not the vault, and needs no token.
- **Clock**: 12-hour by default (`6:30:05 PM`), switchable to 24-hour, in the system
  zone or any IANA zone (Settings → Clock, e.g. `America/New_York`). The header
  clock, the status-strip sync time and the reader's modified stamp follow it,  and
  so does every date: capture stamps in the reader/search/recall/trail, the 30-day
  sparkline's buckets (re-bucketed when that zone's midnight passes, even if the
  vault is idle), LIFE's "today" and win date, and the day the recall card picks
  all come from that zone. Its real abbreviation (`EDT`) is shown next to the
  date.
- Five accent themes (orange, jarvis, amber, crimson, ice) switchable from the
  header pills or the settings panel, saved locally; orange is the default.
- Today's captures and the Review queue are live quick actions: `/api/actions`
  counts them for the chosen day, and each opens a sheet of notes
  (`/api/captures/today`, `/api/review/queue`) that opens the reader. The `⌘K`
  command palette reaches the same actions from the keyboard.

## Requirements

- Node.js **20.19+** (24.x recommended)
- A local folder of Markdown notes. **Keep the project on a local disk** — do not put
  `node_modules` inside Google Drive / OneDrive folders; those filesystems fail
  npm's concurrent writes (`EBADF` / `EPERM`).

## Setup

```bash
git clone <repo> C:\Users\<you>\Projects\BrainDash   # or just copy this folder
cd C:\Users\<you>\Projects\BrainDash
npm install

cp .env.example .env
# edit .env → VAULT_PATH="/path/to/your/vault"
```

`.env` is gitignored. `VAULT_PATH` must be the folder to scan and may contain
spaces. Use forward slashes: inside a double-quoted value, dotenv interprets
`\r`, `\n` and `\t` as escapes, so `C:\Notes\Brain` would silently become
a broken path.

```dotenv
VAULT_PATH="/path/to/your/vault"
BRAINDASH_WRITE=1       # optional: edit/create/delete notes from this machine
# BRAINDASH_TOKEN=...   # optional: require this token on the LAN (see below)
# BRAINDASH_HOSTS=brainbox.local:5181   # optional: answer an extra Host name
# BRAINDASH_PORT=5181   # optional override; PORT is deliberately ignored
```

Writing is off unless `BRAINDASH_WRITE=1` is set. Even then, the API accepts a
write only from loopback; another device opening the Vite address gets the same
dashboard with the editing controls hidden, and a hand-made request from it is
refused with `403`. Deleted notes are recoverable from the **Trash** tile (or
`Open trash` in the palette), which restores one at its old path and opens it.

A shared token is optional and independent of writing. Set `BRAINDASH_TOKEN` and
every API read needs it — `/api/session` is the only route left open, so the page
can ask whether to show the unlock card — which is what stops a phone on the LAN
from reading the vault through the same dashboard. The card stores the answer in
an `HttpOnly` cookie for a week (never the token itself), and curl or a script
can send `Authorization: Bearer <token>` instead. The dashboard's **lock**
button (topbar, beside the gear; also `Lock dashboard` in the palette) ends that
cookie without a trip to the browser's settings and returns to the unlock card.
It affects only the browser that clicked it — the token still works everywhere
else. Leave the variable unset for a single-machine install: nothing is asked
and nothing changes.

A name-based LAN URL needs one more variable. `/api` answers loopback names,
`*.localhost` and literal addresses out of the box; if you reach the dashboard
through a DNS name (an mDNS name or a hosts-file alias), list it in
`BRAINDASH_HOSTS` — `name:port` pins the port, a bare `name` allows any. Anything
else gets `403 host_not_allowed`, a browser-side guard against DNS rebinding
rather than a second password.

## Run

```bash
npm run dev
```

One command starts both processes:

| Process  | URL                      | Notes                                  |
| -------- | ------------------------ | -------------------------------------- |
| Frontend | http://localhost:5180    | Vite dev server, proxies `/api` → 5181 |
| Backend  | http://127.0.0.1:5181    | Express, scans the vault; edits are opt-in and loopback-only |

The Vite server binds every interface (`server.host: true`), so another device on
the same network can open `http://<this-machine-ip>:5180` — the launch output
lists the addresses. The browser still calls the API with relative `/api` URLs,
and Vite proxies them to loopback 5181 on this machine, so the backend itself is
not exposed to the network and no CORS setup is needed. That LAN view is open
unless you set `BRAINDASH_TOKEN`: then the device gets an unlock card before any
vault read (see **Setup**).

**Voice on another device needs HTTPS.** Browsers only hand the microphone to a
secure context (`https://` or `localhost`), so the plain HTTP LAN address leaves
voice unavailable — the mic button says `HTTPS` and explains why instead of
claiming permission was denied. Stop the running dev command and start
`npm run dev:https` instead, then open `https://<this-machine-ip>:5180` on the
phone. The certificate is self-signed and names only `localhost`, so the phone
shows its warning once: on Chrome tap **Advanced → Proceed**, on Safari **Show
Details → visit this website**. The page is then a secure context and the mic
button works; the certificate lives under `node_modules/.vite/basic-ssl` and
nothing is installed into the OS or device trust store. No HTTPS at all is a
valid choice too: the phone keyboard's own dictation key types into the same
search box, so the dashboard's mic is a convenience, not the only way in. The
API proxy still targets loopback, and writes stay limited to this machine, so
HTTPS does not make the vault editable from a phone.

The header shows the resolved vault path and the number of `.md` files found;
that count is the M0 acceptance check. `Rescan vault` refreshes it with a forced
scan, bypassing the watch-backed cache.

Other scripts:

```bash
npm run typecheck     # tsc for server and web
npm test              # node:test suites for server and web (no test framework)
npm run test:coverage # same suites with Node's V8 coverage table
npm run build         # compile server/dist + build web/dist
npm start             # serve the source server via tsx on 5181
npm run start:built   # serve the compiled server/dist on 5181
npm run smoke:built   # boot server/dist against a scratch vault and probe the API
npm run perf:core     # headless-Chrome frame budget for the animated core
npm run check:lockfile # npm ci --dry-run: package.json and the lockfile agree
npm run check:eol     # fail if a tracked text file is CRLF in the index or this checkout
npm run check:deps    # report registry drift (fails on a stale in-range lockfile)
npm run drift:issue   # open, update or close the drift issue from .ci/deps.json
npm run ci:summary    # test totals + build sizes, for the Actions run summary
```

Tests use `node:test` + `node:assert` only: no Jest, Vitest or testing-library.
Each workspace keeps them in `test/` next to the code they cover, and
[`scripts/run-tests.mjs`](scripts/run-tests.mjs) runs them through the tsx loader
(the server's `tsx` dev dependency, already installed) so TypeScript and JSX need
no build step. `npm test -w server` and `npm test -w web` run one side. A trailing
argument narrows the run to files whose path contains it — `npm test -w server --
vault`, `npm test -w web -- cloudLabel` — and a filter that matches nothing prints
the available files and exits non-zero, so a typo cannot pass as a green run.
The server suite also starts the real Express app on an ephemeral port against
temporary vaults, so API status codes, error shapes, the 5 s fallback cache and
the unconfigured-vault `503` are exercised over HTTP rather than by calling
handlers directly.

`npm run test:coverage` turns on Node's built-in V8 coverage report — line,
branch and function percentages plus the uncovered line ranges — for both
workspaces. It needs no extra dependency and uploads nothing. Use it with the
full suite for an honest picture: the report only includes modules a run
actually loaded, so `npm test -w server -- vault --coverage` is useful while
working on one module but does not claim coverage for the rest of the server.
It is a gap finder, not a CI gate; the build does not fail on a percentage.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and every
pull request, and again **weekly** (Mondays 06:00 UTC) or on demand via
*Run workflow*. `check` is the familiar gate — `npm run check:eol`,
`npm run check:lockfile`, `npm ci` (on a cache miss), `npm run typecheck`,
`npm test`, `npm run build` — on a matrix of `ubuntu-latest` and
`windows-latest`. The Windows leg exists because this is the
platform the project is developed on: it is the only runner where backslash
paths, Windows temp directories and the `fs.symlink` fallback in the vault tests
behave as they do at the desk. Line endings are not one of those differences,
because [`.gitattributes`](.gitattributes) normalizes every text file to LF and
marks images and media as binary, so a checkout is byte-identical on both runners
regardless of `core.autocrlf`. Editors are asked for the same answer up front:
[`.editorconfig`](.editorconfig) sets LF, UTF-8, a final newline and two-space
indents, with CRLF only for `.bat`/`.cmd`/`.ps1`, so a saved file is already what
the checkout wants. The gate asserts that rather than trusting it:
`npm run check:eol` reads both halves of `git ls-files --eol` — the working tree
in front of you and the index that would be committed — and fails naming any
tracked text file whose disk copy *or* whose staged blob ends a line with CRLF.
The disk half catches an editor writing CRLF or a rule that stopped matching; the
index half catches the blob that got past the filters, which is only visible on
the next machine's checkout. Binary files and paths declared `eol=crlf` (the
launcher rules) are skipped by design in both halves.
`fail-fast` is off, so one platform failing still reports the other. `check` builds once and uploads `server/dist` and `web/dist`
from **both** legs as `built-app-ubuntu-latest` / `built-app-windows-latest`, so
any green run's output can be downloaded from its run page and inspected. The
artifacts are kept for 14 days, which covers "what did last week's run emit?",
and a re-run replaces the copy it made earlier instead of failing on the
duplicate name. The install is shared too: each Linux job restores the same
`node_modules` cache entry, keyed on the lockfile hash and the resolved Node
version, so the three of them extract one tree instead of three. `check` fills
it on a miss (the key changes with the lockfile); `smoke` and `perf` only ever
restore it, and `npm ci` still runs whenever the key misses — an evicted cache,
a lockfile bump, or a branch whose key has never been saved. The Windows leg
keeps installing from scratch on purpose: npm links workspaces with junctions
there, and an archive round-trip is not worth risking that leg's fidelity.
`smoke` depends on `check` and runs on **both** platforms, each leg downloading
its own `built-app-<os>` artifact and running `npm run smoke:built` against the
exact bytes its own check leg produced — no second build, so a smoke failure
cannot be a different build that happened to differ. The Windows leg is the only
one that boots the Windows-compiled entry against Windows paths, a Windows temp
vault and `npm.cmd` behind `/api/deps`; the Linux copy cannot stand in for it.
Both legs report independently (`fail-fast: false`). A temporary vault is
created, the compiled server listens on a free loopback port, and real HTTP
requests cover health, notes, note reading, search, graph, broken links, recall,
LIFE, mode, the action catalogue, `404` and the built dashboard. Before the server
starts the scratch vault is snapshotted (SHA-256, size and mtime per file), and
after the last probe it must be byte-for-byte unchanged — the read-only probe
path is a passing assertion, not a caption. (The smoke run never sends a write,
so this stays true even when `.env` enables editing.) The same walk runs over
the checkout the server was started from, so a log, cache or config file
dropped beside the code fails the job too — the vault-only walk could not see
one. Two trees are outside that proof, for the same reason: `node_modules` (a
Vite dev server caches into it, so a local run beside `npm run dev` would be
noise) and `.git`. Writes made *through* a symlink are outside both proofs,
because neither walk follows links. The scratch vault is deleted afterwards.

A separate `perf` job measures the animated core instead of asserting it. It
restores the same Ubuntu artifact and the same dependency cache, boots the
compiled server against a temporary
**160-note** vault (the cloud's node cap), opens the built dashboard in headless
Chrome at 1440×900, forces cloud motion on and samples Chrome's own
`ScriptDuration`, `RecalcStyleDuration` and `LayoutDuration` counters for four
seconds. It fails when that animation work exceeds its budget — **14 ms per
frame**, of the 16.7 ms a 60 Hz frame allows, on a workstation and **24 ms** in
CI — or when the loop paints fewer than 10 fps, which
is a liveness floor rather than a target (a node's projected position must also
change before and after the sample, so a stopped loop cannot look cheap). The
budget deliberately excludes paint and rasterisation: a headless runner has no
GPU, so its total frame cost is dominated by software painting that the machine
the dashboard is used on does not do. `npm run perf:core` is the same check locally after `npm run build`;
`CHROME_PATH` selects a browser, and the usual Chrome/Edge/Chromium locations are
searched otherwise. `PERF_FRAME_BUDGET_MS`, `PERF_MIN_FPS` and `PERF_SAMPLE_MS`
override the budget, floor and sample window. It runs on Ubuntu only, so the
budget is a regression baseline for one rasteriser rather than a cross-platform
FPS claim. The two budgets differ for a measured reason: the commit that first
ran this job measured **4.92 ms/frame on a workstation** and **16.25 ms/frame on
the shared runner**, so a single 14 ms line would have failed on the runner's
class rather than on the code. CI therefore runs at 24 ms — enough for that
machine, still less than half of what a real regression (a doubled draw loop)
would cost — while a local `npm run perf:core` keeps the stricter 14 ms.

To inspect an artifact by hand, unzip it over a checkout that has run `npm ci`
and run `npm run start:built`: the zip holds both directories at their workspace
paths, so the compiled server finds `web/dist` where it expects it. Before `check` finishes, `npm run ci:summary` appends a short table to
the **run summary** (the Actions page, not just the logs): tests, passed, failed,
skipped and duration per workspace with an aggregate row, then each build's file
count, raw and gzipped size and three largest files. The totals are not
re-counted; `run-tests.mjs` captures the runner's own summary into
`.ci/tests-<workspace>.json` while the suites run, and the summary step reads
that. Both matrix legs publish their own block under the runner's OS name, so a
green run says what actually executed on each platform.

The scheduled run adds a third job, `drift`, which installs nothing
and restores no npm cache, so it genuinely asks the registry: `npm ci --dry-run`
proves the lockfile still satisfies `package.json` and every locked tarball still
resolves, then `npm run check:deps` compares each dependency's locked version with
what its declared range now allows. A lockfile that has fallen behind its own
range fails the job with the exact packages and the `npm update` fix; newer major
versions are printed and written to the job summary but do not fail it, because
bumping a major is a decision for a person.

The result lives in one issue rather than only in a run's history.
`check-deps.mjs` leaves its classified report in `.ci/deps.json`, and
`npm run drift:issue` runs afterwards (with `if: always()`, since the check exits
1 exactly when an issue is needed) to keep a single open issue labelled
`dependency-drift`. Stale packages open it, or rewrite its title and body when it
is already open — no weekly comment, because the body is the state. When every
lockfile entry matches its range, the script comments once, closes the issue, and
keeps the informational newer-majors table in that comment. Duplicate issues are
folded into the oldest. If the check never produced a report (npm failed), the
issue is left alone instead of being closed on missing evidence. The script uses
`fetch` with the built-in `GITHUB_TOKEN`; `issues: write` is granted to the
`drift` job only, `contents: read` covers everything else, and no personal access
token or stored secret is involved. A newer commit on the same branch cancels the
run it supersedes, so a fork's pull request is still safe to build. The repository
has no remote configured yet; the issue and the workflow start reporting once
this is pushed to a GitHub repository.

## Themes

Click the sliders button beside the clock to pick an accent — **orange** (default),
**jarvis**, **amber**, **crimson**, or **ice** — and to set cloud motion. By default
**Theme source → Auto** follows the OS light/dark setting and the clock: a light
desktop gets the bright pair, a dark one the calm pair, and the hour picks within
that, so the HUD drifts amber → orange → crimson → ice across the day. The canvas
stays dark either way. Picking an accent switches to Manual and sticks, and the
header always highlights whichever accent is actually painted. Preferences live in
`localStorage` under `braindash.themeMode` / `braindash.theme`, are applied before
first paint, and recolor chrome, glows, sparklines, and the node cloud. Palettes are defined once in `web/src/themes.ts`.
Every colour the cloud paints is a theme token — area dots, the spark field, the
dim "unset" nodes and the dashed shared-tag edges included — so switching accents
leaves nothing behind in a fixed grey. The spark field is the one layer outside
the accent's hue family: each palette gives it a pale, muted complement, so the
~150 loose sparks read as depth behind the notes instead of as faded nodes. The
spacing is checked in CIEDE2000 rather than hue degrees — every spark stays at
least 25 ΔE2000 from its palette's node shades and 10 from the other four sparks —
because two pale pastels can be far apart on the wheel and still read alike.
The Settings cards preview each palette as it paints — accent, bright, dim, the
untagged-node shade and the spark tint — so a dark untagged node or a pale spark
band can be judged before picking. Each card also carries a visually hidden
sentence naming all five bands with their hex values, so the preview is not
visual-only. Nothing about the theme touches the vault.

## API

All endpoints are JSON. Reads are always available, unless `BRAINDASH_TOKEN` is
set — then every route except `/api/session` needs the token and answers `401`
without it. The four write endpoints — save, create, delete, restore — require
`BRAINDASH_WRITE=1` and a loopback request.

| Method | Path                 | Status | Purpose |
| ------ | -------------------- | ------ | ------- |
| GET    | `/api/session`       | —  | `{ required, authenticated }`: whether a token is configured and whether this request presented it. The only route outside the token gate |
| POST   | `/api/session`       | —  | Unlock with `{ token }`; sets the `HttpOnly` one-week cookie. `401 bad_token` when it does not match |
| DELETE | `/api/session`       | —  | Clears this browser's session cookie (`Max-Age=0`) and answers `{ required, authenticated: false }`; the Lock button and palette row call it |
| GET    | `/api/health`        | M0 | Liveness, vault path, configured flag, note count, and `writes` (whether this client may edit; false on the LAN) |
| GET    | `/api/stats?tz=`     | M0 | Totals, area/origin split, 30-day captures and `captures30d` bucketed in `tz` (an IANA zone; malformed values keep the server clock), last capture with its `capturedZone`, `totalBytes` and `largestNote` |
| GET    | `/api/notes`         | M1 | Note summaries: `path`, `title`, `captured`, `capturedZone`, `nextReview`, `origin`, `area`, `words`, `bytes`, `keywords` |
| GET    | `/api/notes/:path`   | M1 | One note: summary fields (including `capturedZone`) + raw `markdown`, `size`, `modifiedAt`, plus `outbound` links and `backlinks` |
| PUT    | `/api/notes/:path`   | — | Replace a note with `{ markdown, baseModifiedAt? }` (writes on, loopback only). Answers the re-read note plus the `.trash` `backup`; a changed file is `409` |
| POST   | `/api/notes`         | — | Create `{ path, markdown? }`; `201`, or `409` rather than replacing an existing note |
| DELETE | `/api/notes/:path`   | — | Move a note into `.trash` and return where it went |
| GET    | `/api/trash`         | — | Everything recoverable, newest first: `trashPath`, `total`, `entries` (`id`, `path`, `title`, `trashedAt`, `size`); a read, so a token install can look without edit rights |
| POST   | `/api/trash/restore` | — | Put `{ id }` back at its old path (writes on, loopback only); `201` with the note, `409` if a newer note took the filename |
| GET    | `/api/graph`         | M2 | `nodes` (`id`, `title`, `tags`, `area`) and `edges` (`source`, `target`, `type`: `wikilink`/`tag`) from the notes' own wikilinks, plus `isolated` and `unresolved` links |
| GET    | `/api/links/broken`  | M2 | The graph's `unresolved` targets grouped by the label each note wrote: `total`, `groups` (`label`, `targets`, `notes` with `path`/`title`/`target`/`alias`) |
| GET    | `/api/search?q=term` | M2 | Case-insensitive search of title, tags, frontmatter and body; each hit carries `match` (`title`/`tag`/`frontmatter`/`body`), `snippet`, `captured` and `capturedZone` |
| GET    | `/api/recall/today`  | M2 | Date-seeded daily pick (`?skip=n` for another, `?date=YYYY-MM-DD` for the client's zone day; malformed dates fall back to the server day): `date`, `skip`, `total`, `note` (`path`, `title`, `tags`, `captured`, `capturedZone`, `markdown`) |
| GET    | `/api/actions`       | M3 | The rail's server-backed actions for a day (`?tz=`, `?date=`): `date`, `timeZone`, `actions` (`id`, `label`, `count`, `hint`); `no-store` |
| GET    | `/api/captures/today`| M3 | Notes captured on that day, newest first: `date`, `timeZone`, `total`, `notes` (summaries, `nextReview` included) |
| GET    | `/api/review/queue`  | M3 | Notes whose `next_review` is on or before the day, oldest first: `date`, `timeZone`, `total`, `overdue`, `notes` |

Errors are `{ "error": string, "detail"?: string }` with `400`, `401`, `403`,
`404`, `409`, `413`, `415`, `500`, `503` (`unauthorized` and `bad_token`
only when `BRAINDASH_TOKEN` is set; `invalid_path`, `not_markdown`,
`not_found`, `vault_scan_failed`, `search_failed`, `graph_failed`,
`broken_links_failed`, `recall_failed`, `note_read_failed`, `actions_failed`,
`captures_failed`, `review_failed`, `vault_not_configured`, `host_not_allowed`
(a `Host` that is not this machine), plus `write_disabled`, `write_forbidden`,
`invalid_markdown`, `note_conflict`, `note_exists`, `note_too_large` and
`unsupported_media_type` on the write routes). An unknown `/api/*` path or unsupported method answers
JSON `404` even when the built SPA is being served. A missing or unreadable
`VAULT_PATH` makes `/api/health` report `configured: false` and every scan-backed
route return `503 vault_not_configured` (`/api/stats` also carries
`configured: false`); the UI shows a setup hint instead of empty panels. A
successful scan is kept in memory
and invalidated by a recursive watch on the vault directory, so an idle refresh
poll reads no note files; if the OS refuses the watch, the cache falls back to a
five-second TTL. `?refresh=1` (the manual Rescan button) bypasses the cache and
reads the vault anyway.

## Vault safety

- Without `BRAINDASH_WRITE=1` the server only calls `fs.readdir` / `fs.readFile`;
  every route is a read, and `/api/health` reports `writes: false`.
- `/api/notes/:path` resolves inside `VAULT_PATH` before reading: absolute paths,
  `..`, hidden directories, `_assets` and non-`.md` targets are rejected with `400`,
  and symlink escapes are caught via `fs.realpath` + `path.relative` (a link
  pointing out is `400 invalid_path`; a dangling one is `404`, and a link cycle is
  `404` rather than an escape or a hang). `npm test` builds real links in a
  temporary vault to prove it, skipping only where the OS forbids creating them.
  Unknown notes are `404`.
- Writes repeat that containment check and, for a new note, check the nearest
  existing parent folder's real path too, so a symlinked folder cannot redirect a
  create out of the vault. A save writes a dot-prefixed temp file beside the note
  and renames over it; a failure leaves the previous body intact.
- Replaced and deleted notes are copied or moved into `<vault>/.trash/<stamp>/`
  (preserving their relative path) before the replacement appears. The scan skips
  `.trash`, so trashed notes leave the dashboard but are recoverable in Obsidian.
- A save must carry the `modifiedAt` it opened; a file changed since then answers
  `409 note_conflict` instead of being overwritten. Creates never replace an
  existing file (`409 note_exists`), bodies are capped at 1,000,000 bytes (`413`),
  and only JSON is accepted (`415`).
- Only loopback may write: the socket address, the Host header and (when sent) the
  Origin must all be local. Requests proxied from another device on the LAN are
  refused with `403 write_forbidden`, and `/api/health` tells that client
  `writes: false` so its dashboard hides the editing controls; reads keep working.
- Every response carries the hardening headers and every `/api` answer is
  `no-store`; `/api` also refuses a `Host` that is not loopback, `*.localhost`, a
  literal address or a `BRAINDASH_HOSTS` entry (`403 host_not_allowed`). The
  policy and the reasons are in [docs/SPEC.md](docs/SPEC.md#response-hardening).
- **Your notes never travel with the code.** `VAULT_PATH` names a folder outside
  this checkout, and nothing from it is committed: `.env`, `.freebuff/`,
  `screenshots/`, scratch `.tmp-*` folders and files, and any `.vault/`, `.obsidian/`,
  `.trash/`, `notes/` or `inbox/` directory inside the checkout are gitignored, so
  even a broad `git add -A` cannot sweep a note into a commit.
  `server/test/repoHygiene.test.ts` checks that through git itself — no tracked
  path is a vault path, `.env` stays untracked, and the ignore rules still cover a
  copied-in vault — so it fails the day one slips in rather than relying on a
  hand-kept file list. [.env.example](.env.example) holds placeholders only, and
  the setup steps use `<vault>` rather than anyone's real path. The vault folder
  itself is never created, renamed, or deleted by this project.

## Layout

```
BrainDash/
├── AGENTS.md             # working-mode contract: ask, or decide and keep going
├── scripts/mode.mjs      # `npm run mode work|home|clear` + switch log
├── scripts/run-tests.mjs # node:test runner for both workspaces (via tsx)
├── docs/SPEC.md          # architecture, API, panel list, milestones
├── docs/working-mode.md  # mode protocol, schedule, state format, assumptions
├── docs/DECISIONS.md     # assumptions taken while working unattended
├── server/
│   ├── src/
│   │   ├── index.ts      # Express app, routes, static serving in prod
│   │   ├── accessToken.ts # optional shared token: hashing, cookies, the gate
│   │   ├── life.ts       # Daily/Monthly/Weekly reader (never throws)
│   │   └── vault.ts      # vault walker, frontmatter parser, stats, guarded writes
│   └── test/             # path rejection, index, search, graph, life parsing
├── web/
│   ├── test/             # markdown, cursor, motion, label fitting, life scoring
│   └── src/
│       ├── App.tsx       # command-center shell + CORE/LIFE navigation
│       ├── life.ts       # scoring, streaks, weekly series, alerts, demo data
│       ├── lifeConfig.ts # editable targets and area definitions
│       ├── life.css      # LIFE section + navigation styles
│       ├── ambient.ts    # generated ambient engine (Web Audio, no files)
│       ├── tracks.ts     # IndexedDB track store + import rules
│       ├── audio.css     # sound deck styles
│       ├── graphLayout.ts # deterministic area-cluster layout for the map
│       ├── graph.css     # full-screen graph styles
│       ├── cloudCursor.ts # cloud keyboard cursor rules (arrow keys, Enter)
│       ├── palette.ts    # command catalogue, ranking and arrow-key rules
│       ├── api.ts        # JSON reads, write requests, session unlock and lock
│       ├── access.ts     # whether the dashboard may render (token gate)
│       ├── sessionLock.ts # the gate's lock, offered to header and palette
│       ├── notePath.ts   # typed new-note path checks (the API re-validates)
│       ├── components/   # Clock, StatCard, Sparkline, NodeCloud, QuickActions,
│       │                 # SearchBar, DailyRecall, NoteReader, NoteComposer,
│       │                 # SettingsPanel, LifeSection, LifeSphere, AmbientDeck, FullGraph,
│       │                 # CommandPalette, AccessGate (unlock screen),
│       │                 # TrashPanel (recoverable notes)
│       ├── useVoiceInput.ts # Web Speech API wrapper with graceful fallback
│       ├── types.ts      # API response types
│       └── styles.css    # dark theme tokens, five accents
├── shared/
│   └── wikilinks.ts      # one [[wikilink]] resolver, server and dashboard
├── .env.example
└── package.json          # workspaces + concurrently
```

## Troubleshooting

- **`Port 5180 is already in use`** — another dev server is running. Close it or
  find the listener with `netstat -ano | findstr :5180`.
- **Vault offline banner** — `VAULT_PATH` missing, quoted with backslashes
  (which dotenv mangles), or pointing at a folder that no longer exists.
- **API answers on the wrong port** — this project reads `BRAINDASH_PORT`, not
  `PORT`; shells and CI runners often export `PORT=0`.
