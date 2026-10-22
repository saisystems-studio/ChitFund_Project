import test from "node:test";
import assert from "node:assert/strict";
import { clearLedgerReturn, incomingLedgerReturn, noteLedgerCreated, pendingLedgerReturn, returnFromLedger, startLedgerCreate } from "./ledgerReturn.js";

const store = new Map();
// Browser history stand-in: depth lives in history.state.appIdx like the real app.
let historyState = { appIdx: 0 };
globalThis.window = { history: { get state() { return historyState; }, back() { historyState = { appIdx: historyState.appIdx - 1 }; } } };
globalThis.sessionStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };

test("(+) round trip keeps the draft, returns to origin and carries the created ledger", () => {
  const visited = [];
  const go = path => { visited.push(path); historyState = { appIdx: historyState.appIdx + 1 }; };
  historyState = { appIdx: 3 };
  const draft = { form: { ledger: "", amount: "250", notes: "keep me" } };
  startLedgerCreate(go, { origin: "/payment-entry", field: "ledger", draft, rootNames: ["Sundry Debtors", "Sundry Creditors"] });
  assert.deepEqual(visited, ["/ledgers"]);
  assert.equal(incomingLedgerReturn("/payment-entry"), null, "origin must not restore before Back");
  assert.deepEqual(pendingLedgerReturn().rootNames, ["Sundry Debtors", "Sundry Creditors"]);
  noteLedgerCreated(42);
  assert.equal(returnFromLedger(go), true);
  assert.deepEqual(visited, ["/ledgers"], "steps back through history to the exact transaction entry");
  assert.equal(historyState.appIdx, 3);
  const incoming = incomingLedgerReturn("/payment-entry");
  assert.equal(incoming.createdId, 42);
  assert.deepEqual(incoming.draft, draft);
  assert.equal(incomingLedgerReturn("/collection-entry"), null, "only the originating page restores");
  assert.equal(pendingLedgerReturn(), null, "Add Ledger no longer treats it as pending");
  clearLedgerReturn();
  assert.equal(incomingLedgerReturn("/payment-entry"), null);
});

test("Back without saving restores the previous form state with no ledger selected", () => {
  const go = () => {};
  startLedgerCreate(go, { origin: "/collection-entry", field: "adjustmentLedgerId", draft: { amount: "10" } });
  returnFromLedger(go);
  const incoming = incomingLedgerReturn("/collection-entry");
  assert.equal(incoming.createdId, null);
  assert.deepEqual(incoming.draft, { amount: "10" });
  clearLedgerReturn();
});

test("Add Ledger opened normally (no round trip) keeps its existing Back behaviour", () => {
  clearLedgerReturn();
  assert.equal(returnFromLedger(() => assert.fail("must not navigate")), false);
});

test("browser Back from Add Ledger (no Back click) still restores the draft on the origin entry", () => {
  historyState = { appIdx: 5 };
  const go = () => { historyState = { appIdx: historyState.appIdx + 1 }; };
  startLedgerCreate(go, { origin: "/payment-entry", field: "ledger", draft: { form: { amount: "9" } } });
  assert.equal(incomingLedgerReturn("/payment-entry"), null, "not while Add Ledger is the current entry");
  window.history.back();
  assert.deepEqual(incomingLedgerReturn("/payment-entry").draft, { form: { amount: "9" } });
  clearLedgerReturn();
});

test("Back falls back to pushing the origin when history no longer lines up", () => {
  historyState = { appIdx: 0 };
  const visited = [];
  const go = path => { visited.push(path); historyState = { appIdx: historyState.appIdx + 1 }; };
  startLedgerCreate(go, { origin: "/collection-entry", field: "x", draft: {} });
  go("/ledgers/list"); go("/ledgers");
  returnFromLedger(go);
  assert.equal(visited.at(-1), "/collection-entry");
  assert.ok(incomingLedgerReturn("/collection-entry"));
  clearLedgerReturn();
});
