// Add Ledger -> Add Customer -> back to Add Ledger (Customer Name = Party Ledger Name).
// The unsaved ledger form (name, the exact Group ID, opening balance, ...) is kept in
// sessionStorage (per tab) while Add Customer is open. Saving the customer creates its one
// linked Party Ledger (opening balance zero) on the server; back on Add Ledger the final Save
// completes that same ledger by its ID, so a cancelled or closed Ledger page never leaves a
// duplicate or orphaned ledger -- the linked ledger already exists and can be edited later.
import { historyIndex } from "./navigation.js";

const KEY = "finance_ledger_customer_link";

const storage = () => { try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; } };
const read = () => { try { return JSON.parse(storage()?.getItem(KEY) || "null"); } catch { return null; } };
const write = value => { try { if (value) storage()?.setItem(KEY, JSON.stringify(value)); else storage()?.removeItem(KEY); } catch { /* storage unavailable */ } };

export function clearCustomerLink() { write(null); }

// Add Ledger: remember the form, then open the existing Add Customer page.
export function startCustomerFromLedger(go, draft) {
  // originIdx: history depth of Add Ledger, so only the Add Customer entry opened from it
  // (incl. a refresh of it) counts as "from Ledger" -- a later direct Add Customer does not.
  write({ draft, returning: false, customer: null, originIdx: historyIndex() });
  go("/customers/new");
}

// Add Customer: the ledger draft it was opened from (null for a direct Add Customer).
export function pendingCustomerLink() {
  const context = read();
  return context && !context.returning && historyIndex() === context.originIdx + 1 ? context : null;
}

// Add Customer saved (customer = { id, full_name, ledger_id }) or cancelled (null): back to Add Ledger.
export function finishCustomerLink(go, customer) {
  const context = pendingCustomerLink();
  if (!context) return false;
  write({ ...context, returning: true, customer: customer || null });
  // Step back onto the Add Ledger history entry rather than stacking a new one.
  if (typeof window !== "undefined") window.history.back(); else go("/ledgers");
  return true;
}

// Add Ledger: the draft (and saved customer, if any) coming back -- only on the very Add Ledger
// history entry the trip started from (Save / Cancel step back to it; so do the browser Back
// button and a refresh of that page). Read without consuming (StrictMode renders twice); Add
// Ledger clears it on Save / Reset / Cancel, and a later visit elsewhere never restores it.
export function returningCustomerLink() {
  const context = read();
  return context && historyIndex() === context.originIdx ? context : null;
}
