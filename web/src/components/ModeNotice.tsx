import type { ModeChangeNotice } from "../modeBadge";

interface ModeNoticeProps {
  notice: ModeChangeNotice;
  onDismiss: () => void;
  /** Silences notices for the rest of this tab, instead of just this one. */
  onMute: () => void;
}

/**
 * A brief, dismissible announcement for a mode that changed while the
 * dashboard was open. The header badge updates silently; this is the part that
 * makes the change noticeable and gives the new reason in plain language.
 */
export default function ModeNotice({ notice, onDismiss, onMute }: ModeNoticeProps) {
  return (
    <div
      className={`mode-notice is-${notice.tone}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="mode-notice-dot" aria-hidden="true" />
      <div className="mode-notice-copy">
        <p className="mode-notice-title">
          Working mode: <strong>{notice.label}</strong>{" "}
          <span className="mode-notice-source">{notice.source}</span>
        </p>
        <p className="mode-notice-detail">{notice.detail}</p>
      </div>
      <button
        type="button"
        className="mode-notice-mute"
        onClick={onMute}
        title="No more mode notices in this tab; they return when it closes"
        aria-label="Mute working mode notices for this tab"
      >
        Mute
      </button>
      <button
        type="button"
        className="mode-notice-close"
        onClick={onDismiss}
        aria-label="Dismiss working mode notice"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
