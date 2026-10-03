import { completeEntryOutput } from "../../utils/entryOutput";
import { useEffect, useState } from "react";
import { ACCOUNT_GROUPS, DynamicFields, Field, PAYMENT_MODE_OPTIONS, PaymentModeSelect, today } from "./CollectionEntry";
import "./collection-entry.css";
import "./payment-entry.css";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import { downloadPaymentVoucher, printPaymentVoucher } from "../../utils/paymentVoucher";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import SaveConfirmModal from "../../components/SaveConfirmModal";
import CashDenominationModal from "../../components/CashDenominationModal";
import StaffDropdown from "../../components/StaffDropdown/StaffDropdown";

const blank = () => ({ ledger_group: "", ledger: "", account: "", amount: "", payment_mode: "", date: today(), notes: "", done_by_staff: "" });
const SUNDRY_GROUPS = ["Sundry Debtors", "Sundry Creditors"];
const CASH_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10];

export default function PaymentEntry({ api, auth, go }) {
  const [form, setForm] = useState(blank), [details, setDetails] = useState({}), [accounts, setAccounts] = useState([]), [sundryLedgers, setSundryLedgers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [denomQty, setDenomQty] = useState({}), [coinsAmount, setCoinsAmount] = useState(""), [cashPopupOpen, setCashPopupOpen] = useState(false);
  const setDenomQuantity = (value, qty) => setDenomQty(current => ({ ...current, [value]: qty }));
  const cashRows = CASH_DENOMINATIONS.map(value => ({ value, qty: denomQty[value] || "", amount: Number(denomQty[value] || 0) * value }));
  const totalCashAmount = cashRows.reduce((sum, row) => sum + row.amount, 0) + Number(coinsAmount || 0);
  const selectedAccount = accounts.find(item => String(item.id) === String(form.account));
  const isCashAccount = selectedAccount?.group === "Cash-in-Hand";
  const modeOptions = !form.account ? [] : isCashAccount ? [["Cash", "Cash"]] : PAYMENT_MODE_OPTIONS.filter(([modeValue]) => modeValue !== "Cash");
  const [voucherBusy, setVoucherBusy] = useState(null);
  const [savedEntry, setSavedEntry] = useState(null);
  const { profile: companyProfile, refreshProfile } = useCompanyProfile() || {};
  const voucher = async (entry, action) => {
    if (voucherBusy) return;
    setVoucherBusy(`${action}-${entry.id}`);
    try {
      const profile = await (refreshProfile ? refreshProfile().catch(() => companyProfile) : companyProfile);
      if (savedEntry?.id === entry.id) {
        await completeEntryOutput(() => (action === "pdf" ? downloadPaymentVoucher : printPaymentVoucher)(entry, profile), action, "payment-voucher-print-frame", () => go("/payment-list"));
      } else {
        await (action === "pdf" ? downloadPaymentVoucher : printPaymentVoucher)(entry, profile);
      }
    } catch { setError("Unable to prepare the Payment Voucher."); }
    finally { setVoucherBusy(null); }
  };
  const setError = message => actionToast(message, false, 3000);
  const defaultAccount = rows => String(rows.find(item => item.name.trim().toLowerCase() === "cash")?.id || "");
  useEffect(() => { api.get("/finance/ledgers/", auth).then(({ data }) => { const all = data.results ?? data; const rows = all.filter(item => ACCOUNT_GROUPS.includes(item.group)); setAccounts(rows); setSundryLedgers(all.filter(item => SUNDRY_GROUPS.includes(item.group))); setForm(current => ({ ...current, account: current.account || defaultAccount(rows) })); }).catch(() => setError("Unable to load accounts.")); }, []);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const setDetail = (key, value) => setDetails(current => ({ ...current, [key]: value }));
  useEffect(() => { setForm(current => ({ ...current, payment_mode: "" })); setDetails({}); setCashPopupOpen(false); }, [form.account]);
  const reset = () => { setForm(current => ({ ...blank(), account: defaultAccount(accounts), done_by_staff: current.done_by_staff })); setDetails({}); setDenomQty({}); setCoinsAmount(""); setCashPopupOpen(false); };
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.ledger_group || !form.account || !form.date || !(Number(form.amount) > 0)) return setError("Ledger, Accounts, Date and an Amount greater than zero are required.");
    if (!form.done_by_staff) return setError("Done By is required.");
    const required = form.payment_mode === "UPI" ? ["upi_id", "transaction_utr"] : form.payment_mode === "Cheque" ? ["cheque_number", "cheque_date", "bank_name"] : form.payment_mode === "NEFT" ? ["transaction_utr", "bank_name"] : [];
    if (required.some(key => !String(details[key] || "").trim())) return setError("Complete the required payment details.");
    setSaving(true);
    try {
      const { data } = await api.post("/finance/payment-entries/", { ...form, ...details, cheque_date: details.cheque_date || null }, auth);
      reset(); setSavedEntry(data);
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to save Payment Entry.")); }
    finally { setSaving(false); }
  };
  return <div className="collection-entry-page payment-entry-page">
    <div className="collection-entry-heading">
      <nav className="pe-breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="pe-back" aria-label="Back" onClick={() => go("/payment-list")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"/></svg></button>
        <span>Transactions</span>
        <svg className="pe-sep" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        <strong>Payment Entry</strong>
      </nav>
      <label className="system-date">Date<input aria-label="Date" type="date" required value={form.date} onChange={event => update("date", event.target.value)}/></label>
    </div>
    <section className="collection-entry-card">
      <form onSubmit={save}>
        <div className="collection-entry-fields">
          <Field label="Ledger" required><select value={form.ledger} onChange={event => { const id = event.target.value; const picked = sundryLedgers.find(item => String(item.id) === id); setForm(current => ({ ...current, ledger: id, ledger_group: picked?.group || "" })); }}><option value="">Select Ledger</option>{sundryLedgers.map(item => <option key={item.id} value={item.id}>{item.name} - {item.group}</option>)}</select></Field>
          <Field label="Accounts" required><select value={form.account} onChange={event => update("account", event.target.value)}><option value="">Select Accounts</option>{accounts.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Done By" required><StaffDropdown api={api} auth={auth} value={form.done_by_staff} onChange={value => update("done_by_staff", value)} placeholder="Select staff" allowClear/></Field>
          <Field label="Amount" required><div className="currency-input"><span>₹</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={event => update("amount", event.target.value)} placeholder="0.00"/></div></Field>
          <div className="payment-mode-row"><Field label="Payment Mode" required><PaymentModeSelect value={form.payment_mode} modes={modeOptions} onChange={value => { update("payment_mode", value); if (value === "Cash") setCashPopupOpen(true); else setDetails({}); }}/>{form.payment_mode === "Cash" && totalCashAmount > 0 && <button type="button" className="cash-denom-chip" onClick={() => setCashPopupOpen(true)}>{formatINR(totalCashAmount)} entered · Edit</button>}</Field><DynamicFields mode={form.payment_mode} details={details} setDetail={setDetail}/></div>
          <Field label="Notes" className="entry-notes"><div className="notes-wrap"><textarea rows="3" maxLength="200" value={form.notes} onChange={event => update("notes", event.target.value)} placeholder="Enter notes..."/><small>{form.notes.length} / 200</small></div></Field>
        </div>
        <footer className="collection-entry-actions">
          <button type="button" onClick={() => go("/payment-list")}>Cancel</button>
          <button type="button" onClick={reset}>Reset</button>
          <button className="save-entry" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>
    {savedEntry && <SaveConfirmModal title="Payment Saved Successfully" subtitle="Your payment entry has been recorded." busy={voucherBusy === `pdf-${savedEntry.id}` ? "pdf" : voucherBusy === `print-${savedEntry.id}` ? "print" : null} onDownload={() => voucher(savedEntry, "pdf")} onPrint={() => voucher(savedEntry, "print")} onClose={() => { if (!voucherBusy) go("/payment-list"); }}/>}
    {cashPopupOpen && <CashDenominationModal rows={cashRows} coinsAmount={coinsAmount} onQtyChange={setDenomQuantity} onCoinsChange={setCoinsAmount} total={totalCashAmount} onClose={() => setCashPopupOpen(false)}/>}
  </div>;
}
