import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  NotePathError,
  buildStats,
  captureSeries,
  dayKeyInZone,
  extractKeywords,
  localDayKey,
  parseCaptured,
  parseFrontmatter,
  pickDaily,
  resolveNotePath,
  resolveRecallDate,
  resolveTimeZone,
  scanFingerprint,
  shiftDayKey,
  type NoteMeta,
  type VaultScan,
} from "../src/vault.js";

const ROOT = path.resolve("example-vault");

/** Asserts the request is rejected with the given code and a 400 status. */
function assertRejected(requested: string, code: "invalid_path" | "not_markdown", why: string): void {
  assert.throws(
    () => resolveNotePath(ROOT, requested),
    (error: unknown) => {
      assert.ok(error instanceof NotePathError, `${why}: expected NotePathError for ${JSON.stringify(requested)}`);
      assert.equal(error.code, code, `${why}: code for ${JSON.stringify(requested)}`);
      assert.equal(error.status, 400, `${why}: status for ${JSON.stringify(requested)}`);
      return true;
    },
  );
}

describe("resolveNotePath — accepted paths", () => {
  it("returns an absolute path inside the vault", () => {
    const resolved = resolveNotePath(ROOT, "notes/3-2-1-method.md");
    assert.equal(resolved, path.resolve(ROOT, "notes", "3-2-1-method.md"));
    assert.ok(path.isAbsolute(resolved));
    const inside = path.relative(ROOT, resolved);
    assert.ok(!inside.startsWith("..") && !path.isAbsolute(inside), "resolved path stays inside the vault");
  });

  it("normalises Windows separators to the local separator", () => {
    assert.equal(resolveNotePath(ROOT, "notes\\sub\\note.md"), path.resolve(ROOT, "notes", "sub", "note.md"));
  });

  it("drops redundant dot segments and surrounding whitespace", () => {
    assert.equal(resolveNotePath(ROOT, "  notes/./daily.md  "), path.resolve(ROOT, "notes", "daily.md"));
  });

  it("accepts nested folders and uppercase .MD", () => {
    assert.equal(resolveNotePath(ROOT, "deep/a/b/C.MD"), path.resolve(ROOT, "deep", "a", "b", "C.MD"));
  });
});

describe("resolveNotePath — rejected paths", () => {
  it("rejects empty and whitespace-only paths", () => {
    assertRejected("", "invalid_path", "empty");
    assertRejected("   ", "invalid_path", "whitespace");
  });

  it("rejects absolute paths, home paths and drive letters", () => {
    assertRejected("/etc/passwd.md", "invalid_path", "posix absolute");
    assertRejected("\\etc\\passwd.md", "invalid_path", "windows absolute");
    assertRejected("~/notes/private.md", "invalid_path", "home");
    assertRejected("C:\\Users\\me\\note.md", "invalid_path", "drive");
    assertRejected("C:/Users/me/note.md", "invalid_path", "drive with slashes");
  });

  it("rejects traversal, including traversal that resolves back inside", () => {
    assertRejected("../outside.md", "invalid_path", "parent");
    assertRejected("notes/../../outside.md", "invalid_path", "nested parent");
    assertRejected("notes\\..\\outside.md", "invalid_path", "windows parent");
    assertRejected("notes/../notes/keep.md", "invalid_path", "dot-dot is refused even when it lands inside");
  });

  it("rejects hidden paths and indexed-out directories", () => {
    assertRejected(".obsidian/app.md", "invalid_path", "hidden dir");
    assertRejected("notes/.hidden.md", "invalid_path", "hidden file");
    assertRejected("node_modules/left-pad.md", "invalid_path", "node_modules");
    assertRejected("_assets/cover.md", "invalid_path", "skipped directory");
    assertRejected(".git/notes.md", "invalid_path", "git metadata");
  });

  it("rejects null bytes", () => {
    assertRejected("note\0.md", "invalid_path", "null byte");
  });

  it("rejects anything that is not a markdown note", () => {
    assertRejected("notes/readme.txt", "not_markdown", "text file");
    assertRejected("notes/readme", "not_markdown", "extensionless");
    assertRejected("notes/", "not_markdown", "directory");
    assertRejected("notes/readme.md.bak", "not_markdown", "backup file");
  });
});

