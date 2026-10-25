import { useEffect, useRef } from "react";
import { formatTimestamp, type ClockPrefs } from "../clock";
import { modeBadge } from "../modeBadge";
import type { ModeChangeRecord } from "../modeNoticeHistory";
import type { WorkingMode } from "../types";

interface WorkingModeBadgeProps {
  /** null until the first answer, and whenever the API cannot be reached. */
  mode: WorkingMode | null;
  /** The panel's dates are shown in the clock's zone and hour cycle. */
  clock: ClockPrefs;
  /** Flips collected while notices were muted, newest first. */
  history?: ModeChangeRecord[];
  onClearHistory?: () => void;
  /** Session-only silence for the work/home change notice. */
  noticesMuted: boolean;
  onSelectNoticesMuted: (muted: boolean) => void;
}

/**
 * The working mode at a glance: dot, mode and how it was decided. It sits in the
 * header because it changes how the rest of the session behaves, not because it
 * is a mode switch — switching is `npm run mode`, which also writes the switch
 * log. The badge itself opens a small panel with the full reason (the same
 * sentence as its tooltip), a session mute for mode-change notices, and the
 * backlog of flips that arrived while those notices were off.
 */
export default function WorkingModeBadge({
  mode,
  clock,
  history = [],
  onClearHistory,
  noticesMuted,
  onSelectNoticesMuted,
}: WorkingModeBadgeProps) {
  const badge = modeBadge(mode, (iso) => formatTimestamp(iso, clock));
  const panelRef = useRef<HTMLDetailsElement | null>(null);

  // A native <details> closes on its summary but not on an outside click or
  // Escape. The panel can sit over the header, so make those dismiss it too.
  useEffect(() => {
    const dismiss = (event: Event) => {
      const element = panelRef.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") element.open = false;
        return;
      }
      if (event instanceof PointerEvent && !element.contains(event.target as Node)) {
        element.open = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);

  const backlog =
    history.length > 0
      ? `, ${history.length} muted ${history.length === 1 ? "change" : "changes"}`
      : "";

  return (
    <div className="work-mode-shell">
      {/* The live region lives outside the disclosure, so opening the panel or
          toggling the switch does not re-announce the mode. */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {badge.detail}
      </span>
      <details className={`work-mode is-${badge.tone}`} ref={panelRef}>
        <summary
          className="work-mode-summary"
          aria-label={`Working mode ${badge.label}, ${badge.source}${backlog}. Open the reason and notice settings.`}
          title={badge.detail}
        >
          <span className="work-mode-dot" aria-hidden="true" />
          <span className="work-mode-label">{badge.label}</span>
          <span className="work-mode-source">{badge.source}</span>
          {history.length > 0 ? (
            <span className="mode-history-count" aria-hidden="true">
              {history.length}
            </span>
          ) : null}
          <span className="work-mode-chevron" aria-hidden="true">
            ⌄
          </span>
        </summary>

        <div className="work-mode-panel">
          <p className="work-mode-panel-title">
            Working mode: <strong>{badge.label}</strong>{" "}
            <span className="work-mode-panel-source">{badge.source}</span>
          </p>
          <p className="work-mode-panel-reason">{badge.detail}</p>

          <button
            type="button"
            role="switch"
            aria-checked={!noticesMuted}
            aria-label="Mode-change notices"
            className="work-mode-mute"
            onClick={() => onSelectNoticesMuted(!noticesMuted)}
            title={
              noticesMuted
                ? "Mode-change notices are muted until this tab closes"
                : "Mode-change notices are shown; muting silences this tab"
            }
          >
            <span className="work-mode-mute-label">Notices</span>
            <span className="work-mode-switch" aria-hidden="true">
              <span className="work-mode-switch-knob" />
            </span>
            <span className="work-mode-mute-state">
              {noticesMuted ? "Muted" : "Shown"}
            </span>
          </button>

          {history.length > 0 ? (
            <section className="work-mode-backlog" aria-labelledby="work-mode-backlog-title">
              <p className="mode-history-title" id="work-mode-backlog-title">
                While notices were muted
              </p>
              <ul className="mode-history-list">
                {history.map((entry, index) => (
                  <li
                    className={`mode-history-row is-${entry.tone}`}
                    key={`${entry.at}-${index}`}
                  >
                    <span className="mode-history-dot" aria-hidden="true" />
                    <div className="mode-history-copy">
                      <p className="mode-history-mode">
                        {entry.label}
                        <span className="mode-history-source">{entry.source}</span>
                        <time className="mode-history-time" dateTime={entry.at}>
                          {formatTimestamp(entry.at, clock)}
                        </time>
                      </p>
                      <p className="mode-history-detail">{entry.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {onClearHistory ? (
                <button
                  type="button"
                  className="mode-history-clear"
                  onClick={onClearHistory}
                >
                  Clear
                </button>
              ) : null}
            </section>
          ) : null}
        </div>
      </details>
    </div>
  );
}
