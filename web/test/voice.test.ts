import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  initialVoiceStatus,
  voiceBlocked,
  voiceButtonLabel,
  voiceMessage,
} from "../src/voice.ts";

describe("initialVoiceStatus", () => {
  it("is idle only when the API exists and the page is a secure context", () => {
    assert.equal(initialVoiceStatus({ supported: true, secure: true }), "idle");
  });

  it("reports an unsupported browser before anything else", () => {
    assert.equal(initialVoiceStatus({ supported: false, secure: true }), "unsupported");
    assert.equal(initialVoiceStatus({ supported: false, secure: false }), "unsupported");
  });

  it("names the insecure context rather than a refused permission", () => {
    // A phone opening http://192.168.x.x:5180 lands here; the browser never
    // offers the mic, which is not the same as the person denying it.
    assert.equal(initialVoiceStatus({ supported: true, secure: false }), "insecure");
  });
});

describe("voice messaging", () => {
  it("tells a plain-HTTP phone that the address is the blocker, and offers a way through", () => {
    const message = voiceMessage("insecure");
    assert.match(message, /https:\/\//);
    assert.match(message, /keyboard's mic/);
    assert.equal(voiceButtonLabel("insecure"), "HTTPS");
    assert.equal(voiceBlocked("insecure"), true);
    assert.equal(voiceBlocked("unsupported"), true);
  });

  it("sends a browser without the API to keyboard dictation instead of blaming it", () => {
    const message = voiceMessage("unsupported");
    assert.match(message, /keyboard's mic/);
    assert.doesNotMatch(message, /Chromium/);
    assert.equal(voiceButtonLabel("unsupported"), "No mic");
  });

  it("does not offer a click while blocked, but does while idle or listening", () => {
    assert.equal(voiceBlocked("idle"), false);
    assert.equal(voiceBlocked("listening"), false);
    assert.equal(voiceBlocked("denied"), false);
    assert.equal(voiceBlocked("error"), false);
  });

  it("keeps the existing permission and failure wording", () => {
    assert.match(voiceMessage("denied"), /^Microphone permission was blocked/);
    assert.match(voiceMessage("denied"), /site settings/);
    assert.match(voiceMessage("error"), /try again/);
    assert.equal(voiceMessage("listening"), "Listening… speak your search");
    assert.equal(voiceButtonLabel("listening"), "Stop");
    assert.equal(voiceButtonLabel("idle"), "Voice");
  });
});
