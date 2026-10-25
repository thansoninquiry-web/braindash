import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { paletteRows, stepIndex, type PaletteEntry } from "../palette";
import type { SearchResponse } from "../types";
import { useDialog } from "../useDialog";

/** How many note hits a typed query may add below the commands. */
const NOTE_LIMIT = 6;
/** Same debounce as the header search, so one query is one request. */
const SEARCH_DEBOUNCE_MS = 180;

interface PaletteListProps {
  entries: PaletteEntry[];
  /** Index of the row Enter would run. */
  active: number;
  /** The live query, for the empty message. */
  query: string;
  onHover: (index: number) => void;
  onRun: (entry: PaletteEntry) => void;
}

/**
 * The rows, with a small section heading where the group changes. A row is a
 * div rather than a button on purpose: the input keeps focus and owns the
 * keyboard (arrow keys move `aria-activedescendant`), which is the pattern a
 * combobox screen reader user expects. The pointer still runs a row directly.
 */
export function PaletteList({ entries, active, query, onHover, onRun }: PaletteListProps) {
  if (entries.length === 0) {
    return (
      <p className="palette-empty">
        {query.trim()
          ? `No command or note matches “${query.trim()}”.`
          : "No command is available right now."}
      </p>
    );
  }

  return (
    <>
      {entries.map((entry, index) => (
        <Fragment key={`${entry.group}:${entry.id}`}>
          {index === 0 || entries[index - 1]?.group !== entry.group ? (
            <p className="palette-group" aria-hidden="true">
              {entry.group}
            </p>
          ) : null}
          <div
            id={`palette-option-${index}`}
            role="option"
            aria-selected={index === active}
            className={`palette-row${index === active ? " is-active" : ""}`}
            onMouseEnter={() => onHover(index)}
            onClick={() => onRun(entry)}
          >
            <span className="palette-row-main">
              <span className="palette-row-label">{entry.label}</span>
              <span className="palette-row-detail">{entry.detail}</span>
            </span>
            <span className="palette-row-kind" aria-hidden="true">
              {entry.group === "Notes" ? "note" : "run"}
            </span>
          </div>
        </Fragment>
      ))}
    </>
  );
}

export interface CommandPaletteProps {
  /** Mounted, listening and visible. */
  open: boolean;
  /** The commands the app can run right now, in menu order. */
  commands: PaletteEntry[];
  /** Runs a command or opens a note; the palette closes first. */
  onRun: (entry: PaletteEntry) => void;
  onClose: () => void;
}

/**
 * The keyboard launcher: `⌘K` / `Ctrl+K` opens it, typing filters the commands
 * and searches the vault, ↑/↓ move, Enter runs and Escape closes. It reads
 * notes through `/api/search` (the same index the header search uses) and
 * writes nothing. Neither list is cached: the search is re-asked per query, and
 * the commands come from the live dashboard state, so a count or the presence of
 * `New note` is never stale.
 */
export default function CommandPalette({
  open,
  commands,
  onRun,
  onClose,
}: CommandPaletteProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<PaletteEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const close = useCallback(() => onClose(), [onClose]);
  useDialog({ open, onClose: close, panelRef, initialFocusRef: inputRef });

  // Every opening starts clean: a half-typed query from last time would look
  // like it belongs to the dashboard as it is now.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setNotes([]);
    setError(null);
    setSearching(false);
    setActive(0);
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setNotes([]);
      setError(null);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as SearchResponse & {
          error?: string;
          detail?: string;
        };
        if (!response.ok) {
          throw new Error(body.detail ?? body.error ?? `Search failed (${response.status})`);
        }
        setNotes(
          body.results.map((hit) => ({
            id: hit.path,
            label: hit.title,
            detail: `${hit.path} · ${hit.match}`,
            group: "Notes" as const,
            keywords: hit.tags.join(" "),
          })),
        );
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setNotes([]);
        setError(cause instanceof Error ? cause.message : "Search failed");
      } finally {
        // A superseded query must not clear the newest query's status.
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  // A new query is a new list, so the old selection would point at a row the
  // person never saw.
  useEffect(() => {
    setActive(0);
  }, [query]);

  const entries = useMemo(
    () => paletteRows(commands, notes, query, 9, NOTE_LIMIT),
    [commands, notes, query],
  );

  const selected = entries.length === 0 ? 0 : Math.min(active, entries.length - 1);
  const typed = query.trim().length > 0;

  function run(entry: PaletteEntry | undefined) {
    if (!entry) return;
    onRun(entry);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(stepIndex(selected, entries.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(stepIndex(selected, entries.length, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(entries.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(entries[selected]);
    }
  }

  if (!open) return null;

  const noteCount = notes.length;
  const caption = searching
    ? "Searching the vault…"
    : error
      ? error
      : typed
        ? `${noteCount} note${noteCount === 1 ? "" : "s"} · ${entries.length - noteCount} command${
            entries.length - noteCount === 1 ? "" : "s"
          }`
        : `${commands.length} commands · type to search notes`;

  return (
    <div
      className="palette-scrim"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) close();
      }}
    >
      <div
        ref={panelRef}
        className="palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="palette-field">
          <span className="palette-icon" aria-hidden="true">
            ⌘
          </span>
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            value={query}
            placeholder="Run a command or jump to a note…"
            aria-label="Search commands and notes"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={
              entries.length > 0 ? `palette-option-${selected}` : undefined
            }
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="settings-close"
            onClick={close}
            aria-label="Close the command palette"
          >
            ✕
          </button>
        </div>

        <p className={`palette-status${error ? " is-error" : ""}`} role="status" aria-live="polite">
          {caption}
        </p>

        <div className="palette-list" id="palette-list" role="listbox" aria-label="Commands and notes">
          <PaletteList
            entries={entries}
            active={selected}
            query={query}
            onHover={setActive}
            onRun={run}
          />
        </div>

        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move · <kbd>↵</kbd> run · <kbd>esc</kbd> close
          </span>
          <span className="palette-foot-mono">⌘K / Ctrl+K</span>
        </footer>
      </div>
    </div>
  );
}
