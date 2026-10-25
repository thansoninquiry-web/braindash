import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCaptureSeries,
  capturedDayKey,
  capturedZoneLabel,
  formatCapturedDay,
  formatCapturedStamp,
  formatDateKey,
  parseCapturedStamp,
  shiftDayKey,
  zoneDayKey,
  type ClockPrefs,
} from "../src/clock.js";

function prefs(timeZone: string): ClockPrefs {
  return { timeZone, hour12: true };
}

/** 2026-10-19T03:30:00Z — late evening on the 18th in New York. */
const LATE_NY = new Date("2026-10-19T03:30:00Z");

describe("parseCapturedStamp", () => {
  it("reads the vault's wall-clock shapes", () => {
    assert.deepEqual(parseCapturedStamp("2026-10-18 3:38 PM"), {
      year: 2026,
      month: 10,
      day: 18,
      hour: 15,
      minute: 38,
    });
    assert.deepEqual(parseCapturedStamp("2026-10-18 15:38"), {
      year: 2026,
      month: 10,
      day: 18,
      hour: 15,
      minute: 38,
    });
    assert.deepEqual(parseCapturedStamp("2026-10-18"), {
      year: 2026,
      month: 10,
      day: 18,
      hour: null,
      minute: null,
    });
  });

  it("handles noon and midnight in 12-hour form", () => {
    assert.equal(parseCapturedStamp("2026-10-18 12:00 AM")?.hour, 0);
    assert.equal(parseCapturedStamp("2026-10-18 12:00 PM")?.hour, 12);
    assert.equal(parseCapturedStamp("2026-10-18 1:05 am")?.hour, 1);
  });

  it("rejects impossible or unreadable stamps", () => {
    assert.equal(parseCapturedStamp(null), null);
    assert.equal(parseCapturedStamp(""), null);
    assert.equal(parseCapturedStamp("yesterday"), null);
    assert.equal(parseCapturedStamp("2026-13-01"), null);
    assert.equal(parseCapturedStamp("2026-02-30"), null);
    assert.equal(parseCapturedStamp("2026-10-18 25:00"), null);
  });
});

describe("formatCapturedStamp", () => {
  it("shows a recorded wall clock in the selected zone", () => {
    assert.equal(
      formatCapturedStamp(
        "2026-10-18 3:38 PM",
        { timeZone: "America/New_York", hour12: true },
        "America/New_York",
      ),
      "Oct 18, 2026 · 3:38 PM EDT",
    );
  });

  it("converts between the recording zone and the selected zone", () => {
    assert.equal(
      formatCapturedStamp(
        "2026-10-18 3:38 PM",
        { timeZone: "America/New_York", hour12: true },
        "Asia/Tokyo",
      ),
      "Oct 18, 2026 · 2:38 AM EDT",
    );
    assert.equal(
      formatCapturedStamp(
        "2026-10-18 11:30 PM",
        { timeZone: "Asia/Tokyo", hour12: true },
        "America/New_York",
      ),
      "Oct 19, 2026 · 12:30 PM GMT+9",
    );
  });

  it("follows the hour cycle", () => {
    assert.equal(
      formatCapturedStamp(
        "2026-10-18 3:38 PM",
        { timeZone: "America/New_York", hour12: false },
        "America/New_York",
      ),
      "Oct 18, 2026 · 15:38 EDT",
    );
  });

  it("keeps a date-only stamp on its own day in any zone", () => {
    for (const zone of ["Pacific/Honolulu", "Asia/Tokyo", "UTC"]) {
      assert.equal(
        formatCapturedStamp("2026-10-18", { timeZone: zone, hour12: true }, "America/New_York"),
        "Oct 18, 2026",
      );
    }
  });

  it("returns null for an unreadable stamp so callers can show the raw value", () => {
    assert.equal(formatCapturedStamp("somewhen", { timeZone: "", hour12: true }), null);
    assert.equal(formatCapturedStamp(null, { timeZone: "", hour12: true }), null);
  });
});

