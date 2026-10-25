import { useCallback, useRef } from "react";
import { activeTimeZone, formatCapturedStamp, formatDateKey, type ClockPrefs } from "../clock";
import { reviewStatus } from "../review";
import type { NoteSummary } from "../types";
import { useDialog } from "../useDialog";

/**
 * One dialog for both quick actions, because they differ only in what a row
 * says: Today's captures names when a note was captured, the Review queue names
 * how late its `next_review` is. A row opens the note in the reader — neither
 * list writes anything, since advancing a review date is an edit to the note.
 */

export type ActionKind = "today" | "review";

export interface ActionPanelProps {
  /** Always true: the panel is mounted only while it is open. */
  open: boolean;
  kind: ActionKind;
  /** The day the list describes, `YYYY-MM-DD`, in the chosen zone. */
  date: string;
  notes: NoteSummary[];
  loading: boolean;
  error: string | null;
  clock: ClockPrefs;
  onOpenNote: (path: string) => void;
  onClose: () => void;
}

export default function ActionPanel({
  open,
  kind,
  date,
  notes,
  loading,
  error,
  clock,
  onOpenNote,
  onClose,
}: ActionPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDialog({ open, onClose: close, panelRef, initialFocusRef: closeRef });

  const today = kind === "today";
  const label = formatDateKey(date) ?? date;
  const overdue = notes.filter((note) => reviewStatus(note.nextReview, date)?.state === "overdue").length;
  const title = today ? "Today's captures" : "Review queue";
  const kicker = today ? "Vault · captures" : "Vault · reviews";
  const caption = loading
    ? "Reading the vault index…"
    : error
      ? "The vault index could not be read."
      : today
        ? `${notes.length} note${notes.length === 1 ? "" : "s"} · ${label}`
        : `${notes.length} due${overdue > 0 ? ` · ${overdue} overdue` : ""} · ${label}`;
  const empty = today
    ? `Nothing was captured on ${label}.`
    : `No note is due on or before ${label}.`;

  return (
    <div
      className="action-sheet-scrim"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) close();
      }}
    >
      <div
        ref={panelRef}
        className="action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-sheet-title"
        data-kind={kind}
      >
        <header className="action-sheet-head">
          <div className="action-sheet-heading">
            <p className="action-sheet-kicker">{kicker}</p>
            <h2 id="action-sheet-title" className="action-sheet-title">
              {title}
            </h2>
            <p className="action-sheet-meta" aria-live="polite">
              {caption}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="settings-close"
            onClick={close}
            aria-label={`Close ${title.toLowerCase()}`}
          >
            ✕
          </button>
        </header>

        <div className="action-sheet-body">
          {loading ? (
            <p className="action-sheet-note" role="status">
              Reading the vault index…
            </p>
          ) : null}

          {error ? (
            <p className="action-sheet-note is-error" role="alert">
              {error}
            </p>
          ) : null}

          {!loading && !error && notes.length === 0 ? (
            <p className="action-sheet-note">{empty}</p>
          ) : null}

          {notes.length > 0 ? (
            <ul className="action-rows">
              {notes.map((note) => {
                const status = today ? null : reviewStatus(note.nextReview, date);
                return (
                  <li key={note.path}>
                    <button
                      type="button"
                      className="action-row"
                      onClick={() => onOpenNote(note.path)}
                      title={`Open ${note.title}`}
                    >
                      <span className="action-row-main">
                        <span className="action-row-title">{note.title}</span>
                        <span className="action-row-path">{note.path}</span>
                      </span>
                      <span className="action-row-meta">
                        {today ? (
                          <span className="action-row-stamp">
                            {formatCapturedStamp(
                              note.captured,
                              clock,
                              note.capturedZone ?? activeTimeZone(clock),
                            ) ?? "No captured stamp"}
                          </span>
                        ) : (
                          <>
                            <span
                              className={`action-row-status is-${status?.state ?? "scheduled"}`}
                            >
                              {status?.label ?? "No review date"}
                            </span>
                            <span className="action-row-date">
                              {formatDateKey(note.nextReview) ?? "—"}
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <footer className="action-sheet-foot">
          <span>
            {today
              ? "Captured on this day, newest first"
              : "Due dates come from each note's next_review"}
          </span>
          <span className="action-sheet-mono">
            {notes.length} note{notes.length === 1 ? "" : "s"}
          </span>
        </footer>
      </div>
    </div>
  );
}
