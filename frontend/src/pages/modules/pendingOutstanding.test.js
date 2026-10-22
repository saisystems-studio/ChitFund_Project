import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, exportTable, ledgerLines, queryParams } from "./pendingOutstanding.js";

const party = { party_name: "Party A", opening: "0.00", opening_type: "DR", total_debit: "25000", total_credit: "5000", closing: "20000", closing_type: "DR",
  rows: [{ voucher_date: "2026-04-01", due_date: "2026-04-01", particulars: "Due 1", voucher_no: "CH-1", debit: "10000", credit: "0", balance: "10000", balance_type: "DR" },
    { voucher_date: "2026-04-02", due_date: null, particulars: "Collection", voucher_no: "RV-000001", debit: "0", credit: "5000", balance: "5000", balance_type: "DR" }] };

test("query: multiple view sends a range, individual view a single date, blank party = all", () => {
  assert.deepEqual(queryParams({ ...DEFAULTS, from: "2026-04-01", to: "2026-04-30" }), { view: "multiple", basis: "voucher", sort: "overdue", parties: undefined, date: undefined, from: "2026-04-01", to: "2026-04-30" });
  const one = queryParams({ ...DEFAULTS, view: "individual", date: "2026-04-02", from: "2026-04-01", parties: [3, 4] });
  assert.deepEqual([one.date, one.from, one.to, one.parties], ["2026-04-02", undefined, undefined, "3,4"]);
});

test("individual lines: opening, numbered postings, subtotal, per party", () => {
  const lines = ledgerLines([party]);
  assert.deepEqual(lines.map(line => line.kind), ["opening", "row", "row", "subtotal"]);
  assert.deepEqual(lines.filter(line => line.kind === "row").map(line => line.serial), [1, 2]);
});

test("exports follow the active view: DR / CR / Balance for ledger, Due / Paid / Pending for due-wise", () => {
  const ledger = exportTable({ view: "individual", parties: [party], totals: { debit: "25000", credit: "5000" } });
  assert.deepEqual(ledger.columns.slice(-3).map(column => column.header), ["DR", "CR", "Balance"]);
  assert.equal(ledger.rows.length, 2);
  assert.match(ledger.summary[2][2], /20,000\.00 Dr/);
  const due = exportTable({ view: "multiple", rows: [{ party_name: "A", voucher_date: "2026-04-01", due_date: "2026-04-02", voucher_no: "CH-1", due_amount: "10000", paid: "5000", pending: "5000", overdue_days: 3 }], totals: { due: "10000", paid: "5000", pending: "5000" } });
  assert.deepEqual(due.columns.slice(5, 8).map(column => column.header), ["Due Amount", "Paid", "Pending"]);
  assert.equal(due.rows[0][8], "3");
});