describe("capturedZoneLabel", () => {
  it("names the zone a timed capture was recorded in", () => {
    assert.equal(capturedZoneLabel("2026-10-18 3:38 PM", "America/New_York"), "America/New_York");
    assert.equal(capturedZoneLabel("2026-10-18 23:38", "Asia/Tokyo"), "Asia/Tokyo");
  });

  it("stays absent for a date-only stamp, even when a zone was recorded", () => {
    assert.equal(capturedZoneLabel("2026-10-18", "America/New_York"), null);
  });

  it("stays absent without a recorded zone or a readable stamp", () => {
    assert.equal(capturedZoneLabel("2026-10-18 3:38 PM", null), null);
    assert.equal(capturedZoneLabel("2026-10-18 3:38 PM", undefined), null);
    assert.equal(capturedZoneLabel("somewhen", "America/New_York"), null);
    assert.equal(capturedZoneLabel(null, "UTC"), null);
  });
});

describe("formatCapturedDay", () => {
  it("moves the day with the zone when a time is recorded", () => {
    assert.equal(
      formatCapturedDay(
        "2026-10-18 11:30 PM",
        { timeZone: "Asia/Tokyo", hour12: true },
        "America/New_York",
      ),
      "OCT 19",
    );
    assert.equal(
      formatCapturedDay(
        "2026-10-18 11:30 PM",
        { timeZone: "America/New_York", hour12: true },
        "America/New_York",
      ),
      "OCT 18",
    );
  });

  it("keeps a date-only stamp fixed", () => {
    assert.equal(
      formatCapturedDay("2026-10-18", { timeZone: "Pacific/Honolulu", hour12: true }),
      "OCT 18",
    );
    assert.equal(formatCapturedDay(null, { timeZone: "", hour12: true }), null);
  });
});

describe("formatDateKey", () => {
  it("renders a zone-free date key as a readable day", () => {
    assert.equal(formatDateKey("2026-10-19"), "MON, OCT 19, 2026");
    assert.equal(formatDateKey("2026-01-05"), "MON, JAN 05, 2026");
  });

  it("does not drift for a key in a zone behind UTC", () => {
    // A key parsed at local midnight would show the 18th in Honolulu; noon UTC
    // keeps the written day.
    assert.equal(formatDateKey("2026-10-19"), "MON, OCT 19, 2026");
    assert.equal(formatDateKey("2026-03-01"), "SUN, MAR 01, 2026");
  });

  it("returns null for anything that is not a date key", () => {
    assert.equal(formatDateKey(null), null);
    assert.equal(formatDateKey(""), null);
    assert.equal(formatDateKey("today"), null);
    assert.equal(formatDateKey("2026-02-30"), null);
  });
});

