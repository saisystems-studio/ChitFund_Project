// Journal Entry helpers shared by the form and the list (kept free of React so they can be unit tested).
export const ENDPOINT = "/finance/journal-vouchers/";
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const blankRow = () => ({ key: newToken(), cr_ledger: "", cr_amount: "", dr_ledger: "", dr_amount: "", lead: "" });
// Cash in Hand / Bank Accounts have their own modules (the API refuses them too). `group` is the
// root group the Ledger Master derives for every ledger, so child groups are covered.
export const ACCOUNT_GROUPS = ["Cash-in-Hand", "Bank Accounts"];
export const journalLedgers = (ledgers, rows) => {
  const used = new Set(rows.flatMap(row => [row.cr_ledger, row.dr_ledger]).filter(Boolean).map(String));
  return ledgers.filter(item => !ACCOUNT_GROUPS.includes(item.group) || used.has(String(item.id)));
};

// Two-sided entry: the side typed first ("lead") drives the opposite amount, which is then
// read-only. Clearing the lead amount clears the mirror and unlocks both. A legacy row whose two
// amounts already differ (compound voucher) is left alone.
export function syncAmount(row, side, value) {
  const other = side === "cr" ? "dr" : "cr";
  const next = { ...row, [`${side}_amount`]: value };
  if (value === "" || value == null) {
    if (row.lead === side) { next[`${other}_amount`] = ""; next.lead = ""; }
    return next;
  }
  if (row.lead === side || (!row.lead && (row[`${other}_amount`] === "" || row[`${other}_amount`] == null))) { next.lead = side; next[`${other}_amount`] = value; }
  return next;
}
export const lockedSide = row => row.lead === "cr" ? "dr" : row.lead === "dr" ? "cr" : "";

// Request token: lets the API recognise a repeated / retried Save of the same voucher.
// crypto.randomUUID needs a secure context, so fall back to getRandomValues (works over plain http).
export function newToken() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = cryptoApi?.getRandomValues ? cryptoApi.getRandomValues(new Uint8Array(16)) : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Whole paise, so totals never drift (0.1 + 0.2).
export const paise = value => { const number = Number(value); return value === "" || value == null || !Number.isFinite(number) ? 0 : Math.round(number * 100); };

export function totals(rows) {
  const credit = rows.reduce((sum, row) => sum + paise(row.cr_amount), 0);
  const debit = rows.reduce((sum, row) => sum + paise(row.dr_amount), 0);
  return { credit: credit / 100, debit: debit / 100, difference: Math.abs(credit - debit) / 100, balanced: credit > 0 && credit === debit };
}

const validAmount = value => value === "" || value == null || (/^\d+(\.\d{1,2})?$/.test(String(value).trim()) && Number(value) >= 0);

// Same rules as the API; returns the first problem, or "" when the voucher can be saved.
export function validateJournal({ date, rows }) {
  if (!date) return "Voucher Date is required.";
  let credit = 0, debit = 0;
  for (const [index, row] of rows.entries()) {
    const number = index + 1;
    for (const [side, label] of [["cr", "Credit"], ["dr", "Debit"]]) {
      const ledger = row[`${side}_ledger`], amount = row[`${side}_amount`];
      if (!validAmount(amount)) return `Row ${number}: enter a valid ${label} Amount (no negatives, up to 2 decimals).`;
      if (paise(amount) > 0 && !ledger) return `Row ${number}: select the ${label} ledger.`;
      if (ledger && !(paise(amount) > 0)) return `Row ${number}: enter the ${label} Amount.`;
    }
    if (row.cr_ledger && row.dr_ledger && String(row.cr_ledger) === String(row.dr_ledger)) return `Row ${number}: the same ledger cannot be both debited and credited.`;
    credit += paise(row.cr_amount); debit += paise(row.dr_amount);
  }
  if (!credit || !debit) return "Enter at least one Debit and one Credit line.";
  if (credit !== debit) return `Journal is unbalanced: difference ${(Math.abs(credit - debit) / 100).toFixed(2)}.`;
  return "";
}

// API rows -> form rows (strings, as typed).
export const formRows = rows => (rows?.length ? rows : [{}]).map(row => ({
  key: newToken(),
  // Saved rows reopen with Debit as the typed side when both amounts match (the original side is not stored).
  lead: row.cr_amount != null && row.dr_amount != null && Number(row.cr_amount) === Number(row.dr_amount) && Number(row.cr_amount) > 0 ? "dr" : "",
  cr_ledger: row.cr_ledger ? String(row.cr_ledger) : "", cr_amount: row.cr_amount != null ? Number(row.cr_amount).toFixed(2) : "",
  dr_ledger: row.dr_ledger ? String(row.dr_ledger) : "", dr_amount: row.dr_amount != null ? Number(row.dr_amount).toFixed(2) : "",
}));

// "Bank" / "Bank +2 more" for one side of a voucher in the list.
export function sideSummary(voucher, side) {
  const names = [...new Set((voucher.lines || []).filter(line => line.side === side).map(line => line.ledger_name))];
  return names.length > 1 ? `${names[0]} +${names.length - 1} more` : names[0] || "—";
}
export const isCompound = voucher => (voucher.lines || []).length > 2;