describe("resolveRecallDate", () => {
  it("accepts the client's calendar day unchanged", () => {
    assert.equal(resolveRecallDate("2026-10-19"), "2026-10-19");
    assert.equal(resolveRecallDate(" 2026-01-01 "), "2026-01-01");
    assert.equal(resolveRecallDate("2024-02-29"), "2024-02-29", "a leap day is real");
  });

  it("rejects anything that is not a real calendar date", () => {
    assert.equal(resolveRecallDate(undefined), null);
    assert.equal(resolveRecallDate(20261019), null);
    assert.equal(resolveRecallDate(["2026-10-19"]), null);
    assert.equal(resolveRecallDate("2026-10-19T00:00:00Z"), null);
    assert.equal(resolveRecallDate("19/10/2026"), null);
    assert.equal(resolveRecallDate("yesterday"), null);
    assert.equal(resolveRecallDate("2026-13-01"), null, "month 13");
    assert.equal(resolveRecallDate("2026-02-30"), null, "February has no 30th");
    assert.equal(resolveRecallDate("2023-02-29"), null, "2023 is not a leap year");
    assert.equal(resolveRecallDate("0000-01-01"), null, "year zero");
  });
});

describe("pickDaily", () => {
  const notes = ["a.md", "b.md", "c.md", "d.md"].map((file) => ({
    path: file,
    title: file.replace(/\.md$/, ""),
    captured: null,
    origin: null,
    area: null,
    tags: [],
    words: 0,
    bytes: 0,
    keywords: [],
    links: [],
  }));
  const scan = { notes } as unknown as Parameters<typeof pickDaily>[0];

  it("seeds the same note all day and moves across days", () => {
    const first = pickDaily(scan, "2026-10-19");
    assert.ok(first);
    assert.deepEqual(pickDaily(scan, "2026-10-19"), first, "stable for the same key");
    // A hash can collide for two adjacent days, so assert the date matters
    // across a week rather than for one particular pair.
    const across = new Set(
      Array.from({ length: 7 }, (_, index) =>
        pickDaily(scan, `2026-10-${String(19 + index).padStart(2, "0")}`)?.path,
      ),
    );
    assert.ok(across.size > 1, "the day key changes the pick");
  });

  it("wraps the skip offset and never leaves the vault", () => {
    for (const skip of [0, 1, 4, 9]) {
      const pick = pickDaily(scan, "2026-10-19", skip);
      assert.ok(pick && notes.some((note) => note.path === pick.path));
    }
    assert.equal(
      pickDaily(scan, "2026-10-19", 4)?.path,
      pickDaily(scan, "2026-10-19", 0)?.path,
      "a full turn comes back to the same note",
    );
  });

  it("reads the local day key from a date", () => {
    assert.equal(localDayKey(new Date(2026, 9, 19, 23, 30)), "2026-10-19");
    assert.equal(localDayKey(new Date(2026, 0, 1, 0, 0)), "2026-01-01");
  });
});

/** The fields the dashboard's refresh gate depends on. */
function note(path: string, overrides: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path,
    title: path.replace(/\.md$/, ""),
    captured: null,
    capturedZone: null,
    nextReview: null,
    origin: null,
    area: null,
    words: 10,
    bytes: 100,
    keywords: ["alpha", "beta"],
    tags: ["notes"],
    links: [],
    frontmatter: "",
    ...overrides,
  };
}

