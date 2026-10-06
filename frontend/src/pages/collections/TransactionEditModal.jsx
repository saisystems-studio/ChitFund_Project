import { useEffect, useState } from "react";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import StaffDropdown from "../../components/StaffDropdown/StaffDropdown";
import "./transaction-list.css";

const groups = ["Sundry Debtors", "Sundry Creditors", "Indirect Expense", "Direct Expense", "Income"];
const accountGroups = ["Cash-in-Hand", "Bank Accounts"];
const paymentFields = ["ledger", "ledger_group", "account", "accounts", "amount", "payment_mode", "date", "upi_id", "transaction_utr", "bank_name", "cheque_number", "cheque_date", "notes", "done_by_staff"];
const collectionFields = ["collection_amount", "collection_date", "payment_mode", "account", "reference_no", "remarks", "upi_id", "bank_name", "cheque_number", "cheque_date", "adjustment_type", "adjustment_amount", "discount_amount", "ledger", "ledger_group", "ledger_amount", "done_by_staff"];
export const transactionEndpoint = (kind, id) => `/finance/${kind === "collection" ? "collection-transactions" : "payment-entries"}/${id}/`;

export default function TransactionEditModal({ api, auth, kind, id, onClose, onSaved }) {
  const [form, setForm] = useState(null), [ledgers, setLedgers] = useState([]);
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const collection = kind === "collection";
  useEffect(() => {
    let active = true;
    Promise.all([api.get(transactionEndpoint(kind, id), auth), api.get("/finance/ledgers/", auth)])
      .then(([record, ledgerResponse]) => { if (active) { setForm(record.data); setLedgers(ledgerResponse.data.results ?? ledgerResponse.data); } })
      .catch(requestError => { if (active) setError(apiErrorMessage(requestError, "Unable to load this entry.")); });
    return () => { active = false; };
  }, [kind, id]);
  useEffect(() => {
    const keyDown = event => { if (event.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [saving, onClose]);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async event => {
    event.preventDefault();
    if (saving || !form) return;
    setSaving(true); setError("");
    const payload = Object.fromEntries((collection ? collectionFields : paymentFields).filter(key => key in form).map(key => [key, form[key]]));
    for (const key of ["account", "ledger", "cheque_date", "done_by_staff"]) if (payload[key] === "") payload[key] = null;
    try { await api.patch(transactionEndpoint(kind, id), payload, auth); onSaved(); }
    catch (requestError) { setError(apiErrorMessage(requestError, "Unable to update this entry.")); }
    finally { setSaving(false); }
  };
  const field = (label, key, type = "text", required = false) => <label key={key}>{label}<input type={type} required={required} value={form[key] ?? ""} onChange={event => update(key, event.target.value)} {...(type === "number" ? { min: required ? "0.01" : "0", step: "0.01" } : {})}/></label>;
  const chooseLedger = (label, key, options) => <label>{label}<select value={form[key] ?? ""} onChange={event => {
    const value = event.target.value;
    if (key === "ledger") setForm(current => ({ ...current, ledger: value, ledger_group: value ? ledgers.find(item => String(item.id) === value)?.group || current.ledger_group : current.ledger_group }));
    else update(key, value);
  }}><option value="">Select {label}</option>{options.map(item => <option key={item.id} value={item.id}>{item.name} - {item.group}</option>)}</select></label>;
  const modes = [...new Set(["Cash", "UPI", "Cheque", "NEFT", form?.payment_mode].filter(Boolean))];
  return <div className="transaction-edit-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form className="transaction-edit-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-edit-title" onSubmit={save}>
      <header><h2 id="transaction-edit-title">Edit {collection ? "Collection" : "Payment"} Entry</h2><button type="button" aria-label="Close" disabled={saving} onClick={onClose}>&times;</button></header>
      <div className="transaction-edit-body">
        {error && <p className="error" role="alert">{error}</p>}
        {!form && !error && <p>Loading saved entry...</p>}
        {form && <fieldset disabled={saving}>
          {collection && <div className="transaction-edit-identity"><span>Customer: <strong>{form.customer_name}</strong></span><span>Loan: <strong>{form.loan_no}</strong></span></div>}
          <div className="transaction-edit-grid">
            {field("Date", collection ? "collection_date" : "date", "date", true)}
            {field("Amount", collection ? "collection_amount" : "amount", "number", true)}
            {chooseLedger("Account", "account", ledgers.filter(item => accountGroups.includes(item.group) || item.id === form.account))}
            <label>Payment Mode<select required value={form.payment_mode || ""} onChange={event => update("payment_mode", event.target.value)}><option value="">Select Payment Mode</option>{modes.map(mode => <option key={mode}>{mode}</option>)}</select></label>
            <label>Salesman<StaffDropdown api={api} auth={auth} value={form.done_by_staff || ""} onChange={value => update("done_by_staff", value)} placeholder="Select staff" allowClear/></label>
            {chooseLedger("Ledger", "ledger", ledgers.filter(item => groups.includes(item.group) || item.id === form.ledger))}
            <label>Ledger Group<select value={form.ledger_group || ""} onChange={event => update("ledger_group", event.target.value)}><option value="">Select Ledger Group</option>{groups.map(group => <option key={group}>{group}</option>)}</select></label>
            {!collection && form.accounts && <label>Legacy Account<select value={form.accounts} onChange={event => update("accounts", event.target.value)}><option>Card</option><option>Credit</option></select></label>}
            {collection && field("Other Charges Amount", "ledger_amount", "number")}
          </div>
          <details open><summary>Payment Details</summary><div className="transaction-edit-grid">
            {field("UPI ID", "upi_id")}
            {field("Reference / UTR", collection ? "reference_no" : "transaction_utr")}
            {field("Bank Name", "bank_name")}
            {field("Cheque Number", "cheque_number")}
            {field("Cheque Date", "cheque_date", "date")}
            {collection && <>{field("Adjustment Type", "adjustment_type")}{field("Adjustment / Penalty Amount", "adjustment_amount", "number")}{field("Discount Amount", "discount_amount", "number")}</>}
          </div></details>
          <label>Notes<textarea rows="3" maxLength="500" value={form[collection ? "remarks" : "notes"] || ""} onChange={event => update(collection ? "remarks" : "notes", event.target.value)}/></label>
          {collection && form.allocations?.length > 0 && <details><summary>Saved Installment Allocation</summary><table><thead><tr><th>Installment</th><th>Amount</th></tr></thead><tbody>{form.allocations.map(row => <tr key={row.installment_id}><td>{row.installment_number}</td><td>{formatINR(row.amount)}</td></tr>)}</tbody></table></details>}
        </fieldset>}
      </div>
      <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={!form || saving}>{saving ? "Saving..." : "Save Changes"}</button></footer>
    </form>
  </div>;
}
