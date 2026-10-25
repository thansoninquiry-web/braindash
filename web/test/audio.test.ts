import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampVolume, percentLabel, volumeToGain } from "../src/ambient.js";
import {
  acceptsTrack,
  describeBytes,
  trackId,
  trackKind,
  type TrackFileLike,
} from "../src/tracks.js";

function file(name: string, type = "", size = 1024): TrackFileLike {
  return { name, type, size, lastModified: 1_700_000_000_000 };
}

describe("volume", () => {
  it("clamps to 0–1 and rejects nonsense", () => {
    assert.equal(clampVolume(-2), 0);
    assert.equal(clampVolume(4), 1);
    assert.equal(clampVolume(0.42), 0.42);
    assert.equal(clampVolume(Number.NaN), 0);
    assert.equal(clampVolume(Number.POSITIVE_INFINITY), 0);
  });

  it("squares the slider so the quiet end is usable", () => {
    assert.equal(volumeToGain(0), 0);
    assert.equal(volumeToGain(1), 1);
    assert.equal(volumeToGain(0.5), 0.25);
    assert.ok(volumeToGain(0.3) < volumeToGain(0.6));
  });

  it("labels a rounded percentage", () => {
    assert.equal(percentLabel(0.554), "55%");
    assert.equal(percentLabel(1.4), "100%");
    assert.equal(percentLabel(-1), "0%");
  });
});

describe("acceptsTrack", () => {
  it("takes any audio MIME type", () => {
    assert.equal(acceptsTrack(file("clip.mp3", "audio/mpeg")), true);
    assert.equal(acceptsTrack(file("voice.weba", "audio/webm")), true);
  });

  it("takes mp4, m4v and mov by MIME or extension", () => {
    assert.equal(acceptsTrack(file("set.mp4", "video/mp4")), true);
    assert.equal(acceptsTrack(file("set.mp4", "")), true, "the picker sometimes omits the type");
    assert.equal(acceptsTrack(file("set.MP4", "application/octet-stream")), true);
    assert.equal(acceptsTrack(file("phone.mov", "video/quicktime")), true);
  });

  it("falls back to the extension when the type is empty", () => {
    assert.equal(acceptsTrack(file("track.m4a")), true);
    assert.equal(acceptsTrack(file("track.flac")), true);
    assert.equal(acceptsTrack(file("track.wav")), true);
  });

  it("rejects everything else", () => {
    assert.equal(acceptsTrack(file("notes.txt", "text/plain")), false);
    assert.equal(acceptsTrack(file("scan.pdf", "application/pdf")), false);
    assert.equal(acceptsTrack(file("README")), false);
    assert.equal(acceptsTrack(file("image.png", "image/png")), false);
  });
});

describe("trackKind", () => {
  it("marks video containers as video", () => {
    assert.equal(trackKind(file("set.mp4", "video/mp4")), "video");
    assert.equal(trackKind(file("set.mp4", "")), "video");
    assert.equal(trackKind(file("clip.mp3", "audio/mpeg")), "audio");
    assert.equal(trackKind(file("clip.wav", "")), "audio");
  });
});

describe("trackId", () => {
  it("is stable for the same file", () => {
    assert.equal(trackId(file("Night Drive.mp3", "audio/mpeg")), trackId(file("Night Drive.mp3", "audio/mpeg")));
  });

  it("slugifies the name and keeps the size", () => {
    assert.equal(trackId(file("Night Drive.mp3", "audio/mpeg", 2048)), "night-drive-2048-1700000000000");
  });

  it("distinguishes two different files with the same name", () => {
    const first = trackId(file("take.mp3", "audio/mpeg", 100));
    const second = trackId(file("take.mp3", "audio/mpeg", 200));
    assert.notEqual(first, second);
  });

  it("never returns an empty id for symbol-only names", () => {
    assert.match(trackId(file("東京.mp3", "audio/mpeg")), /^track-\d+-/);
  });
});

describe("describeBytes", () => {
  it("reads in KB and MB", () => {
    assert.equal(describeBytes(0), "0 KB");
    assert.equal(describeBytes(900), "1 KB");
    assert.equal(describeBytes(512 * 1024), "512 KB");
    assert.equal(describeBytes(3.5 * 1024 * 1024), "3.5 MB");
  });
});
