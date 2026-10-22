// Pure helpers for the Pending & Outstanding report: the flat display lines of the Individual
// (DR / CR) view and the export tables, kept free of React so they can be unit tested.
import { formatINR } from "../../utils/currency.js";

export const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "";
export const balanceText = (amount, side) => `${formatINR(amount)} ${side === "CR" ? "Cr" : "Dr"}`;
const num = value => Number(value || 0);

export const DEFAULTS = { parties: [], view: "multiple", basis: "voucher", from: "", to: "", date: "", sort: "overdue" };

export function queryParams(filters) {
  const single = filters.view === "individual" && filters.date;
  return {
    view: filters.view, basis: filters.basis, sort: filters.sort,
    parties: filters.parties.length ? filters.parties.join(",") : undefined,
    date: filters.view === "individual" ? filters.date || undefined : undefined,
    from: single || filters.view === "individual" ? undefined : filters.from || undefined,
    to: single || filters.view === "individual" ? undefined : filters.to || undefined,
  };
}

// Individual view: one block per party (Opening, its postings, subtotal). `kind` drives the row style.
export function ledgerLines(parties) {
  let serial = 0;
  return parties.flatMap(party => [
    { kind: "opening", party: party.party_name, balance: balanceText(party.opening, party.opening_type) },
    ...party.rows.map(row => ({ kind: "row", serial: ++serial, party: party.party_name, row })),
    { kind: "subtotal", party: party.party_name, debit: party.total_debit, credit: party.total_credit, balance: balanceText(party.closing, party.closing_type) },
  ]);
}

export function filtersLine(filters, partyNames, as_of) {
  const range = filters.view === "individual"
    ? (filters.date && `Date: ${dateLabel(filters.date)}`)
    : [filters.from && `From ${dateLabel(filters.from)}`, filters.to && `To ${dateLabel(filters.to)}`].filter(Boolean).join(" ");
  return [`Party: ${partyNames.length ? partyNames.join(", ") : "All Parties"}`, `View: ${filters.view === "individual" ? "Individual Date-wise" : "Multiple Date-wise"}`,
    `Date Basis: ${filters.basis === "due" ? "Due Date" : "Voucher Date"}`, range, filters.view === "multiple" && as_of && `As of ${dateLabel(as_of)}`,
    `Sort: ${filters.sort === "party" ? "Party-wise" : "Overdue"}`].filter(Boolean).join("   •   ");
}

// Table definition shared by the PDF and Excel exports: same columns, rows and footer as the screen.
export function exportTable(data) {
  if (data.view === "multiple") {
    return {
      columns: [{ header: "S.No", align: "center" }, { header: "Party Name" }, { header: "Voucher Date" }, { header: "Due Date" }, { header: "Voucher No" },
        { header: "Due Amount", align: "right" }, { header: "Paid", align: "right" }, { header: "Pending", align: "right" }, { header: "Overdue Days", align: "right" }],
      rows: data.rows.map((row, index) => [String(index + 1), row.party_name, dateLabel(row.voucher_date), dateLabel(row.due_date), row.voucher_no,
        formatINR(row.due_amount), formatINR(row.paid), formatINR(row.pending), String(row.overdue_days)]),
      summary: [["Total", formatINR(data.totals.due), formatINR(data.totals.paid), formatINR(data.totals.pending), ""]],
      raw: data.rows.map((row, index) => [index + 1, row.party_name, row.voucher_date || "", row.due_date || "", row.voucher_no, num(row.due_amount), num(row.paid), num(row.pending), row.overdue_days]),
    };
  }
  const lines = ledgerLines(data.parties);
  const body = [], raw = [];
  for (const line of lines) {
    if (line.kind === "row") {
      const r = line.row;
      body.push([String(line.serial), dateLabel(r.voucher_date), dateLabel(r.due_date), line.party, r.particulars, r.voucher_no, num(r.debit) ? formatINR(r.debit) : "", num(r.credit) ? formatINR(r.credit) : "", balanceText(r.balance, r.balance_type)]);
      raw.push([line.serial, r.voucher_date || "", r.due_date || "", line.party, r.particulars, r.voucher_no, num(r.debit) || "", num(r.credit) || "", balanceText(r.balance, r.balance_type)]);
    }
  }
  return {
    columns: [{ header: "S.No", align: "center" }, { header: "Voucher Date" }, { header: "Due Date" }, { header: "Party Name" }, { header: "Particulars" }, { header: "Voucher No" },
      { header: "DR", align: "right" }, { header: "CR", align: "right" }, { header: "Balance", align: "right" }],
    rows: body, raw,
    summary: data.parties.flatMap(party => [
      [`${party.party_name} - Opening Balance`, "", balanceText(party.opening, party.opening_type)],
      [`${party.party_name} - Total`, formatINR(party.total_debit), formatINR(party.total_credit)],
      [`${party.party_name} - Closing Balance`, "", balanceText(party.closing, party.closing_type)],
    ]),
    combined: data.parties.length > 1 ? [`All parties - Total DR / CR`, formatINR(data.totals.debit), formatINR(data.totals.credit)] : null,
  };
}
