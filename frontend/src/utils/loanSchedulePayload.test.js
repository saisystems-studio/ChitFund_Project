import test from "node:test";
import assert from "node:assert/strict";
import { toApiDate, chitPreviewPayload, calculateChitEndDate } from "./loanSchedulePayload.js";

test("Chit end date adds the API duration to the chosen start date", () => {
  assert.equal(calculateChitEndDate("2026-09-01", 5, "DAY"), "2026-09-06");
  assert.equal(calculateChitEndDate("2026-09-01", "5", "MONTH"), "2027-02-01");
  assert.equal(calculateChitEndDate("2026-09-01", 2, "YEAR"), "2028-09-01");
  assert.equal(calculateChitEndDate("2026-09-02", 5, "DAY"), "2026-09-07");
  assert.equal(calculateChitEndDate("2026-01-31", 1, "MONTH"), "2026-02-28");
  assert.equal(calculateChitEndDate("2024-02-29", 1, "YEAR"), "2025-02-28");
  assert.equal(calculateChitEndDate("", 5, "DAY"), "");
  assert.equal(calculateChitEndDate("2026-09-01", undefined, "DAY"), "");
  assert.equal(calculateChitEndDate("2026-09-01", 5, undefined), "");
});

test("API dates are ISO, including legacy display-format drafts", () => {
  assert.equal(toApiDate("09/01/2026"), "2026-09-01");
  assert.equal(toApiDate("2026-09-01"), "2026-09-01");
  assert.equal(toApiDate(null), "");
  assert.throws(() => toApiDate("2026-02-30"));
  assert.throws(() => toApiDate("20260901"));
});

test("preview uses selected group details without requiring end date", () => {
  const group = {id: 7, start_date: "2026-09-01", end_date: null, duration: 3,
    duration_type: "MONTH", collection_day: 5, collection_month: null};
  const payload = chitPreviewPayload(group, "", false, ["09/05/2026", null]);
  assert.deepEqual(payload, {chit_group_id: 7, start_date: "2026-09-01", duration: 3,
    duration_type: "MONTH", collection_day: 5, collection_month: null,
    include_sunday: false, blocked_holidays: ["2026-09-05"]});
  assert.equal(chitPreviewPayload(group, "09/02/2026", true, []).start_date, "2026-09-02");
});
