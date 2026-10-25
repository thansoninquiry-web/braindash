import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { getTrash, restoreTrashNote } from "../api";
import { formatClockTime, formatDateKey, zoneDayKey, type ClockPrefs } from "../clock";
import { formatBytes } from "../format";
import type { TrashEntry, TrashListing } from "../types";
import { useDialog } from "../useDialog";

/**
 * The vault's `.trash`, and the way back out of it.
 *
 * Delete has always been a move into `.trash/<stamp>/<path>`; until now nothing
 * in the dashboard could read that folder, so the safety net existed only for
 * someone with a file manager. This lists what is recoverable, says where each
 * note would return, and restores one on request. Restoring is a write, so the
 * panel is only offered where writes are on; a note whose filename has been
 * re-used is refused by the API rather than replacing the newer note.
 */

export interface TrashPanelBodyProps {
  clock: ClockPrefs;
  loading: boolean;
  error: string | null;
  listing: TrashListing | null;
  /** Id currently being restored, so only that row says "Restoring…". */
  restoringId: string | null;
  /** A refused restore, tied to the row it came from. */
  restoreError: { id: string; message: string } | null;
  writable: boolean;
  onRestore: (entry: TrashEntry) => void;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  closeRef: RefObject<HTMLButtonElement | null>;
}

/** The markup, so the states can be rendered without a fetch. */
export function TrashPanelBody({
  clock,
  loading,
  error,
  listing,
  restoringId,
  restoreError,
  writable,
  onRestore,
  onClose,
  panelRef,
  closeRef,
}: TrashPanelBodyProps) {
  const entries = listing?.entries ?? [];
  const total = listing?.total ?? 0;
  const caption = loading
    ? "Reading .trash…"
    : error
      ? "The trash could not be read."
      : total === 0
        ? "Nothing deleted is waiting here."
        : `${total} recoverable note${total === 1 ? "" : "s"} · newest first`;

  return (
    <div
      className="action-sheet-scrim"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trash-title"
      >
        <header className="action-sheet-head">
          <div className="action-sheet-heading">
            <p className="action-sheet-kicker">Vault · trash</p>
            <h2 id="trash-title" className="action-sheet-title">
              Trash
            </h2>
            <p className="action-sheet-meta" aria-live="polite">
              {caption}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="Close the trash"
          >
            ✕
          </button>
        </header>

        <div className="action-sheet-body">
          {loading ? (
            <p className="action-sheet-note" role="status">
              Reading what deleting kept…
            </p>
          ) : null}

          {error ? (
            <p className="action-sheet-note is-error" role="alert">
              {error}
            </p>
          ) : null}

          {!loading && !error && entries.length === 0 ? (
            <p className="action-sheet-note">
              Nothing in the trash. Deleting a note moves it here instead of erasing it.
            </p>
          ) : null}

          {entries.length > 0 ? (
            <ul className="trash-rows">
              {entries.map((entry) => {
                const when = new Date(entry.trashedAt);
                const day = formatDateKey(zoneDayKey(when, clock)) ?? "—";
                const failed = restoreError?.id === entry.id ? restoreError.message : null;
                return (
                  <li key={entry.id} className="trash-row">
                    <span className="trash-row-main">
                      <span className="trash-row-title">{entry.title}</span>
                      <span className="trash-row-path">{entry.path}</span>
                    </span>
                    <span className="trash-row-meta">
                      <span className="trash-row-stamp">
                        {day} · {formatClockTime(when, clock)}
                      </span>
                      <span className="trash-row-size">{formatBytes(entry.size)}</span>
                    </span>
                    <button
                      type="button"
                      className="trash-restore"
                      onClick={() => onRestore(entry)}
                      disabled={!writable || restoringId !== null}
                      title={`Put ${entry.path} back`}
                    >
                      {restoringId === entry.id ? "Restoring…" : "Restore"}
                    </button>
                    {failed ? (
                      <p className="trash-row-error" role="alert">
                        {failed}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <footer className="action-sheet-foot">
          <span>
            {writable
              ? "Restoring writes the note back at the path it left"
              : "Read-only session · restores need BRAINDASH_WRITE=1"}
          </span>
          <span className="action-sheet-mono">
            {total} note{total === 1 ? "" : "s"}
          </span>
        </footer>
      </div>
    </div>
  );
}

export interface TrashPanelProps {
  open: boolean;
  clock: ClockPrefs;
  writable: boolean;
  /** Bumped after a restore or rescan, to re-read the folder. */
  version: number;
  /** The restored note's path, so the dashboard can refresh and open it. */
  onRestored: (path: string) => void;
  onClose: () => void;
}

export default function TrashPanel({
  open,
  clock,
  writable,
  version,
  onRestored,
  onClose,
}: TrashPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [listing, setListing] = useState<TrashListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<{ id: string; message: string } | null>(null);

  const close = useCallback(() => onClose(), [onClose]);
  useDialog({ open, onClose: close, panelRef, initialFocusRef: closeRef });

  // Opened, or the vault moved underneath: re-read rather than showing a stale
  // list of what is recoverable.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setRestoreError(null);
    getTrash()
      .then((next) => {
        if (live) {
          setListing(next);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : "The trash could not be read.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open, version]);

  async function restore(entry: TrashEntry) {
    if (restoringId !== null) return;
    setRestoringId(entry.id);
    setRestoreError(null);
    try {
      const restored = await restoreTrashNote(entry.id);
      setListing((current) =>
        current
          ? {
              ...current,
              total: Math.max(current.total - 1, 0),
              entries: current.entries.filter((row) => row.id !== entry.id),
            }
          : current,
      );
      onRestored(restored.path);
    } catch (cause) {
      setRestoreError({
        id: entry.id,
        message: cause instanceof Error ? cause.message : "That note could not be restored.",
      });
    } finally {
      setRestoringId(null);
    }
  }

  if (!open) return null;

  return (
    <TrashPanelBody
      clock={clock}
      loading={loading}
      error={error}
      listing={listing}
      restoringId={restoringId}
      restoreError={restoreError}
      writable={writable}
      onRestore={(entry) => void restore(entry)}
      onClose={close}
      panelRef={panelRef}
      closeRef={closeRef}
    />
  );
}
