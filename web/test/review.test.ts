import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewStatus } from "../src/review.js";

describe("reviewStatus", () => {
  it("marks the day itself as due but not overdue", () => {
    assert.deepEqual(reviewStatus("2026-10-21", "2026-10-21"), {
      state: "due-today",
      days: 0,
      label: "Due today",
    });
  });

  it("counts whole days late, singular and plural", () => {
    assert.deepEqual(reviewStatus("2026-10-20", "2026-10-21"), {
      state: "overdue",
      days: 1,
      label: "1 day overdue",
    });
    assert.equal(reviewStatus("2026-10-18", "2026-10-21")?.label, "3 days overdue");
    assert.equal(reviewStatus("2026-10-18", "2026-10-21")?.state, "overdue");
  });

  it("crosses a month boundary without an off-by-one", () => {
    assert.deepEqual(reviewStatus("2026-09-30", "2026-10-01"), {
      state: "overdue",
      days: 1,
      label: "1 day overdue",
    });
  });

  it("keeps a future date scheduled rather than due", () => {
    assert.deepEqual(reviewStatus("2026-10-22", "2026-10-21"), {
      state: "scheduled",
      days: -1,
      label: "Scheduled",
    });
  });

  it("is null when either side is missing or not a real date", () => {
    assert.equal(reviewStatus(null, "2026-10-21"), null);
    assert.equal(reviewStatus(undefined, "2026-10-21"), null);
    assert.equal(reviewStatus("soon", "2026-10-21"), null);
    assert.equal(reviewStatus("2026-02-30", "2026-10-21"), null);
    assert.equal(reviewStatus("2026-10-21", "not-a-day"), null);
  });
});
