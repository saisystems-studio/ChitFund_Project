import { useEffect, useState } from "react";
import { ACCOUNT_GROUPS, DynamicFields, Field, LEDGER_OPTIONS, PaymentModeSelect, today } from "./CollectionEntry";
import "./collection-entry.css";
import "./payment-entry.css";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import { downloadPaymentVoucher, paymentVoucherNo, printPaymentVoucher } from "../../utils/paymentVoucher";
import { useCompanyProfile } from "../../components/CompanyProfileContext";

const blank = () => ({ ledger_group: "", account: "", amount: "", payment_mode: "Cash", date: today(), notes: "" });

export default function PaymentEntry({ api, auth, go }) {
  const [form, setForm] = useState(blank), [details, setDetails] = useState({}), [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]), [voucherBusy, setVoucherBusy] = useState(null);
  const { profile: companyProfile, refreshProfile } = useCompanyProfile() || {};
  const loadHistory = () => api.get("/finance/payment-entries/", { ...auth, params: { page_size: 100 } }).then(({ data }) => setHistory(data.results ?? data)).catch(() => setError("Unable to load Payment History."));
  useEffect(() => { loadHistory(); }, []);
  const voucher = async (entry, action) => {
    if (voucherBusy) return;
    setVoucherBusy(`${action}-${entry.id}`);
    try {
      const profile = await (refreshProfile ? refreshProfile().catch(() => companyProfile) : companyProfile);
      await (action === "pdf" ? downloadPaymentVoucher : printPaymentVoucher)(entry, profile);
    } catch { setError("Unable to prepare the Payment Voucher."); }
    finally { setVoucherBusy(null); }
  };
  const setError = message => actionToast(message, false, 3000), setSuccess = message => actionToast(message, true, 3000);
  const defaultAccount = rows => String(rows.find(item => item.name.trim().toLowerCase() === "cash")?.id || "");
  useEffect(() => { api.get("/finance/ledgers/", auth).then(({ data }) => { const rows = (data.results ?? data).filter(item => ACCOUNT_GROUPS.includes(item.group)); setAccounts(rows); setForm(current => ({ ...current, account: current.account || defaultAccount(rows) })); }).catch(() => setError("Unable to load accounts.")); }, []);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const setDetail = (key, value) => setDetails(current => ({ ...current, [key]: value }));
  const reset = () => { setForm({ ...blank(), account: defaultAccount(accounts) }); setDetails({}); };
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.ledger_group || !form.account || !form.date || !(Number(form.amount) > 0)) return setError("Ledger, Accounts, Date and an Amount greater than zero are required.");
    const required = form.payment_mode === "UPI" ? ["upi_id", "transaction_utr"] : form.payment_mode === "Cheque" ? ["cheque_number", "cheque_date", "bank_name"] : form.payment_mode === "NEFT" ? ["transaction_utr", "bank_name"] : [];
    if (required.some(key => !String(details[key] || "").trim())) return setError("Complete the required payment details.");
    setSaving(true);
    try {
      await api.post("/finance/payment-entries/", { ...form, ...details, cheque_date: details.cheque_date || null }, auth);
      reset(); setSuccess("Payment Entry saved successfully."); loadHistory();
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to save Payment Entry.")); }
    finally { setSaving(false); }
  };
  return <div className="collection-entry-page payment-entry-page">
    <div className="collection-entry-heading">
      <nav className="pe-breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="pe-back" aria-label="Back" onClick={() => go("/dashboard")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"/></svg></button>
        <span>Transactions</span>
        <svg className="pe-sep" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        <strong>Payment Entry</strong>
      </nav>
      <label className="system-date">Date<input aria-label="Date" type="date" required value={form.date} onChange={event => update("date", event.target.value)}/></label>
    </div>
    <section className="collection-entry-card">
      <form onSubmit={save}>
        <div className="collection-entry-fields">
          <Field label="Ledger" required><select value={form.ledger_group} onChange={event => update("ledger_group", event.target.value)}><option value="">Select Ledger</option>{LEDGER_OPTIONS.map(item => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Accounts" required><select value={form.account} onChange={event => update("account", event.target.value)}><option value="">Select Accounts</option>{accounts.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Amount" required><div className="currency-input"><span>₹</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={event => update("amount", event.target.value)} placeholder="0.00"/></div></Field>
          <div className="payment-mode-row"><Field label="Payment Mode" required><PaymentModeSelect value={form.payment_mode} onChange={value => { update("payment_mode", value); setDetails({}); }}/></Field><DynamicFields mode={form.payment_mode} details={details} setDetail={setDetail}/></div>
          <Field label="Notes" className="entry-notes"><div className="notes-wrap"><textarea rows="3" maxLength="200" value={form.notes} onChange={event => update("notes", event.target.value)} placeholder="Enter notes..."/><small>{form.notes.length} / 200</small></div></Field>
        </div>
        <footer className="collection-entry-actions">
          <button type="button" onClick={() => go("/dashboard")}>Cancel</button>
          <button type="button" onClick={reset}>Reset</button>
          <button className="save-entry" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>
    <section className="collection-entry-card pe-history">
      <h2>Payment History</h2>
      <div className="pe-history-wrap"><table><thead><tr><th>S.No</th><th>Date</th><th>Voucher No</th><th>Ledger</th><th>Accounts</th><th>Mode</th><th className="pe-amount">Amount</th><th className="pe-voucher-col">Voucher</th></tr></thead>
        <tbody>{history.map((entry, index) => <tr key={entry.id}><td>{index + 1}</td><td>{String(entry.date || "").split("-").reverse().join("/")}</td><td className="mono">{paymentVoucherNo(entry)}</td><td>{entry.ledger_group || entry.ledger_name || "—"}</td><td>{entry.account_name || entry.accounts || "—"}</td><td>{entry.payment_mode === "NEFT" ? "NEFT/IMPS/RGST" : entry.payment_mode}</td><td className="pe-amount">{formatINR(entry.amount)}</td>
          <td className="pe-voucher-col"><div className="report-receipt-actions">
            <button type="button" className="report-receipt-button receipt-pdf" aria-label="Download PDF voucher" title="Download PDF voucher" disabled={Boolean(voucherBusy)} onClick={() => voucher(entry, "pdf")}>{voucherBusy === `pdf-${entry.id}` ? <span className="report-receipt-spinner" aria-hidden="true"/> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M12 12v6m-3-3 3 3 3-3"/></svg>}</button>
            <button type="button" className="report-receipt-button receipt-print" aria-label="Print voucher" title="Print voucher" disabled={Boolean(voucherBusy)} onClick={() => voucher(entry, "print")}>{voucherBusy === `print-${entry.id}` ? <span className="report-receipt-spinner" aria-hidden="true"/> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></svg>}</button>
          </div></td></tr>)}</tbody></table>{!history.length && <div className="pe-history-empty">No payment entries saved yet.</div>}</div>
    </section>
  </div>;
}