describe("scanFingerprint", () => {
  it("is stable for the same vault, whatever order the notes arrive in", () => {
    const notes = [note("a.md"), note("b.md"), note("c.md")];
    const first = scanFingerprint(notes);
    assert.equal(scanFingerprint([...notes].reverse()), first);
    assert.equal(scanFingerprint([...notes]), first);
    assert.match(first, /^[0-9a-f]{8}$/);
  });

  it("moves when a note's content or metadata changes", () => {
    const base = scanFingerprint([note("a.md"), note("b.md")]);
    const variants: Partial<NoteMeta>[] = [
      { bytes: 101 },
      { title: "Renamed" },
      { captured: "2026-10-19 3:38 PM" },
      { capturedZone: "Asia/Tokyo" },
      { area: "ideas" },
      { origin: "ai" },
      { tags: ["notes", "extra"] },
      { keywords: ["alpha", "gamma"] },
    ];
    for (const change of variants) {
      const changed = scanFingerprint([note("a.md", change), note("b.md")]);
      assert.notEqual(changed, base, `${JSON.stringify(change)} must change the fingerprint`);
    }
  });

  it("moves when a note is added or removed", () => {
    const base = scanFingerprint([note("a.md")]);
    assert.notEqual(scanFingerprint([note("a.md"), note("b.md")]), base);
    assert.notEqual(scanFingerprint([]), base);
  });
});

describe("extractKeywords", () => {
  it("ranks by frequency, then alphabetically for ties", () => {
    assert.deepEqual(extractKeywords("zebra apple zebra apple zebra kiwi"), ["zebra", "apple", "kiwi"]);
    assert.deepEqual(extractKeywords("beta beta alpha alpha gamma"), ["alpha", "beta", "gamma"]);
  });

  it("honours the limit, defaulting to six", () => {
    const text = "alpha alpha beta beta gamma gamma delta epsilon zeta";
    assert.deepEqual(extractKeywords(text, 2), ["alpha", "beta"]);
    assert.deepEqual(extractKeywords(text), ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]);
  });

  it("drops stopwords and words shorter than four characters", () => {
    assert.deepEqual(extractKeywords("about about about because because cat cats"), ["cats"]);
  });

  it("is case-insensitive and trims punctuation around tokens", () => {
    assert.deepEqual(extractKeywords("Rust RUST rust"), ["rust"]);
    assert.deepEqual(extractKeywords("'quoted' quoted"), ["quoted"]);
  });

  it("keeps hyphenated words whole", () => {
    assert.deepEqual(extractKeywords("state-of-the-art state-of-the-art"), ["state-of-the-art"]);
  });

  it("never reads keywords out of frontmatter, fenced code or inline code", () => {
    const raw = [
      "---",
      "tags: [secretword]",
      "title: Secretword",
      "---",
      "",
      "`secretword`",
      "",
      "```ts",
      "const secretword = 'secretword';",
      "```",
      "",
      "visiblewords repeated repeated",
    ].join("\n");
    assert.deepEqual(extractKeywords(raw), ["repeated", "visiblewords"]);
  });

  it("returns an empty list when there is nothing to rank", () => {
    assert.deepEqual(extractKeywords(""), []);
    assert.deepEqual(extractKeywords("a an of the"), []);
  });

  it("is deterministic between calls", () => {
    const text = "gamma beta alpha gamma beta alpha delta";
    assert.deepEqual(extractKeywords(text), extractKeywords(text));
  });
});

const ZONE_NOW = new Date("2026-10-19T11:43:00Z");

describe("parseFrontmatter — malformed blocks", () => {
  it("treats an unterminated block as no frontmatter", () => {
    assert.deepEqual(parseFrontmatter("---\ntitle: Draft\nstill prose"), {
      fields: {},
      tags: [],
      block: "",
    });
  });

  it("skips a line that is neither a field nor a list item, and keeps parsing after it", () => {
    const parsed = parseFrontmatter("---\ntitle: Kept\nnot a field\narea: life\n---\nBody");
    assert.equal(parsed.fields.title, "Kept");
    assert.equal(parsed.fields.area, "life", "a malformed line does not stop the rest of the block");
    assert.equal(parsed.block, "title: Kept\nnot a field\narea: life");
  });
});

