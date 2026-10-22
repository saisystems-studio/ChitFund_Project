import test from "node:test";
import assert from "node:assert/strict";
import { clearCustomerLink, finishCustomerLink, pendingCustomerLink, returningCustomerLink, startCustomerFromLedger } from "./customerLedgerLink.js";

const store = new Map();
let historyState = { appIdx: 0 };
globalThis.window = { history: { get state() { return historyState; }, back() { historyState = { appIdx: historyState.appIdx - 1 }; } } };
globalThis.sessionStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
const go = path => { go.visited.push(path); historyState = { appIdx: historyState.appIdx + 1 }; };

test("Add Ledger -> Add Customer -> Save returns the draft with the linked ledger", () => {
  go.visited = []; historyState = { appIdx: 2 };
  const draft = { name: "Sai", group_detail: 11, opening_balance: "0", opening_balance_type: "DR" };
  startCustomerFromLedger(go, draft);
  assert.deepEqual(go.visited, ["/customers/new"]);
  assert.deepEqual(pendingCustomerLink().draft, draft, "Add Customer sees the ledger name and group id");
  assert.equal(returningCustomerLink(), null, "nothing returns while Add Customer is open");
  assert.equal(finishCustomerLink(go, { id: 7, full_name: "Sai", ledger_id: 31 }), true);
  assert.equal(historyState.appIdx, 2, "steps back onto the Add Ledger entry");
  const back = returningCustomerLink();
  assert.deepEqual(back.draft, draft);
  assert.equal(back.customer.ledger_id, 31);
  assert.equal(pendingCustomerLink(), null);
  clearCustomerLink();
  assert.equal(returningCustomerLink(), null);
});

test("Cancel and browser Back restore the draft without a customer", () => {
  go.visited = []; historyState = { appIdx: 4 };
  startCustomerFromLedger(go, { name: "Kumar", group_detail: 11 });
  finishCustomerLink(go, null);
  assert.equal(returningCustomerLink().customer, null);
  clearCustomerLink();
  startCustomerFromLedger(go, { name: "Ravi", group_detail: 12 });
  window.history.back();
  assert.equal(returningCustomerLink().draft.name, "Ravi", "browser Back still restores");
  clearCustomerLink();
});

test("a later direct Add Customer is not treated as opened from Add Ledger", () => {
  go.visited = []; historyState = { appIdx: 1 };
  startCustomerFromLedger(go, { name: "Stale", group_detail: 11 });
  go("/dashboard"); go("/customers/new");
  assert.equal(pendingCustomerLink(), null);
  assert.equal(finishCustomerLink(go, { id: 1 }), false);
  assert.equal(returningCustomerLink(), null, "nor restored on a later, different Add Ledger visit");
  clearCustomerLink();
});

test("a refresh of Add Ledger after the customer was saved still finishes the same ledger", () => {
  go.visited = []; historyState = { appIdx: 5 };
  startCustomerFromLedger(go, { name: "Sai", group_detail: 11 });
  finishCustomerLink(go, { id: 9, full_name: "Sai", ledger_id: 40 });
  historyState = { appIdx: 5 }; // reload keeps history.state
  assert.equal(returningCustomerLink().customer.ledger_id, 40);
  assert.equal(returningCustomerLink().customer.ledger_id, 40, "reading does not consume it");
  clearCustomerLink();
  assert.equal(returningCustomerLink(), null);
});
