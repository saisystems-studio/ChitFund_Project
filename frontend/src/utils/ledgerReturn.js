// Round trip from a transaction's Ledger field to the existing Add Ledger page
// and back. The originating page, its in-progress form values, the active
// ledger field and the group eligibility for that field are kept in
// sessionStorage (per tab) so returning restores the form exactly, then
// selects the newly created ledger when one was saved.
import { historyIndex } from "./navigation.js";

const KEY = "finance_ledger_return";

const storage = () => { try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; } };

export function readLedgerReturn() {
  try { return JSON.parse(storage()?.getItem(KEY) || "null"); } catch { return null; }
}

function write(context) {
  try { if (context) storage()?.setItem(KEY, JSON.stringify(context)); else storage()?.removeItem(KEY); } catch { /* storage unavailable */ }
}

export function clearLedgerReturn() { write(null); }

// Called from the (+) button: remember where we came from, then open Add Ledger.
export function startLedgerCreate(go, { origin, field, draft, rootNames }) {
  // originIdx = the history depth of the transaction page, so Back can step back to that
  // exact history entry instead of pushing a new one.
  write({ origin, field, draft, rootNames: rootNames || null, createdId: null, returning: false, originIdx: historyIndex() });
  go("/ledgers");
}

// Add Ledger page: the context only applies while a round trip is pending.
export function pendingLedgerReturn() {
  const context = readLedgerReturn();
  return context && !context.returning ? context : null;
}

export function noteLedgerCreated(id) {
  const context = readLedgerReturn();
  if (context && !context.returning) write({ ...context, createdId: id });
}

// Back / Cancel from Add Ledger: go to the origin page, which restores its draft.
export function returnFromLedger(go) {
  const context = pendingLedgerReturn();
  if (!context) return false;
  write({ ...context, returning: true });
  if (historyIndex() === context.originIdx + 1 && typeof window !== "undefined") window.history.back();
  else go(context.origin);
  return true;
}

// Origin page: read (without consuming, so StrictMode double renders agree)
// the context that is coming back to it.
// Also accepts the browser Back button (context still pending) when this is the very
// history entry the round trip started from.
export function incomingLedgerReturn(origin) {
  const context = readLedgerReturn();
  if (!context || context.origin !== origin) return null;
  return context.returning || historyIndex() === context.originIdx ? context : null;
}
