import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import WorkingModeBadge from "../src/components/WorkingModeBadge.js";
import type { ModeChangeRecord } from "../src/modeNoticeHistory.js";
import type { WorkingMode } from "../src/types.js";

const noop = () => {};

const MODE: WorkingMode = {
  mode: "home",
  source: "explicit override",
  stale: false,
  since: "2026-10-20T12:00:00.000Z",
  until: null,
  note: null,
  schedule: {
    mode: "work",
    timeZone: "America/New_York",
    days: [1, 2, 3, 4, 5],
    start: "08:30",
    end: "17:30",
  },
  checkedAt: "2026-10-20T16:00:00.000Z",
};

const CLOCK = { timeZone: "UTC", hour12: true };

function history(): ModeChangeRecord[] {
  return [
    {
      label: "Work",
      tone: "work",
      source: "auto",
      detail: "The dashboard finishes tasks without asking. Inferred from the weekly schedule.",
      at: "2026-10-20T15:00:00.000Z",
    },
    {
      label: "Home",
      tone: "home",
      source: "manual",
      detail: "Questions are welcome. Set by hand.",
      at: "2026-10-20T13:00:00.000Z",
    },
  ];
}

interface Options {
  mode?: WorkingMode | null;
  history?: ModeChangeRecord[];
  muted?: boolean;
  onClearHistory?: () => void;
}

function render(options: Options = {}): string {
  return renderToStaticMarkup(
    <WorkingModeBadge
      mode={options.mode === undefined ? MODE : options.mode}
      clock={CLOCK}
      history={options.history ?? []}
      noticesMuted={options.muted ?? false}
      onSelectNoticesMuted={noop}
      onClearHistory={options.onClearHistory}
    />,
  );
}

describe("WorkingModeBadge", () => {
  it("is a disclosure that always offers the reason and the notice switch", () => {
    const markup = render();
    assert.match(markup, /class="work-mode-shell"/);
    assert.match(markup, /<details class="work-mode is-home">/);
    assert.match(markup, /class="work-mode-summary"/);
    assert.match(
      markup,
      /aria-label="Working mode Home, manual\. Open the reason and notice settings\."/,
    );
    assert.match(markup, /role="status"/);
    assert.match(markup, /<span class="work-mode-label">Home<\/span>/);
    assert.match(markup, /<span class="work-mode-source">manual<\/span>/);
    assert.match(markup, /class="work-mode-panel"/);
    assert.match(markup, /Working mode: <strong>Home<\/strong>/);
    assert.match(markup, /Set by hand at Oct 20, 2026/);
    assert.match(markup, /Schedule:/);
    assert.doesNotMatch(markup, /mode-history-count/);
    assert.doesNotMatch(markup, /While notices were muted/);
  });

  it("switches notices with a checked role=switch", () => {
    const shown = render();
    assert.match(shown, /role="switch"/);
    assert.match(shown, /aria-checked="true"/);
    assert.match(shown, /aria-label="Mode-change notices"/);
    assert.match(shown, /<span class="work-mode-mute-state">Shown<\/span>/);

    const muted = render({ muted: true });
    assert.match(muted, /role="switch"/);
    assert.match(muted, /aria-checked="false"/);
    assert.match(muted, /<span class="work-mode-mute-state">Muted<\/span>/);
    assert.match(muted, /muted until this tab closes/);
  });

  it("counts the backlog in the summary and lists it newest first", () => {
    const markup = render({ history: history(), onClearHistory: noop });
    assert.match(markup, /class="mode-history-count" aria-hidden="true">2</);
    assert.match(
      markup,
      /aria-label="Working mode Home, manual, 2 muted changes\. Open the reason and notice settings\."/,
    );
    assert.match(markup, /While notices were muted/);

    const workAt = markup.indexOf("The dashboard finishes tasks without asking.");
    const homeAt = markup.indexOf("Questions are welcome. Set by hand.");
    assert.ok(workAt >= 0 && homeAt >= 0, "both reasons are present");
    assert.ok(workAt < homeAt, "the newer Work flip comes first");
    assert.match(markup, /datetime="2026-10-20T15:00:00.000Z"/i);
    assert.match(markup, /Oct 20, 2026, 3:00 PM UTC/i);
    assert.match(markup, /<span class="mode-history-source">auto<\/span>/);
    assert.match(markup, /<span class="mode-history-source">manual<\/span>/);
    assert.match(markup, /<button type="button" class="mode-history-clear">Clear<\/button>/);
  });

  it("renders without a clear control when the owner does not provide one", () => {
    const markup = render({ history: history() });
    assert.doesNotMatch(markup, /mode-history-clear/);
    assert.match(markup, /While notices were muted/);
  });

  it("still opens while the mode is unknown, with the explanation and switch", () => {
    const markup = render({ mode: null });
    assert.match(markup, /class="work-mode is-unknown"/);
    assert.match(markup, /Working mode unavailable/);
    assert.match(markup, /role="switch"/);
    assert.match(
      markup,
      /aria-label="Working mode Mode, —\. Open the reason and notice settings\."/,
    );
  });
});
