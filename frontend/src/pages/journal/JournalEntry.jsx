import { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import { goBack } from "../../utils/navigation";
import { ENDPOINT, blankRow, formRows, journalLedgers, lockedSide, newToken, paise, syncAmount, today, totals, validateJournal } from "./journal";
import "../collections/collection-entry.css";
import "./journal.css";

// Journal Entry (Tally-style): one grid of  Ledger (Cr) | Credit | Ledger (Dr) | Debit  rows.
// Rows need not balance individually -- the whole voucher must. Used as the Add Journal page
// and, with `id`, as the Edit popup from Journal List.
export default function JournalEntry({ api, auth, go, id = null, onClose, onSaved }) {
  const editing = id != null;
  const [voucherNo, setVoucherNo] = useState(""), [date, setDate] = useState(today()), [narration, setNarration] = useState("");
  const [rows, setRows] = useState(() => [blankRow()]), [ledgers, setLedgers] = useState([]);
  const [token, setToken] = useState(newToken), [saving, setSaving] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");

  const loadNextVoucher = () => api.get(`${ENDPOINT}next-voucher/`, auth).then(({ data }) => setVoucherNo(data.voucher_no)).catch(() => setVoucherNo(""));
  useEffect(() => {
    let active = true;
    const requests = [api.get("/finance/ledgers/", auth).then(({ data }) => { if (active) setLedgers([...(data.results ?? data)].sort((a, b) => String(a.name).localeCompare(String(b.name)))); })];
    if (editing) requests.push(api.get(`${ENDPOINT}${id}/`, auth).then(({ data }) => { if (!active) return; setVoucherNo(data.voucher_no); setDate(data.date); setNarration(data.narration || ""); setRows(formRows(data.rows)); }));
    else requests.push(loadNextVoucher());
    Promise.all(requests).catch(requestError => { if (active) setError(apiErrorMessage(requestError, "Unable to load the journal.")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const sum = useMemo(() => totals(rows), [rows]);
  const options = useMemo(() => journalLedgers(ledgers, rows), [ledgers, rows]);
  const setAmount = (key, side, value) => setRows(current => current.map(row => row.key === key ? syncAmount(row, side, value) : row));
  const update = (key, field, value) => setRows(current => current.map(row => row.key === key ? { ...row, [field]: value } : row));
  const addRow = () => setRows(current => [...current, blankRow()]);
  const removeRow = key => setRows(current => current.length > 1 ? current.filter(row => row.key !== key) : current);
  // Reset keeps the date and voucher number; a fresh token makes the next Save a new voucher.
  const reset = () => { setRows([blankRow()]); setNarration(""); setError(""); setToken(newToken()); };
  const cancel = () => (onClose ? onClose() : goBack("/journal-list"));

  const save = async event => {
    event.preventDefault();
    if (saving || loading) return;
    const problem = validateJournal({ date, rows });
    if (problem) return setError(problem);
    setSaving(true); setError("");
    const payload = { date, narration: narration.trim(), rows: rows.map(({ key, lead, ...row }) => row) };
    try {
      const { data } = editing ? await api.put(`${ENDPOINT}${id}/`, payload, auth) : await api.post(ENDPOINT, { ...payload, client_token: token }, auth);
      actionToast(`Journal ${data.voucher_no} ${editing ? "updated" : "saved"} successfully.`);
      if (onSaved) onSaved(data);
      else { reset(); loadNextVoucher(); }
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to save the journal.")); }
    finally { setSaving(false); }
  };

  const ledgerSelect = (row, side) => <SearchableSelect aria-label={`Ledger Name (${side === "cr" ? "Cr" : "Dr"})`} value={row[`${side}_ledger`]} searchPlaceholder="Search ledger..." onChange={event => update(row.key, `${side}_ledger`, event.target.value)}>
    <option value="">Select Ledger</option>{options.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </SearchableSelect>;
  const amountInput = (row, side) => <input className={`jv-amount${lockedSide(row) === side ? " jv-auto" : ""}`} readOnly={lockedSide(row) === side} tabIndex={lockedSide(row) === side ? -1 : undefined} title={lockedSide(row) === side ? "Filled automatically from the other side" : undefined} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" aria-label={`${side === "cr" ? "Credit" : "Debit"} Amount`}
    value={row[`${side}_amount`]}
    onFocus={event => { if (lockedSide(row) !== side && paise(event.target.value) === 0) setAmount(row.key, side, ""); }}
    onChange={event => lockedSide(row) !== side && setAmount(row.key, side, event.target.value)}
    onBlur={event => { const value = event.target.value; if (lockedSide(row) !== side && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0) setAmount(row.key, side, Number(value).toFixed(2)); }}/>;

  return <div className={`jv-page ${editing ? "jv-in-modal" : "data-page"}`}>
    {editing ? <div className="jv-modal-heading"><h2>Edit Journal</h2><button type="button" aria-label="Close" disabled={saving} onClick={cancel}>×</button></div> : <PageBreadcrumb className="jv-breadcrumb" current="Add Journal Entry" onBack={cancel} />}
    <form className={`jv-container ${editing ? "" : "data-container"}`} onSubmit={save} noValidate>
      <fieldset disabled={saving || loading}>
        <div className="jv-header">
          <label className="jv-field"><span className="jv-label">Voucher Number</span><input readOnly className="jv-voucher" value={voucherNo || "Auto-generated on save"} title={editing ? "Saved voucher number" : "Next voucher number (confirmed on save)"}/></label>
          <label className="jv-field"><span className="jv-label">Voucher Date<span className="jv-required" aria-hidden="true">*</span></span><input type="date" required value={date} onChange={event => setDate(event.target.value)}/></label>
        </div>
        <div className="jv-grid-wrap">
          <table className="jv-grid">
            <colgroup><col className="jv-col-ledger"/><col className="jv-col-amount"/><col className="jv-col-ledger"/><col className="jv-col-amount"/><col className="jv-col-action"/></colgroup>
            <thead><tr><th>DR Ledger</th><th className="num">DR Amount (₹)</th><th>CR Ledger</th><th className="num">CR Amount (₹)</th><th aria-label="Row actions"/></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={row.key}>
              <td data-label="DR Ledger">{ledgerSelect(row, "dr")}</td><td data-label="DR Amount (₹)">{amountInput(row, "dr")}</td>
              <td data-label="CR Ledger">{ledgerSelect(row, "cr")}</td><td data-label="CR Amount (₹)">{amountInput(row, "cr")}</td>
              <td className="jv-row-action"><button type="button" className="jv-delete-row" aria-label={`Delete row ${index + 1}`} title={rows.length > 1 ? "Delete row" : "The last row cannot be deleted"} disabled={rows.length === 1} onClick={() => removeRow(row.key)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></td>
            </tr>)}</tbody>
            <tfoot><tr><td className="jv-total-label">Total Debit</td><td className="num">{formatINR(sum.debit)}</td><td className="jv-total-label">Total Credit</td><td className="num">{formatINR(sum.credit)}</td><td/></tr></tfoot>
          </table>
        </div>
        <div className="jv-grid-bar">
          <button type="button" className="jv-add-row" onClick={addRow}>+ Add Row</button>
        </div>
        <label className="jv-field jv-narration"><span className="jv-label">Notes</span><textarea rows={2} maxLength={1000} value={narration} onChange={event => setNarration(event.target.value)} placeholder="Enter notes..."/></label>
        {error && <div className="collection-entry-error" role="alert">{error}</div>}
        <footer className="collection-entry-actions jv-actions">
          <button type="button" onClick={cancel}>Cancel</button>
          {!editing && <button type="button" onClick={reset}>Reset</button>}
          <button className="save-entry" disabled={saving || loading}>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </fieldset>
    </form>
  </div>;
}