describe("parseCaptured — meridiem and unparseable stamps", () => {
  it("reads midnight and noon from the meridiem", () => {
    const midnight = parseCaptured("2026-10-19 12:30 AM");
    const noon = parseCaptured("2026-10-19 12:30 PM");
    assert.equal(midnight?.getHours(), 0);
    assert.equal(midnight?.getMinutes(), 30);
    assert.equal(noon?.getHours(), 12);
    assert.equal(noon?.getMinutes(), 30);
    assert.equal(parseCaptured("2026-10-19 12:00 am")?.getHours(), 0, "the meridiem is case-insensitive");
  });

  it("returns null for an empty or unreadable stamp", () => {
    assert.equal(parseCaptured(null), null);
    assert.equal(parseCaptured(""), null);
    assert.equal(parseCaptured("somewhen"), null);
  });
});

describe("zone-aware day keys", () => {
  it("reads the same instant as a different calendar day per zone", () => {
    assert.equal(dayKeyInZone(ZONE_NOW, "Pacific/Honolulu"), "2026-10-19");
    assert.equal(dayKeyInZone(ZONE_NOW, "America/New_York"), "2026-10-19");
    assert.equal(dayKeyInZone(ZONE_NOW, "Pacific/Kiritimati"), "2026-10-20");
    assert.equal(dayKeyInZone(ZONE_NOW, "Mars/Olympus_Mons"), null);
  });

  it("shifts keys across month and year ends without DST drift", () => {
    assert.equal(shiftDayKey("2026-12-31", 1), "2027-01-01");
    assert.equal(shiftDayKey("2026-03-01", -1), "2026-02-28");
    assert.equal(shiftDayKey("2024-03-01", -1), "2024-02-29");
    assert.equal(shiftDayKey("not-a-day", 3), "not-a-day");
  });

  it("accepts real IANA zones and rejects the rest", () => {
    assert.equal(resolveTimeZone("Asia/Tokyo"), "Asia/Tokyo");
    assert.equal(resolveTimeZone(" UTC "), "UTC");
    assert.equal(resolveTimeZone(""), null);
    assert.equal(resolveTimeZone("Mars/Olympus_Mons"), null);
    assert.equal(resolveTimeZone("Asia/Tokyo".padEnd(80, "x")), null, "absurdly long input");
    assert.equal(resolveTimeZone(42), null);
    assert.equal(resolveTimeZone(undefined), null);
  });
});

