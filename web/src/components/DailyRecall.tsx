import { useCallback, useEffect, useRef, useState } from "react";
import { capturedZoneLabel, formatCapturedStamp, zoneDayKey, type ClockPrefs } from "../clock";
import { renderMarkdown } from "../markdown";
import type { NoteDetail, RecallPick, RecallToday } from "../types";

interface RecallStampProps {
  captured: string | null;
  capturedZone: string | null;
  clock: ClockPrefs;
}

/**
 * The revealed note's recorded time. A note that says which zone it was written
 * in names that origin under the converted stamp, exactly as the reader does,
 * so the recall card cannot imply the note was written in the chosen zone.
 * Exported for its markup test.
 */
export function RecallStamp({ captured, capturedZone, clock }: RecallStampProps) {
  const stamp = formatCapturedStamp(captured, clock, capturedZone ?? undefined);
  const zone = capturedZoneLabel(captured, capturedZone);

  return (
    <p className="recall-stamp" title={captured ?? undefined}>
      {stamp ? `Recorded ${stamp}` : "No captured date recorded"}
      {zone ? (
        <>
          {" "}
          <span className="recall-zone" title={`Captured in ${zone}`}>
            {zone}
          </span>
        </>
      ) : null}
    </p>
  );
}

interface DailyRecallProps {
  /** Resolves `[[wikilink]]` targets inside the revealed note. */
  resolveWikilink: (target: string) => string | null;
  onOpenNote: (path: string) => void;
  /** Changes whenever the vault is rescanned, so the pick can be refreshed. */
  vaultVersion: number;
  /** "Today" is read in this zone, not the machine's or the server's. */
  clock: ClockPrefs;
}

export default function DailyRecall({
  resolveWikilink,
  onOpenNote,
  vaultVersion,
  clock,
}: DailyRecallProps) {
  const [skip, setSkip] = useState(0);
  const [pick, setPick] = useState<RecallPick | null>(null);
  const [total, setTotal] = useState(0);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<NoteDetail | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const day = zoneDayKey(now, clock);

  // Re-render only when the day actually turns over in this zone, so a
  // dashboard left open past midnight picks a new note without a reload.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow((current) => (zoneDayKey(new Date(), clock) === zoneDayKey(current, clock) ? current : new Date()));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [clock]);

  const lastDay = useRef(day);
  useEffect(() => {
    if (lastDay.current === day) return;
    lastDay.current = day;
    setSkip(0);
  }, [day]);

  const load = useCallback(async (nextSkip: number, forDay: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/recall/today?skip=${nextSkip}&date=${encodeURIComponent(forDay)}`, {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as RecallToday & { detail?: string; error?: string };
      if (!response.ok) {
        throw new Error(body.detail ?? body.error ?? `Recall failed (${response.status})`);
      }
      setPick(body.note);
      setTotal(body.total);
      setDate(body.date);
      // A background check that lands on the same note keeps the body the reader
      // already revealed; only a new pick closes it.
      setRevealed((current) =>
        current && body.note && current.path === body.note.path ? current : null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recall unavailable");
      setPick(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(skip, day);
    // A rescan or a zone/day change can change the pick, so refresh with it.
  }, [load, skip, vaultVersion, day]);

  async function reveal() {
    if (!pick) return;
    setRevealing(true);
    try {
      const response = await fetch(`/api/notes/${pick.path.split("/").map(encodeURIComponent).join("/")}`, {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as NoteDetail & { detail?: string };
      if (!response.ok) throw new Error(body.detail ?? `Could not read note (${response.status})`);
      setRevealed(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read note");
    } finally {
      setRevealing(false);
    }
  }

  return (
    <section className="recall" aria-label="Daily recall">
      <div className="recall-head">
        <span className="metric-label">Daily recall</span>
        <span className="rail-tag">{date || day || "today"}</span>
      </div>

      {loading ? <p className="recall-state">Drawing today&apos;s note…</p> : null}

      {!loading && error ? (
        <p className="recall-state recall-state-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && !pick ? (
        <p className="recall-state">The vault is empty, so there is nothing to recall.</p>
      ) : null}

      {!loading && pick ? (
        <>
          <h3 className="recall-title">{pick.title}</h3>

          <div className="recall-tags">
            {pick.tags.length > 0 ? (
              pick.tags.map((tag) => (
                <span key={tag} className="recall-tag">
                  #{tag}
                </span>
              ))
            ) : (
              <span className="recall-tag is-muted">no tags</span>
            )}
          </div>

          {revealed ? (
            <div className="recall-body">
              <RecallStamp
                captured={revealed.captured}
                capturedZone={revealed.capturedZone}
                clock={clock}
              />
              <article className="prose prose-tight">
                {renderMarkdown(revealed.markdown, { resolveWikilink, onOpenNote })}
              </article>
            </div>
          ) : (
            <p className="recall-hint">
              {revealing ? "Reading the note…" : "Reveal to read it, or skip to another note for today."}
            </p>
          )}

          <div className="recall-actions">
            {revealed ? (
              <button type="button" className="action action-primary" onClick={() => onOpenNote(revealed.path)}>
                <span>Open in reader</span>
                <span className="action-hint">↗</span>
              </button>
            ) : (
              <button type="button" className="action action-primary" onClick={() => void reveal()} disabled={revealing}>
                <span>{revealing ? "Revealing…" : "Reveal"}</span>
                <span className="action-hint">{pick.area ?? "note"}</span>
              </button>
            )}

            <button
              type="button"
              className="action"
              onClick={() => {
                setSkip((current) => current + 1);
              }}
              disabled={total <= 1}
              title={total <= 1 ? "Only one note in the vault" : "Pick a different note for today"}
            >
              <span>Skip</span>
              <span className="action-hint">{total > 0 ? `${(skip % total) + 1}/${total}` : "—"}</span>
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
