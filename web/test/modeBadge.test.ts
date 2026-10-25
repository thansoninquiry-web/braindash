import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeSchedule, modeBadge, modeChangeNotice, tabIdentity } from "../src/modeBadge.ts";
import type { WorkingMode } from "../src/types.ts";

const SCHEDULE: WorkingMode["schedule"] = {
  mode: "work",
  timeZone: "America/New_York",
  days: [1, 2, 3, 4, 5],
  start: "08:30",
  end: "17:30",
};

function mode(overrides: Partial<WorkingMode> = {}): WorkingMode {
  return {
    mode: "work",
    source: "schedule",
    stale: false,
    since: null,
    until: null,
    note: null,
    schedule: SCHEDULE,
    checkedAt: "2026-10-19T12:30:00.000Z",
    ...overrides,
  };
}

describe("modeBadge — labels", () => {
  it("says it does not know when the API never answered", () => {
    const badge = modeBadge(null);
    assert.equal(badge.label, "Mode");
    assert.equal(badge.tone, "unknown");
    assert.equal(badge.source, "—");
    assert.match(badge.detail, /unavailable/);
  });

  it("marks a scheduled work day as automatic", () => {
    const badge = modeBadge(mode());
    assert.equal(badge.label, "Work");
    assert.equal(badge.tone, "work");
    assert.equal(badge.source, "auto");
    assert.match(badge.detail, /without asking/);
    assert.match(badge.detail, /Inferred from the weekly schedule\./);
    assert.match(badge.detail, /Mon–Fri 08:30–17:30 America\/New_York/);
    assert.doesNotMatch(badge.detail, /Set by hand/);
  });

  it("marks a handed-set override as manual and dates it", () => {
    const badge = modeBadge(
      mode({
        source: "explicit override",
        since: "2026-10-19T04:44:00.000Z",
        until: "2026-10-19T13:44:00.000Z",
        note: "at the office",
        schedule: { ...SCHEDULE, mode: "home" },
      }),
      (iso) => `<${iso}>`,
    );
    assert.equal(badge.source, "manual");
    assert.match(badge.detail, /Set by hand at <2026-10-19T04:44:00\.000Z>, until <2026-10-19T13:44:00\.000Z>\./);
    assert.match(badge.detail, /The schedule alone would say home\./);
    assert.match(badge.detail, /Note: at the office/);
  });

  it("does not mention a disagreement when there is none", () => {
    const badge = modeBadge(mode({ source: "explicit override", since: "2026-10-19T04:44:00.000Z" }));
    assert.doesNotMatch(badge.detail, /schedule alone would say/);
  });

  it("explains a stale override instead of pretending it was automatic", () => {
    const badge = modeBadge(
      mode({
        mode: "home",
        source: "schedule (override stale)",
        stale: true,
        since: "2026-10-19T00:00:00.000Z",
        until: "2026-10-19T09:00:00.000Z",
      }),
      (iso) => iso,
    );
    assert.equal(badge.source, "stale");
    assert.equal(badge.tone, "home");
    assert.match(badge.detail, /last override ended at 2026-10-19T09:00:00\.000Z/);
    assert.match(badge.detail, /weekly schedule took over/);
  });

  it("speaks for the person at the desk, not the schema", () => {
    const badge = modeBadge(mode({ mode: "home" }));
    assert.equal(badge.label, "Home");
    assert.match(badge.detail, /questions are welcome/);
  });
});

