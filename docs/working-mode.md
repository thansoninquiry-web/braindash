# Working mode protocol

The rule an agent follows when deciding whether to interrupt the person at this
machine or to keep working alone. The short contract is [`AGENTS.md`](../AGENTS.md);
this file explains the mechanics and records why the defaults are what they are.

## Why this exists

Work gets done here in two very different situations: someone is at the desk and
can answer in seconds, or someone is at work and cannot answer for hours. The
second case is the one that needs a written rule, because a question there is not a
clarification — it is a stalled session.

## The two modes

| Mode | Where the person is | Agent behaviour |
| ---- | ------------------- | --------------- |
| **work** | At work, away from this machine | Never block. Decide, log the decision, finish the task, hand over. |
| **home** | At the machine | Ask, confirm, show evidence; act on reversible things without asking. |

Both modes ship the same code quality bar: docs, typecheck, build, and a real
behavioural check. The difference is only who decides.

## Schedule (assumption — edit this section to match reality)

Default inference when no explicit state exists, or the state has expired:

- **Mon–Fri, 08:30–17:30, `America/New_York`** → `work`
- evenings, nights, weekends → `home`

That zone comes from this dashboard's own clock preference and is the one the
assumption above was built on. If the real schedule differs — different hours, a
hybrid week, a different zone — change the constants at the top of
[`scripts/mode.mjs`](../scripts/mode.mjs) (`SCHEDULE`) and this table together.

## State file

`.freebuff/working-mode`, machine-local and untracked (the mode is a fact about
this desk, not about the repository). Plain `key: value` lines so it can be read,
hand-edited, or parsed by a script:

```
mode: work
since: 2026-10-19T13:05:00.000Z
until: 2026-10-19T22:05:00.000Z
note: at the office, back after standup
```

- `mode` — `work` or `home`.
- `since` — ISO timestamp of the switch.
- `until` — optional. `work` gets one automatically (now + 9h) so a forgotten
  override cannot hold for days; `home` has none.
- `note` — free text, shown by `npm run mode`.

**Staleness:** state is ignored if `until` has passed or the file is older than 12
hours, and the schedule decides instead. This keeps a forgotten `work` from
silently outliving the working day, and a stale `home` from blocking autonomous
work the next morning.

## Dashboard surface

The dashboard header carries a **WORK** / **HOME** badge, because the mode changes
how the rest of the session behaves and a person glancing at a wall-mounted screen
should not have to run a command to find out. `GET /api/mode` answers with the same
resolved mode the CLI prints (plus `source`, `stale`, `since`, `until`, `note` and
the schedule it resolved against); the server imports the helpers from
[`scripts/mode.mjs`](../scripts/mode.mjs) rather than reimplementing the rules, so
the badge and `npm run mode` cannot disagree.

The badge is **read-only**. Switching modes is `npm run mode`, which records the
override and appends to the switch log; a dashboard button would need a write path
and would let any local page flip a machine-wide setting. It takes its first answer
from `/api/mode` and then keeps `/api/mode/stream` open: the server watches
`.freebuff/` and re-resolves once a second, so a flip is pushed to the header within
a second instead of waiting for the next poll. A one-minute fetch and a refocus
fetch remain as fallbacks — independently of the vault refresh, which can be
switched off — and a failed read degrades to a dashed `MODE` badge rather than an
error banner.

## Logs

| File | Purpose | Tracked |
| ---- | ------- | ------- |
| `.freebuff/working-mode` | current state | no |
| `.freebuff/mode-log.md` | append-only history of switches, written by `npm run mode` | no |
| `docs/DECISIONS.md` | assumptions and approvals queued while working autonomously | yes |

The switch log is machine-local because it is operational noise; the decision log is
tracked because it is the record a person reviews when they get back.

## Assumptions made when this was built

Recorded here because the request was to choose sensible options rather than ask.
Each is reversible and noted with what would overturn it.

1. **"AFK mode / ready mode" meant a working agreement, not an app feature.** The
   first read of the request produced a dashboard standby feature; the follow-up made
   it clear the modes describe *where the person is*, so the app is untouched.
2. **Two modes, not three.** `work` and `home` only; `clear` is a command, not a
   mode. A third "away" state would need its own rules and there was no evidence for
   what it should mean.
3. **Schedule defaults to Mon–Fri 08:30–17:30 `America/New_York`.** Taken from the
   dashboard's clock preference; a guess that is easy to correct in one file.
4. **Ambiguity resolves to `work`, not `home`.** The two failure modes are not
   symmetric: wrongly assuming "away" costs a documented decision line, wrongly
   assuming "present" costs an entire unattended session waiting on a question
   nobody answers. So when inference is unclear, act autonomously and log it.
5. **Explicit state outranks the schedule.** Standing at the desk at 21:00 is normal
   and `npm run mode home` must win over a calendar rule.
6. **A `work` override expires (9h) and all state goes stale after 12h.** Without an
   expiry, one Friday afternoon switch would leave every later session autonomous
   with no one noticing.
7. **No commits, pushes, deploys, service signups or vault writes in either mode
   without being asked.** They are irreversible or externally visible, and nobody is
   around to undo them while at work.
8. **Machine-local state, tracked decisions.** The mode describes one desk, so it
   lives in untracked `.freebuff/`; the decisions are what a person reviews later, so
   `docs/DECISIONS.md` is committed with the work.

## Verifying the mechanism

```bash
npm run mode            # current mode + what the schedule suggests
npm run mode work       # override for the next 9h, appended to the switch log
npm run mode home       # back to collaboration
npm run mode clear      # remove the override, follow the schedule
```

To test staleness without waiting: write a state file with a past `until` (or a
`since` older than 12h) and `npm run mode` should report `schedule (override stale)`
while still showing the ignored values.
