import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MODE_HISTORY_LIMIT,
  parseNoticeHistory,
  readNoticeHistory,
  rememberModeChange,
  saveNoticeHistory,
  type HistoryStore,
  type ModeChangeRecord,
} from "../src/modeNoticeHistory.js";
import type { ModeChangeNotice } from "../src/modeBadge.js";

function change(label: string, overrides: Partial<ModeChangeNotice> = {}): ModeChangeNotice {
  return {
    label,
    tone: label === "Work" ? "work" : "home",
    source: "auto",
    detail: `${label} because the schedule said so.`,
    ...overrides,
  };
}

function record(label: string, at: string): ModeChangeRecord {
  return { ...change(label), at };
}

function fakeStore(entries: Record<string, string> = {}): HistoryStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("mode notice history — keeping the last few flips", () => {
  it("puts the newest flip first and caps the backlog", () => {
    let history: ModeChangeRecord[] = [];
    history = rememberModeChange(history, change("Home"), "2026-10-20T12:00:00.000Z");
    history = rememberModeChange(history, change("Work"), "2026-10-20T13:00:00.000Z");
    history = rememberModeChange(history, change("Home"), "2026-10-20T14:00:00.000Z");
    history = rememberModeChange(history, change("Work"), "2026-10-20T15:00:00.000Z");

    assert.deepEqual(
      history.map((entry) => entry.at),
      ["2026-10-20T15:00:00.000Z", "2026-10-20T14:00:00.000Z", "2026-10-20T13:00:00.000Z"],
    );
    assert.equal(history.length, MODE_HISTORY_LIMIT);
    assert.equal(history[0]?.label, "Work");
    assert.equal(history[0]?.tone, "work");
  });

  it("does not mutate the list it was given", () => {
    const before = [record("Home", "2026-10-20T12:00:00.000Z")];
    const after = rememberModeChange(before, change("Work"), "2026-10-20T13:00:00.000Z");
    assert.equal(before.length, 1);
    assert.equal(before[0]?.label, "Home");
    assert.equal(after.length, 2);
  });

  it("accepts a zero limit and never keeps more than asked", () => {
    assert.deepEqual(rememberModeChange([], change("Work"), "2026-10-20T13:00:00.000Z", 0), []);
    const one = rememberModeChange(
      [record("Home", "2026-10-20T12:00:00.000Z")],
      change("Work"),
      "2026-10-20T13:00:00.000Z",
      1,
    );
    assert.equal(one.length, 1);
    assert.equal(one[0]?.label, "Work");
  });
});

describe("mode notice history — storage", () => {
  it("round-trips a backlog through the tab's storage", () => {
    const store = fakeStore();
    const history = [record("Work", "2026-10-20T13:00:00.000Z")];
    saveNoticeHistory(history, store);
    assert.deepEqual(readNoticeHistory(store), history);
    assert.deepEqual([...store.map.keys()], ["braindash.modeNoticeHistory"]);
  });

  it("starts empty without storage, with nothing stored, or after malformed JSON", () => {
    assert.deepEqual(readNoticeHistory(null), []);
    assert.deepEqual(readNoticeHistory(fakeStore()), []);
    assert.deepEqual(parseNoticeHistory(null), []);
    assert.deepEqual(parseNoticeHistory("not json"), []);
    assert.deepEqual(parseNoticeHistory('{"label":"Work"}'), []);
  });

  it("drops rows that would not render and keeps the valid ones", () => {
    const raw = JSON.stringify([
      record("Work", "2026-10-20T13:00:00.000Z"),
      { label: "Home", tone: "sideways", source: "auto", detail: "x", at: "2026-10-20" },
      { label: "Home", tone: "home", source: "auto", detail: "x" },
      { label: "Home", tone: "home", source: "robot", detail: "x", at: "2026-10-20" },
      record("Home", "2026-10-20T12:00:00.000Z"),
    ]);
    const parsed = parseNoticeHistory(raw);
    assert.deepEqual(
      parsed.map((entry) => entry.at),
      ["2026-10-20T13:00:00.000Z", "2026-10-20T12:00:00.000Z"],
    );
  });

  it("caps a stored backlog and honours a custom limit", () => {
    const raw = JSON.stringify([
      record("Work", "2026-10-20T15:00:00.000Z"),
      record("Home", "2026-10-20T14:00:00.000Z"),
      record("Work", "2026-10-20T13:00:00.000Z"),
      record("Home", "2026-10-20T12:00:00.000Z"),
    ]);
    assert.equal(parseNoticeHistory(raw).length, MODE_HISTORY_LIMIT);
    assert.equal(parseNoticeHistory(raw, 1).length, 1);
  });

  it("survives storage that throws, like the mute does", () => {
    const broken: HistoryStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.deepEqual(readNoticeHistory(broken), []);
    assert.doesNotThrow(() =>
      saveNoticeHistory([record("Work", "2026-10-20T13:00:00.000Z")], broken),
    );
  });
});
