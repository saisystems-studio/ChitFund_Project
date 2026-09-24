import { useEffect, useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import { DynamicFields, PaymentModeSelect, today } from "./CollectionEntry";
import "./collection-entry.css";
import "./payment-entry.css";
import { actionToast } from "../../utils/actionToast";

const blank = () => ({ ledger: "", accounts: "", amount: "", payment_mode: "Cash", date: today() });

export default function PaymentEntry({ api, auth, go }) {
  const [form, setForm] = useState(blank), [details, setDetails] = useState({}), [ledgers, setLedgers] = useState([]);
  const [saving, setSaving] = useState(false);
  const setError = message => actionToast(message, false, 3000), setSuccess = message => actionToast(message, true, 3000);
  useEffect(() => { api.get("/finance/ledgers/", auth).then(({ data }) => setLedgers(data.results ?? data)).catch(() => setError("Unable to load ledgers.")); }, []);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const setDetail = (key, value) => setDetails(current => ({ ...current, [key]: value }));
  const reset = () => { setForm(blank()); setDetails({}); };
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.ledger || !form.accounts || !form.date || !(Number(form.amount) > 0)) return setError("Ledger, Accounts, Date and an Amount greater than zero are required.");
    const required = form.payment_mode === "UPI" ? ["upi_id", "transaction_utr"] : form.payment_mode === "Cheque" ? ["cheque_number", "cheque_date", "bank_name"] : form.payment_mode === "NEFT" ? ["transaction_utr", "bank_name"] : [];
    if (required.some(key => !String(details[key] || "").trim())) return setError("Complete the required payment details.");
    setSaving(true);
    try {
      await api.post("/finance/payment-entries/", { ...form, ...details, cheque_date: details.cheque_date || null }, auth);
      reset(); setSuccess("Payment Entry saved successfully.");
    } catch (requestError) { setError(requestError.response?.data?.detail || JSON.stringify(requestError.response?.data || "Unable to save Payment Entry.")); }
    finally { setSaving(false); }
  };
  return <div className="pe-page">
    <nav className="pe-breadcrumb" aria-label="Breadcrumb">
      <button type="button" className="pe-back" aria-label="Back" onClick={() => go("/dashboard")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"/></svg></button>
      <span>Transactions</span>
      <svg className="pe-sep" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
      <strong>Payment Entry</strong>
    </nav>
    <section className="pe-card">
      <form onSubmit={save}>
        <header className="pe-head">
          <div className="pe-title">
            <span className="pe-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h8M8 9h3"/></svg></span>
            <div><h2>Payment Entry</h2><p>Record payments against ledgers</p></div>
          </div>
          <label className="pe-date">
            <span className="pe-addon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/></svg></span>
            <span className="pe-date-body"><small>Date <i>*</i></small><input type="date" required value={form.date} onChange={event => update("date", event.target.value)}/></span>
          </label>
        </header>
        <div className="pe-fields">
          <div className="pe-field"><span className="pe-label">Ledger Name <i>*</i></span><span className="pe-control pe-dropdown"><span className="pe-addon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a1 1 0 0 1 1-1h5a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5a1 1 0 0 1-1-1V5ZM20 5a1 1 0 0 0-1-1h-5a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h5a1 1 0 0 0 1-1V5Z"/></svg></span><SearchableDropdown value={form.ledger} options={ledgers.map(item => ({ value: item.id, label: item.name }))} onChange={value => update("ledger", value)} placeholder="Select Ledger"/></span></div>
          <label className="pe-field"><span className="pe-label">Accounts <i>*</i></span><span className="pe-control"><span className="pe-addon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg></span><select required value={form.accounts} onChange={event => update("accounts", event.target.value)}><option value="">Select Accounts</option><option>Card</option><option>Credit</option></select></span></label>
          <label className="pe-field"><span className="pe-label">Amount <i>*</i></span><span className="pe-control"><span className="pe-addon pe-rupee">₹</span><input required type="number" min="0.01" step="0.01" placeholder="Enter amount" value={form.amount} onChange={event => update("amount", event.target.value)}/></span></label>
          <label className="pe-field"><span className="pe-label">Payment Mode <i>*</i></span><span className="pe-control"><span className="pe-addon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg></span><PaymentModeSelect value={form.payment_mode} onChange={value => { update("payment_mode", value); setDetails({}); }}/></span></label>
          <DynamicFields mode={form.payment_mode} details={details} setDetail={setDetail}/>
        </div>
        <footer className="pe-actions">
          <button type="button" className="pe-cancel" onClick={() => go("/dashboard")}>Cancel</button>
          <button type="button" className="pe-reset" onClick={reset}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>Reset</button>
          <button className="pe-save" disabled={saving}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>
  </div>;
}
