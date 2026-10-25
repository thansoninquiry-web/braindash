# Decision log

Choices made without asking, newest first. One bullet each: what was decided, why,
and what would overturn it. Read this when you get back — it is the part of an
unattended session that needed a human.

`Approvals needed` collects work that was deliberately **not** done because it is
irreversible or externally visible (commits, deploys, signups, vault writes).

## 2026-10-19 — Windows CI leg

- **The `check` job became an `ubuntu-latest` + `windows-latest` matrix.** The
  project is written and used on Windows, and several suites only mean something
  there: `vaultSymlink.test.ts` creates junctions or skips when the OS refuses a
  link, `resolveNotePath` is fed backslash paths, the API and index suites write
  temporary vaults under the Windows temp directory, and `git` hands files back
  with CRLF. Running only on Ubuntu left those paths untested on the platform
  that runs them daily. `fail-fast: false` keeps both results visible when one
  breaks. Would be reverted if the extra runner minutes outweighed the platform
  signal.
- **The smoke job stays Ubuntu-only.** It proves the compiled artifact and real
  HTTP behaviour, which are platform-independent once the build works, and the
  Windows `check` leg already runs the build. A Windows smoke leg can be added
  later without changing the script, which only uses `node:child_process`, `net`
  and `os.tmpdir()`. Would change if a failure unique to Windows packaging
  appeared.
- **The cache is keyed per runner.** `actions/setup-node`'s `cache: npm` follows
  the matrix `os`, so a Windows leg downloads its own cached modules instead of
  restoring POSIX-built native binaries; npm reuses the downloaded archives, so
  the cost stays reasonable.
- **The CRLF path was rehearsed locally before relying on CI.** A copy of the
  sources with every line ending rewritten to CRLF ran the full server and web
  suites and both tsconfigs on Windows (`174 + 208` passing, both `tsc` runs
  clean). Checkout on Windows already produces CRLF through `core.autocrlf=true`,
  so the new leg tests what the desk runs. At the time no `.gitattributes`
  pinned line endings; the 2026-10-20 entry below adds one, so a fresh checkout
  now arrives LF on both runners and this rehearsal remains the record that CRLF
  working trees were tested before the rule existed.

## 2026-10-19 — built-server CI smoke

- **The smoke job compiles the server instead of reusing `tsx`.** "Built server"
  means the artifact, not the dev entry point: `server/tsconfig.build.json` emits
  JavaScript, and `server/dist/server/src/index.js` is what CI boots. This caught
  a real module-format bug (`shared/wikilinks.ts` compiled as CommonJS), which a
  `tsx` smoke run would have hidden. Would change if the server moved to a bundler.
- **The output keeps the source-relative layout and copies `scripts/mode.mjs`.**
  `vault.ts` imports `shared/wikilinks.js` by relative path, and `workingMode.ts`
  imports the CLI's `scripts/mode.mjs`; flattening the output would break both.
  The build copies that one runtime module into `server/dist/scripts/`, so the
  API and `npm run mode` keep sharing one resolver. Would be replaced by a
  proper shared package if the mode logic grows.
- **The compiled entry gets `BRAINDASH_ROOT` explicitly.** From
  `server/dist/server/src`, the old two-levels-up inference finds `server/dist`,
  not the repository root, so `.env` and `web/dist` would be missed. `start:built`
  and the smoke script set it; source runs keep the old inference. Would change
  if the build were flattened or packaged with its own root.
- **The root package is now `"type": "module"`.** Without it TypeScript emits the
  shared resolver as CommonJS, and Node's ESM loader rejects its named exports
  from `server/dist/shared/wikilinks.js`. Both workspaces were already ESM, so
  this makes the root scripts consistent rather than changing their behavior.
- **The smoke run chooses an OS-assigned port and a fresh `os.tmpdir()` vault.**
  A fixed port collides with a developer's running server, and a checked-in
  fixture would not prove the build works against a clean vault. The vault is
  removed in `finally`; the child is killed and waited for before cleanup. Would
  change if CI needed a persistent recorded fixture.
- **The smoke job is separate from `check`.** It repeats install/build, but a red
  run then says whether the suites or the built artifact broke. `needs: check`
  avoids paying for it when the unit gate already failed. Would fold into one job
  if CI install time became the bottleneck.

## 2026-10-19 — mode-change notice

- **Only a real work/home flip is announced.** The first `/api/mode` answer is
  the starting state, not a transition; source-only changes (`auto` to `manual`
  with the same mode) and a failed poll that returns `null` stay quiet. This
  keeps the notice meaningful instead of turning every 60 s poll into noise.
  Would change if a source change ever altered behavior without changing mode.
- **The notice is a non-blocking status region, not a dialog.** It uses
  `role="status"`, `aria-live="polite"` and `aria-atomic="true"`, keeps the
  page usable, and has a real close button with an accessible label. A modal
  would interrupt whatever the person was doing for a state they cannot change
  from the browser anyway. Would change if a mode change required action.
- **It clears after nine seconds, paused while the document is hidden.** A flip
  that happens behind another window should not expire unseen, so the timer
  starts or restarts on `visibilitychange` once the tab is visible. The fixed
  top-center overlay is above the header but below nothing essential; the toast
  is deliberately short and dismissible. Would change if mode notices needed to
  persist until acknowledged.

## 2026-10-19 — mode in the browser tab

- **The mode goes first in the title, not the product name.** An unfocused tab is
  usually truncated from the right, so `Work · BrainDash` / `Home · BrainDash`
  keeps the actionable word visible; `BrainDash · Work` would hide it. The
  neutral state is plain `BrainDash` rather than a fake mode before `/api/mode`
  answers. Would change if the brand needed to stay first for window switching.
- **The favicon carries a letter as well as colour.** Work is an orange filled
  tile with **W**, home a teal tile with **H**, unknown grey with **B**. A tab
  strip can dim or desaturate favicons, so colour alone would lose the state; the
  two-letter vocabulary matches the header badge and stays legible at 16px.
  Would change if the mode vocabulary grows beyond work/home.
- **The icon is a client-generated SVG data URL, not a server route.** It follows
  the existing `/api/mode` poll with no second request, cache header or asset
  invalidation; `web/public/favicon.svg` is only the neutral pre-mount fallback.
  Would change if a CSP forbade data-image favicons, in which case a small static
  set named per mode would be the next step.

## 2026-10-19 — API routes covered end to end

- **The Express app moved into `server/src/app.ts` as `createVaultApp`.** `index.ts`
  now only loads env, builds the app with the real vault and `web/dist`, and
  listens. The factory takes the vault path, an injectable watcher, fallback TTL
  and clock, and the static directory, which lets the suite start the real routes
  on an ephemeral port, force the no-watcher path and control time. Would be
  overturned by a framework that replaces Express and cannot mount this app.
- **The 5 s TTL is tested at its real default with a fake clock, not by sleeping.**
  The suite passes `watch: null` and a `now` closure, then asserts that 4 999 ms
  still returns the cached snapshot and 5 001 ms rescans. Using a short test TTL
  would have tested a different number than production. `?refresh=1` on health
  and stats, and a watcher event forcing a rescan, are separate cases.
- **Unknown `/api/*` paths and unsupported methods now return JSON 404 before the
  SPA fallback.** While serving `web/dist`, a GET `/api/typo` used to return
  `index.html` with `200`, so a client's JSON parse failed instead of surfacing an
  API error. The guard sits after all real routes and before `express.static`.
  Would be overturned if an API path ever also needs to be an SPA route.
- **The tests pin error shapes as well as status codes.** Every documented error
  is asserted for `error`, a string `detail`, and the absence of a stack; the
  unconfigured cases cover both a null path and a path that is a file, so the
  `vaultConfigured` check is exercised rather than only the `!VAULT_PATH` branch.
- **The factory accepts a `scan` injection for the 500 path.** A permission-denied
  vault is not portable to create in a test, so fault injection is the only reliable
  way to prove that stats/notes/search/graph/recall keep their route-specific 500
  codes. The same case asserts the deliberate degradation: health still answers 200
  with a null count, and a direct note read still returns its markdown with empty
  connections. Would be removed if the scanner grows side effects a fake cannot
  model.
- **No new test dependency.** The suite uses global `fetch` and `node:test`,
  matching the repo's no-framework rule.

## 2026-10-19 — cloud action row

- **The Open and Motion-paused buttons share one permanently reserved 22 px row.**
  The cloud frame above is a flex sibling, so the Open button appearing on selection
  added its 32 px (22 px button + 10 px gap) and shrank the sphere; a long title made
  that button the widest thing in the label block, which is why it read as the
  culprit. `.cloud-actions` is `flex: none; height: 22px; margin-top: 10px` whether
  it holds nothing, Open, Motion, or both, so the frame is the same height before,
  during and after a selection. Would be overturned by moving the pair into an
  overlay inside the frame, which preserves the 32 px but covers nodes near the
  bottom of the sphere.
- **Both buttons are exactly 22 px tall with horizontal padding only.** Their height
  used to come from 5 px vertical padding plus the line box; pinning it makes the
  reserved row exact and keeps two buttons on one line. The Open button gets
  `min-width: 0` so its label ellipsises when the Motion button shares a narrow row,
  while the full note title stays on the button's `title` attribute.
- **The row exists even when empty.** Reserving space only after the first selection
  would just move the jump one step later; an always-present empty row means a
  future button added there inherits the same stability.

## 2026-10-19 — cloud title glyph metrics

- **The fit measures real glyphs with canvas `measureText`, not an em-per-character
  estimate.** The old 0.9em constant was a rounding of the 0.886em measured in the
  browser, so a font change, a proportional fallback, different tracking or a
  different `text-transform` silently drifted the line count. The canvas uses the
  same text engine as paint, and the helper still walks word and hyphen break
  points because canvas reports advances, not where the browser wraps. This
  supersedes the "would be replaced by `getClientRects()`" note above: measuring
  the live heading with a `Range` would mutate and reflow it during render. Would
  be overturned by a font the canvas cannot load; the app uses system monospace
  today.
- **Tracking and indent stay authored lengths in custom properties.**
  `getComputedStyle` resolves `letter-spacing: 0.3em` to the px value of whichever
  size is currently painted, so resolving it from there per candidate size would
  reintroduce the estimate's bug. `--cloud-title-tracking` and
  `--cloud-title-indent` are read as token streams (still `0.3em`, or `0.22em` at
  the narrow breakpoint) and resolved against each candidate; `lengthPx` handles
  em, rem, px and pt. Would be overturned by moving these to a unit it does not
  understand (`ch`, `vw`), which would be ignored by the fit.
- **Canvas letter-spacing is used when available, with a per-character fallback.**
  Chromium supports `ctx.letterSpacing`; older engines get
  `advance + tracking × characters`. That fallback errs on the wide side, so it can
  never under-count a line.
- **A late webfont triggers a re-measure.** Canvas would otherwise keep measuring
  the fallback face from the first paint. `document.fonts.ready` and the
  `loadingdone` event bump a revision the fit memo depends on. No webfont is used
  today, so this protects the next font change rather than changing today's render.
- **Tests inject metrics instead of a canvas.** Node has none, so the suite models
  the heading's em advance plus tracking; dedicated cases pin that a proportional
  face and looser tracking change the chosen size, which a character-count estimate
  could not. `lengthPx` has its own unit tests.

## 2026-10-19 — LIFE on the dashboard cadence

- **LIFE no longer owns a 5 s poll.** The section had its own timer, so it kept
  reading three folders every five seconds regardless of Settings → **Vault
  refresh** or whether the window was visible, and its HUD claimed "Polling every
  5s". The dashboard now bumps a `refreshTick` on every completed check and
  `LifeSection` reloads `/api/life` on that signal; mounting `#life` still loads
  once, so a revisit is also fresh.
- **The signal is deliberately not the scan fingerprint.** A Daily or Monthly edit
  can change a value without changing any indexed field (path, size, title,
  frontmatter, keywords), so gating LIFE on `vaultVersion` would have missed
  exactly the edits this is for. It re-reads on every due check instead — one extra
  small request per interval, only while the section is open. No extra Rescan button
  was added to LIFE: the rail control lives on CORE, and returning to `#life`
  remounts the section, which reads once anyway.
- **A 30 s local tick keeps the date current without reading anything.** The old
  poll refreshed `now`; with refresh Off the day still has to roll at midnight (it
  drives "today" and the demo generator), so a no-network timer updates that state
  on its own.

## 2026-10-19 — watch the vault, not the clock

- **The scan cache is invalidated by a recursive `fs.watch`, not a 5 s TTL.** The
  unattended refresh polls once a minute, so the TTL had always expired and every
  poll re-read all 39 notes. The watcher marks the snapshot dirty on any change
  below the vault root; a quiet poll returns the cached scan without reading a
  file, and a dirty one is rescanned by the next request. Concurrent requests
  during that rescan share one in-flight read instead of stampeding the disk.
- **The 5 s TTL survives only as the fallback.** Recursive watch is unsupported on
  some filesystems, and `fs.watch` can fail after it starts. Without a watcher the
  cache must not serve one snapshot forever, so a watcher error forces one rescan
  (events may have been missed) and then the old TTL applies. Would change if a
  filesystem accepts `fs.watch` but never emits events — that failure is silent,
  and only a periodic stat walk could catch it.
- **The manual Rescan button bypasses the cache with `?refresh=1`.** Its label
  promises a disk read; with a quiet watcher, a plain poll would never touch the
  vault. `/api/health` and `/api/stats` honour the flag, and the client waits for
  that scan before re-reading notes and graph, so one click cannot paint a
  half-updated dashboard. Background polls never send it.
- **The watcher starts lazily on the first scan, not at boot.** There is no
  snapshot to invalidate before then, and a missing vault should still answer 503
  instead of throwing at import time. Its log line therefore appears with the
  first dashboard request, not with the API banner.

