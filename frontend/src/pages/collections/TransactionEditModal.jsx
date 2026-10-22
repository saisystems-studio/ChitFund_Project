import { useEffect, useRef, useState } from "react";
import { BANK_ACCOUNTS_GROUP, PAYMENT_MODE_OPTIONS, isAccountLedger } from "./CollectionEntry";
import { SUNDRY_GROUPS, modeFields, needsBankAccount } from "./PaymentEntry";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import StaffDropdown from "../../components/StaffDropdown/StaffDropdown";
import "./transaction-list.css";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";

const groups = ["Sundry Debtors", "Sundry Creditors", "Indirect Expense", "Direct Expense", "Income"];
const paymentFields = ["ledger", "ledger_group", "account", "accounts", "amount", "payment_mode", "date", "upi_id", "transaction_utr", "bank_name", "cheque_number", "cheque_date", "notes", "done_by_staff"];
const collectionFields = ["party_ledger", "collection_amount", "collection_date", "payment_mode", "account", "reference_no", "remarks", "upi_id", "bank_name", "cheque_number", "cheque_date", "adjustment_type", "adjustment_amount", "discount_amount", "ledger", "ledger_group", "ledger_amount", "done_by_staff"];
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
  const isBankLedger = value => ledgers.some(item => String(item.id) === String(value ?? "") && item.group === BANK_ACCOUNTS_GROUP);
  // Payment Mode drives the Cash/Bank side: Cash -> default Cash in Hand ledger (resolved by
  // the API, an existing Cash ledger is kept); other modes keep a Bank ledger or ask for one.
  const chooseMode = value => setForm(current => ({ ...current, payment_mode: value, account: needsBankAccount(value) ? (isBankLedger(current.account) ? current.account : "") : current.account }));
  const save = async event => {
    event.preventDefault();
    if (saving || !form) return;
    if (!form.payment_mode) return setError("Select a Payment Mode.");
    if (needsBankAccount(form.payment_mode) && !isBankLedger(form.account)) return setError("Select a Bank Account.");
    setSaving(true); setError("");
    const payload = Object.fromEntries((collection ? collectionFields : paymentFields).filter(key => key in form).map(key => [key, form[key]]));
    if (!needsBankAccount(form.payment_mode)) payload.account = null;
    for (const key of ["party_ledger", "account", "ledger", "cheque_date", "done_by_staff"]) if (payload[key] === "") payload[key] = null;
    try { await api.patch(transactionEndpoint(kind, id), payload, auth); onSaved(); }
    catch (requestError) { setError(apiErrorMessage(requestError, "Unable to update this entry.")); }
    finally { setSaving(false); }
  };
  const field = (label, key, type = "text", required = false) => <label key={key}>{label}<input type={type} required={required} value={form[key] ?? ""} onChange={event => update(key, event.target.value)} {...(type === "number" ? { min: required ? "0.01" : "0", step: "0.01" } : {})}/></label>;
  const chooseLedger = (label, key, options) => <label>{label}<SearchableSelect value={form[key] ?? ""} onChange={event => {
    const value = event.target.value;
    if (key === "ledger") setForm(current => ({ ...current, ledger: value, ledger_group: value ? ledgers.find(item => String(item.id) === value)?.group || current.ledger_group : current.ledger_group }));
    else update(key, value);
  }}><option value="">Select {label}</option>{options.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SearchableSelect></label>;
  const modes = [...new Set([...PAYMENT_MODE_OPTIONS.map(([value]) => value), form?.payment_mode].filter(Boolean))];
  if (!collection) return <PaymentEditModal {...{ api, auth, id, onClose, onSaved }} />;
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
            <label>Payment Mode<select required value={form.payment_mode || ""} onChange={event => chooseMode(event.target.value)}><option value="">Select Payment Mode</option>{modes.map(mode => <option key={mode} value={mode}>{PAYMENT_MODE_OPTIONS.find(([value]) => value === mode)?.[1] || mode}</option>)}</select></label>
            {needsBankAccount(form.payment_mode) && chooseLedger("Bank Account", "account", ledgers.filter(item => item.group === BANK_ACCOUNTS_GROUP))}
            <label>Resources<StaffDropdown api={api} auth={auth} value={form.done_by_staff || ""} onChange={value => update("done_by_staff", value)} placeholder="Select staff" allowClear/></label>
            {chooseLedger("Ledger", "party_ledger", ledgers.filter(item => !isAccountLedger(item) || String(item.id) === String(form.party_ledger)))}
            {chooseLedger("Other Charges Ledger", "ledger", ledgers)}
            <label>Ledger Group<SearchableSelect value={form.ledger_group || ""} onChange={event => update("ledger_group", event.target.value)}><option value="">Select Ledger Group</option>{groups.map(group => <option key={group}>{group}</option>)}</SearchableSelect></label>
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

// Edit Payment Entry: the same fields, order and Payment Mode -> Bank Account -> detail-field
// rules as the Add Payment Entry page. Every saved value is shown exactly as saved (the saved
// Payment Mode stays an option even if no longer offered) and nothing is auto-selected.
// Changing the Payment Mode only clears the fields that no longer apply. Cash posts to the
// default Cash in Hand ledger (resolved by the API). Save sends only Payment Entry fields.
const PAYMENT_DETAIL_KEYS = ["upi_id", "transaction_utr", "bank_name", "cheque_number", "cheque_date"];
function PaymentEditModal({ api, auth, id, onClose, onSaved }) {
  const [form, setForm] = useState(null), [ledgers, setLedgers] = useState([]);
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const savedMode = useRef("");
  useEffect(() => {
    let active = true;
    Promise.all([api.get(transactionEndpoint("payment", id), auth), api.get("/finance/ledgers/", auth)])
      .then(([record, ledgerResponse]) => {
        if (!active) return;
        const data = record.data;
        savedMode.current = data.payment_mode || "";
        setForm({ ...data, account: data.account == null ? "" : String(data.account), ledger: data.ledger == null ? "" : String(data.ledger), done_by_staff: data.done_by_staff == null ? "" : String(data.done_by_staff) });
        setLedgers(ledgerResponse.data.results ?? ledgerResponse.data);
      })
      .catch(requestError => { if (active) setError(apiErrorMessage(requestError, "Unable to load this entry.")); });
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    const keyDown = event => { if (event.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [saving, onClose]);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const sameId = (a, b) => String(a ?? "") === String(b ?? "");
  // Same option sets as Add Payment Entry, plus the record's own saved ledger / account.
  const ledgerOptions = form ? ledgers : [];
  const bankOptions = form ? ledgers.filter(item => item.group === BANK_ACCOUNTS_GROUP) : [];
  const isBankLedger = value => bankOptions.some(item => sameId(item.id, value));
  const needsBank = needsBankAccount(form?.payment_mode);
  const offered = PAYMENT_MODE_OPTIONS;
  const modeOptions = form?.payment_mode && !offered.some(([value]) => value === form.payment_mode)
    ? [...offered, [form.payment_mode, PAYMENT_MODE_OPTIONS.find(([value]) => value === form.payment_mode)?.[1] || form.payment_mode]]
    : offered;
  const detailFields = form ? modeFields(form.payment_mode) : [];

  const chooseMode = value => setForm(current => {
    const keep = new Set(modeFields(value).map(([key]) => key));
    const next = { ...current, payment_mode: value, account: needsBankAccount(value) && isBankLedger(current.account) ? current.account : needsBankAccount(value) ? "" : current.account };
    PAYMENT_DETAIL_KEYS.forEach(key => { if (!keep.has(key)) next[key] = ""; });
    return next;
  });

  const save = async event => {
    event.preventDefault();
    if (saving || !form) return;
    if (!form.ledger_group || !form.date || !(Number(form.amount) > 0)) return setError("Ledger, Date and an Amount greater than zero are required.");
    if (!form.payment_mode) return setError("Select a Payment Mode.");
    if (needsBank && !isBankLedger(form.account)) return setError("Select a Bank Account.");
    if (detailFields.some(([key]) => !String(form[key] || "").trim())) return setError("Complete the required payment details.");
    setSaving(true); setError("");
    const payload = { date: form.date, ledger: form.ledger || null, ledger_group: form.ledger_group, account: needsBank ? form.account : null, amount: form.amount, payment_mode: form.payment_mode, done_by_staff: form.done_by_staff || null, notes: form.notes || "" };
    // Details of the chosen mode are sent; details that no longer apply are cleared only when the mode changed.
    const keep = new Set(detailFields.map(([key]) => key));
    PAYMENT_DETAIL_KEYS.forEach(key => {
      if (keep.has(key)) payload[key] = form[key] || (key === "cheque_date" ? null : "");
      else if (form.payment_mode !== savedMode.current) payload[key] = key === "cheque_date" ? null : "";
    });
    try { await api.patch(transactionEndpoint("payment", id), payload, auth); onSaved(); }
    catch (requestError) { setError(apiErrorMessage(requestError, "Unable to update this entry.")); }
    finally { setSaving(false); }
  };

  const label = (text, required) => <span>{text}{required && <i className="required-star"> *</i>}</span>;
  return <div className="transaction-edit-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form className="transaction-edit-modal payment-edit-modal" role="dialog" aria-modal="true" aria-labelledby="payment-edit-title" onSubmit={save} noValidate>
      <header><h2 id="payment-edit-title">Edit Payment Entry</h2><button type="button" aria-label="Close" disabled={saving} onClick={onClose}>&times;</button></header>
      <div className="transaction-edit-body">
        {error && <p className="error" role="alert">{error}</p>}
        {!form && !error && <p>Loading saved entry...</p>}
        {form && <fieldset disabled={saving}>
          <div className="transaction-edit-grid">
            <label>{label("Date", true)}<input type="date" required value={form.date || ""} onChange={event => update("date", event.target.value)}/></label>
            <label>{label("Ledger", true)}<SearchableSelect value={form.ledger} onChange={event => { const value = event.target.value; const picked = ledgers.find(item => sameId(item.id, value)); setForm(current => ({ ...current, ledger: value, ledger_group: picked?.group || current.ledger_group })); }}>
              <option value="">Select Ledger</option>{ledgerOptions.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
            </SearchableSelect></label>
            <label>{label("Resources")}<StaffDropdown api={api} auth={auth} value={form.done_by_staff} onChange={value => update("done_by_staff", value ? String(value) : "")} placeholder="Select staff" allowClear/></label>
            <label>{label("Amount", true)}<input type="number" min="0.01" step="0.01" required value={form.amount ?? ""} onChange={event => update("amount", event.target.value)}/></label>
            <label>{label("Payment Mode", true)}<select required value={form.payment_mode || ""} disabled={!modeOptions.length} onChange={event => chooseMode(event.target.value)}>
              <option value="">Select Mode</option>{modeOptions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select></label>
            {needsBank && <label>{label("Bank Account", true)}<SearchableSelect value={form.account} onChange={event => update("account", event.target.value)}>
              <option value="">Select Bank Account</option>{bankOptions.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
            </SearchableSelect></label>}
            {detailFields.map(([key, text, type]) => <label key={key}>{label(text, true)}<input type={type} required value={form[key] || ""} onChange={event => update(key, event.target.value)}/></label>)}
          </div>
          <label>{label("Notes")}<textarea rows="3" maxLength="200" value={form.notes || ""} onChange={event => update("notes", event.target.value)} placeholder="Enter notes..."/><small className="payment-edit-count">{(form.notes || "").length} / 200</small></label>
        </fieldset>}
      </div>
      <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={!form || saving}>{saving ? "Saving..." : "Save Changes"}</button></footer>
    </form>
  </div>;
}
