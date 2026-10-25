import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  capturedZoneLabel,
  formatCapturedStamp,
  formatTimestamp,
  type ClockPrefs,
} from "../clock";
import { exactBytes, formatBytes } from "../format";
import { headingSlug } from "../headingTarget";
import { renderMarkdown } from "../markdown";
import { systemPrefersReducedMotion } from "../motion";
import type { NoteBacklink, NoteDetail, NoteLink } from "../types";
import { useDialog } from "../useDialog";

/** How long a jumped-to heading stays highlighted. Matches the CSS animation. */
const FLASH_MS = 2_200;

/** `[[Note#Heading]]`: which heading to land on, and a counter that re-triggers
 * the same heading when the same link is clicked twice. */
export interface HeadingRequest {
  text: string;
  nonce: number;
}

interface NoteReaderProps {
  open: boolean;
  note: NoteDetail | null;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onRetry: () => void;
  /** Resolves `[[wikilink]]` targets against the vault index. */
  resolveWikilink: (target: string) => string | null;
  onOpenNote: (path: string, heading?: string | null) => void;
  /** Heading a `[[Note#Heading]]` link asked for; null for an ordinary open. */
  headingRequest?: HeadingRequest | null;
  /** Applied to the file's modified timestamp. */
  clock: ClockPrefs;
  /** True when the API accepts writes and this machine is allowed to send them. */
  writes?: boolean;
  /** Replaces the note with the edited markdown; rejects with a message. */
  onSave?: (markdown: string) => Promise<void>;
  /** Moves the note into the vault's `.trash`; rejects with a message. */
  onDelete?: () => Promise<void>;
}

function formatStamp(value: string | null, clock: ClockPrefs): string | null {
  if (!value) return null;
  return formatTimestamp(value, clock);
}

interface ConnectionsProps {
  outbound: NoteLink[];
  backlinks: NoteBacklink[];
  /** The heading travels with the path, so a link with `#Heading` lands there. */
  onOpenNote: (path: string, heading?: string | null) => void;
}

/**
 * The note's place in the graph: what it links to and what links back to it,
 * using the same resolution the cloud draws its edges from. Broken targets stay
 * visible (and inert) instead of disappearing, so a typo is easy to spot.
 */
