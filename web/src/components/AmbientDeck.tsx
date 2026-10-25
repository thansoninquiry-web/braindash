import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { AmbientEngine, clampVolume, percentLabel, volumeToGain } from "../ambient";
import {
  acceptsTrack,
  describeBytes,
  listTracks,
  loadTrackBlob,
  removeTrack,
  saveTrack,
  type TrackMeta,
} from "../tracks";

const VOLUME_KEY = "braindash.sound.volume";
const DEFAULT_VOLUME = 0.55;

type Active = { kind: "ambient" } | { kind: "track"; id: string };

function readStoredVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    return clampVolume(Number(raw));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export default function AmbientDeck() {
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(readStoredVolume);
  const [tracks, setTracks] = useState<TrackMeta[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<AmbientEngine | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTracks(await listTracks());
    } catch {
      setError("This browser would not open its track storage.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [refresh]);

  // Volume applies to whatever is playing, and is the one sound setting kept
  // between visits. Playback itself never auto-starts: browsers block it.
  useEffect(() => {
    try {
      window.localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Private-mode storage refusal is fine; the slider still works.
    }
    engineRef.current?.setVolume(volume);
    const audio = audioRef.current;
    if (audio) audio.volume = volumeToGain(volume);
  }, [volume]);

  // A non-modal deck: Escape and a click elsewhere close it, focus goes back
  // to the trigger. No scrim, because the dashboard stays usable behind it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  const stopAll = useCallback(() => {
    engineRef.current?.stop();
    const audio = audioRef.current;
    if (audio) audio.pause();
    setActive(null);
  }, []);

  const startAmbient = useCallback(() => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    const engine = engineRef.current ?? new AmbientEngine();
    engineRef.current = engine;
    engine.start(volume);
    if (!engine.isRunning) {
      setError("This browser has no Web Audio, so the generated bed cannot play.");
      return;
    }
    setError(null);
    setActive({ kind: "ambient" });
  }, [volume]);

  const playTrack = useCallback(
    async (track: TrackMeta) => {
      setError(null);
      setBusyTrack(track.id);
      try {
        const blob = await loadTrackBlob(track.id);
        if (!blob) throw new Error("the file is no longer in this browser's storage");
        const audio = audioRef.current;
        if (!audio) throw new Error("this browser has no audio element");
        engineRef.current?.stop();
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        audio.src = urlRef.current;
        audio.volume = volumeToGain(volume);
        await audio.play();
        setActive({ kind: "track", id: track.id });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "playback failed";
        setError(`${track.name}: ${message}.`);
        setActive(null);
      } finally {
        setBusyTrack(null);
      }
    },
    [volume],
  );

  const handleImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) return;
      const accepted = files.filter(acceptsTrack);
      const skipped = files.length - accepted.length;
      if (accepted.length === 0) {
        setError("Only audio files and mp4 (or m4v/mov) files can be imported.");
        return;
      }
      setError(null);
      setImporting(true);
      const failed: string[] = [];
      let newest: TrackMeta | null = null;
      for (const file of accepted) {
        try {
          newest = await saveTrack(file);
        } catch {
          failed.push(file.name);
        }
      }
      await refresh();
      setImporting(false);
      if (newest) await playTrack(newest);
      if (failed.length > 0) {
        setError(`Could not store ${failed.join(", ")} — browser storage may be full.`);
      } else if (skipped > 0) {
        setError(`${skipped} file${skipped === 1 ? "" : "s"} skipped — not audio or mp4.`);
      }
    },
    [playTrack, refresh],
  );

  const forget = useCallback(
    async (track: TrackMeta) => {
      if (active?.kind === "track" && active.id === track.id) stopAll();
      try {
        await removeTrack(track.id);
      } catch {
        setError(`${track.name}: could not be removed from this browser.`);
        return;
      }
      await refresh();
    },
    [active, refresh, stopAll],
  );

  const ambientOn = active?.kind === "ambient";

  return (
    <div className="sound-dock" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`icon-button sound-trigger${active ? " is-playing" : ""}`}
        aria-label={active ? "Sound — playing" : "Sound"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M4 14v-4M8 17V7M12 20V4M16 16V8M20 13v-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {active ? <span className="sound-dot" aria-hidden="true" /> : null}
      </button>

      <audio
        ref={audioRef}
        hidden
        onEnded={() => setActive(null)}
        onError={() => {
          setError("That file has no audio this browser can decode.");
          setActive(null);
        }}
      />

      {open ? (
        <div className="sound-pop" role="dialog" aria-label="Sound" ref={panelRef}>
          <header className="sound-head">
            <div>
              <h2 className="sound-title">Sound</h2>
              <p className="sound-sub">Synthesised · stored on this device</p>
            </div>
            <button
              type="button"
              className="sound-close"
              aria-label="Close sound panel"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </header>

          <section className={`sound-preset${ambientOn ? " is-on" : ""}`}>
            <div className="sound-preset-text">
              <span className="sound-preset-name">Aurora Drift</span>
              <span className="sound-preset-meta">generated ambient · no file</span>
            </div>
            <button
              type="button"
              className="sound-play"
              aria-pressed={ambientOn}
              autoFocus
              onClick={() => (ambientOn ? stopAll() : startAmbient())}
            >
              {ambientOn ? "Stop" : "Play"}
            </button>
          </section>

          <label className="sound-volume">
            <span className="sound-volume-label">
              Volume
              <span className="sound-volume-value">{percentLabel(volume)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              aria-label="Volume"
              onChange={(event) => setVolume(clampVolume(Number(event.target.value) / 100))}
            />
          </label>

          <div className="sound-tracks-head">
            <span className="sound-label">Your tracks</span>
            <span className="sound-count">{tracks.length === 0 ? "none" : tracks.length}</span>
          </div>

          {tracks.length === 0 ? (
            <p className="sound-empty">
              Import an mp3, m4a, wav… or an mp4. Files stay in this browser.
            </p>
          ) : (
            <ul className="sound-tracks">
              {tracks.map((track) => {
                const playing = active?.kind === "track" && active.id === track.id;
                const busy = busyTrack === track.id;
                return (
                  <li key={track.id} className={`sound-track${playing ? " is-active" : ""}`}>
                    <button
                      type="button"
                      className="sound-track-main"
                      aria-label={playing ? `Stop ${track.name}` : `Play ${track.name}`}
                      onClick={() => (playing ? stopAll() : void playTrack(track))}
                    >
                      <span className="sound-track-name">{track.name}</span>
                      <span className="sound-track-meta">
                        {busy
                          ? "loading…"
                          : `${track.kind === "video" ? "mp4" : "audio"} · ${describeBytes(track.bytes)}${playing ? " · playing" : ""}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="sound-track-remove"
                      aria-label={`Remove ${track.name}`}
                      onClick={() => void forget(track)}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="sound-actions">
            <button
              type="button"
              className={`sound-import${importing ? " is-busy" : ""}`}
              aria-label="Import audio or mp4 files"
              aria-busy={importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? "Importing…" : "Import audio / mp4"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/mp4,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.mp4,.m4v,.mov"
              multiple
              hidden
              onChange={(event) => void handleImport(event)}
            />
            {active && active.kind === "track" ? (
              <button type="button" className="sound-stop" onClick={stopAll}>
                Stop
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="sound-error" role="alert">
              {error}
            </p>
          ) : null}

          <p className="sound-note">
            Nothing is uploaded and nothing is written to the vault. Removing a track deletes it
            from this browser.
          </p>
        </div>
      ) : null}
    </div>
  );
}