describe("captureSeries — the chosen zone", () => {
  it("ends its window on that zone's today", () => {
    const notes = [note("a.md")];
    assert.deepEqual(
      captureSeries(notes, 3, { timeZone: "Pacific/Honolulu", now: ZONE_NOW }).map((point) => point.date),
      ["2026-10-17", "2026-10-18", "2026-10-19"],
    );
    assert.deepEqual(
      captureSeries(notes, 3, { timeZone: "Pacific/Kiritimati", now: ZONE_NOW }).map((point) => point.date),
      ["2026-10-18", "2026-10-19", "2026-10-20"],
    );
  });

  it("keeps a bare date on the day it was written, in any zone", () => {
    const bare = [note("bare.md", { captured: "2026-10-18", capturedZone: "Pacific/Kiritimati" })];
    assert.deepEqual(captureSeries(bare, 3, { timeZone: "Pacific/Kiritimati", now: ZONE_NOW }), [
      { date: "2026-10-18", count: 1 },
      { date: "2026-10-19", count: 0 },
      { date: "2026-10-20", count: 0 },
    ]);
  });

  it("buckets a timed capture by the instant in that zone", () => {
    const stamp = "2026-10-18 11:30 PM";
    const instant = parseCaptured(stamp);
    assert.ok(instant);
    // Kiritimati is a fixed UTC+14, so adding 14h is an independent expectation.
    const wall = new Date(instant.getTime() + 14 * 3_600_000);
    const expected = `${wall.getUTCFullYear()}-${String(wall.getUTCMonth() + 1).padStart(2, "0")}-${String(
      wall.getUTCDate(),
    ).padStart(2, "0")}`;
    const series = captureSeries([note("late.md", { captured: stamp })], 4, {
      timeZone: "Pacific/Kiritimati",
      now: ZONE_NOW,
    });
    assert.equal(series.find((point) => point.count === 1)?.date, expected);
  });

  it("reads a timed stamp in the zone the note recorded", () => {
    const series = captureSeries(
      [note("late.md", { captured: "2026-10-18 11:30 PM", capturedZone: "Pacific/Kiritimati" })],
      4,
      // The display zone is Honolulu, but 23:30 in UTC+14 is 23:30 on the 17th
      // there. The note's zone wins over the global recordedZone too.
      { timeZone: "Pacific/Honolulu", now: ZONE_NOW, recordedZone: "America/New_York" },
    );
    assert.deepEqual(
      series.map((point) => [point.date, point.count]),
      [
        ["2026-10-16", 0],
        ["2026-10-17", 1],
        ["2026-10-18", 0],
        ["2026-10-19", 0],
      ],
    );
  });

  it("falls back to the server clock for a missing or unknown zone", () => {
    const notes = [
      note("a.md", { captured: "2026-10-18 3:38 PM" }),
      note("b.md", { captured: "2026-10-18" }),
    ];
    const local = captureSeries(notes, 3, { now: ZONE_NOW });
    assert.deepEqual(captureSeries(notes, 3, { now: ZONE_NOW, timeZone: null }), local);
    assert.deepEqual(captureSeries(notes, 3, { now: ZONE_NOW, timeZone: "Mars/Olympus_Mons" }), local);
  });

  it("falls back to local time when the recorded origin is not a real zone", () => {
    const notes = [note("a.md", { captured: "2026-10-18 3:38 PM" })];
    const local = captureSeries(notes, 3, { now: ZONE_NOW });
    assert.deepEqual(
      captureSeries(notes, 3, { now: ZONE_NOW, recordedZone: "Mars/Olympus_Mons" }),
      local,
      "a bad recorded zone must not lose the capture",
    );
  });

  it("ignores captures outside the window and values it cannot parse", () => {
    const series = captureSeries(
      [note("old.md", { captured: "2020-01-01" }), note("bad.md", { captured: "somewhen" })],
      3,
      { timeZone: "UTC", now: ZONE_NOW },
    );
    assert.deepEqual(series.map((point) => point.count), [0, 0, 0]);
  });

  it("returns nothing for a non-positive or non-finite window", () => {
    assert.deepEqual(captureSeries([note("a.md")], 0), []);
    assert.deepEqual(captureSeries([note("a.md")], Number.NaN), []);
  });
});

describe("buildStats — the chosen zone", () => {
  it("orders the latest capture by each note's recorded zone", () => {
    const scan = {
      vaultPath: "/vault",
      scannedAt: "2026-10-19T00:00:00.000Z",
      notes: [
        note("early.md", {
          title: "Early",
          captured: "2026-10-18 11:30 PM",
          capturedZone: "Pacific/Kiritimati",
        }),
        note("late.md", {
          title: "Late",
          captured: "2026-10-18 8:00 PM",
          capturedZone: "America/New_York",
        }),
      ],skipped: [],unreadable: [],
      bodies: new Map<string, string>(),
    } satisfies VaultScan;
    const stats = buildStats(scan, { timeZone: "UTC", now: ZONE_NOW });
    // 23:30 UTC+14 is 09:30Z; 20:00 EDT is 00:00Z the next day, so the later
    // written clock is the earlier instant. Read locally, "Early" would win.
    assert.equal(stats.lastCapture?.title, "Late");
    assert.equal(stats.lastCapture?.capturedZone, "America/New_York");
  });

  it("passes the zone to the series and its 30-day total", () => {
    const scan = {
      vaultPath: "/vault",
      scannedAt: "2026-10-19T00:00:00.000Z",
      notes: [note("a.md", { captured: "2026-10-18 3:38 PM" }), note("b.md")],skipped: [],unreadable: [],
      bodies: new Map<string, string>(),
    } satisfies VaultScan;
    const stats = buildStats(scan, { timeZone: "Pacific/Kiritimati", now: ZONE_NOW });
    assert.equal(stats.series.length, 30);
    assert.equal(stats.series.at(-1)?.date, "2026-10-20");
    assert.equal(
      stats.captures30d,
      stats.series.reduce((sum, point) => sum + point.count, 0),
    );
  });
});
