import test from "node:test";
import assert from "node:assert/strict";
import { findNode, groupModel, loanModel, voucherModel } from "./detailModels.js";

test("voucher model keeps only the fields that exist and totals the postings", () => {
  const model = voucherModel({ voucher_type: "Payment Entry", voucher_no: "PV-000003", date: "2026-05-01", amount: "500.00", payment_mode: "Cash", account: "Cash", party: "Rent",
    reference: "", narration: "", customer: null, loan: null, extra: [], allocations: [], edit: { kind: "payment", id: 3 },
    postings: [{ ledger: "Rent", debit: "500.00", credit: "0.00" }, { ledger: "Cash", debit: "0.00", credit: "500.00" }] });
  const labels = model.sections[0].items.map(entry => entry.label);
  assert.ok(labels.includes("Voucher No.") && !labels.includes("Narration") && !labels.includes("Reference / UTR"));
  assert.deepEqual(model.tables[0].footer[0], { label: "Total", debit: 500, credit: 500 });
  assert.deepEqual(model.admin, { kind: "payment", id: 3 });
});

test("loan model highlights the selected installment and links receipts", () => {
  const model = loanModel({ customer: { name: "Ravi" }, highlight: 11, edit: { kind: "loan", id: 2 },
    loan: { loan_no: "CH-1", loan_type: "Chit", status: "ACTIVE", loan_amount: "1000", total_amount: "1200", paid_amount: "200", penalty_amount: "0", outstanding_amount: "1000", extra: [] },
    schedule: [{ id: 10, installment_number: 1 }, { id: 11, installment_number: 2 }], collections: [{ voucher_no: "RV-000004", amount: "200" }] });
  assert.deepEqual(model.tables[0].rows.map(row => row._highlight), [false, true]);
  assert.deepEqual(model.tables[1].rows[0]._open, { kind: "voucher", id: "RV-000004" });
});

test("group model lists the exact node's descendants with drill-downs", () => {
  const tree = { groups: [{ id: "group-1", name: "Assets", debit: 10, credit: 0, children: [{ id: "ledger-5", name: "Cash", is_group: false, debit: 10, credit: 0, children: [] }] }] };
  const node = findNode(tree, "group-1");
  const model = groupModel({ node, reportLabel: "Trial Balance", params: { report: "trial-balance", from: "2026-04-01" } });
  assert.equal(findNode(tree, "ledger-5").name, "Cash");
  assert.equal(model.tables[0].rows[0]._open.kind, "ledger");
  assert.equal(model.tables[0].rows[0]._open.extra.from, "2026-04-01");
});
