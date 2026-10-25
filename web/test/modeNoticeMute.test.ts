import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readNoticeMuted, saveNoticeMuted, type MuteStore } from "../src/modeNoticeMute.js";

/** A `sessionStorage` stand-in, so the rules are tested without a DOM. */
function fakeStore(entries: Record<string, string> = {}): MuteStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("mode notice mute", () => {
  it("starts unmuted, including when the tab has no storage at all", () => {
    assert.equal(readNoticeMuted(fakeStore()), false);
    assert.equal(readNoticeMuted(null), false);
  });

  it("remembers the choice for the tab", () => {
    const store = fakeStore();
    saveNoticeMuted(true, store);
    assert.equal(readNoticeMuted(store), true);
    saveNoticeMuted(false, store);
    assert.equal(readNoticeMuted(store), false);
  });

  it("writes one key, so a stale value cannot impersonate the mute", () => {
    const store = fakeStore();
    saveNoticeMuted(true, store);
    assert.deepEqual([...store.map.keys()], ["braindash.modeNoticeMuted"]);
  });

  it("survives storage that throws instead of taking the dashboard down", () => {
    const broken: MuteStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(readNoticeMuted(broken), false);
    assert.doesNotThrow(() => saveNoticeMuted(true, broken));
  });
});