## 2026-10-19 — perceptual spark spacing

- **Spark spacing is asserted in CIEDE2000, not hue degrees.** The old guard asked
  for 120° of hue, which says nothing about how pale or how light a colour is: two
  low-saturation pastels on opposite sides of the wheel can still read as the same
  grey-blue. CIEDE2000 is the perceptual metric, so the test now asserts every
  spark is ≥ 25 ΔE2000 from its own node shades and that the five sparks are ≥ 10
  apart. The helper is pinned to six published Sharma reference pairs, so a
  formula slip cannot silently weaken the guard.
- **Orange and Amber's sparks moved by one or two ΔE76 to clear the pairwise
  guard.** Orange `#a6c4d8 → #a1c7dc` (a touch more cyan) and Amber
  `#aab9d8 → #a8b7d5` (a touch more violet); the old pair sat at 8.4 ΔE2000,
  below the 10 the guard now requires. Both nudges are far below a clear visual
  step in a low-opacity background layer; would be revisited if the spark field
  ever had to carry meaning rather than depth.
- **The 10 guard is deliberately not larger.** Requiring 12 would force a visibly
  darker Amber spark to clear the lavender/blue pair, costing the pale, recessed
  reading the layer depends on. Would change if sparks were ever shown side by
  side in a theme comparison rather than one palette at a time.

## 2026-10-19 — sparks drift behind

- **The spark layer takes 0.35 of the notes' yaw and of their pitch movement, not
  a separate rotation.** Sharing the formula keeps the two layers on one horizon
  and in phase at rest; scaling it makes the pointer tilt and the idle drift leave
  the sparks lagging, which is the depth cue. A wholly independent rotation would
  read as two unrelated objects rather than one sphere with a background.
- **The base pitch is shared, so only movement is damped.** Scaling the whole
  pitch would flatten the spark field onto a shallower plane, not push it back.
  `sparkPose` keeps `BASE_PITCH` and scales the part above it.
- **Drags and settles are damped too, because they enter through yaw.** There is no
  separate spark drag term to tune; a release turns the back layer less, which is
  what a farther layer does. Would be overturned if the sparks should stay fixed
  while the notes turn.

## 2026-10-19 — name the settled note

- **A landed drag borrows the focus slot instead of adding a new badge.** The slot
  already fits two lines and is measured, so a settled title cannot resize the
  sphere; the caption carries `Settled · path`, which separates it from a hover
  without new chrome. Would be replaced by a floating chip if the name ever needs
  to point at the node rather than sit under the core.
- **It appears at release and stays until the next interaction.** Naming the target
  while the camera is still easing tells the reader where the gesture is going; a
  0.9 s flash would be easy to miss, and the `Settled` caption records where the
  landing happened rather than claiming the note is still centred once the drift
  resumes. Still mode keeps it for the same reason; toggling motion back on clears
  it with the restarted loop.
- **A landing drops an older clicked cluster.** Otherwise the new name in the slot
  and the “Open …” button would point at different notes; the drag is the newer
  gesture, so it wins, and the zoom that cluster pulled in is restored with it.
- **Precedence is hover → settled → clicked cluster → keyboard cursor**
  (`cloudFocusIndex`). A pointer over a node is always truthful, and a release is
  fresher than an older click. A new drag, click, `R`, Escape/arrow keys or a
  rebuilt cloud clears the settled name.

## 2026-10-19 — hold the landing

- **The hold freezes the ambient clock, not the spring's target.** The settle
  already ends on a note-facing pose; `advanceAmbient` withholds 0.9 s of animation
  time from that moment, so yaw, pitch, bob and dust stay exactly where the spring
  left them instead of easing away the instant the note is centred. A new drag or
  `R` clears the hold, and the withheld seconds stay in `offset`, so the drift
  resumes from the held pose rather than jumping forward by the beat.
- **0.9 s is a beat, not a pause.** Long enough to read a title and see which node
  is centred; short enough that the core still feels alive. Would be tuned, or made
  a preference, if it reads as stuck on a slower display.
- **Motion off needs no hold.** With the main loop stopped the sphere is already
  still, and a release settles on its own frames; starting a hold there would only
  delay nothing. The hold belongs to the release gesture, not to click-to-focus,
  which still eases while the user steers.

## 2026-10-19 — notes own their capture zone

- **The field is `captured_zone` in frontmatter, an IANA name.** It pairs with
  `captured:` and is what a capture tool can write without inventing an offset;
  `parseFrontmatter` already lowercases keys, so case does not matter. The
  dashboard only reads it — the vault stays read-only.
- **Invalid or missing zones keep the old behaviour.** `asCapturedZone` validates
  with `resolveTimeZone`; a typo becomes `null` and a timed stamp still falls back
  to the machine's zone, so one bad line cannot erase a capture. Date-only stamps
  ignore the field entirely because a bare date is a calendar fact.
- **The zone travels with every summary, not just the reader.** `capturedZone` is
  on `/api/notes`, search hits, the recall pick and the reader, because those are
  all surfaces that format `captured`; fetching the note again just to learn its
  zone would make the trail and search lag the reader. It is also in
  `scanFingerprint`, so editing only the zone refreshes the dashboard.
