import { useEffect, useRef, useState, type FormEvent } from "react";
import { normaliseNotePath } from "../notePath";
import { useDialog } from "../useDialog";

interface NoteComposerProps {
  open: boolean;
  onClose: () => void;
  /** Creates the note; rejects with a message the form shows. */
  onCreate: (path: string, markdown: string) => Promise<void>;
}

const TEMPLATE = "# Untitled\n\n";

/**
 * The one place the dashboard writes a *new* file. The path is checked here for
 * the mistakes a person makes while typing (absolute path, `..`, a hidden
 * folder) and again by the API, which owns the real containment rules.
 */
export default function NoteComposer({ open, onClose, onCreate }: NoteComposerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pathRef = useRef<HTMLInputElement | null>(null);
  const [pathValue, setPathValue] = useState("");
  const [markdown, setMarkdown] = useState(TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useDialog({ open, onClose, panelRef, initialFocusRef: pathRef });

  // Every opening starts clean: a previous error or half-typed path must not
  // look like it belongs to the note about to be written.
  useEffect(() => {
    if (!open) return;
    setPathValue("");
    setMarkdown(TEMPLATE);
    setError(null);
    setBusy(false);
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const checked = normaliseNotePath(pathValue);
    if (checked.path === null) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(checked.path, markdown);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The note could not be created");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="reader-scrim"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="reader-panel composer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
      >
        <header className="reader-head">
          <div className="reader-heading">
            <p className="reader-kicker">New note</p>
            <h2 id="composer-title" className="reader-title">
              Write a note into the vault
            </h2>
          </div>
          <div className="reader-tools">
            <button
              type="button"
              className="settings-close"
              onClick={onClose}
              aria-label="Close new note"
            >
              ✕
            </button>
          </div>
        </header>

        <form className="composer-form" onSubmit={(event) => void submit(event)}>
          <label className="composer-field">
            <span className="composer-label">Path</span>
            <input
              ref={pathRef}
              className="composer-input"
              value={pathValue}
              onChange={(event) => setPathValue(event.target.value)}
              placeholder="notes/new-idea.md"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="composer-field composer-field-grow">
            <span className="composer-label">Markdown</span>
            <textarea
              className="reader-editor composer-editor"
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              spellCheck={false}
            />
          </label>

          {error ? (
            <p className="reader-action-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="composer-actions">
            <button type="button" className="reader-action" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="reader-action reader-action-primary"
              disabled={busy}
            >
              {busy ? "Creating…" : "Create note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
