import { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "../api";
import type { BrokenLinkReport } from "../types";
import { useDialog } from "../useDialog";

interface BrokenLinksProps {
  /** Changes when the vault is rescanned, so the report follows the index. */
  vaultVersion: number;
  onOpenNote: (path: string) => void;
}

/** At most three groups on the card; the report is where the full list lives. */
const SHOWN = 3;

/**
 * The graph's unresolved wikilinks, grouped by the words each note shows —
 * the alias when one was written, otherwise the bare target. A group is the
 * unit a person repairs: two spellings of the same idea share one label even
 * when the targets differ, and the note rows say which file to edit.
 */
export default function BrokenLinks({ vaultVersion, onOpenNote }: BrokenLinksProps) {
  const [report, setReport] = useState<BrokenLinkReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  useDialog({ open, onClose: close, panelRef, initialFocusRef: closeRef });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getJson<BrokenLinkReport>("/api/links/broken")
      .then((next) => {
        if (!alive) return;
        setReport(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : "Link report unavailable");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [vaultVersion]);

  const groups = report?.groups ?? [];
  const shown = groups.slice(0, SHOWN);
  const hidden = groups.length - shown.length;
  const total = report?.total ?? 0;
  // Distinct files that need an edit; one note can carry several labels.
  const noteCount = new Set(groups.flatMap((group) => group.notes.map((entry) => entry.path))).size;
  const state = error ? "unavailable" : report === null ? "pending" : total > 0 ? "broken" : "clean";
  const caption = error
    ? error
    : report === null
      ? "Checking every wikilink against the index…"
      : total === 0
        ? "Every wikilink resolves to a note."
        : `${groups.length} label group${groups.length === 1 ? "" : "s"} · ${noteCount} note${
            noteCount === 1 ? "" : "s"
          }`;

  function openNote(path: string) {
    close();
    onOpenNote(path);
  }

  return (
    <>
      <section className="link-health" aria-label="Broken links" data-state={state}>
        <div className="link-health-head">
          <span className="metric-label">Link health</span>
          <span className="rail-tag">wikilinks</span>
        </div>

        <div className="link-health-value">
          <span className="link-health-count">{report ? total : "—"}</span>
          <span className="link-health-unit">
            broken link{total === 1 ? "" : "s"}
          </span>
        </div>

        <p className="link-health-caption" aria-live="polite">
          {caption}
        </p>

        {shown.length > 0 ? (
          <ul className="link-health-list">
            {shown.map((group) => (
              <li key={group.label.toLowerCase()}>
                <span className="link-health-label" title={group.targets.join(", ")}>
                  {group.label}
                </span>
                <span className="link-health-note-count">{group.notes.length}</span>
              </li>
            ))}
            {hidden > 0 ? <li className="link-health-more">+{hidden} more label{hidden === 1 ? "" : "s"}</li> : null}
          </ul>
        ) : null}

        <div className="link-health-foot">
          <span className="link-health-stamp">{loading ? "Refreshing…" : "Indexed"}</span>
          <button
            type="button"
            className="link-health-open"
            onClick={() => setOpen(true)}
            disabled={loading && report === null}
            aria-haspopup="dialog"
          >
            {total > 0 ? "Report" : "Inspect"}
          </button>
        </div>
      </section>

      {open ? (
        <div
          className="link-report-scrim"
          onMouseDown={(event) => {
            if (!panelRef.current?.contains(event.target as Node)) close();
          }}
        >
          <div
            ref={panelRef}
            className="link-report-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-report-title"
          >
            <header className="link-report-head">
              <div className="link-report-heading">
                <p className="link-report-kicker">Vault · links</p>
                <h2 id="link-report-title" className="link-report-title">
                  Broken links
                </h2>
                <p className="link-report-meta">
                  {error
                    ? "The vault index could not be read."
                    : report
                      ? `${total} broken link${total === 1 ? "" : "s"} · ${groups.length} label group${
                          groups.length === 1 ? "" : "s"
                        }`
                      : "Reading the vault index…"}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="settings-close"
                onClick={close}
                aria-label="Close broken link report"
              >
                ✕
              </button>
            </header>

            <div className="link-report-body">
              {error ? (
                <p className="link-report-empty" role="alert">
                  {error}
                </p>
              ) : null}

              {!error && report && groups.length === 0 ? (
                <p className="link-report-empty">
                  Every wikilink in the vault resolves. Nothing to repair.
                </p>
              ) : null}

              {groups.map((group) => (
                <section className="link-group" key={group.label.toLowerCase()}>
                  <header className="link-group-head">
                    <h3 className="link-group-label">{group.label}</h3>
                    <span className="link-group-count">
                      {group.notes.length} link{group.notes.length === 1 ? "" : "s"}
                    </span>
                  </header>

                  <p className="link-group-targets">
                    <span className="link-group-targets-label">Unresolved</span>
                    {group.targets.map((target) => (
                      <code key={target} className="link-target">
                        [[{target}]]
                      </code>
                    ))}
                  </p>

                  <ul className="link-group-notes">
                    {group.notes.map((entry) => (
                      <li key={`${entry.path}\u0000${entry.target}`}>
                        <button
                          type="button"
                          className="link-note"
                          onClick={() => openNote(entry.path)}
                          title={`Open ${entry.title}`}
                        >
                          <span className="link-note-title">{entry.title}</span>
                          <span className="link-note-wrote">
                            {entry.alias ? `[[${entry.target}|${entry.alias}]]` : `[[${entry.target}]]`}
                          </span>
                          <span className="link-note-path">{entry.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <footer className="link-report-foot">
              <span>Grouped by the label each note wrote · from the index</span>
              <span className="link-report-mono">
                {groups.length} group{groups.length === 1 ? "" : "s"}
              </span>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
