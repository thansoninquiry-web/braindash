import type { RefObject } from "react";
import { useRef } from "react";
import { listTimeZones, systemTimeZone, type ClockPrefs } from "../clock";
import { MOTION_OPTIONS, type MotionPref } from "../motion";
import { REFRESH_OPTIONS, type RefreshPref } from "../refresh";
import { THEME_MODE_OPTIONS, THEMES, type Theme, type ThemeId, type ThemeMode } from "../themes";
import { useDialog } from "../useDialog";

/** The five bands a swatch paints, named and valued for non-visual readers. */
function swatchDescription(theme: Theme): string {
  return `Palette: accent ${theme.accent}, bright ${theme.bright}, dim ${theme.dim}, untagged node ${theme.unset}, spark field ${theme.dust}.`;
}

interface SettingsPanelProps {
  open: boolean;
  /** The accent actually painted right now, auto-resolved or manual. */
  theme: ThemeId;
  themeMode: ThemeMode;
  /** Which signal Auto used, e.g. "OS dark · night". */
  autoSource: string;
  onSelectMode: (mode: ThemeMode) => void;
  onSelect: (id: ThemeId) => void;
  motion: MotionPref;
  onSelectMotion: (pref: MotionPref) => void;
  clock: ClockPrefs;
  onSelectTimeZone: (timeZone: string) => void;
  onSelectHour12: (hour12: boolean) => void;
  refresh: RefreshPref;
  onSelectRefresh: (pref: RefreshPref) => void;
  /** Session-only silence for the work/home change notice. */
  noticesMuted: boolean;
  onSelectNoticesMuted: (muted: boolean) => void;
  onClose: () => void;
}