- **The trail sorts by converted instants.** Ordering by the raw strings would put
  a later wall clock in a behind-UTC zone above an earlier instant elsewhere; the
  shared `capturedInstant` reads each note in its own zone first. The series and
  the server fallback do the same, and a note without a zone uses the machine (or
  the caller's `recordedZone`) exactly as before.
- **Verified against a throwaway vault** (four notes served on port 5182, never
  the user's vault): `/api/notes` returned each valid `capturedZone` and `null` for
  the typo; `/api/stats?tz=Pacific/Honolulu` bucketed Oct 17 = 1 and Oct 18 = 3;
  the trail ordered Broken → Late → Bare (converted instants), not the raw
  Early → Broken → Late; the reader and search showed
  `Oct 17, 2026 · 11:30 PM HST` for `2026-10-18 11:30 PM` in Kiritimati, and the
  invalid-zone note still displayed `Oct 18, 2026 · 3:00 PM HST`. The temp server
  and vault were removed afterwards.

## 2026-10-19 — every date on the chosen zone

- **`/api/stats` now takes `?tz=IANA`.** The client already re-bucketed the
  sparkline from the note index, but its fallback (before `/api/notes` arrives,
  or when that request fails) was the server's local `series`/`captures30d` — two
  calendars on one screen. The server buckets the same window in the requested
  zone instead, with `resolveTimeZone` validating the parameter so a typo falls
  back to the server clock rather than throwing a `500`.
- **The client sends its active zone on every stats request and re-fetches once
  when the zone changes.** The re-fetch is separate from the initial load so it
  neither resets the core's scanning state nor re-reads notes and graph for a
  display-only change; a cancelled request cannot overwrite a newer zone's stats.
- **The sparkline memo is keyed on the zone's day, not only on the clock.** The
  vault fingerprint is unchanged at midnight, so a `[notes, clock]` memo would keep
  yesterday's 30 buckets while the trail and recall moved on. A `zoneDay` state,
  checked every 30 seconds, re-runs the memo when the date actually turns over;
  the stats fallback gets the same treatment by comparing the series signature
  before the fingerprint early-return, so a day rollover repaints the cards without
  re-reading notes or graph.
- **A bare capture date keeps the day it was written on.** It is a calendar fact,
  not an instant; converting it would turn `2026-10-18` into the 17th in Honolulu.
  A timed wall clock is an instant and is bucketed by the day it falls on in the
  chosen zone — the same rule `web/src/clock.ts` already applies.
- **The server reads a timed wall clock in its own zone, with no recorded-zone
  parameter.** The API runs on the machine that writes the vault, so that is the
  only zone the stamps can have meant; adding a second client-supplied zone would
  be a second source of truth for no gain. Would be overturned by notes that start
  recording an explicit offset.
- **Verified end to end:** `?tz=Pacific/Kiritimati` ends its window on `2026-10-20`
  while Honolulu ends on `2026-10-19` and an invalid zone keeps `2026-10-19`; in
  the browser, switching Settings to `America/New_York` issued
  `GET /api/stats?tz=America%2FNew_York` and the trail, recall, LIFE date and
  clock all agreed on `MON, OCT 19`. For the bucket/trail match, an independent
  `buildCaptureSeries` run over the real index predicted Tokyo `+2 TODAY` and New
  York `+0 TODAY`; the Tokyo card and its two `OCT 19` trail rows agreed. The
  rollover itself was exercised by pinning the page's `Date` to 00:00:10 JST on
  Oct 20 with Tokyo selected: within one 30-second tick, with no zone change and
  no vault change, the card moved from `+2 TODAY` to `+0 TODAY` and the clock and
  recall moved to Oct 20. The pin was removed by reload afterwards.

## 2026-10-19 — one wikilink resolver

- **The resolver lives in a top-level `shared/`, not in either workspace.** It has to
  be importable by the Express server and bundled by Vite; a fourth npm workspace
  would add a build step and a package name for one file, and putting it under
  `server/` would make the dashboard import server code. Both tsconfigs follow
  imports outside their `include`, and Vite resolves it through the workspace root.
- **The collapsed rules are the union of the two copies, not a copy of one.** The
  server knew title, path, path without `.md` and the dash/underscore→space file
  name; the client also knew spaces→dashes. The shared builder splits the file name
  into words and registers both the spaced and dashed forms, so dashes and
  underscores are now equivalent everywhere. That is a small behaviour change on
  the server — `[[a-b]]` now reaches `a_b.md` — and it removes the class of bug where
  the renderer opened a note the graph refused to draw an edge to.
- **`resolveWikilink` owns normalisation.** The index stores lowercased keys and the
  two previous call sites each did `target.trim().toLowerCase()` by hand; a single
  function means a future caller cannot forget half of it. The index tests pin that
  an un-normalised lookup misses, so the contract is explicit.
- **The shared tests run in the server suite.** `shared/` has no `test/` directory
  of its own and the runner only scans a workspace's `test/`; `server/test` is where
  a module outside both workspaces is cheapest to cover. The web side is covered by
  the build (the import must resolve) and by the reader test in the browser, not by
  a duplicate unit suite.
- **Verified in the browser, not just by types:** opening `MCP` and clicking its
  `[[ai-school]]` link opened *Ai school* through the shared resolver, while
  `HelpDeskLab`'s `[[rea]]` still rendered unresolved and its three real links
  resolved. The graph's 39 nodes / 20 edges / 26 unresolved were unchanged by the
  collapse.

## 2026-10-19 — continuous integration

- **One job, four steps, not three jobs.** Splitting typecheck/test/build into
  parallel jobs would run `npm ci` three times for a gate that finishes in well
  under two minutes; the step name is enough to see what failed. Would be split if
  the suites grew slow enough that the wall-clock difference mattered.
- **Node 24, pinned.** It is the version the dashboard is developed on, and
  `package.json` still records the real floor (`>=20.19`). No version matrix: Node
  20 is past end of life and a second run would only prove ICU and `node:test`
  behave the same. Would add 22 if a contributor needed it.
- **`npm ci`, never `npm install`.** CI must fail when the lockfile and
  `package.json` disagree rather than commit a silent dependency bump into a build.
  The lockfile is in sync (`npm ci --dry-run` exits 0).
- **`pull_request`, not `pull_request_target`, with `contents: read` and no
  secrets.** Fork code then runs with the same read-only token a push gets, so the
  workflow cannot be used to exfiltrate anything or write to the repository.
- **No deploy, publish or coverage upload.** The project has no deployment target
  and no coverage threshold; adding either is a product decision, not plumbing.
  Would revisit with a hosting target or a coverage gate.
- **The exact sequence was proven from a clean copy** (source without
  `node_modules`, `npm ci` → typecheck → 104 + 177 tests → build, all exit 0).
  Ubuntu itself could not be exercised here — no Docker daemon and no Node inside
  WSL — so the first Actions run is the real Linux check; nothing in the suites
  reads Windows-only paths, and the temp-dir fixtures use `os.tmpdir()`.

## 2026-10-19 — working mode in the header

- **The badge reads, it does not write.** Switching could have been a click, but a
  write endpoint would let any page on the machine flip a setting that changes how
  every agent behaves, and the switch log exists precisely to record who set it and
  why. `npm run mode` stays the only writer; the header answers "which mode is it?"
  in the place a glance lands. Would be overturned by a request for a dashboard-only
  control that still logs (it would need the same-origin/CSRF story as the rest).
- **The server imports `scripts/mode.mjs` instead of duplicating the schedule.** Two
  copies of `Mon–Fri 08:30–17:30 America/New_York` plus the 9 h/12 h staleness rules
  is how a badge ends up lying. The script now guards its CLI block behind an
  execution check and takes a path in `readState`, so the API uses the exact
  functions `npm run mode` prints from; `scripts/mode.d.mts` gives TypeScript the
  shape. The cost is a declaration file kept beside the script — worth it over a
  second resolver.
- **The mode polls on its own minute, not on the vault refresh.** Vault refresh can
  be turned off, and it is gated on a scan fingerprint, so a mode change could sit
  invisible indefinitely. A 60 s interval plus a refocus fetch costs one tiny local
  request and makes `npm run mode home` visible by the time someone sits down.
  Would be replaced by server-sent events if more local state ever needs the same.
- **A failed read shows a dashed `MODE` badge, not an error.** The mode is context,
  not the dashboard's job; a banner would put an unrelated failure in front of the
  vault data. The tooltip says the API did not answer, so a real problem is still
  discoverable.

## 2026-10-19 — test runner and vault coverage

- **The runner takes file filters instead of gaining a second runner.** There was
  already a runner (`scripts/run-tests.mjs`, `node:test` through tsx), and a
  parallel Jest/Vitest setup would cost a dependency and a second config for the
  same result. The wrapper now reads any argument that is not a `.json` tsconfig
  as a path filter, so `npm test -w server -- vault` works; a filter that matches
  nothing lists the available files and exits 1 rather than reporting a green run
  over zero tests. Would be overturned if watch mode became a daily need — Node's
  `--watch` is the next thing to reach for, not a framework.
- **Coverage is Node's built-in V8 report, not c8.** `--coverage` adds
  `--experimental-test-coverage`, and `test:coverage` exposes it per workspace and
  at the root. A separate coverage package would duplicate what Node 24 already
  reports, add a dependency and a config for no extra signal. The report only
  counts modules a run loaded, so it is documented as a scoped, diagnostic view
  rather than a project-wide percentage; there is no threshold and no upload.
  Would add a threshold only if CI needed a regression gate, and would reach for
  c8 only if Node's report stopped following tsx source maps.
- **The index and search suites build a real vault on disk; the graph suite does
  not.** `scanVault` is the filesystem, so its tests have to write files (a temp
  dir removed afterwards, as the LIFE tests already do); `buildGraph` and
  `noteConnections` only read a `VaultScan`, so they take in-memory notes and
  cover edge cases the example vault cannot produce — 40 notes on one tag, a
  broken link, a self link. Would change if a fixture vault on disk grew cheap
  enough to be worth sharing between suites.
- **The first coverage run closed the real vault gaps, not the defensive ones.**
  It reported `vault.ts` at 99.59% lines / 91.17% branches. The gaps worth
  covering were user-reachable: an unterminated or malformed frontmatter block,
  `12:00 AM`/`12:00 PM` parsing, a note whose title comes from its filename, a
  long snippet cut at the end, tag-vs-link backlink ordering in both arrival
  orders, and an invalid `recordedZone` falling back to local time. The remaining
  misses are defensive branches that need a file to disappear mid-scan or a
  non-file at a `.md` path, plus `??` fallbacks the surrounding checks make
  unreachable; they stay as cheap guards rather than being deleted for a number.
  After the additions the full server run reports `vault.ts` at 99.80% lines /
  93.85% branches (from 99.59% / 91.17%), with the line report still naming a
  multi-line `proseOnly` expression that `extractKeywords` tests do exercise.
- **Needs approval: commit the coverage work.** No commit or push was made in
  work mode. The tree already carries unrelated changes, so review the diff and
  stage only the runner scripts, the vault test/file additions and the three docs
  when it is time to commit.
- **Search keeps phrase semantics and the tests pin it.** A multi-word query is a
  literal substring, not an implicit AND; that is now asserted (`"orchard
  appears"` matches one note) so a future tokeniser change has to be deliberate.
  The same applies to the index having lowercase keys: the test states that
  callers normalise, rather than making the index quietly forgiving.
- **The tag cap is tested by its contract, not its constant.** The suite asserts
  that 40 notes sharing one tag produce unique edges, fewer than all 780 pairs,
  and `truncated: true` — so raising or lowering `MAX_TAG_EDGES` is a one-line
  change, while removing the cap trips the test.

## 2026-10-19 — cloud label slot

- **The focus label is a fixed two-line box, not a box that fits its text.** The
  sphere is a flex sibling, so any growth in the label shrinks the frame and moves
  every node — measured at 900 px wide, a 45-character title cost the frame 70 px
  and a hover visibly jumped the cloud. The alternative, a taller slot that only
  grows when needed, is the same bug with extra steps. Would be overturned by
  moving the label out of flow (an overlay inside the frame), which trades the
  reserved space for text drawn over the sphere.
- **Long titles step down in size rather than ellipsise at full size.** 30 px in a
  585 px column holds ~22 characters a line; ellipsising there would cut most real
  note names after one word. The ladder (30 → 13 px) keeps the whole name on two
  lines for everything up to roughly 100 characters, and only then clamps, with the
  full title in the element's `title`. A 13 px floor was chosen over shrinking
  further because smaller uppercase mono stops being readable at desktop distance.
- **The fit models wrapping greedily, not by characters per line.** A character
  count said "PRD — reverse-engineering a repo with AI" (40 characters) fit two
  lines at 30 px; the browser needs three because the 19-character word cannot
  follow "PRD —" and leaves both lines short. The helper therefore wraps by words
  and hyphen/dash break points, and a test pins that exact title to 24 px. Would be
  replaced by `getClientRects()` measurement if a proportional title font is ever
  introduced.
- **The cap stays in CSS, the fitted size comes from JS.** `--cloud-title-max`
  owns the responsive 30 px / 22 px cap and the slot height, while the component
  only publishes `--cloud-title-fit`; the rendered size is
  `min(cap, fit)`. One source of truth for the breakpoint, and CSS keeps working
  before the first measurement.

## 2026-10-19 — cloud release settle

- **"Notable orientation" means a note facing the camera.** The cloud has no
  meaningful cardinal axes — its notes are a Fibonacci sphere, so a quarter turn is
  as arbitrary as any other angle. Every node already owns a pose that centres it
  (the same pose click-to-focus eases to), which makes that the only discrete set of
  meaningful resting poses. Would be overturned by a request for a fixed home pose.
- **The flick's velocity seeds a critically damped spring instead of coasting to
  rest and then snapping.** A pure snap would discard the gesture's momentum and
  read as a jump; the spring carries a flick, arrives without oscillating at rest,
  and is capped at 3 rad/s so a hard throw cannot turn the sphere into a carousel.
  It gives up after 1.1 s in case a clamped pitch stalls it.
- **Notes past the tilt limit are only a fallback.** Aiming at a pole would slide
  along the pitch clamp, so `nearestPose` prefers notes that can actually be centred.
  They still count when nothing else exists — a two-note vault puts both notes on
  the poles — and the pose then parks on the clamp rather than leaving the release
  unsettled (or asking for a flipped view).
- **The settle also runs with motion off.** It is the tail of a direct gesture, not
  ambient motion; with the main loop stopped it drives its own frames. Leaving the
  sphere at an arbitrary angle there would be exactly the bug this request names.
- **`decayVelocity` and the coast were removed.** Nothing else used them once the
  release handed over to the spring, and keeping two motion models would make the
  feel depend on which path ran.

## 2026-10-19 — unattended refresh

- **A minute by default, and a preference to turn it off.** The dashboard is meant to
  sit open in F11 all day next to an editor, so one check a minute is the cadence that
  keeps it current without becoming a background scan loop; five minutes and off are
  there for large vaults and for anyone who wants a frozen view. Recorded in
  `braindash.refresh`.
- **The refresh is change-gated by a server fingerprint rather than by comparing
  payloads.** `/api/stats` now carries a signature of the scan (path, size, title,
  frontmatter fields, keywords). Without it every poll would replace the graph object,
  rebuild the cloud's particles and clear whatever the user had focused — the exact
  disruption a refresh is supposed to avoid. A content hash would be stricter; the
  keywords fold the body in without a second pass over every file.
- **A hidden window never checks.** A background tab reading the vault is pure cost,
  and the dashboard is not being looked at; coming back into view makes the check due
  immediately, which is what a returned-to monitor wants. The rule lives in
  `shouldCheckVault` so it is unit-tested rather than an inline condition.
- **The ticker is fast (15 s) and the interval decides.** A throttled or sleeping tab,
  or a laptop that was closed, would otherwise wait a full interval from whenever the
  browser last ran timers.
- **A failed background check is silent.** The initial load and the Rescan button
  still surface errors, but a poll that fails keeps the last good data on screen and
  just stops advancing the `Synced` stamp — blanking a working dashboard because one
  request failed would be worse than a stale one.
- **A focused cluster follows its note across a rebuild, and a revealed recall note
  stays revealed.** Both state slices were index- or version-keyed, so any vault change
  closed them. The focus now re-finds its note by path, and the recall card only drops
  the revealed body when the pick actually changes — which also makes the manual Rescan
  less destructive.

## 2026-10-19 — palette swatch preview

- **The Settings swatches show five bands, not the accent trio.** The cards are the
  only place a palette can be compared before picking it, and the two colours that
  decide how the core reads — the deliberately dark untagged node and the pale spark
  — were invisible there. The header pills stay label-only, since they are a quick
  switch rather than a preview.
- **A panel-coloured seam splits chrome from the cloud colours.** Five equal bands
  with no grouping read as one gradient; the 2 px break marks where the chrome trio
  ends and the untagged/spark pair begins, without adding labels to a small card.
- **An inset hairline keeps the dark band legible.** `--node-unset` is near the
  panel's own darkness by design, so the swatch gained a 1 px inner ring; a plain
  border would have swallowed exactly the band the change is about.

## 2026-10-19 — spark layer colour

- **Each palette's spark is a pale complement of its accent, not the accent.** Every
  theme had `dust` set to the accent hue, so the ~150 decorative particles were
  literally dimmer copies of the nodes. A ~170°-away hue (pale periwinkle for Jarvis,
  sky for Orange, slate for Amber, aqua for Crimson, warm sand for Ice) at
  saturation ≤ 0.5 and luminance ≈ 0.5 reads as a separate depth layer at dust's low
  opacity, while staying paler than any note shade so it cannot be mistaken for one.
- **A test holds the invariant rather than the swatches being eyeballed.**
  `web/test/themes.test.ts` asserts the five sparks are unique, that each sits at
  least 120° of hue away from its accent and all four node shades, and that every
  spark stays pale (luminance > 0.35) and muted (saturation ≤ 0.5). Would be
  overturned by a palette that wants sparks inside the accent family after all.
- **The muted second hue was judged inside the "one accent" rule.** The rule bans
  neon cyan/purple/green in glows; these are pastel complements behind the notes, not
  a second interface colour, and no chrome, glow or text uses them.

## 2026-10-19 — captured timestamps

- **The 30-day capture series is bucketed on the client, in the clock's zone.**
  `/api/stats` can only bucket by the server's own calendar, so under a zone on the
  other side of midnight the sparkline and its `+N today` delta referred to a
  different day than every stamp beside them. `buildCaptureSeries` reuses the same
  stamp parser and offset solve on the note index the dashboard already holds, and
  the window ends on `zoneDayKey()`. The server's `series`/`captures30d` stay in the
  response (API compatibility, and the fallback until `/api/notes` lands). Would be
  overturned by the server gaining a zone-aware stats endpoint — then this
  duplication should go.
- **LIFE's "today" moved to the clock's zone too.** The section is built from
  `Daily/YYYY-MM-DD.md`, so its HUD date, win date and demo series were still using
  the machine's day while the header and recall followed the chosen zone. `zoneDayKey`
  now feeds the whole section and `formatDateKey` prints keys at noon UTC, which
  keeps a date key from ever rendering as the previous day. Would be overturned if
  LIFE should mean "the vault's day" regardless of the reader's clock.

- **A wall clock is read in the machine's zone, then shown in the chosen one.** The
  vault stores `2026-10-18 3:38 PM` with no zone, so something has to decide what
  instant that was. The machine that wrote the note is the only defensible answer
  (it is the user's own Drive folder), and converting from there is what makes the
  time actually obey the Settings zone. Would be overturned by notes that start
  recording an explicit offset, at which point the recorded zone should win.
- **Date-only stamps are not converted.** They are calendar facts, not instants;
  shifting `2026-10-18` to the 17th because Honolulu is behind would be a bug the
  user sees. Implemented by formatting at noon UTC.
- **Formatting lives in `clock.ts`, not in each component.** Four surfaces showed
  the raw string or their own regex-parsed copy; one pair of functions
  (`formatCapturedStamp`, `formatCapturedDay`) plus `parseCapturedStamp` keeps them
  agreeing, and the raw value is preserved as a tooltip instead of being lost.
- **The two-pass offset solve is deliberate.** A single pass puts the hour after a
  DST change one hour off; the second pass costs one `Intl` call and removes the
  only seasonal wrong-answer case.

## 2026-10-19 — the recall day

- **The client decides which day "today" is.** The dashboard clock already follows a
  chosen IANA zone, so leaving recall on the server's local day made the header say
  Tokyo while the card said New York's date. The card now sends `?date=` from the
  zone and the server validates it, keeping a single source of truth for the reader.
- **The server still works without a date, and ignores a bad one.** `resolveRecallDate`
  only accepts real calendar dates (month 13, Feb 30 and year zero fall back to the
  server day), so curl, scripts and older clients behave exactly as before and a
  malformed query cannot seed an empty bucket.
- **The day is re-checked every 30 seconds, not on a midnight timer.** A dashboard
  left open overnight needs to switch notes without a reload, and computing the zone
  day is cheap enough that a twin midnight scheduler would only add a failure mode.
- **Changing the zone resets `skip`.** Otherwise "skip 3" from the old day would land
  mid-way through the new day's rotation for no reason the reader can see.

## 2026-10-19 — full graph

- **The map is laid out, not simulated.** A force simulation would move notes on
  every open and fight a poll every 5 s; a deterministic area-cluster spiral keeps
  positions stable, groups by meaning (career/life/ideas/untagged) and keeps hubs
  central. It loses the even spread a force layout gives — long links between
  distant clusters are visible — but the reader can trust the geography.
- **It opens as a modal overlay rather than a route.** One tile, one Escape, no
  history entry to manage, and the dashboard's state (open note, filters) survives
  behind it. A `#graph` route would be the better choice if the map needs to be
  linked to or reloaded independently; the layout module is already separable.
- **Pan only starts on empty canvas.** Starting a drag on a note made every click a
  potential pan and suppressed the open; restricting the gesture keeps clicks exact.
- **`E`/`Shift+E` cycles edge focus.** Chromium focuses SVG `<line tabindex=0>` but
  does not emit the focus events React relies on, so tab-only edge focus could not be
  relied on. The shortcut works from anywhere in the dialog and was verified; the
  tabbable hit lines stay as a bonus for browsers that do fire the events.
- **Edge focus dims rather than hides.** Dimmed notes stay at 0.22 opacity so the
  shape of the vault is still readable while one edge is in focus.

## 2026-10-19 — sound deck

- **The ambient bed is synthesised, not shipped as an audio file.** The ask was a
  "futuristic ambient" sound; a looped mp3 would need an asset, a licence and a
  size bump, and would audibly repeat. Web Audio gives an endless, slowly drifting
  pad for ~50 lines and zero bytes. Would be overturned by a request for a specific
  composed track, which belongs in the importer instead.
- **Imported tracks live in IndexedDB, not the vault or the server.** The vault is
  read-only by contract and an mp4 is far larger than a note store should carry;
  the server has no upload endpoint and does not get one. Metadata and blobs sit in
  separate stores so opening the deck never deserialises a 200 MB file.
- **The importer accepts `audio/*` plus mp4/m4v/mov, and reports decode failures.**
  The brief named mp4; phones also produce `.mov` with the same audio codecs. A
  file the browser cannot decode gets a row-level error rather than disappearing.
- **Playback is never restored on load, volume is.** Browsers block audio without a
  gesture, so reopening the app playing would silently fail; the slider value is
  safe to persist and is the setting people actually tune once.
- **The deck is a non-modal popover in the header, not a settings section.** Sound is
  toggled often enough to deserve one click, and a scrim over the dashboard for a
  volume slider would be heavier than the feature. Escape, outside click and focus
  return are handled without trapping Tab.
- **Ambient keeps playing across CORE/LIFE.** The deck is mounted in the shell, so
  changing sections does not tear down the audio graph; only Stop or unmount does.

## 2026-10-19 — LIFE section

- **Navigation did not exist, so one was added rather than a second dashboard.** A
  two-tab `CORE / LIFE` strip sits under the status bar and mirrors the section in
  the URL hash (`#life`). The vault core keeps its state while LIFE is open; the
  alternative — a router — would have meant restructuring every panel for no gain.
- **`/api/life` never fails.** A missing vault, missing folders and unreadable files
  all return `200` with empty arrays and warnings. The LIFE section is the one screen
  that still has something to say while the vault is offline (its demo data), so a
  `503` would only add an error state nobody can act on.
- **The demo fallback is generated on the client.** The server reports `demo: true`
  when all three folders are empty; `web/src/life.ts` then substitutes deterministic
  data and the UI shows the badge. Keeping the generator out of the server means the
  API never pretends data exists.
- **Missing daily fields score zero; missing monthly fields are skipped.** A blank
  day is a real missed day, but an unfilled monthly note should not sink MONEY for a
  month. A blank relationships rating does score zero, because that is the only
  input the area has.
- **Percent fields accept both shapes.** `24%` and `0.24` both mean 24; values above
  1 are left alone so `1.5%` stays 1.5. This was the only way to read a folder of
  hand-written notes without a unit convention.
- **Relationships scores as weekly rating × 10**, since no daily field feeds it.
- **Extra targets were added to `lifeConfig.ts`** for net worth ($100k), credit score
  (800), savings rate (20%) and spend ($100/day) so MONEY and the panel have goals;
  the eight targets named in the brief are exactly as specified. All are one edit
  away if the numbers are wrong.
- **Templates start with `_` and the reader ignores `_` files**, so copying a
  template never adds a phantom day/month/week.
- **Vault writes were limited to the requested scaffolding.** `Daily/`, `Monthly/`
  and `Weekly/` were created with a `_template.md` in each (Daily included because
  the section is useless without it). Nothing else in the vault was touched, and the
  application still has no write path.
- **Monthly figures are grouped in one "latest month" card, not repeated as daily
  rows.** A 14-day sparkline of a monthly number is a flat line and a "7d average"
  of it is just the number again, which read as a second, contradictory copy of the
  same figure. Net worth, credit score, utilization and savings rate now appear once,
  with their month-over-month change; utilization falling is coloured green because
  lower is better. Would be overturned by a request to see monthly values inline
  with the daily metrics.
- **LIFE styles live in `web/src/life.css`** rather than growing `styles.css` past
  2,400 lines; both are imported once in `main.tsx`.

## 2026-10-19 — reactive core

- **A click now frames a note's cluster instead of opening it immediately.** The ask
  was "clicking a node eases the camera to focus its cluster", which cannot also be
  "click opens the note" without the camera spinning away the moment the reader
  closes. First click frames (camera ease, 1.12x zoom, cluster lit, others dimmed),
  a second click on the same node opens it, and an **Open “Title”** button appears
  under the core so the two-step move is discoverable and keyboard-reachable.
  Empty space or `Escape` releases the focus and restores the zoom. Would be
  overturned by a request for one-click opening; the button is where that would go.
- **The focus camera is a closed loop, not a one-off target.** The first version
  computed an absolute spin target at click time; the ~0.3 rad error left by the
  pointer-parallax easing put the note ~60 px below centre. The frame now recomputes
  the residual against the actual pose each tick, so the note lands within a pixel.
- **Nodes at the poles cannot reach dead centre.** Pitch stays clamped to ±1.15 rad
  (the existing tilt limit), so a top/bottom node sits as central as the clamp allows
  — about 55 px off for the very first note. Keeping the limit was the deliberate
  choice: removing it would let the sphere tip upside down.
- **The scan pulse is held for 1.1 s.** A local 35-note scan finishes in a frame or
  two, so the ring flashed once and read as a glitch. `pulsing` stays true briefly
  after `scanning` ends; a longer scan keeps animating for its whole duration.
- **Drag momentum was already there** (velocity capture, 6 rad/s clamp, 2%-per-second
  decay); it was only moved behind `decayVelocity` so the maths is testable. Nothing
  about the feel was retuned.

## 2026-10-19 — test suites

- **`node:test` + `node:assert` only; no Jest/Vitest/testing-library.** "Dependency-free"
  was read literally, so nothing was installed. Markdown is rendered with
  `react-dom/server` (already a dependency) instead of a component testing library.
- **Cloud keyboard rules were extracted into `web/src/cloudCursor.ts`.** They lived
  inline in the SVG component, where testing them would have needed a DOM. The
  component now calls `cloudKeyAction` / `stepCursor` / `cursorTargetPath`; the
  rendered SVG and its focus/hover behaviour are unchanged. Would be overturned if
  the cursor ever needs scroll position or geometry, which a pure module cannot own.
- **`scripts/run-tests.mjs` runs the suites through the existing `tsx` dev
  dependency and passes an explicit file list.** The test runner's directory and
  glob arguments are unreliable once tsx's resolver is in front, and npm scripts
  cannot set `TSX_TSCONFIG_PATH` portably on Windows — that env var is why the
  wrapper exists rather than a one-line `node --test` command.
- **`test/` is part of each workspace's tsconfig** so `npm run typecheck` covers the
  suites; a test that only runs is not checked for type errors.
- **No CI workflow was added.** It would need writing to the remote to be useful, and
  publishing is gated; the suite runs from `npm test` locally.

## 2026-10-19 — working-mode protocol

- **Built a rules file + state + logs, not an app feature.** The first read of
  "afk mode / ready mode" produced a dashboard standby screen; the correction made
  it clear the modes describe *where the person is*. The app is untouched, and
  `web/src/mode.ts` was never wired in (it does not exist on disk).
- **Two modes: `work` and `home`.** `clear` is a command that removes the override,
  not a third mode. A separate "away" state would need rules nobody has described.
- **Schedule defaults to Mon–Fri 08:30–17:30 `America/New_York`.** No schedule was
  given; this is the dashboard's own clock zone and the most common office pattern.
  Change `SCHEDULE` in `scripts/mode.mjs` and the table in
  `docs/working-mode.md` together if it is wrong.
- **Inference falls back to `work`, not `home`.** If the state file is unreadable,
  the cost of guessing "away" is one documented decision; the cost of guessing
  "present" is a whole session blocked on a question nobody reads.
- **A `work` override expires after 9h; all state goes stale after 12h.** Stops one
  Friday switch from making every later session silently autonomous.
- **State lives in untracked `.freebuff/`; decisions are tracked here.** The mode is
  a fact about one desk; the decisions are what a person reviews later. Added
  `.freebuff/` to `.gitignore` so agent state does not pollute `git status`.
- **No commits, pushes, deploys, service signups or vault writes while autonomous.**
  Queued under `Approvals needed` instead. Nothing was queued during this task.

## 2026-10-19 — symlink escape test

- **The guard is tested with real links in a temp vault, not a mocked `fs`.** The
  branch only matters when the filesystem disagrees with the lexical path, so a
  stub would assert the test's own assumption; a junction in a `mkdtemp` vault and
  a sibling folder outside it exercise the code the server actually runs. It would
  be overturned only if `readNote` stopped touching `realpath`.
- **Windows gets a junction for directories and a symlink for files.** A junction
  needs no elevation; a file symlink needs Developer Mode, so that one test skips
  with the OS error on a machine without it. Any error other than the known
  unsupported codes is rethrown, so a broken fixture fails instead of skipping.
- **The rejection is asserted as `invalid_path`/`400`, and the escape target is
  asserted readable first.** Otherwise a missing temp file would let the test pass
  through the `404` path without the containment check ever running. Removing the
  guard was confirmed to fail exactly the two escape tests.
- **A link that stays inside is a test, not an oversight.** The check is about
  containment, not about banning links; reading `alias/inner.md` through a link to
  `notes/` returns `notes/inner.md`, which pins the reported path to the real one.
- **A dangling link is asserted as `404`, not `invalid_path`.** `realpath` fails
  before there is a target to compare, and both are refusals; the distinction is
  what the API returns, so the test records it. On Windows a junction to a missing
  target cannot be created, so that case skips there.

## 2026-10-19 — scheduled dependency drift

- **Drift is a scheduled job, not another step in the every-push gate.** Asked
  "what changed upstream" needs the registry, and a push-triggered registry query
  would fail every branch on a package someone else released overnight. Monday
  06:00 UTC plus *Run workflow* keeps the signal but puts it on a cadence a person
  can ignore for a day. Would be overturned if a drifted lockfile starts breaking
  installs between Mondays, which is what `check:lockfile` in the gate catches.
- **`npm run check:lockfile` runs in the normal gate.** `npm ci` already refuses a
  mismatched lockfile, but the explicit `--dry-run` step says which invariant
  broke before an install half-succeeds, and it is the same command the drift job
  repeats. It costs one resolution pass, no cache invalidation.
- **The drift job restores no npm cache and installs nothing.** A warm cache can
  answer for a tarball the registry no longer serves, which is exactly the kind of
  rot a weekly job exists to find. Both checks are metadata-only.
- **Only in-range drift fails; newer majors are reported.** A lockfile behind its
  own range is a bug nobody decided to have, and `npm update` fixes it. A major
  bump is a migration with breaking changes, so printing it (and the job summary)
  is the useful half and failing on it would just teach people to ignore the job.
- **The comparison is `scripts/check-deps.mjs` with a `node:test` suite.** The
  range logic (caret/tilde/`*`/exact, prereleases, a missing `node_modules`) is
  where the mistakes are, and a CI-only shell one-liner could not be tested
  offline; the suite only needs fixture objects.
- **A weekly schedule only fires on the default branch.** Forks and feature
  branches never run `drift`; their pushes still get the full gate. `workflow_dispatch`
  is there for the case where the cron is delayed or someone wants the answer now.

## 2026-10-19 — run summary

- **The test step hands the totals to the summary step as a file, not as log
  scraping.** `run-tests.mjs` already sits between the runner and the terminal, so
  it captures the final `ℹ tests`/`ℹ pass` block and writes
  `.ci/tests-<workspace>.json` there. A later CI step cannot read a previous
  step's stdout, and re-running the suites just to count them would double the
  job. Parsing is limited to the reporter's summary lines; a run that dies before
  printing them writes no file and the summary says so instead of claiming zero.
- **Capture only under `CI`, and pin the spec reporter there.** A local `npm test`
  keeps inherited stdio and writes nothing, so the working tree stays clean and
  the interactive output is unchanged. In CI the child's stdout is a pipe, where
  Node would default to tap; `--test-reporter=spec` keeps the log the same shape
  a person sees locally and gives the parser one documented format (tap is still
  understood, because a contributor's non-TTY shell produces it).
- **Build size is measured from disk, not from Vite's printout.** The bundler's
  table only covers the dashboard; `server/dist` has its own copy step. Walking
  both directories reports files, raw bytes, gzipped bytes (text assets only,
  since that is what a browser downloads) and the three largest files, and a
  missing directory is "not built" rather than an inviting zero.
- **The summary step cannot fail the build.** A read-only summary path or a
  missing `.ci/` file is a reporting problem, not a test problem; the script warns
  and exits 0. The gate is still the suites' own exit status, and the summary only
  runs after a green build.
- **Per-runner blocks, not a merged table.** The matrix legs measure different
  platforms, so averaging them would hide the Windows number; each appends its
  own block headed with `RUNNER_OS`.

## 2026-10-19 — wikilink extraction in shared

- **The server's regex moved into `shared/wikilinks.ts`, and the renderer now uses
  the same parser.** They had already agreed on targets through the index, but not
  on the token: `[[A|]]` counted as an edge for the server while the renderer
  dropped it, `[[A|B|C]]` lost `|C`, `[[a\|b]]` became target `a\` with alias `b`,
  and `[[#H]]` vanished from the reader. One parser makes those impossible to
  disagree about.
- **The token grammar is exported as `WIKILINK_TOKEN_SOURCE`.** The renderer
  composes its inline pattern from it and `findWikilinks` compiles the same source,
  so a change to what counts as a token cannot land on one surface only. The
  renderer additionally ignores a token whose opening `[[` is backslash-escaped;
  `findWikilinks` applies the same odd-backslash rule, so both read
  `\[[literal]]` as text.
- **Escapes are limited to punctuation.** `\|`, `\#`, `\[`, `\]` and `\\` keep a
  separator or bracket literal; a backslash before a letter stays where it is, so
  a Windows path is not mangled into `C:Users`. The renderer gained a leading
  escape alternative in its inline scanner; other prose backslashes are untouched.
- **A heading-only `[[#Heading]]` renders as text and is not an edge.** It has no
  target to resolve, so the server skips it and the reader shows the heading
  instead of deleting the token. Blank aliases fall back to the target, and extra
  pipes stay in the alias, matching what the parser records.
- **Inline code is stripped with fenced code.** `bodyOnly` claimed to strip code
  but only removed fences, so `` `[[example]]` `` drew an edge the reader showed as
  a code span. Now both surfaces treat it as code; tags inside inline code stop
  counting too, which is the same rule.
- **Scan semantics are otherwise unchanged.** Targets are still trimmed, kept
  case-sensitive and deduped in first-written order, so graph keys, unresolved
  lists and backlinks keep their existing shape.

## 2026-10-19 — the scan keeps parsed links

- **`NoteMeta.links` is now `Wikilink[]`, not `string[]`.** Extracting only the
  target was the last place the split was thrown away: the reader's Links-out row
  could not show `B` for `[[Beta#Top|B]]` and re-read the brackets or fell back to
  the note title. `findWikilinks` result is stored (deduped by target, first
  spelling kept), and the outbound API carries `target`, `heading`, `alias` and
  `label`, so the reader uses the same parts the inline renderer does.
- **Dedupe stays by target, not by the whole token.** Two spellings of one note
  are one edge and one row; keeping both would draw duplicate lines and list the
  same note twice. The first spelling wins, so the label is what the author wrote
  first, matching the resolver's first-note-wins index.
- **`ResolvedLink extends Wikilink` instead of restating the fields.** The graph,
  the API and the client's `NoteLink` cannot drift on which parts exist; adding a
  part later is one edit in shared plus the consumers that want it.
- **The reader shows the written label, not the resolved title.** `[[Beta#Top|B]]`
  reads `B` in both the body and the Links-out list; the resolved path is still the
  secondary line and the tooltip. Would be overturned if the list is meant to
  preview destination titles rather than echo the prose.
- **Fixtures parse their link strings through `parseWikilink`.** Building
  `{ target, heading: null, alias: null }` by hand in tests would let a fixture
  hold an untrimmed target the real scan can never produce (one such fixture
  exposed the difference immediately).

## 2026-10-19 — symlinked folders in the scan

- **The walk still does not follow symlinks, in either direction.** Following a
  link is how a vault quietly indexes its own notes twice (`notes/x.md` and
  `alias/x.md`) or reaches outside `VAULT_PATH`; `readNote` already refuses the
  escape case. The change is that the skip is now data, not an invisible branch.
- **`skipped` reports symlinks only, not hidden entries or `SKIP_DIRS`.** Those are
  a stated policy (`.obsidian`, `node_modules`, dotfiles) that the docs already
  describe; listing them would bury the one case that looks like a missing note.
- **The record is `{ path, reason: "symlink" }`, sorted by path, on `VaultScan` and
  `/api/notes`.** A reason field leaves room for other causes without changing the
  shape, and sorting keeps the JSON stable across platforms whose `readdir` order
  differs. The array is always present, empty when nothing was skipped, so a client
  can distinguish "none" from "not reported".
- **The test creates a real link and asserts the target is readable first.** A
  mock would prove nothing about `dirent.isSymbolicLink()` (Windows junctions are
  the case that historically differs), and checking the outside file keeps a `404`
  from accidentally passing the test. On a machine that forbids links it skips
  with the OS error, like the rest of that suite.
- **It pins no-duplication as well as no-escape.** A link to an internal folder is
  reported and left alone, so `notes/inner.md` appears exactly once — the reason
  the walk does not simply resolve and dedupe every entry.
- **Chains are tested with real two-hop links.** `readNote` resolves with
  `realpath`, which follows the whole chain, so no extra guard was needed; the
  tests pin that the existing guard covers indirection: two directory hops or a
  file link pointing at another file link ending outside are still `400
  invalid_path`, a chain that stays inside returns the final canonical path, and
  a dangling chain is `404` rather than an escape. The outside target is read
  before the refusal is asserted, so a broken fixture cannot pass as containment.

## 2026-10-19 — captured zone in the reader

- **The reader names the note's own zone, not the zone it was displayed in.** The
  stamp already carries a display-zone abbreviation (`GMT+9`); the IANA name is
  the missing half, and it is what makes a converted time auditable. Both are
  shown: `4:38 AM GMT+9` with `America/New_York` beside it.
- **Only a timed stamp from a note that recorded a zone gets the label.** A
  date-only capture never moves between zones (it is a calendar fact), and a note
  without `captured_zone` was read in the machine's zone — printing that fallback
  would claim the note recorded something it did not. `capturedZoneLabel` encodes
  both rules so the reader cannot drift from the formatter.
- **The label stays when the chosen zone equals the recorded one.** The strip is
  then simply showing where the note came from; hiding it would make the layout
  jump between two notes and imply a conversion only sometimes happened.
- **It is raw IANA text, not a second abbreviation.** `EDT` is already in the
  stamp and changes with DST; `America/New_York` is stable and unambiguous, and the
  hover title repeats it as "Captured in …".
- **The rendered strip is asserted, not just the helper.** `web/test/noteReader`
  renders the real component with `react-dom/server` and checks the New
  York → Tokyo conversion across midnight, plus the three cases where the label
  must be absent.
- **The trail tooltip reuses `capturedZoneLabel` instead of its own rule.**
  `trailTooltip` composes the row's `title`, so a date-only stamp or a note with no
  recorded zone keeps the plain `Open <path>` text; the row cannot claim a
  conversion that did not happen. The builder lives in `web/src/trail.ts` because
  the App has no component test, and the rendered tooltip was checked end to end
  in a browser against a scratch vault (`Open notes/zoned.md · captured in
  America/New_York`).

## 2026-10-20 — the room behind the core

- **The hall is a stage under the sphere, not a page-wide background.** The
  requested reference is a photograph of an empty room; tiling the whole dashboard
  with it would fight the panels and the small type. The notes are what the eye
  should land on, so the room lives behind the cloud and fades into the page at
  all four edges, which also removes any hard frame. A future full-bleed hero can
  reuse the same geometry.
- **One vanishing point, not hand-placed lines.** Roof, two walls, floor, the
  cross seams, the wall joints, the ceiling panels and the doorway all come out of
  `cloudVoid()` with depth as the only input, and every guide terminates on the
  doorway's edge by construction. So changing the horizon or the aspect cannot
  leave a line floating, and the tests can assert convergence and symmetry rather
  than pixel coordinates.
- **Harmonic cross-seam spacing.** Evenly spaced panels read as a ladder. Screen
  depth is `z / (z + eye)`, which crowds the seams toward the horizon the way the
  photograph does.
- **The room is static.** Only notes move. A breathing room would compete with the
  sphere and would repaint the whole stage every frame.
- **Levitation is three cues:** a slow per-note drift that is independent of the
  sphere's rotation, a pool of accent light on the floor under the ball, and dot
  size/opacity that holds at depth. Reflecting every dot in the floor was
  rejected: it doubles the painted circles for a cue the pool already gives.
- **One blur pass on the node filter.** A tight core plus a wide bloom looked
  better but runs the filter twice over the whole particle group every frame; the
  bloom is carried by the halo and the floor pool instead.
- **Near wall joints are skipped.** A joint right beside the camera reads as the
  front edge of a box, so the wall seams start at the second panel back. What
  would change it: a full-height hero where the near walls are meant to be in
  frame.

## 2026-10-20 — provenance in the tab

- **The title carries the word, the favicon carries a mark.** A tab strip can be
  monochrome, 16 px, and truncated, so one channel is not enough: the title says
  `Work (manual)` and the icon adds a corner dot, which survives a grey or
  colour-blind tab strip. The mode stays the first word, so `Work (manual) · Bra…`
  is still readable when the tab is cut short.
- **Only manual and stale are marked.** The scheduled case is the ordinary one;
  a mark on it would make every tab look annotated and leave nothing to notice
  when the state actually needs a human. Filled dot = set by hand, hollow ring =
  the override lapsed, no mark = the schedule decided, and before `/api/mode`
  answers there is no mark either — an unanswered read is not an automatic one.
- **`tabIdentity` takes the whole payload now.** It derives label, source and
  mark from the same `modeBadge` the header uses, so the tab and the badge cannot
  disagree about provenance. The App memoises the result on `mode` + `source`, so
  the minute poll (which returns a new object every time) does not rewrite
  `document.title` and the favicon when nothing changed.

## 2026-10-20 — the mode-change notice sits at the bottom

- **The notice was already there; the placement changed.** The dashboard polls
  `/api/mode` every minute and on refocus, and `modeChangeNotice` already turned a
  real Work↔Home flip into a nine-second `role="status"` notice. Verified end to
  end in a browser (fetch answered with a flipped payload, window focused): the
  notice appeared, the tab title and badge changed with it, the close button
  removed it, and it self-dismissed after nine seconds without a click.
- **Bottom-anchored, not top-centred.** The old `top: 12px` overlay covered the
  accent-theme switch for its whole nine seconds — a notice about the mode had
  become an obstacle to another control. At the bottom it only ever covers the
  read-only footer line, at every width, and the header badge stays visible next
  to it. What would change it: a header that reserves a slot for the notice.

## 2026-10-20 — vault guard tests

- **Faults are injected by name, not raced and not built from OS fixtures.** The
  vanishing-file branch only fires between the walk's `readdir` and the read; a
  test that deletes a file from a timer is a coin flip on a fast disk and a flake
  on CI. One `fs.readFile` call is held to raise `ENOENT` for a single path, which
  is exactly what the race delivers, and the rest of the scan still runs against
  the real filesystem.
- **The post-read `stat` guard is pinned with a fault, and that is stated in the
  test.** On Windows, macOS and Linux alike, reading a directory fails with
  `EISDIR` before `!stat.isFile()` is reached, so a real directory can only prove
  the `404`, not the guard. The real directory case is still asserted first; the
  fault exists to cover the branch a real filesystem cannot reach.
- **The injector fails a test whose fault never fired.** A stub the code never
  reached is a test that proves nothing, and it is the failure mode this kind of
  test hides best. `server/test/fsFault.ts` counts matches and throws after the
  body if any declared fault went unused (verified by pointing a fault at a path
  the scan never reads: the test failed with that message).
- **The stubs go through a mutable view of `fs.promises`.** It is one shared
  object, so patching its methods affects the module under test; TypeScript marks
  a namespace import's properties read-only, hence the cast, and every stub is
  restored in a `finally`. The runner gives each test file its own process, so
  this cannot bleed into another suite.

## 2026-10-20 — the core becomes a galaxy

- **The core is a spiral galaxy, not a sphere or a flat diagram.** The reference
  video is an almost-face-on spiral: reading it as a ball of dots lost the arms,
  the bulge and the depth. Notes moved from `galaxyPoint`'s arc to four
  logarithmic arms, the resting pitch went to 0.9 rad (near face-on, both arms in
  view), and the dust became three seeded populations plus a soft gas layer.
  Would be revisited if a spherical layout ever carried real meaning (e.g. a
  faithful 3-D embedding of the graph).
- **Stars are neutral white; only the gas takes the accent.** Tinting the dust
  with the theme turned the galaxy into a gold sticker in the amber theme — a
  photograph of stars is white, and the accent belongs to the room around it. The
  `--star` token is deliberately outside the theme palettes.
- **The star disk is its own SVG layer with a CSS transform.** The first pass put
  ~8k circles in the notes' SVG; every frame's node attribute writes forced a
  repaint of all of them and headless Chrome measured 31 fps. Rotating the disk
  with `scale(zoom, zoom·tilt) rotate(yaw)` on a separate, composited element took
  the same frame to 125 fps (p95 10 ms), and 105 fps once the disk grew to 10,246
  circles, with no visual change. The notes' halo
  moved from a per-frame `feGaussianBlur` to a radial gradient for the same
  reason.
- **The disk is sized to the stage, with the viewBox in frame pixels.** A fixed
  600×460 viewBox letterboxed the galaxy into two-thirds of a wide stage. A
  `ResizeObserver` now sets the viewBox to the frame's own size and clamps the
  radius to the space a tilted disk needs. Units are CSS pixels, which also keeps
  the pointer targets and star sizes predictable at any window size.

## 2026-10-20 — a session mute for mode notices

- **`sessionStorage`, not `localStorage`.** The request was explicit that the
  mute is session-only and per tab. `sessionStorage` gives exactly that: it
  survives a reload of the open tab and is empty in a new window, so a moment of
  "not right now" cannot silently hide tomorrow's flip. Would change only if
  someone asks for a permanent "never show these" switch, which is a different
  decision.
- **The control lives on the notice and in Settings.** A mute that can only be
  reached from the notice it is hiding is a one-way door; the Shown/Muted
  radiogroup in Settings makes it reversible. The notice's button is a separate
  labelled control rather than a second meaning for the ×, so "dismiss this one"
  and "stop these" cannot be confused by pointer or screen reader.
- **A muted tab still tracks flips internally.** The effect updates
  `lastKnownMode` before checking the mute, so unmuting mid-session announces the
  *next* change rather than replaying a stale one from while it was quiet.
- **Storage failures are silent, by design.** Blocked or quota-exceeded storage
  leaves the choice working for the mounted page and simply does not survive the
  reload; it must never take the dashboard down or claim a persistence it lacks.

## 2026-10-21 — muted mode flips wait on the badge

- **Muting banks a flip instead of dropping it.** The old mute advanced
  `lastKnownMode` and returned, so a Work↔Home change was simply forgotten. The
  notice is still built, then stored with the payload's `checkedAt`; the badge
  offers it later. Would change if mute came to mean "erase the history too",
  which is not what the button says.
- **Three per tab, in `sessionStorage`.** A backlog is a glance back at what was
  missed, not a mode log (the CLI's `mode-log.md` is that), so it is capped at
  three. Using the mute's storage lifetime means a reload keeps the silence and
  the flips it hid together, while a new window starts clean. The stored value
  is shape-checked on read so an older build cannot break the header.
- **The badge itself is the panel.** A separate history chip would have left the
  reason and the notice switch without a home until a flip happened. Making the
  badge a native `<details>` gives the full reason and the switch a place in
  every state, and the backlog simply extends the same panel when it exists. It
  still cannot switch the mode (`npm run mode` does that), and the live region
  stays separate so opening the panel or toggling the switch does not
  re-announce the mode.
- **Unmuting keeps the backlog.**  The user may switch mute back before reading it;
  clearing is explicit (Clear in the disclosure) rather than a side effect of
  the Shown choice. No muted flip is ever replayed as a notice.

## 2026-10-20 — build once, smoke the same bytes

- **The check job uploads `server/dist` + `web/dist`; the smoke job downloads
  them.** `check` already builds on both platforms, so the smoke job's rebuild
  was a second, independent compilation of the same commit — wasted minutes, and
  a failure that could not be attributed to either build. Now the smoke run
  boots exactly what `check` produced, and `needs: check` guarantees it is the
  same run. Would change if the smoke job ever needed outputs the build does not
  produce (it does not: it consumes compiled JS and static files only).
- **Only the Ubuntu leg uploads.** The smoke job is `ubuntu-latest`, and the
  compiled JS and `web/dist` assets are platform-neutral, so `built-app-ubuntu-latest`
  is the single artifact both steps agree on by name. If the matrix or the smoke
  runner changes, the download step fails loudly rather than silently using a
  stale artifact — the intended failure mode.
- **`npm ci` stays in the smoke job.** The artifact carries build output, not
  `node_modules`; uploading dependencies would be hundreds of megabytes of
  platform-specific binaries. Installing from the lockfile is what makes the
  runtime tree identical to the check job's, and it is the cheap half of the old
  step. `if-no-files-found: error` plus a named download step makes a missing or
  renamed artifact a red job, not a skipped smoke.
- **Retention is one day.** The only consumer is the next job in the same run,
  so keeping two compiled trees per run for the default 90 days buys nothing.

## 2026-10-20 — the smoke proves the vault is untouched

- **Snapshot before the server starts, compare after the last probe.** Hashing
  only after the probes would miss a startup-time write, and a mtime-only check
  would miss a rewrite that preserved timestamps. Starting before the spawn also
  makes the assertion cover the scan the server does on boot.
- **SHA-256 + size + mtime, not just one.** Content is the claim ("nothing is
  written to the vault"), so hashes decide; size and mtime are reported as
  separate lines so a failure says whether the bytes moved or only the metadata
  did. Would drop mtime if a platform ever reported it inconsistently, but it is
  exact on both CI runners today.
- **Directories are excluded.** A directory's mtime changes whenever an entry is
  created or removed, which the file list already reports; including it would
  turn one added file into two confusing lines and add noise for no new
  information.
- **The helpers live in `scripts/vaultSnapshot.mjs`, with a `.d.mts` and a
  server test.** The smoke script runs `main()` on import, so anything defined
  inside it is untestable. The test covers detection of changed content, an
  added file, a removed file and an `utimes`-only touch — and the guard was
  checked the other way too: injecting a one-byte `appendFile` into the scratch
  vault during a local run made the smoke exit 1 with
  `notes/alpha.md: content changed; size 192 → 193; mtime changed`.

## 2026-10-20 — line endings are a repository rule

- **`* text=auto eol=lf` plus explicit types.** The working machine has
  `core.autocrlf=true`, so a fresh checkout there produced CRLF while the Linux
  runner produced LF: identical commits, different bytes, whole-file diffs and a
  Windows CI leg whose meaning quietly depended on the runner's Git config. An
  in-tree `.gitattributes` makes LF the repository *and* working-tree answer on
  both platforms. Measured both ways with `git checkout-index` into a scratch
  directory: without the file and `core.autocrlf=true`, README.md came out with
  280 CRLF, `App.tsx` 645, `package-lock.json` 3719 and `mode.mjs` 190; with it,
  zero under `core.autocrlf=true` *and* `false`, and the PNG is byte-identical in
  all three checkouts.
- **Windows launchers get `eol=crlf`.** None exist today, but a `.cmd` or `.ps1`
  with LF can fail in ways that look unrelated. The rule is written now so adding
  one does not need this decision revisited in the same commit.
- **Binaries are declared, not sniffed.** `binary` (-text -diff) on the image and
  media extensions keeps Git from treating a PNG as text if its first bytes look
  printable, and keeps image changes out of the diff view.
- **One-time renormalization is not done here.** Every text blob already in the
  index is LF (`git ls-files --eol` shows 67 × `i/lf` and the one PNG as
  `i/-text`), so nothing needs rewriting today. If a CRLF blob ever lands,
  `git add --renormalize .` fixes it in a commit of its own — that is a staging
  operation on files this session did not author, so it is left to the owner.

## 2026-10-21 — one issue for dependency drift

- **A file, not a second registry query, carries the verdict.** `check-deps.mjs`
  writes `.ci/deps.json` after `npm outdated` succeeds, and `drift-issue.mjs`
  reads it. Asking npm again in the issue step could disagree with the check that
  just ran, and doubles a slow network call; the file also lets the issue keep
  the exact rows the job summary showed. It is written only after a successful
  `npm outdated`, so the existence of the file *is* the "the check reached a
  verdict" signal.
- **The issue is a record, not a replacement for the red run.** `check:deps`
  still exits 1 on in-range drift. Turning that green because an issue exists
  would hide the failure from anyone who watches the Actions tab, and the two
  signals serve different readers: the run says "something is wrong now", the
  issue is where the fix is tracked across weeks.
- **The body is the state, so a repeat finding writes no comment.** Stale
  packages rewrite the title and body of the open issue; otherwise every weekly
  run would add a near-identical comment and bury the actual discussion. The
  title carries the count because that is what the issue list shows.
- **Closing leaves the reason behind.** A close without a comment looks like the
  issue was dismissed. The closing comment repeats the informational
  newer-majors table on purpose — it is the only part of the report that would
  otherwise be destroyed by closing.
- **No report means no change.** If npm failed, the check step was skipped or the
  script ran outside CI, there is no evidence that the lockfile became clean, so
  the issue is left exactly as it was instead of being closed. A scheduled run
  that silently closes an issue because its registry call failed is worse than a
  stale issue.
- **`issues: write` is scoped to the `drift` job and adds no secret.** The
  workflow keeps `contents: read`; only the scheduled job widens its own token,
  and it uses the built-in `GITHUB_TOKEN`. Pull requests never reach that job, so
  the widened permission is not reachable from a fork. No Octokit dependency:
  the script calls four REST routes with `fetch`, one page of 100 open issues is
  enough for the lookup, and duplicates left by a hand-edited label are folded
  into the lowest-numbered issue rather than stacking up.
- **A regression after a close opens a new issue.** Only open issues are
  reconciled; reopening a closed one would be quieter but would notify nobody,
  and the closed issue plus its closing comment stay as the record of the
  previous episode.
- **Dry-run and tests without a network.** `--dry-run` prints the title and body
  it would publish; `server/test/driftIssue.test.ts` runs the real script against
  a local fake API, so the create/update/close sequence, the duplicate folding and
  the missing-token failure are exercised end to end rather than only as pure
  functions. Would change if the repository ever needs per-workspace issues (the
  label could gain a workspace suffix) or more than 100 open issues (the lookup
  would need pagination or the search API).

## 2026-10-21 — dependency health on the dashboard

- **The card calls the CI check, not a second implementation.** `server/src/deps.ts`
  imports `collectDrift()` from `scripts/check-deps.mjs`, the same function the
  weekly job runs, so "behind" means one thing everywhere: the lockfile supplied
  a version older than the range `package.json` allows. A parallel implementation
  in TypeScript would drift the first time the classification changed. The npm
  call is now async (`spawn`, not `spawnSync`): a synchronous child would freeze
  every other route — and the watcher — for the length of a registry round trip.
  `collectDrift` also owns the timeout and the "npm itself failed" distinction,
  so the CLI's exit codes and the card's `ok: false` come from the same place.
- **15 minutes fresh, one minute stale.** `npm outdated` is a registry round trip
  (about 1.4 s warm here), far too expensive per page load. A good answer is
  reused for 15 minutes; a failure for only one, so a recovered registry is not
  hidden behind a long cache while a broken one is not hammered. Concurrent
  requests share one in-flight run, and **Recheck** (`?refresh=1`) is the only
  path that skips the cache — measured through the dev server: 1.38 s cold,
  39 ms cached.
- **A failed check is a card state, not an error page.** The route answers `200`
  with `ok: false` and a one-line reason, because the notes are readable whether
  or not npm can reach the registry; raising the vault-offline banner would blame
  the vault for a toolchain problem. The card also loads on its own, not in the
  vault's `Promise.all`, so a slow registry never delays the first paint.
- **npm runs at the repository root.** `npm run dev -w server` starts the process
  in `server/`, where `npm outdated` would only see that workspace; `index.ts`
  passes its own `ROOT` to the reader. The built server imports
  `dist/scripts/check-deps.mjs`, so `build-server.mjs` copies it next to
  `mode.mjs`, and the smoke suite asserts `/api/deps` — a missing copy would
  otherwise fail only in the dashboard, not in CI.
- **Only three rows, and the count leads.** The issue is the full table; the card
  is a glanceable readout. Newer majors are mentioned as one line rather than
  listed, since acting on them is a deliberate decision, not drift.
  Would change if the repository grew more than one lockfile (the reader would
  need a per-workspace breakdown, or the route would take a `?root=`), or if the
  npm call proved too slow to run from a request at all — then the CI job's
  `.ci/deps.json` would become the server's source instead of a live call.

## 2026-10-21 — the graph has a heartbeat, and the shell breathes with it

- **The core pulses inside its existing frame loop; the full graph pulses in CSS.**
  The galaxy already draws every frame and owns a busy ring, so the ambient pulse
  is one more term there: `graphPulse` adds a crest travelling outward (2.4 rad
  radial delay, ~1.8 s core-to-rim) plus a slow per-note breath, and the idle ring
  reuses `pulseFrame` at 22% of the scan alpha. `FullGraph` is static SVG with no
  loop, so its halos breathe through a staggered CSS animation instead — no timer
  is started for a dialog that may sit open for minutes.
- **The crest delay must stay under a full turn.** The first draft used 5.6 rad,
  which wraps past 2π and makes the rim crest *before* the core on the first pass —
  the test caught it. 2.4 rad keeps the inward-out direction unambiguous, and
  `cloudMotion.test.ts` pins both the bounds and the delay.
- **Motion is gated where motion is already decided.** The JS pulse multiplies the
  existing `animate` flag, so Off paints one still frame without a frozen ring; the
  CSS additions sit behind `prefers-reduced-motion`, and no new animation runs
  outside the loop that was already there.
- **The polish stays decorative and cheap.** Hover hairlines on metric rows, panel
  borders that answer the pointer, one sheen pass across a vault action, the brand
  mark and wordmark breathing, corner brackets out of phase, the active tab's glow,
  accent-coloured selection and caret, and a faster halo on hover. No new request,
  asset, dependency, or per-frame write.
  Would change if the heartbeat read as distracting on a long session — the periods
  are constants (`GRAPH_PULSE_PERIOD`, the CSS keyframe durations), so slowing it is
  a one-line change rather than a redesign.

## 2026-10-21 — every green run publishes its build

- **Both legs upload, not just Ubuntu.** The original rule treated the artifact as
  the smoke job's input, so a second copy was pure cost. The requirement changed:
  a green run's output should be inspectable afterwards. The Windows copy is the
  same platform-neutral JS in principle, but it is the only evidence of what that
  leg actually emitted, and two artifacts of ~144 KiB gzipped are cheap next to
  being unable to answer "what did the Windows build produce?".
- **14 days instead of 1.** One day covered only "the very next job in this run".
  Two weeks covers "what did last week's run emit?" without hoarding storage for a
  repository that builds on every push. Measured artifact: 14 files, 498 KiB raw,
  144 KiB gzipped — well inside the 10 GB / 1000-file limits.
- **`overwrite: true` is required, not cosmetic.** Re-running a check job keeps
  the same run id, and `upload-artifact@v4` refuses a second artifact with an
  existing name in one run; without it a re-run fails at the last step and the
  smoke job then has nothing to download. Replacing the previous copy is correct:
  the re-run's build supersedes it.
- **The two directory paths are unchanged.** `smoke` restores
  `built-app-ubuntu-latest` by exact name, and the zip keeps the workspace-relative
  paths, so unzipping over a checkout that has run `npm ci` and running
  `npm run start:built` serves exactly those bytes.
  Would change if artifacts needed provenance (a published checksum or signed
  attestation), or if the storage policy demanded a shorter window for pull
  requests.

## 2026-10-21 — the badge panel's small print clears AA

- **The panel's 8 px labels use `--muted`, not `--muted-dim`.** axe marked the
  panel's text "incomplete" because it sits on a gradient, so the ratios were
  measured by hand against both stops: `--muted-dim` came out 2.95–3.18:1 at 8 px,
  under AA's 4.5:1 for body text, while `--muted` reaches 5.73–6.18:1 on the same
  pane. Only the four failing selectors changed (provenance in the panel title,
  the switch's Shown/Muted word, the backlog heading, its source and timestamp).
- **Scoped to the panel instead of the token.** `--muted-dim` is used all over the
  dashboard for deliberately quiet metadata, and repainting every surface to fix
  one 340 px pane would be a diff nobody asked for; it would change if the token
  itself is ever re-tuned.
- **Dismissal is hand-rolled on top of `<details>`.** A native summary handles
  keyboard and screen readers, but the element does not close on an outside click
  or Escape. A single document-level listener covers both, and the live region
  stays outside the disclosure so opening it or flipping the switch cannot
  re-announce the mode.

## 2026-10-21 — one installed tree for the Linux jobs

- **The cache holds `node_modules`, not only npm's tarball cache.** `setup-node`
  already shares `~/.npm`, but every job still extracted the same tree: measured
  here at 100 MB and 5,917 entries, taking 12 s of a warm `npm ci`. A gzip
  archive of that tree is 24 MB and took 5 s, so `smoke` and `perf` now pay a
  transfer instead of an extraction, and `check`'s Ubuntu leg skips the install
  entirely on a hit. The saving is seconds rather than minutes — it is worth it
  because it is one line per job, not because it is dramatic.
- **Key: lockfile hash + resolved Node version + OS, and no `restore-keys`.**
  A prefix fallback would hand a job a tree built from a different lockfile, and
  `npm ci` deletes `node_modules` before reinstalling, so the fallback would be
  restored and immediately thrown away. A resolved key is
  `node-modules-v1-Linux-node-v24.22.0-<64 hex>`, 100 characters against the 512
  limit; it includes the exact installed Node version (via
  `steps.node.outputs.node-version`, which is `node --version` and keeps its
  leading `v`), so a Node upgrade cannot reuse binaries built for another one.
- **`npm ci` still runs on a miss.** A lockfile bump, an evicted entry, or a
  branch/pull-request ref whose key has never been saved all miss; the install
  step is guarded with `steps.modules.outputs.cache-hit != 'true'` rather than
  removed. The integrity gate is unchanged: `npm run check:lockfile` still runs
  before the cache restore, so a cache hit never becomes a way to skip proving
  that the lockfile describes `package.json`.
- **Linux only.** npm links workspaces with junctions on Windows, and a tar
  round-trip of this checkout's `node_modules` came back with **0 symlinks** —
  `node_modules/@braindash/*` had been dereferenced into directories. Restoring
  that in CI would quietly turn the workspace link into a stale copy of the
  source tree, so the Windows leg keeps installing from scratch.
- **`check` writes, `smoke` and `perf` read.** `needs: check` already orders
  them after the gate, and a cache entry only becomes visible once its save step
  has finished, so the ordering is the guarantee rather than a hope.

## 2026-10-21 — the smoke runs on both platforms

- **One matrixed job, not a second `smoke-windows` job.** `smoke` now has
  `os: [ubuntu-latest, windows-latest]` with `fail-fast: false`, and downloads
  `built-app-${{ matrix.os }}` — the same expression `check` uploads with, so the
  names cannot drift apart. A separate job would have duplicated every step
  (checkout, Node, install, artifact, probe) and given the two legs two places
  to diverge.
- **Each leg consumes its own platform's build.** The Windows artifact used to
  exist only for inspection; it is now the input to a real boot. That is the
  point: the Linux copy cannot prove the Windows-compiled entry handles
  `path.sep`, a vault under `%TEMP%` or the `npm.cmd` spawn behind `/api/deps`.
- **The Windows leg still installs from scratch.** The shared `node_modules`
  cache stays Linux-only for the junction reason above; here a fresh `npm ci` is
  both correct and cheap next to the rest of the job.
- **Verified locally on Windows, not in Actions.** `npm run smoke:built` against
  the local build passed on this machine: 5 notes, 1 edge, "vault unchanged
  (5 files)", en route through the same assertions the CI leg runs, including
  the `/api/deps` npm call and the scratch-vault snapshot. The YAML parses and
  the matrix wiring was checked structurally (artifact name expression, cache
  step still Linux-only, `needs: check`, `fail-fast`). What is unproven until a
  push is the artifact download itself — same platform, so no conversion is
  involved, but it is the one step that only exists on GitHub.
  Would change if the Windows leg turns flaky: the two candidates are the
  recursive watcher briefly holding the temp vault (retry the `fs.rm`) and the
  `/api/deps` npm call's 25 s probe budget on a cold runner.

## 2026-10-21 — the read-only proof covers the checkout, not the whole disk

- **Scope: the checkout the server is started from.** The vault walk cannot see
  a cache, log or config written beside the code, and that is the realistic
  failure for a server whose whole job is reading. Watching the machine instead
  would be a false-positive machine: the smoke's own `/api/deps` probe shells
  out to npm, which writes its cache under the home directory, so a
  home-directory snapshot would fail on the harness rather than the product.
- **`node_modules` and `.git` are ignored.** A Vite dev server caches into
  `node_modules/.vite`, so a local `npm run smoke:built` beside `npm run dev`
  would report a write nobody made; the tree also dominates the walk (100 MB
  against 311 files). `.git` is not the application's storage either. Everything
  else — `server/dist`, `web/dist`, `.freebuff/`, any new root-level file — is
  covered.
- **Symlinks are skipped, never followed.** Not just policy: a link to a
  directory reads as `EISDIR` and the old walk would have thrown rather than
  reported. This matches the vault scanner's rule, and it means a write *through*
  a link is outside both proofs — documented rather than implied.
- **Verified by breaking it.** The local smoke reports `checkout unchanged
  (311 files)`; writing `.smoke-negative-probe.txt` two seconds into a run made
  it exit 1 with `the probes wrote outside the scratch vault:
  .smoke-negative-probe.txt: added`. Four new unit tests cover the ignore
  subtree, a nested ignore that keeps its siblings, a write beside the ignored
  paths, and a directory link (10 in the suite, all passing).
- **The comparison still happens before the child is killed.** That is where the
  vault proof has always been, and it keeps a failure in the main body from
  being replaced by a shutdown-time diff. Writes during shutdown are therefore
  not covered by either tree — the same boundary both proofs had before.

## 2026-10-21 — CRLF is a gate, not a convention

- **The check reads the working tree, not the attribute file.** `.gitattributes`
  already asks for LF, but a rule is only a promise: an editor that writes CRLF, a
  tool that ignores `eol=lf`, or a pattern removed by accident all look green until
  something diffs. `git ls-files --eol` is the one command that reports what each
  tracked file actually is, and it also applies Git's own text/binary decision, so
  a PNG holding `0x0d0a` is never a finding and the file does not have to be read
  to know that.
- **Declared `eol=crlf` paths are exempt.** The `.cmd` / `.bat` / `.ps1` rules
  exist because a launcher with LF can fail oddly; the gate must not fail those
  files for matching the answer written for them.
- **Both runners, before the install.** It is one Git call, so it runs ahead of the
  dependency cache and needs no `node_modules`. The Windows leg is the one that
  matters — `core.autocrlf=true` there is what would produce CRLF if the
  attribute rule stopped applying — and the Linux leg catches a tree checked out
  without attributes at all.
- **Git failing to answer exits 2, never 0.** An unparsed row or a missing work
  tree must not read as “nothing to report”; that is how a gate becomes decorative
  after a Git upgrade.
- **The negative case was run both ways.** Rewriting `server/src/life.ts` with CRLF
  locally produced exit 1 with `272 CRLF lines (first at line 1)`; restoring the
  file returned green. The first attempt *passed* on the rewritten file, which
  exposed that the parser kept the `/` from `w/crlf`; the pattern was fixed and
  `server/test/checkEol.test.ts` now pins the column format as well as a real
  temporary Git checkout.

## 2026-10-21 — editors write LF too

- **`.editorconfig` mirrors `.gitattributes`, not the other way round.** Git already
  converts on checkout, so a file saved with CRLF looks fine until Git normalizes
  it — the editor is the half that was never told. Both sides now agree at save
  time, and the settings are the ones the code already uses (UTF-8, 2-space
  indents, final newline) rather than a new style to apply.
- **Markdown keeps trailing whitespace; launchers get CRLF.** Two trailing spaces
  are a hard line break in Markdown, so trimming is off there; `.bat`, `.cmd` and
  `.ps1` ask for CRLF to match their attribute rules.
- **Checked with EditorConfig core, not by eye.** `editorconfig` printed
  `end_of_line=lf` for `web/src/api.ts`, `trim_trailing_whitespace=false` and LF
  for `README.md`, and `end_of_line=crlf` for a probe `.cmd`, which was then
  removed. `npm run check:eol` still reports 67 text files all LF, and the file
  itself is LF.

## 2026-10-21 — the LAN view can be locked

- **Opt-in through `BRAINDASH_TOKEN`; unset changes nothing.** The API is
  loopback-only by default, but Vite binds every interface, so the same vault is
  on the network through the dashboard. A variable rather than a new mode or a
  config file keeps the single-machine install exactly as it was, and the smoke
  and perf harnesses pin it empty so a token in the developer's `.env` cannot
  turn their assertions into 401s.
- **A cookie, not a header, is what the browser uses.** `EventSource` cannot send
  an `Authorization` header, so a header-only design would have broken the mode
  stream, and a token in the query string would sit in history and logs. The
  cookie also carries across reloads, assets and proxied requests without
  touching each call site. It stores the token's SHA-256, not the token, is
  `HttpOnly` and `SameSite=Strict`, and every comparison hashes both sides first
  so `timingSafeEqual` cannot throw on a length mismatch.
- **The unlock screen is in the SPA, not a server-rendered page.** The dashboard
  is served by Vite on 5180 and by Express on 5181; a login page would only
  cover one of them and could drift from the other. `AccessGate` in `main.tsx`
  mounts the dashboard only after `/api/session` allows it, so while locked the
  App component never runs — no fetch fan-out, no vault request, no cached data
  behind the card.
- **The bundle stays public; the data does not.** Gating static files would need
  a second HTML surface and still not cover Vite, and the shell contains no vault
  content. Every API route except `/api/session` is gated, including
  `/api/health`, which names the vault path and note count.
- **Verified over HTTP and in the DOM, both ways in.** curl: no cookie or a
  forged cookie is `401`, the right token sets
  `braindash_token=<sha256>; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`,
  then `/api/notes` is `200`, `Authorization: Bearer` is `200`, `DELETE` clears
  and the next read is `401` again. Headless Chrome: the built server shows the
  unlock card, a wrong token shows the alert, the right one mounts the dashboard,
  `document.cookie` is empty (HttpOnly), reload keeps access, and a fresh
  incognito tab is locked again. The same unlock was repeated through the Vite
  proxy on 5180, which is the actual LAN path.

## 2026-10-21 — today's captures and the review queue

- **One day rule, shared with the sparkline.** `capturesOnDay` and the 30-day
  `captureSeries` now both call the same `captureDayKey`, so a note counted under
  today's bar is the same note the Today's captures sheet lists. A bare date keeps
  its written day; a timed stamp is converted into the chosen zone — a capture at
  12:00 UTC is the 21st in UTC and the 22nd in Kiritimati, and the API test proves
  that boundary.
- **The Review queue is a reading list, not a scheduler.** Advancing
  `next_review` would mean writing frontmatter, which is the reader's Edit path
  and only exists on a loopback write-enabled install. A queue that only reads is
  useful on the phone-facing LAN view too, and does not add a second write
  surface to audit.
- **`/api/actions` is a catalogue of the two actions that need the vault, not of
  every tile.** Random note, Full graph, New note and Themes are client-side and
  already have their answers; inventing server rows for them would make the rail
  depend on a request it does not need. Unknown ids are ignored by the client, so
  adding a third later is not a breaking change.
- **Counts refresh on a real change, not on every poll.** The dashboard reads the
  catalogue on mount and again only when the scan's fingerprint moved
  (`vaultVersion`), the zone changed, or the calendar day moved — the same
  change-gating the rest of the dashboard uses. **Rescan vault** bumps the same
  version, so an edited `next_review` reaches the tile without a reload.
- **The review date joins the fingerprint.** Without it, editing only
  `next_review` would leave the scan fingerprint identical and the queue would
  stay stale until the next real vault change; the field costs a few bytes in the
  signature.
- **Verified over HTTP and in the DOM.** Built server against a five-note
  scratch vault: `/api/actions` reported `today: 2` and `review: 2` (`1 of 2
  overdue`), the captures sheet listed *Morning Sketch* (9:15 AM EDT) then the
  bare-dated *Dated Note*, a row opened the reader, and the queue showed `3 days
  overdue` on *Overdue Review* and `Due today` on the other. Rewriting that
  note's `next_review` to +30 days and pressing **Rescan vault** moved the tile
  from 2 to 1 while the sheet was closed.

## 2026-10-22 — the session can be dropped from the dashboard

- **A header button, only where a session exists.** Locking lives in the topbar
  beside the gear, not in Settings: it is a session action, not an appearance
  one, and it has to be reachable in one click from a browser someone is about
  to walk away from. It renders only when `/api/session` reports `required`, so
  a no-token install — which holds no cookie — shows no control at all rather
  than a button that would do nothing, the same rule the palette uses for
  commands that cannot run.
- **Also a palette row, placed last.** `Lock dashboard` is offered as a command
  because the palette is the app's keyboard surface and a lock that only a mouse
  can reach is half a lock. It sits at the end of the catalogue so the first
  Enter on an empty palette cannot drop the session, and it is searchable by
  `sign out`, `logout` and `session` rather than only by its own label.
- **The dashboard unmounts; the page does not reload.** `DELETE /api/session`
  answers `{ required, authenticated: false }`, which is exactly the gate's next
  state, so setting it returns the unlock card and unmounts `App` in the same
  tick — the reader, the note list and every card leave the DOM, and the mode
  stream's `EventSource` closes through its own cleanup. `location.reload()`
  would wipe the same pixels but throw away the URL hash the person arrived on
  and re-run the whole boot for a state the gate already knows.
- **A failed lock is shown, not swallowed.** The busy and error state is shared
  by the button and the palette row through `useLockAction`, and the message
  renders under the always-mounted header button. A lock that quietly failed
  would leave the cookie in place while the UI implied otherwise.
- **It clears this browser's cookie and nothing else.** No server-side session
  table was added: the install documents itself as a shared secret for a trusted
  network, so a lock ends the session in front of you while the token stays valid
  everywhere else. Global revocation would need the account system the gate
  deliberately is not.
- **The empty palette is a menu, so the cap now applies to typed searches.**
  Verification caught the tenth command being sliced off: the status line said
  `10 commands` while nine rows existed, so `Lock dashboard` was unreachable by
  arrow keys until the person typed something. `paletteRows` caps only a query
  and lists the whole catalogue when the box is empty; `palette.test.ts` pins
  both the tenth row and the lock's first place for `sign out`. A menu cap would
  only come back with paging or scrolling, which is a different UI.
- **Verified over HTTP and in the browser.** The built server (`start:built`)
  on 5281 with a scratch vault and a token, leaving the dev servers on 5180/5181
  alone: `POST /api/session` set the cookie, `DELETE` answered `Max-Age=0` with
  `authenticated: false`, and the same cookie string then read `401`. In the
  dashboard the lock button appeared beside the gear, clicking it cleared the
  cookie and returned the unlock card with the dashboard gone (`/api/health`
  `401`, no `.app` in the DOM), the palette's `Lock dashboard` did the same from
  a `sign out` query, and a second build on 5282 without a token rendered
  neither control and listed nine commands. The failure banner is covered by
  markup tests; forcing a rejected `DELETE` live was not attempted.

## 2026-10-22 — the line-ending gate reads the index too

- **The working tree cannot answer for the blob.** `.gitattributes` normalizes
  text on `git add`, so most CRLF never reaches a blob — but not all: a blob
  written past the filters (`git hash-object --no-filters` plus `update-index`, a
  merge driver, a tool that writes objects directly) can hold CRLF while every
  `w/` column still reads `lf`, because the checkout *is* that blob. The gate
  would pass and the next clone would be CRLF, which is exactly the failure the
  gate exists to prevent.
- **One Git call, two columns.** `git ls-files --eol` already lists `i/…` beside
  `w/…`, so the index half costs a filter over an array that is in memory — no
  second process, no blob walking. `crlfBlobs` mirrors `crlfOffenders` with the
  same exemptions: binary (`-text`, the `binary` macro) is never inspected, and a
  path whose rule declares `eol=crlf` — the launcher rules — is the rule's
  business, not a finding.
- **Index findings print first, and either one fails the run.** A staged blob is
  the finding that reaches other machines and the one a later checkout cannot
  repair, so it is reported first with its own repair (`git add
  --renormalize <path>`); a disk finding keeps its local repair (`git checkout --
  <path>`). Two independent sections, one exit code 1; exit 2 still means Git
  could not answer, never a clean tree.
- **The count comes from the blob, not the file.** `git cat-file blob :<path>`
  reads the object that would be committed, so `2 CRLF lines (first at line 1)`
  describes the blob even when the file on disk has already been fixed.
- **Rehearsed both ways in this checkout.** A raw CRLF blob written into the index
  for `.env.example` made `npm run check:eol` exit 1 with `CRLF in the index: 1 of
  71 text files` and the line count; `git reset -- .env.example` restored `i/lf`,
  the run went green again, and the file's uncommitted edits were untouched.
  `server/test/checkEol.test.ts` pins the same fixture in a temporary repository
  (raw blob via `hash-object --no-filters` + `update-index`) alongside the unit
  rules for the index column.

## 2026-10-22 — deleted notes can be recovered from the dashboard

- **The safety net existed; nothing could reach it.** Delete has always moved a
  note to `.trash/<stamp>/<path>`, but recovery meant opening a file manager, so
  the guarantee was only real for someone who knew the folder existed. Listing and
  restoring closes that loop inside the same contract as the rest of the write
  layer: the API validates containment, the client never invents a path.
- **Listing is a read; restoring is a write.** `GET /api/trash` sits behind the
  token gate like every read and works without write mode, because looking at what
  was deleted changes nothing. `POST /api/trash/restore` goes through the same
  `rejectWrite` gate as delete (`403 write_disabled`, `403 write_forbidden`), and
  the tile and palette row render only when `/api/health` reports `writes: true` —
  a control that always answers 403 would be a lie the dashboard tells itself.
- **Restore never replaces a newer note.** The bytes are written with `wx`, so a
  filename that came back into use answers `409 note_exists` and the trashed copy
  stays. Overwriting would turn “undo a delete” into “lose what I wrote since” —
  the one thing a safety net must not do.
- **Bytes copied, mtime kept, folder pruned.** The copy runs the same checks as a
  create (real `.trash` root and a real parent inside the vault), keeps the note's
  `mtime` via `utimes` so the reader's `modifiedAt` conflict check still compares
  like with like, and removes the emptied stamp folder. A failed unlink leaves a
  duplicate in the trash rather than a lost note, which is the harmless direction.
- **Titles come from the head of the file only.** The list reads 4 KB per entry for
  a `# heading`, falling back to the filename slug; a large trash should not be
  read in full just to be labelled.
- **One dialog at a time.** A restore closes the sheet, refreshes the vault along
  the manual-rescan path (stats, notes, graph, `vaultVersion`) and opens the
  restored note in the reader. Keeping both open would give `useDialog` two focus
  traps and two `Escape` handlers — the rule the palette and the gate already
  follow.
- **Verified over HTTP and in the browser.** With `BRAINDASH_WRITE=1` on a scratch
  vault (built server on 5283, dev servers untouched): the empty trash answered
  `{ total: 0, entries: [] }`; deleting *Alpha note* from the reader left one
  entry with its id, path, title and 48 B size; the Trash tile opened the sheet
  focused on its close button, restoring closed it, opened the reader on the
  restored body, emptied the trash and put the note back in `/api/notes` with one
  dialog still open. Deleting *Beta note*, re-creating `notes/beta.md` and pressing
  Restore answered `409`, showed *A note already exists at that path* on that row,
  kept the sheet and the row, and left the newer note untouched — the only
  console error was that deliberate 409.

## 2026-10-23 — the browser is hardened even without a token

- **Headers belong to every response, not to the routes that remembered.** A
  token is optional, so the default install had nothing between its vault and a
  hostile page: any site could frame `127.0.0.1:5181` and put its own controls
  over **Delete**. `server/src/httpSecurity.ts` now sets the CSP (`'self'` only —
  inline styles for React `style` attributes and `blob:` for imported audio are
  the two exemptions), `nosniff`, `X-Frame-Options: DENY` beside
  `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` and a
  microphone-only `Permissions-Policy` before any route, so the built SPA and
  the JSON share one policy. `Cache-Control: no-store` moved from individual
  handlers to the `/api` mount for the same reason: a new route cannot forget it.
- **The Host header is checked on reads too.** DNS rebinding needs no token to
  exploit: a page on `evil.example` resolves to 127.0.0.1, so the browser treats
  the API as same-origin. `/api` now answers only a loopback name, `*.localhost`,
  a literal IPv4/IPv6 address, or a name in `BRAINDASH_HOSTS`; everything else is
  `403 host_not_allowed`, `/api/session` included. Literal addresses stay allowed
  because the phone-friendly LAN view sends one and an attacker cannot serve a
  page from the victim's own address; a DNS name on the LAN is what the env var
  is for (bare matches any port, `name:port` pins one). This is not
  authentication — the token still decides who reads.
- **Dev gets the same policy with one honest exemption.** Vite serves the HTML
  itself and injects React refresh as an inline module script, so
  `web/vite.config.ts` sends `script-src 'self' 'unsafe-inline'` and
  `connect-src 'self' ws: wss:` for HMR. The built server, which serves the HTML,
  sends the strict policy; preview keeps the dev headers because `npm run
  preview` is a local review server, not the deployment.
- **Verified over HTTP.** `server/test/httpSecurity.test.ts` covers the headers on
  JSON and on the SPA from a temporary dist, `no-store` on four API routes, the
  refusal of `rebind.example` on `/api/health`, `/api/session` and `/api/notes`,
  the LAN literal and `localhost` still answering, and a configured name accepted
  only on its pinned port. `hostnameOf`, `isAllowedHost` and `parseAllowedHosts`
  are unit-tested, including `127.0.0.1.nip.io` and a bare `::1` — which exposed
  a real bug: a host without brackets was being cut at the first colon and
  refused.
- **Public-view cleanup.** `docs/SPEC.md` and `.env.example` named this
  machine's user folder and the author's own vault location; both now use
  placeholders, and the tree was checked for key/token shapes, email addresses,
  registry credentials and LAN addresses (none in tracked files). What remains
  outside the files is the commit author's email in history, which a rewrite or a
  noreply address would change — recorded under approvals rather than done.

## 2026-10-24 — a vault can never be committed

- **The repository is published; the notes are not.** The project is about to be
  used as a resume piece, so the checkout is public while the vault it reads is
  private. Nothing tracked was ever a note, but the safety did not survive a
  habit: `git add -A` in a checkout that briefly held a scratch vault would have
  committed it, and the two scratch folders from earlier verification
  (`.tmp-polish-vault/`, `.tmp-shots/`) were untracked and *not* ignored. Those
  were deleted and the ignore rules now cover `.tmp-*` (folder and file form —
  `web/.tmp-vite-verify.config.ts` was a third scratch artefact and is gone),
  `.vault/`, `.obsidian/`, `.trash/`, `notes/` and `inbox/`, so a vault copied or
  pointed into the checkout
  stays out of every commit without anyone remembering to check.
- **The guarantee is a test, not a promise.** `server/test/repoHygiene.test.ts`
  reads the real repository through git: `git ls-files` must contain no vault
  segment and no `.tmp-*` path, `.env` must stay untracked, and
  `git check-ignore --no-index` must still match a note under `notes/`, a trashed
  note, `.obsidian/app.json`, `.vault/notes/…` and `.env`. A hand-kept list would
  have to be edited every time the repo grew; the ignore rules are read instead,
  which is what catches the day someone removes a line. Rehearsed both ways: with
  `notes/` removed from `.gitignore` the suite failed on
  `notes/daily/2026-10-24.md`; restored, it passes. The test skips where git is
  unavailable rather than failing a tarball extraction.
- **What was still exposed was history, not files.** No tracked file carried the
  author's address any more (this log quoted it once, and that line was rewritten),
  but the one existing commit's author header did. That was left under approvals
  in this session and then done on request — see the next entry.

## 2026-10-24 — public history rebuilt on a noreply identity

- **Asked for, then done, with the old history kept.** The owner asked for a
  public-ready history, so the single existing commit became one fresh root commit
  holding the current tree (200 files, everything `.gitignore` already excluded)
  and `master` now points at it. Before anything moved, the whole old repository —
  all refs, commit `61361ca`, 72 files — was written to
  `.git/pre-public-history.bundle`, and `git bundle verify` reported “the bundle
  records a complete history”. Recovery was rehearsed rather
  than assumed: fetching that bundle back into `refs/check/old-history` produced
  the old commit with its 72 files under its original name and address, after
  which the temporary ref was deleted.
- **The identity is repo-local.** `user.name` stays `s0ma`; `user.email` became
  GitHub’s noreply form, `<id>+<login>@users.noreply.github.com`, read from the
  authenticated CLI account rather than guessed (a wrong id silently detaches
  commits from the account). Both the author and the committer header of the new
  commit carry it. The setting lives in `.git/config`, so it changes nothing for
  other repositories on this machine, and no personal address is left in the
  commit graph or in `.git/config`.
- **The bundle never leaves this machine.** `.git/pre-public-history.bundle` sits
  inside the git directory, which is never committed, and the branch holds no
  vault content (the hygiene test re-ran against the committed index and passed:
  no vault segment, `.env` untracked, ignore rules still matching). What the
  bundle preserves is the old commit's author address; it stays local and should
  not be pushed.
- **Not done: no remote, no push.** Creating the GitHub repository and pushing are
  externally visible, so they remain under approvals.

## Approvals needed

- **Publish the fresh history.** `master` is one root commit on the noreply
  identity with a clean tree, but no remote exists and nothing was pushed:
  creating the GitHub repository and the first push are external actions that
  await approval. Push `master` only — `.git/pre-public-history.bundle` holds the
  old commit and the personal address in its author header, and must stay local.
- **Let CI run.** `.github/workflows/ci.yml` (the `check` matrix, the built-server
  smoke, the perf job, the scheduled dependency drift with its artifact and run
  summary) only executes on GitHub, so those results stay unknown until the first
  push.
- **Decide whether `docs/DECISIONS.md` ships.** It is a working log written for
  this machine: newest first, written against a working-mode contract, and full of
  "uncommitted" bookkeeping from before the history was rebuilt. It carries no
  personal data after the address cleanup, but it reads as internal process rather
  than project documentation; dropping it also means dropping its README link.

## Earlier approval backlog, now resolved

Everything this section used to list — each feature, its tests and its docs — was
uncommitted when it was written and is now inside the single root commit. The
push items are the only ones still open, and the stale per-feature entries were
removed rather than kept, because a list that says "uncommitted" about committed
work is worse than no list.
