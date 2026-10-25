import { useEffect, useState } from "react";
import {
  formatClockDate,
  formatClockTime,
  timeZoneAbbreviation,
  type ClockPrefs,
} from "../clock";

interface ClockProps {
  prefs: ClockPrefs;
}

export default function Clock({ prefs }: ClockProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="clock" role="timer" aria-live="off">
      <span className="clock-time">{formatClockTime(now, prefs)}</span>
      <span className="clock-meta">
        <span className="clock-date">{formatClockDate(now, prefs)}</span>
        <span className="clock-zone">{timeZoneAbbreviation(now, prefs)}</span>
      </span>
    </div>
  );
}