describe("tabIdentity", () => {
  const svg = (icon: string) =>
    decodeURIComponent(icon.slice("data:image/svg+xml,".length));
  /** The corner marker, whatever its shape. */
  const marked = (icon: string) => /<circle cx="26" cy="6"/.test(svg(icon));

  it("leads the title with Work and marks the favicon with W", () => {
    const tab = tabIdentity(mode({ mode: "work" }));
    assert.match(tab.title, /^Work \(auto\) · BrainDash$/, "the mode survives tab truncation");
    assert.equal(tab.tone, "work");
    assert.equal(tab.source, "auto");
    assert.match(tab.icon, /^data:image\/svg\+xml,/);
    assert.match(svg(tab.icon), />W<\/text>/);
    assert.match(svg(tab.icon), /fill="#ff9a4d"/);
  });

  it("gives Home its own letter and fill", () => {
    const work = tabIdentity(mode({ mode: "work" }));
    const home = tabIdentity(mode({ mode: "home" }));
    assert.match(home.title, /^Home \(auto\) · BrainDash$/);
    assert.equal(home.tone, "home");
    assert.match(svg(home.icon), />H<\/text>/);
    assert.match(svg(home.icon), /fill="#5fd0b8"/);
    assert.notEqual(home.icon, work.icon, "the favicon is not colour-only");
  });

  it("names the provenance in the title, after the mode", () => {
    const manual = tabIdentity(mode({ source: "explicit override" }));
    const stale = tabIdentity(mode({ source: "schedule (override stale)", stale: true }));
    assert.equal(manual.title, "Work (manual) · BrainDash");
    assert.equal(manual.source, "manual");
    assert.equal(stale.title, "Work (stale) · BrainDash");
    assert.equal(stale.source, "stale");
  });

  it("marks a by-hand mode with a filled dot and a lapsed one with a ring", () => {
    const manual = svg(tabIdentity(mode({ source: "explicit override" })).icon);
    const stale = svg(tabIdentity(mode({ source: "schedule (override stale)", stale: true })).icon);
    const auto = svg(tabIdentity(mode()).icon);

    assert.match(manual, /<circle cx="26" cy="6" r="3.4" fill="#06090b"\/>/);
    assert.match(stale, /<circle cx="26" cy="6" r="3" fill="none" stroke="#06090b"/);
    assert.equal(marked(auto), false, "the schedule needs no mark; the letter carries it");
    assert.notEqual(manual, stale, "the two provenances are not the same drawing");
  });

  it("still separates work from home when both were set by hand", () => {
    const work = tabIdentity(mode({ mode: "work", source: "explicit override" }));
    const home = tabIdentity(mode({ mode: "home", source: "explicit override" }));
    assert.equal(marked(work.icon), true);
    assert.equal(marked(home.icon), true);
    assert.notEqual(work.icon, home.icon, "the provenance mark does not replace the mode");
  });

  it("keeps a neutral BrainDash tab before the mode answers", () => {
    const tab = tabIdentity(null);
    assert.equal(tab.title, "BrainDash");
    assert.equal(tab.tone, "unknown");
    assert.equal(tab.source, "—");
    assert.match(svg(tab.icon), />B<\/text>/);
    assert.equal(marked(tab.icon), false, "no answer is not the same as an automatic one");
    assert.notEqual(tab.icon, tabIdentity(mode({ mode: "work" })).icon);
    assert.notEqual(tab.icon, tabIdentity(mode({ mode: "home" })).icon);
  });
});

describe("modeChangeNotice", () => {
  it("stays quiet for the first answer, same-mode polls and a failed read", () => {
    assert.equal(modeChangeNotice(null, mode()), null);
    assert.equal(modeChangeNotice(mode(), mode({ source: "explicit override" })), null);
    assert.equal(modeChangeNotice(mode(), null), null);
  });

  it("announces Work and its automatic reason", () => {
    assert.deepEqual(modeChangeNotice(mode({ mode: "home" }), mode()), {
      label: "Work",
      tone: "work",
      source: "auto",
      detail: "The dashboard finishes tasks without asking. Inferred from the weekly schedule.",
    });
  });

  it("announces Home with a manual override", () => {
    const notice = modeChangeNotice(
      mode(),
      mode({ mode: "home", source: "explicit override", since: "2026-10-19T15:00:00.000Z" }),
    );
    assert.deepEqual(notice, {
      label: "Home",
      tone: "home",
      source: "manual",
      detail: "Questions are welcome. Set by hand.",
    });
  });

  it("explains a stale override taking over", () => {
    const notice = modeChangeNotice(
      mode(),
      mode({ mode: "home", source: "schedule (override stale)", stale: true }),
    );
    assert.equal(notice?.source, "stale");
    assert.equal(
      notice?.detail,
      "Questions are welcome. The last override expired; the weekly schedule took over.",
    );
  });
});

describe("describeSchedule", () => {
  it("collapses a run of weekdays", () => {
    assert.equal(
      describeSchedule(SCHEDULE),
      "Mon–Fri 08:30–17:30 America/New_York",
    );
  });

  it("keeps an out-of-office week as a list", () => {
    assert.equal(
      describeSchedule({ ...SCHEDULE, days: [0, 6] }),
      "Sun, Sat 08:30–17:30 America/New_York",
    );
    assert.equal(
      describeSchedule({ ...SCHEDULE, days: [1, 3, 5] }),
      "Mon, Wed, Fri 08:30–17:30 America/New_York",
    );
  });

  it("handles a single day, every day and no days", () => {
    assert.equal(describeSchedule({ ...SCHEDULE, days: [2] }), "Tue 08:30–17:30 America/New_York");
    assert.equal(
      describeSchedule({ ...SCHEDULE, days: [0, 1, 2, 3, 4, 5, 6] }),
      "Every day 08:30–17:30 America/New_York",
    );
    assert.equal(describeSchedule({ ...SCHEDULE, days: [] }), "No days 08:30–17:30 America/New_York");
  });

  it("does not mutate the payload's day list", () => {
    const days = [5, 1, 3, 2, 4];
    describeSchedule({ ...SCHEDULE, days });
    assert.deepEqual(days, [5, 1, 3, 2, 4]);
  });
});
