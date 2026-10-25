# Working mode — read this first

Which mode is active decides whether you **ask** or **decide and keep going**.
Everything else in this repo (code conventions, safety rules) applies in both modes.

## 1. Check the mode before you act

```bash
npm run mode
```

That reads `.freebuff/working-mode` (machine-local, untracked) and prints the mode,
when it was set, whether it has expired, and what the weekly schedule suggests.

Resolution order — do not ask which mode it is, it is written down for this reason:

1. **Explicit state wins** while it is fresh (no `until` in the past, set within 12h).
2. **Otherwise follow the schedule** in `docs/working-mode.md` (Mon–Fri 08:30–17:30
   America/New_York → work, everything else → home) and say in one line that you
   inferred it.
3. If the file is missing or unreadable, use the schedule. Never block to find out.

## 2. AT WORK — the person is not at this machine

A question that waits for them burns the whole session, so:

- **Never end a turn with a question or a request for approval.** For a real fork,
  pick the option a careful engineer would pick, then record it in
  `docs/DECISIONS.md` — one line: date, decision, why, what would change it.
- **Finish the whole job in one pass:** implementation, docs, `npm run typecheck`,
  `npm run build`, and an observable check (browser, `curl`) where the change is
  visible. A build alone does not prove behaviour.
- **Hand over at the end:** what changed, what you verified and how, what still
  needs their eyes, and what you deliberately did not do.
- **Safety gates stay on.** While they are away, do not: commit, push, open or merge
  PRs, deploy, publish, write to the vault, install or sign up for services, use
  credentials, or run destructive filesystem commands. Queue each of those as a
  "needs approval" bullet in `docs/DECISIONS.md` instead of doing it.
- **Never stall.** If you are blocked (missing key, broken environment, ambiguous
  requirement that blocks only part of the work), write the blocker down, do the
  parts that are unblocked, and move on.

## 3. AT HOME — they are at the machine

Questions are cheap and welcome:

- Confirm intent before big or irreversible work, and offer choices for genuine
  design forks (use the question tool, not prose).
- Still act on reversible things instead of asking, and still keep the same gates
  for commits, pushes, deploys and anything outside this repo.
- Show your evidence as you go: screenshots, measured numbers, failing checks.

## 4. Both modes

- The vault is read-only unless `BRAINDASH_WRITE=1` is set locally. That opt-in
  lets the dashboard edit, create and trash notes from this machine only, keeps
  replaced/deleted notes in `.trash`, and is for the person's own edits: never
  bulk-rewrite notes or use it to change unrelated files.
- Reuse the running dev servers (web 5180, API 5181) instead of starting new ones.
- Never stage or commit changes you did not make; the tree carries other work.
- When behaviour changes, update `docs/SPEC.md` and `README.md` in the same turn.

## 5. Switching

```bash
npm run mode work     # at work: autonomous, no blocking questions
npm run mode home     # at home: normal collaboration
npm run mode clear    # forget the override, follow the schedule
npm run mode status   # same as bare `npm run mode`
```

`.freebuff/mode-log.md` records every switch with a timestamp. The format of the
state file, the schedule, and the reasoning behind these defaults are in
[`docs/working-mode.md`](docs/working-mode.md); the assumption log agents write to
is [`docs/DECISIONS.md`](docs/DECISIONS.md).
