import test from "node:test";
import assert from "node:assert/strict";
import { formRows, isCompound, journalLedgers, lockedSide, newToken, sideSummary, syncAmount, totals, validateJournal } from "./journal.js";

const row = (cr_ledger, cr_amount, dr_ledger, dr_amount) => ({ cr_ledger, cr_amount, dr_ledger, dr_amount });

test("totals use whole paise and report balance", () => {
  assert.deepEqual(totals([row("1", "0.10", "2", ""), row("", "0.20", "3", "0.30")]), { credit: 0.3, debit: 0.3, difference: 0, balanced: true });
  assert.deepEqual(totals([row("1", "5000", "2", "4000")]), { credit: 5000, debit: 4000, difference: 1000, balanced: false });
  assert.equal(totals([row("", "", "", "")]).balanced, false);
});

test("validation mirrors the API rules", () => {
  const date = "2026-10-14";
  assert.equal(validateJournal({ date, rows: [row("1", "5000", "2", "5000")] }), "");
  assert.equal(validateJournal({ date, rows: [row("1", "7000", "2", "5000"), row("", "", "3", "2000"), row("", "", "", "")] }), "");
  assert.match(validateJournal({ date: "", rows: [row("1", "1", "2", "1")] }), /Date/);
  assert.match(validateJournal({ date, rows: [row("1", "5000", "2", "4000")] }), /unbalanced/);
  assert.match(validateJournal({ date, rows: [row("", "100", "2", "100")] }), /select the Credit ledger/);
  assert.match(validateJournal({ date, rows: [row("1", "", "2", "100")] }), /enter the Credit Amount/);
  assert.match(validateJournal({ date, rows: [row("1", "-5", "2", "-5")] }), /valid Credit Amount/);
  assert.match(validateJournal({ date, rows: [row("1", "1.555", "2", "1.555")] }), /valid Credit Amount/);
  assert.match(validateJournal({ date, rows: [row("1", "10", "1", "10")] }), /same ledger/);
  assert.match(validateJournal({ date, rows: [row("", "", "2", "10")] }), /at least one Debit and one Credit/);
});

test("list helpers and tokens", () => {
  const voucher = { lines: [{ side: "CR", ledger_name: "Bank" }, { side: "CR", ledger_name: "Cash" }, { side: "DR", ledger_name: "Kumar" }] };
  assert.equal(sideSummary(voucher, "CR"), "Bank +1 more");
  assert.equal(sideSummary(voucher, "DR"), "Kumar");
  assert.equal(isCompound(voucher), true);
  assert.deepEqual(formRows([{ cr_ledger: 1, cr_amount: "5000.00", dr_ledger: null, dr_amount: null }]).map(({ key, ...rest }) => rest), [{ cr_ledger: "1", cr_amount: "5000.00", dr_ledger: "", dr_amount: "", lead: "" }]);
  assert.match(newToken(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("typing one side mirrors it to the other, which locks; clearing unlocks both", () => {
  let r = { cr_amount: "", dr_amount: "", lead: "" };
  r = syncAmount(r, "dr", "5000"); assert.deepEqual([r.cr_amount, lockedSide(r)], ["5000", "cr"]);
  r = syncAmount(r, "dr", "5200"); assert.equal(r.cr_amount, "5200");
  r = syncAmount(r, "dr", ""); assert.deepEqual([r.cr_amount, r.dr_amount, lockedSide(r)], ["", "", ""]);
  r = syncAmount(r, "cr", "8000"); assert.deepEqual([r.dr_amount, lockedSide(r)], ["8000", "dr"]);
});

test("a legacy row with different amounts is not overwritten; equal saved rows reopen locked", () => {
  const legacy = { cr_amount: "100", dr_amount: "40", lead: "" };
  assert.equal(syncAmount(legacy, "cr", "90").dr_amount, "40");
  assert.equal(formRows([{ cr_ledger: 1, cr_amount: "50.00", dr_ledger: 2, dr_amount: "50.00" }])[0].lead, "dr");
  assert.equal(formRows([{ cr_ledger: 1, cr_amount: "50.00", dr_ledger: 2, dr_amount: "40.00" }])[0].lead, "");
});

test("cash and bank ledgers are hidden unless an old voucher already uses them", () => {
  const ledgers = [{ id: 1, group: "Cash-in-Hand" }, { id: 2, group: "Bank Accounts" }, { id: 3, group: "Sundry Debtors" }, { id: 4, group: "Income" }];
  assert.deepEqual(journalLedgers(ledgers, []).map(l => l.id), [3, 4]);
  assert.deepEqual(journalLedgers(ledgers, [{ cr_ledger: "1", dr_ledger: "" }]).map(l => l.id), [1, 3, 4]);
});