function Connections({ outbound, backlinks, onOpenNote }: ConnectionsProps) {
  const resolved = outbound.filter((link): link is NoteLink & { path: string } => link.path !== null);
  const missing = outbound.filter((link) => link.path === null);

  return (
    <section className="reader-links" aria-label="Connections">
      <div className="reader-link-col">
        <h3 className="reader-links-title">
          Links out<span className="reader-links-count">{resolved.length}</span>
        </h3>
        {outbound.length === 0 ? (
          <p className="reader-links-empty">No [[wikilinks]] in this note.</p>
        ) : null}
        {resolved.length > 0 ? (
          <ul className="reader-link-list">
            {resolved.map((link) => (
              <li key={`out-${link.target}`}>
                <button
                  type="button"
                  className="reader-link"
                  onClick={() => onOpenNote(link.path, link.heading)}
                  title={link.heading ? `Open ${link.path} at “${link.heading}”` : `Open ${link.path}`}
                >
                  <span className="reader-link-title">{link.label}</span>
                  <span className="reader-link-path">{link.path}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {missing.length > 0 ? (
          <div className="reader-link-missing">
            <p className="reader-links-empty">
              {missing.length} target{missing.length === 1 ? "" : "s"} with no note
            </p>
            <ul className="reader-link-chips">
              {missing.map((link) => (
                <li key={`missing-${link.target}`} className="reader-link-chip" title={`No note matches [[${link.target}]]`}>
                  {link.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="reader-link-col">
        <h3 className="reader-links-title">
          Backlinks<span className="reader-links-count">{backlinks.length}</span>
        </h3>
        {backlinks.length === 0 ? (
          <p className="reader-links-empty">No other note links here yet.</p>
        ) : (
          <ul className="reader-link-list">
            {backlinks.map((link) => (
              <li key={`in-${link.path}`}>
                <button
                  type="button"
                  className="reader-link"
                  onClick={() => onOpenNote(link.path)}
                  title={`Open ${link.path}`}
                >
                  <span className="reader-link-title">{link.title}</span>
                  <span className="reader-link-path">
                    {link.via === "tag"
                      ? `shares ${link.tags.map((tag) => `#${tag}`).join(" ")}`
                      : "links here"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function NoteReader({
  open,
  note,
  error,
  loading,
  onClose,
  onRetry,
  resolveWikilink,
  onOpenNote,
  headingRequest = null,
  clock,
  writes = false,
  onSave,
  onDelete,
}: NoteReaderProps) {
  const panelRef: RefObject<HTMLDivElement | null> = useRef(null);
  const closeRef: RefObject<HTMLButtonElement | null> = useRef(null);
  const bodyRef: RefObject<HTMLDivElement | null> = useRef(null);
  const [flashing, setFlashing] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Writes are useless without a handler to carry them. */
  const canEdit = writes && Boolean(onSave) && Boolean(onDelete) && note !== null;
  const dirty = editing && note !== null && draft !== note.markdown;

  // Closing with an unsaved draft is the one way to lose work here, so the ✕
  // and Escape ask first. The browser's confirm is deliberate: it is the only
  // guard that a keyboard user cannot dismiss by accident.
  const requestClose = useCallback(() => {
    if (dirty && !window.confirm("Discard the unsaved edit?")) return;
    onClose();
  }, [dirty, onClose]);

  useDialog({ open, onClose: requestClose, panelRef, initialFocusRef: closeRef });

  // A different note, or closing the reader, always starts from the file again.
  useEffect(() => {
    setEditing(false);
    setDraft("");
    setSaving(false);
    setActionError(null);
    setConfirmDelete(false);
  }, [note?.path, open]);

  // A `[[Note#Heading]]` link has already fetched its note by the time this
  // runs, so the heading exists in the DOM. Scrolling `smooth` is skipped when
  // the OS asks for less motion; the highlight still marks the landing either
  // way, because "where did I go?" is information, not decoration.
  useEffect(() => {
    if (!open || loading || !note || !headingRequest?.text) return;
    const slug = headingSlug(headingRequest.text);
    if (!slug) return;
    const body = bodyRef.current;
    if (!body) return;
    const target = body.querySelector<HTMLElement>(`[data-heading="${slug}"]`);
    if (!target) return;
    // Scroll the reader's own box, not the page behind it: `scrollIntoView` can
    // also move the document, which would leave the dashboard scrolled
    // somewhere else when the reader closes.
    const offset = target.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTo({
      top: body.scrollTop + offset - 14,
      behavior: systemPrefersReducedMotion() ? "auto" : "smooth",
    });
    setFlashing(slug);
    const timer = window.setTimeout(() => setFlashing(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [open, loading, note, headingRequest]);

  function beginEdit() {
    if (!note) return;
    setDraft(note.markdown);
    setActionError(null);
    setConfirmDelete(false);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft("");
    setActionError(null);
  }

  async function saveEdit() {
    if (!onSave || !dirty || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The note could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function removeNote() {
    if (!onDelete || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await onDelete();
      setConfirmDelete(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The note could not be deleted");
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const modified = note ? formatStamp(note.modifiedAt, clock) : null;
  // The captured stamp is converted into the chosen zone; naming the note's own
  // zone beside it makes that conversion inspectable instead of invisible.
  const capturedZone = note ? capturedZoneLabel(note.captured, note.capturedZone) : null;
  const keywords = note?.keywords ?? [];
  const outbound = note?.outbound ?? [];
  const backlinks = note?.backlinks ?? [];
  // The server resolved this note's own links against the same index the cloud
  // uses, so inline `[[wikilinks]]` and the Links-out list always agree. Falls
  // back to the index-wide resolver when the response predates the field.
  const noteLinks = new Map(
    outbound
      .filter((link): link is NoteLink & { path: string } => link.path !== null)
      .map((link) => [link.target.trim().toLowerCase(), link.path]),
  );
  const resolveInNote = (target: string) =>
    noteLinks.get(target.trim().toLowerCase()) ?? resolveWikilink(target);

  return (
    <div
      className="reader-scrim"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="reader-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-title"
      >
        <header className="reader-head">
          <div className="reader-heading">
            <p className="reader-kicker">
              Note
              {note?.area ? <span className={`area-tag area-${note.area}`}>{note.area}</span> : null}
              {note?.origin ? <span className="reader-origin">{note.origin === "ai" ? "AI capture" : "Written by you"}</span> : null}
            </p>
            <h2 id="reader-title" className="reader-title">
              {note?.title ?? (error ? "Note unavailable" : "Reading note…")}
            </h2>
            {note ? (
              <code className="reader-path" title={note.path}>
                {note.path}
              </code>
            ) : null}
          </div>
          <div className="reader-tools">
            {canEdit && !editing ? (
              <>
                <button type="button" className="reader-action" onClick={beginEdit}>
                  Edit
                </button>
                {confirmDelete ? (
                  <span className="reader-confirm" role="group" aria-label="Confirm delete">
                    <button
                      type="button"
                      className="reader-action reader-action-danger"
                      onClick={() => void removeNote()}
                      disabled={saving}
                    >
                      {saving ? "Moving…" : "Move to .trash"}
                    </button>
                    <button
                      type="button"
                      className="reader-action"
                      onClick={() => setConfirmDelete(false)}
                      disabled={saving}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="reader-action"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete
                  </button>
                )}
              </>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              className="settings-close"
              onClick={requestClose}
              aria-label="Close note"
            >
              ✕
            </button>
          </div>
        </header>

        {note ? (
          <dl className="reader-meta">
            <div>
              <dt>Captured</dt>
              <dd title={note.captured ?? "no captured date"}>
                <span>
                  {formatCapturedStamp(note.captured, clock, note.capturedZone ?? undefined) ??
                    "no captured date"}
                </span>
                {capturedZone ? (
                  <span className="reader-meta-zone" title={`Captured in ${capturedZone}`}>
                    {capturedZone}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Words</dt>
              <dd>{note.words.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd title={exactBytes(note.size)}>{formatBytes(note.size)}</dd>
            </div>
            <div>
              <dt>Keywords</dt>
              <dd>{keywords.length > 0 ? keywords.join(" · ") : "—"}</dd>
            </div>
            <div>
              <dt>Links</dt>
              <dd>
                {outbound.length} out · {backlinks.length} in
              </dd>
            </div>
          </dl>
        ) : null}

        <div className="reader-body" ref={bodyRef}>
          {loading ? <p className="reader-state">Reading from the vault…</p> : null}
          {!loading && error ? (
            <div className="reader-state reader-state-error" role="alert">
              <p>{error}</p>
              <button type="button" className="reader-retry" onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : null}
          {!loading && !error && note ? (
            editing ? (
              <div className="reader-edit">
                <label className="reader-edit-label" htmlFor="reader-editor">
                  Markdown
                  <span className="reader-edit-path">{note.path}</span>
                </label>
                <textarea
                  id="reader-editor"
                  className="reader-editor"
                  value={draft}
                  spellCheck={false}
                  onChange={(event) => setDraft(event.target.value)}
                  aria-describedby={actionError ? "reader-action-error" : undefined}
                />
                {actionError ? (
                  <p id="reader-action-error" className="reader-action-error" role="alert">
                    {actionError}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <article className="prose">
                  {renderMarkdown(note.markdown, {
                    resolveWikilink: resolveInNote,
                    onOpenNote,
                    highlightHeading: flashing,
                  })}
                </article>
                <Connections outbound={outbound} backlinks={backlinks} onOpenNote={onOpenNote} />
              </>
            )
          ) : null}
        </div>

        <footer className="reader-foot">
          {canEdit && editing ? (
            <div className="reader-edit-actions">
              <span className="reader-edit-state">{dirty ? "Unsaved changes" : "No changes yet"}</span>
              <button type="button" className="reader-action" onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="reader-action reader-action-primary"
                onClick={() => void saveEdit()}
                disabled={!dirty || saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <span>
              {canEdit
                ? "Editing writes to your vault · previous versions go to .trash"
                : "Read-only · nothing is written to the vault"}
            </span>
          )}
          {modified ? <span className="reader-stamp">modified {modified}</span> : null}
        </footer>
      </div>
    </div>
  );
}
