import { useState } from "react";
import type { ActionCatalogue } from "../types";

interface QuickActionsProps {
  onRescan: () => void;
  busy: boolean;
  vaultPath: string | null;
  onOpenRandom: () => void;
  notesBusy: boolean;
  onOpenSettings: () => void;
  onOpenGraph: () => void;
  /** The graph is fetched alongside the index; the tile waits for a real one. */
  graphReady: boolean;
  /** Writes are on and local to this machine. */
  writable: boolean;
  onNewNote: () => void;
  /** Opens the recoverable notes in `.trash`; restoring is a write too. */
  onOpenTrash: () => void;
  /** Counts from `/api/actions`; null until the catalogue answers. */
  actions: ActionCatalogue | null;
  onTodayCaptures: () => void;
  onOpenReview: () => void;
}

export default function QuickActions({
  onRescan,
  busy,
  vaultPath,
  onOpenRandom,
  notesBusy,
  onOpenSettings,
  onOpenGraph,
  graphReady,
  writable,
  onNewNote,
  onOpenTrash,
  actions,
  onTodayCaptures,
  onOpenReview,
}: QuickActionsProps) {
  const [copied, setCopied] = useState(false);
  const catalogue = (id: string) => actions?.actions.find((action) => action.id === id) ?? null;
  const today = catalogue("today");
  const review = catalogue("review");

  async function copyPath() {
    if (!vaultPath) return;
    try {
      await navigator.clipboard.writeText(vaultPath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rail-group" aria-label="Quick actions">
      <div className="rail-head">
        <h2 className="rail-title">Skills · quick access</h2>
        <span className="rail-tag">{writable ? "7 live" : "5 live"}</span>
      </div>

      <div className="tiles">
        <button
          type="button"
          className="tile"
          onClick={onOpenRandom}
          disabled={busy || notesBusy}
        >
          <span className="tile-label">Random note</span>
          <span className="tile-icon" aria-hidden="true">
            ↗
          </span>
        </button>

        <button
          type="button"
          className="tile"
          onClick={onOpenGraph}
          disabled={!graphReady}
          aria-haspopup="dialog"
          title={graphReady ? "Open the full-screen graph" : "Waiting for the vault graph"}
        >
          <span className="tile-label">Full graph</span>
          <span className="tile-icon" aria-hidden="true">
            ↗
          </span>
        </button>

        {writable ? (
          <button
            type="button"
            className="tile"
            onClick={onNewNote}
            aria-haspopup="dialog"
            title="Write a new markdown note into the vault"
          >
            <span className="tile-label">New note</span>
            <span className="tile-icon" aria-hidden="true">
              +
            </span>
          </button>
        ) : null}

        {writable ? (
          <button
            type="button"
            className="tile"
            onClick={onOpenTrash}
            aria-haspopup="dialog"
            title="Deleted notes are recoverable · restore one"
          >
            <span className="tile-label">Trash</span>
            <span className="tile-icon" aria-hidden="true">
              ↺
            </span>
          </button>
        ) : null}

        <button
          type="button"
          className="tile"
          onClick={onTodayCaptures}
          disabled={!today}
          aria-haspopup="dialog"
          title={today ? `${today.hint} · open today's captures` : "Waiting for the vault index"}
        >
          <span className="tile-label">Today's captures</span>
          <span className={`tile-count${today && today.count > 0 ? " is-active" : ""}`}>
            {today ? today.count : "—"}
          </span>
        </button>

        <button
          type="button"
          className="tile"
          onClick={onOpenReview}
          disabled={!review}
          aria-haspopup="dialog"
          title={review ? `${review.hint} · open the review queue` : "Waiting for the vault index"}
        >
          <span className="tile-label">Review queue</span>
          <span className={`tile-count${review && review.count > 0 ? " is-active" : ""}`}>
            {review ? review.count : "—"}
          </span>
        </button>

        <button
          type="button"
          className="tile"
          onClick={onOpenSettings}
          aria-haspopup="dialog"
        >
          <span className="tile-label">Themes</span>
          <span className="tile-icon" aria-hidden="true">
            ↘
          </span>
        </button>
      </div>

      <p className="rail-hint">
        {writable
          ? "Writes to this vault · this machine only"
          : "Read-only vault · nothing is written back"}
      </p>

      <div className="rail-actions">
        <button type="button" className="action action-primary" onClick={onRescan} disabled={busy}>
          <span>{busy ? "Scanning vault…" : "Rescan vault"}</span>
          <span className="action-hint">Live</span>
        </button>

        <button type="button" className="action" onClick={copyPath} disabled={!vaultPath}>
          <span>{copied ? "Path copied" : "Copy vault path"}</span>
          <span className="action-hint">Clip</span>
        </button>
      </div>
    </section>
  );
}
