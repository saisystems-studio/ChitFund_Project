import test from "node:test";
import assert from "node:assert/strict";
import { creationDate, fetchAllPages, filterPendingRows, overdueDays } from "./pendingReport.js";

const today = "2026-09-28";
const rows = [
  { loan_no: "L1", customer_code: "C1", customer: "One", due_date: "2026-09-16", balance: "50.00", status: "OVERDUE" },
  { loan_no: "L2", customer_code: "C2", customer: "Two", due_date: today, balance: "70.00", status: "UPCOMING" },
  { loan_no: "L1", customer_code: "C1", due_date: "2026-09-29", balance: "90.00", status: "UPCOMING" },
  { loan_no: "L1", customer_code: "C1", due_date: "2026-09-10", balance: "0.00", status: "PAID" },
];
test("includes previous and today's dues, with future dues only at an explicit cutoff", () => {
  assert.deepEqual(filterPendingRows(rows, {}, today), rows.slice(0, 2));
  assert.deepEqual(filterPendingRows(rows, { to: "2026-12-31" }, today), rows.slice(0, 3));
});
test("filters work individually and together without changing amounts", () => {
  assert.deepEqual(filterPendingRows(rows, {customer_code:"C1"}, today), [rows[0]]);
  assert.deepEqual(filterPendingRows(rows, {loan_number:"L1"}, today), [rows[0]]);
  for (const filters of [{ status: "OVERDUE" }, { from: "2026-09-16", to: "2026-09-16" }, { customer_code: "C1", loan_number: "L1", status: "OVERDUE", from: "2026-09-01", to: today }]) {
    assert.deepEqual(filterPendingRows(rows, filters, today), [rows[0]]);
  }
  assert.deepEqual(filterPendingRows(rows, { customer_code: "C1", loan_number: "L2" }, today), []);
  assert.deepEqual(filterPendingRows(rows, { status: "PENDING" }, today), [rows[1]]);
});
test("overdue days use calendar due dates including leap years", () => {
  assert.equal(overdueDays("2026-09-16", today), 12);
  assert.equal(overdueDays(today, today), 0);
  assert.equal(overdueDays("2026-09-29", today), 0);
  assert.equal(overdueDays("2024-02-28", "2024-03-01"), 2);
});

test("creation date uses the stored timestamp and never substitutes today", () => {
  assert.equal(creationDate("2026-09-03T12:00:00"), "03/09/2026");
  assert.equal(creationDate(null), "—");
});

test("all saved entries are loaded across API pages", async () => {
  const pages = {
    "/entries/": { results: [{ id: 1 }], next: "/entries/?page=2" },
    "/entries/?page=2": { results: [{ id: 2 }], next: null },
  };
  const api = { get: async url => ({ data: pages[url] }) };
  assert.deepEqual(await fetchAllPages(api, "/entries/", {}), [{ id: 1 }, { id: 2 }]);
});

test("partially paid future due remains excluded before its due date", () => {
 const row={due_date:"2026-11-05",scheduled:5000,paid:1000,balance:4000,status:"PARTIAL"};
 assert.deepEqual(filterPendingRows([row],{},"2026-10-15"),[]);
 assert.deepEqual(filterPendingRows([row],{to:"2026-10-15"},"2026-10-15"),[]);
});

test("eligible future cutoff shows the partial balance",()=>{const row={due_date:"2026-11-05",balance:4000,paid:1000,status:"PARTIAL"};assert.deepEqual(filterPendingRows([row],{to:"2026-11-05"},"2026-10-15"),[row]);});

test("all pending includes future balances without treating them as overdue", () => {
 assert.deepEqual(filterPendingRows(rows,{scope:"all_pending",to:today},today),rows.slice(0,3));
 assert.deepEqual(filterPendingRows(rows,{scope:"all_pending",status:"OVERDUE",to:today},today),[rows[0]]);
});