export default function SettingsPanel({
  open,
  theme,
  themeMode,
  autoSource,
  onSelectMode,
  onSelect,
  motion,
  onSelectMotion,
  clock,
  onSelectTimeZone,
  onSelectHour12,
  refresh,
  onSelectRefresh,
  noticesMuted,
  onSelectNoticesMuted,
  onClose,
}: SettingsPanelProps) {
  const panelRef: RefObject<HTMLDivElement | null> = useRef(null);
  const closeRef: RefObject<HTMLButtonElement | null> = useRef(null);
  const zones = listTimeZones();
  const systemZone = systemTimeZone();
  // A stored zone outside the list would otherwise silently show as "System".
  const zoneOptions =
    clock.timeZone && !zones.includes(clock.timeZone)
      ? [clock.timeZone, ...zones].sort()
      : zones;

  useDialog({ open, onClose, panelRef, initialFocusRef: closeRef });

  if (!open) return null;

  return (
    <div
      className="settings-scrim"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-head">
          <div>
            <h2 id="settings-title" className="settings-title">
              Settings
            </h2>
            <p className="settings-sub">Display · stored on this device</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        <section className="settings-section">
          <h3 className="settings-label">Theme source</h3>
          <div className="choice-grid choice-grid-stack" role="radiogroup" aria-label="Theme source">
            {THEME_MODE_OPTIONS.map((option) => {
              const selected = option.id === themeMode;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`choice-option${selected ? " is-selected" : ""}`}
                  onClick={() => onSelectMode(option.id)}
                >
                  <span className="choice-name">{option.label}</span>
                  <span className="choice-hint">{option.hint}</span>
                </button>
              );
            })}
          </div>
          <p className="settings-caption">
            {themeMode === "auto"
              ? `Following ${autoSource} → ${THEMES.find((entry) => entry.id === theme)?.label ?? theme}`
              : "Locked to the accent picked below."}
          </p>
        </section>

        <section className="settings-section">
          <h3 className="settings-label">Accent theme</h3>
          <p className="settings-caption">
            {themeMode === "auto"
              ? "Choosing one switches to Manual. "
              : "Used while the theme source is Manual. "}
            Each swatch previews the palette as painted: accent, bright, dim, untagged node,
            spark field.
          </p>
          <div className="theme-grid" role="radiogroup" aria-label="Accent theme">
            {THEMES.map((option) => {
              const selected = option.id === theme;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-labelledby={`theme-name-${option.id}`}
                  aria-describedby={`theme-palette-${option.id}`}
                  className={`theme-option${selected ? " is-selected" : ""}`}
                  onClick={() => onSelect(option.id)}
                >
                  <span
                    className="theme-swatch"
                    aria-hidden="true"
                    title={`${option.label}: accent · bright · dim · untagged node · spark field`}
                  >
                    <span style={{ background: option.accent }} />
                    <span style={{ background: option.bright }} />
                    <span style={{ background: option.dim }} />
                    {/* The two content colours the cloud actually paints with. */}
                    <span className="is-vault" style={{ background: option.unset }} />
                    <span style={{ background: option.dust }} />
                  </span>
                  <span className="theme-name" id={`theme-name-${option.id}`}>
                    {option.label}
                  </span>
                  {/* Named separately from the swatch so the radio's name stays
                      just "Orange" and the palette follows as its description. */}
                  <span className="sr-only" id={`theme-palette-${option.id}`}>
                    {swatchDescription(option)}
                  </span>
                  {selected ? <span className="theme-check" aria-hidden="true">ACTIVE</span> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-label">Clock</h3>
          <label className="clock-field">
            <span className="clock-field-label">Time zone</span>
            <select
              className="clock-select"
              value={clock.timeZone}
              onChange={(event) => onSelectTimeZone(event.target.value)}
            >
              <option value="">{`System · ${systemZone}`}</option>
              {zoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <div className="choice-grid clock-format" role="radiogroup" aria-label="Clock format">
            <button
              type="button"
              role="radio"
              aria-checked={clock.hour12}
              className={`choice-option${clock.hour12 ? " is-selected" : ""}`}
              onClick={() => onSelectHour12(true)}
            >
              <span className="choice-name">12-hour</span>
              <span className="choice-hint">6:30:05 PM</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!clock.hour12}
              className={`choice-option${!clock.hour12 ? " is-selected" : ""}`}
              onClick={() => onSelectHour12(false)}
            >
              <span className="choice-name">24-hour</span>
              <span className="choice-hint">18:30:05</span>
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-label">Vault refresh</h3>
          <div className="choice-grid" role="radiogroup" aria-label="Vault refresh">
            {REFRESH_OPTIONS.map((option) => {
              const selected = option.id === refresh;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`choice-option${selected ? " is-selected" : ""}`}
                  onClick={() => onSelectRefresh(option.id)}
                >
                  <span className="choice-name">{option.label}</span>
                  <span className="choice-hint">{option.hint}</span>
                </button>
              );
            })}
          </div>
          <p className="settings-caption">
            Checked only while this window is visible, and one small request at a time: the
            notes, graph and recall are re-read only when the vault actually changed, while
            LIFE re-reads on every check so Daily/Monthly edits appear on their own.
          </p>
        </section>

        <section className="settings-section">
          <h3 className="settings-label">Cloud motion</h3>
          <div className="choice-grid" role="radiogroup" aria-label="Cloud motion">
            {MOTION_OPTIONS.map((option) => {
              const selected = option.id === motion;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`choice-option${selected ? " is-selected" : ""}`}
                  onClick={() => onSelectMotion(option.id)}
                >
                  <span className="choice-name">{option.label}</span>
                  <span className="choice-hint">{option.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-label">Mode-change notices</h3>
          <div
            className="choice-grid"
            role="radiogroup"
            aria-label="Mode-change notices"
          >
            {[
              { muted: false, label: "Shown", hint: "A work/home flip gets a short notice" },
              { muted: true, label: "Muted", hint: "Silent; flips collect on the badge" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={noticesMuted === option.muted}
                className={`choice-option${noticesMuted === option.muted ? " is-selected" : ""}`}
                onClick={() => onSelectNoticesMuted(option.muted)}
              >
                <span className="choice-name">{option.label}</span>
                <span className="choice-hint">{option.hint}</span>
              </button>
            ))}
          </div>
          <p className="settings-caption">
            Muting lasts until this tab closes — a new window starts with notices on,
            because a mode flip is worth seeing at least once. The last three flips
            wait on the header badge until you clear them, so muting silences the
            interruption without losing the news.
          </p>
        </section>

        <p className="settings-note">
          Themes only change chrome, glow, and node and spark colors. Auto follows the OS
          light/dark setting by day and the clock by hour; the canvas stays dark
          either way. Clock, motion and refresh are local preferences too. Nothing is
          written to the vault.
        </p>
      </div>
    </div>
  );
}
