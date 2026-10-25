import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { capturedZoneLabel, formatCapturedStamp, type ClockPrefs } from "../clock";
import type { SearchHit, SearchResponse } from "../types";
import { useVoiceInput } from "../useVoiceInput";
import { voiceBlocked, voiceButtonLabel, voiceMessage } from "../voice";

interface SearchBarProps {
  /** Opens a hit in the reader panel. */
  onOpenNote: (path: string) => void;
  /** Hit dates obey the chosen zone and hour cycle. */
  clock: ClockPrefs;
}

type Status = "idle" | "loading" | "error";

/** Wraps the first case-insensitive occurrence of `needle` in a <mark>. */
function highlight(text: string, needle: string): ReactNode {
  const term = needle.trim();
  if (!term) return text;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="hit-mark">{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </>
  );
}

interface SearchHitRowProps {
  hit: SearchHit;
  index: number;
  active: boolean;
  /** The live query, for highlighting the title and snippet. */
  query: string;
  clock: ClockPrefs;
  onHover: () => void;
  onOpen: () => void;
}

/**
 * One result row. The date is converted into the chosen clock zone; when the
 * note recorded a zone of its own, that origin sits under the stamp in the
 * same hairline mono as the reader, so a converted hit never looks like it was
 * written where it is being read.
 */
export function SearchHitRow({
  hit,
  index,
  active,
  query,
  clock,
  onHover,
  onOpen,
}: SearchHitRowProps) {
  const zone = capturedZoneLabel(hit.captured, hit.capturedZone);

  return (
    <button
      id={`search-hit-${index}`}
      type="button"
      role="option"
      aria-selected={active}
      className={`search-hit${active ? " is-active" : ""}`}
      style={{ animationDelay: `${Math.min(index, 9) * 18}ms` }}
      onMouseEnter={onHover}
      onClick={onOpen}
    >
      <span className="hit-head">
        <span className="hit-title">{highlight(hit.title, query)}</span>
        <span className="hit-when">
          <span className="hit-date" title={hit.captured ?? "no captured date"}>
            {formatCapturedStamp(hit.captured, clock, hit.capturedZone ?? undefined) ?? "undated"}
          </span>
          {zone ? (
            <span className="hit-zone" title={`Captured in ${zone}`}>
              {zone}
            </span>
          ) : null}
        </span>
      </span>
      <span className="hit-snippet">{highlight(hit.snippet, query)}</span>
      <span className="hit-foot">
        <span className={`hit-badge match-${hit.match}`}>{hit.match}</span>
        {hit.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="hit-tag">
            #{tag}
          </span>
        ))}
        <span className="hit-path">{hit.path}</span>
      </span>
    </button>
  );
}

export default function SearchBar({ onOpenNote, clock }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const dictationBase = useRef("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const voice = useVoiceInput({
    onTranscript: (text, isFinal) => {
      // Interim results replace the dictated tail; the final one settles it.
      const base = dictationBase.current;
      setQuery(text ? `${base}${base && text ? " " : ""}${text}` : base);
      if (isFinal) setOpen(true);
    },
  });

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setHits(null);
      setStatus("idle");
      setError(null);
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as SearchResponse & { error?: string; detail?: string };
        if (!response.ok) {
          throw new Error(body.detail ?? body.error ?? `Search failed (${response.status})`);
        }
        setHits(body.results);
        setActive(0);
        setOpen(true);
        setError(null);
        setStatus("idle");
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Search failed");
        setStatus("error");
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const openHit = useCallback(
    (hit: SearchHit | undefined) => {
      if (!hit) return;
      setOpen(false);
      onOpenNote(hit.path);
    },
    [onOpenNote],
  );

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const total = hits?.length ?? 0;
    if (event.key === "ArrowDown" && total > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (current + 1) % total);
    } else if (event.key === "ArrowUp" && total > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (current - 1 + total) % total);
    } else if (event.key === "Enter") {
      if (open && total > 0) {
        event.preventDefault();
        openHit(hits?.[active]);
      }
    } else if (event.key === "Escape") {
      if (open) setOpen(false);
      else setQuery("");
    }
  }

  function onMicClick() {
    if (voice.status !== "listening") dictationBase.current = query.trim();
    voice.toggle();
  }

  const voiceLabel = voiceMessage(voice.status);

  const showPanel = open && query.trim().length > 0;

  return (
    <div className="search">
      <div className={`search-field${voice.status === "listening" ? " is-listening" : ""}`}>
        <span className="search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          ref={inputRef}
          className="search-input"
          type="search"
          value={query}
          placeholder="Search titles, tags, frontmatter and note text…"
          aria-label="Search the vault"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-activedescendant={showPanel && hits && hits.length > 0 ? `search-hit-${active}` : undefined}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (hits && hits.length > 0) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />

        {query ? (
          <button
            type="button"
            className="search-clear"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            ✕
          </button>
        ) : null}

        <button
          type="button"
          className={`voice-button${voice.status === "listening" ? " is-listening" : ""}`}
          onClick={onMicClick}
          aria-pressed={voice.status === "listening"}
          title={voiceLabel}
          disabled={voiceBlocked(voice.status)}
        >
          <span className="voice-dot" aria-hidden="true" />
          <span className="voice-text">{voiceButtonLabel(voice.status)}</span>
        </button>
      </div>

      <p className="search-meta" role="status" aria-live="polite">
        {status === "loading" ? "Searching…" : null}
        {status === "error" ? error : null}
        {status === "idle" && showPanel && hits
          ? `${hits.length} ${hits.length === 1 ? "match" : "matches"} · titles · tags · frontmatter · body`
          : null}
        {status === "idle" && !showPanel ? voiceLabel : null}
      </p>

      {showPanel ? (
        <div className="search-results" id="search-results" role="listbox" aria-label="Search results">
          {hits && hits.length === 0 ? (
            <p className="search-empty">No note matches “{query.trim()}”.</p>
          ) : null}

          {hits?.map((hit, index) => (
            <SearchHitRow
              key={hit.path}
              hit={hit}
              index={index}
              active={index === active}
              query={query}
              clock={clock}
              onHover={() => setActive(index)}
              onOpen={() => openHit(hit)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