describe("zoneDayKey", () => {
  it("reads the day in the chosen zone, not the machine's", () => {
    assert.equal(zoneDayKey(LATE_NY, prefs("America/New_York")), "2026-10-18");
    assert.equal(zoneDayKey(LATE_NY, prefs("UTC")), "2026-10-19");
    assert.equal(zoneDayKey(LATE_NY, prefs("Asia/Tokyo")), "2026-10-19");
    assert.equal(zoneDayKey(LATE_NY, prefs("Pacific/Honolulu")), "2026-10-18");
  });

  it("moves the day at the zone's own midnight", () => {
    const justBefore = new Date("2026-10-19T03:59:00Z"); // 23:59 EDT on the 18th
    const justAfter = new Date("2026-10-19T04:01:00Z"); // 00:01 EDT on the 19th
    assert.equal(zoneDayKey(justBefore, prefs("America/New_York")), "2026-10-18");
    assert.equal(zoneDayKey(justAfter, prefs("America/New_York")), "2026-10-19");
  });

  it("keeps the local order and padding, including single-digit months", () => {
    assert.equal(zoneDayKey(new Date("2026-01-05T12:00:00Z"), prefs("UTC")), "2026-01-05");
  });

  it("falls back to the system day for an unknown zone", () => {
    const key = zoneDayKey(LATE_NY, prefs("Mars/Olympus_Mons"));
    assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("treats an empty zone as the system zone", () => {
    assert.match(zoneDayKey(LATE_NY, prefs("")), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("handles a daylight-saving boundary without skipping a day", () => {
    // US DST ends 2026-11-01; the 02:00 hour repeats but the day must not.
    const keys = [
      "2026-11-01T04:00:00Z",
      "2026-11-01T05:00:00Z",
      "2026-11-01T06:00:00Z",
      "2026-11-01T07:00:00Z",
    ].map((iso) => zoneDayKey(new Date(iso), prefs("America/New_York")));
    assert.deepEqual(keys, ["2026-11-01", "2026-11-01", "2026-11-01", "2026-11-01"]);
  });
});

describe("shiftDayKey", () => {
  it("walks calendar days across month, year and DST boundaries", () => {
    assert.equal(shiftDayKey("2026-10-19", -1), "2026-10-18");
    assert.equal(shiftDayKey("2026-03-01", -1), "2026-02-28");
    assert.equal(shiftDayKey("2026-12-31", 1), "2027-01-01");
    // DST starts 2026-03-08 in New York; the next key is still the 9th.
    assert.equal(shiftDayKey("2026-03-08", 1), "2026-03-09");
    assert.equal(shiftDayKey("2026-03-08", 30), "2026-04-07");
  });

  it("leaves a malformed key alone", () => {
    assert.equal(shiftDayKey("today", 1), "today");
  });
});

describe("capturedDayKey", () => {
  it("moves a timed stamp to the day it falls on in the chosen zone", () => {
    assert.equal(
      capturedDayKey(
        "2026-10-18 11:30 PM",
        { timeZone: "Asia/Tokyo", hour12: true },
        "America/New_York",
      ),
      "2026-10-19",
    );
    assert.equal(
      capturedDayKey(
        "2026-10-18 11:30 PM",
        { timeZone: "America/New_York", hour12: true },
        "America/New_York",
      ),
      "2026-10-18",
    );
  });

  it("keeps a date-only stamp on its own day", () => {
    assert.equal(
      capturedDayKey("2026-10-06", { timeZone: "Pacific/Honolulu", hour12: true }),
      "2026-10-06",
    );
  });

  it("returns null for an unreadable stamp", () => {
    assert.equal(capturedDayKey(null, prefs("")), null);
    assert.equal(capturedDayKey("somewhen", prefs("")), null);
  });
});

describe("buildCaptureSeries", () => {
  it("ends the window on today in the chosen zone and buckets by its day", () => {
    // 03:30 UTC on the 19th is still the 18th in New York and the 19th in Tokyo.
    const series = buildCaptureSeries(
      ["2026-10-18 3:38 PM", "2026-10-18 3:38 PM", "2026-10-18 11:30 PM", "2026-10-06"],
      { timeZone: "Asia/Tokyo", hour12: true },
      30,
      LATE_NY,
      "America/New_York",
    );
    assert.equal(series.length, 30);
    assert.equal(series[0]?.date, "2026-09-20");
    assert.equal(series[series.length - 1]?.date, "2026-10-19");
    // 3:38 PM EDT is 4:38 AM JST on the 19th; 11:30 PM EDT is the 19th too.
    assert.equal(series[series.length - 1]?.count, 3);
    // The date-only capture stays on the 6th rather than drifting to the 7th.
    assert.equal(series.find((point) => point.date === "2026-10-06")?.count, 1);
    assert.equal(series.find((point) => point.date === "2026-10-18")?.count, 0);
  });

  it("reads each entry in its own recorded zone", () => {
    const series = buildCaptureSeries(
      [
        { captured: "2026-10-18 11:30 PM", zone: "Pacific/Kiritimati" },
        { captured: "2026-10-18 11:30 PM" },
        { captured: "2026-10-18", zone: "Pacific/Kiritimati" },
        { captured: "2026-10-18 11:30 PM", zone: "Mars/Olympus_Mons" },
      ],
      { timeZone: "Pacific/Honolulu", hour12: true },
      4,
      LATE_NY,
      "America/New_York",
    );
    assert.deepEqual(series, [
      { date: "2026-10-15", count: 0 },
      { date: "2026-10-16", count: 0 },
      // 23:30 in UTC+14 is 23:30 on the 17th in UTC-10.
      { date: "2026-10-17", count: 1 },
      // The untimed note keeps its written day; the note with no zone uses
      // New York, and the invalid zone falls back there too.
      { date: "2026-10-18", count: 3 },
    ]);
  });

  it("keeps one bucket per calendar day across a DST change", () => {
    const series = buildCaptureSeries(
      [],
      { timeZone: "America/New_York", hour12: true },
      40,
      new Date("2026-11-05T12:00:00Z"),
      "America/New_York",
    );
    assert.equal(series.length, 40);
    assert.equal(series[0]?.date, "2026-09-27");
    assert.equal(series[39]?.date, "2026-11-05");
    assert.equal(new Set(series.map((point) => point.date)).size, 40);
    assert.equal(series.every((point) => point.count === 0), true);
  });

  it("returns an empty series for a non-positive window", () => {
    assert.deepEqual(buildCaptureSeries([], prefs("UTC"), 0), []);
  });
});
