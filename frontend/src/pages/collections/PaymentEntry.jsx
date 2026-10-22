import PageBreadcrumb from "../../components/PageBreadcrumb";
import { completeEntryOutput } from "../../utils/entryOutput";
import { useEffect, useRef, useState } from "react";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import { AccountSelect, Field, ledgerBalanceLabel, PaymentModeSelect, isAccountLedger, isCashAccount, modesForAccount, nextModeFor, today } from "./CollectionEntry";
import "./collection-entry.css";
import "./payment-entry.css";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import { downloadPaymentVoucher, printPaymentVoucher } from "../../utils/paymentVoucher";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import SaveConfirmModal from "../../components/SaveConfirmModal";
import CashDenominationModal from "../../components/CashDenominationModal";
import DenominationToggle from "../../components/DenominationToggle";
import StaffDropdown from "../../components/StaffDropdown/StaffDropdown";
import LedgerSelect from "../../components/LedgerSelect/LedgerSelect";
import { clearLedgerReturn, incomingLedgerReturn, startLedgerCreate } from "../../utils/ledgerReturn";

const blank = () => ({ ledger_group: "", ledger: "", loan: "", account: "", amount: "", payment_mode: "", date: today(), notes: "", done_by_staff: "" });
export const SUNDRY_GROUPS = ["Sundry Debtors", "Sundry Creditors"];
const CASH_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10];
const ORIGIN = "/payment-entry";
// Payment Entry fields per payment mode — only these are shown, validated and submitted.
export const MODE_FIELDS = {
  UPI: [["transaction_utr", "UTR / Transaction Reference No.", "text"]],
  NEFT: [["transaction_utr", "UTR / Reference No.", "text"], ["bank_name", "Bank Name", "text"]],
  RTGS: [["transaction_utr", "UTR / Reference No.", "text"], ["bank_name", "Bank Name", "text"]],
  IMPS: [["transaction_utr", "UTR / Reference No.", "text"], ["bank_name", "Bank Name", "text"]],
  Cheque: [["cheque_number", "Cheque Number", "text"], ["cheque_date", "Cheque Date", "date"], ["bank_name", "Bank Name", "text"]],
};
export const modeFields = mode => MODE_FIELDS[mode] || [];
// Bank (non-Cash) modes post to a ledger from the Bank Accounts group; Cash posts to Cash in Hand.
export const needsBankAccount = mode => Boolean(mode) && mode !== "Cash";

export default function PaymentEntry({ api, auth, go }) {
  // Returning from Add Ledger (+): restore the in-progress entry exactly as it was left.
  const [incoming] = useState(() => incomingLedgerReturn(ORIGIN));
  const draft = incoming?.draft || {};
  const [form, setForm] = useState(() => draft.form || blank()), [details, setDetails] = useState(() => draft.details || {}), [accounts, setAccounts] = useState([]), [sundryLedgers, setSundryLedgers] = useState([]), [loans, setLoans] = useState([]);
  const [saving, setSaving] = useState(false);
  const [denomQty, setDenomQty] = useState(() => draft.denomQty || {}), [coinsAmount, setCoinsAmount] = useState(() => draft.coinsAmount || ""), [cashPopupOpen, setCashPopupOpen] = useState(false), [denomEnabled, setDenomEnabled] = useState(() => Boolean(draft.denomEnabled));
  const setDenomQuantity = (value, qty) => setDenomQty(current => ({ ...current, [value]: qty }));
  const clearDenomination = () => { setDenomEnabled(false); setCashPopupOpen(false); setDenomQty({}); setCoinsAmount(""); };
  const toggleDenomination = checked => { if (checked) { setDenomEnabled(true); setCashPopupOpen(true); } else clearDenomination(); };
  const cashRows = CASH_DENOMINATIONS.map(value => ({ value, qty: denomQty[value] || "", amount: Number(denomQty[value] || 0) * value }));
  const totalCashAmount = cashRows.reduce((sum, row) => sum + row.amount, 0) + Number(coinsAmount || 0);
  // The selected Account drives Payment Mode: Cash in Hand is always Cash; a Bank account offers the bank modes.
  const account = accounts.find(item => String(item.id) === String(form.account));
  const isCashMode = form.payment_mode === "Cash";
  const modeOptions = modesForAccount(account);
  const chooseAccount = id => { const next = accounts.find(item => String(item.id) === String(id)); setForm(current => ({ ...current, account: id, payment_mode: nextModeFor(next, current.payment_mode) })); };
  const [voucherBusy, setVoucherBusy] = useState(null);
  const [savedEntry, setSavedEntry] = useState(null);
  const { profile: companyProfile, refreshProfile } = useCompanyProfile() || {};
  const voucher = async (entry, action) => {
    if (voucherBusy) return;
    setVoucherBusy(`${action}-${entry.id}`);
    try {
      const profile = await (refreshProfile ? refreshProfile().catch(() => companyProfile) : companyProfile);
      if (savedEntry?.id === entry.id) {
        await completeEntryOutput(() => (action === "pdf" ? downloadPaymentVoucher : printPaymentVoucher)(entry, profile), action, "payment-voucher-print-frame", () => setSavedEntry(null));
      } else {
        await (action === "pdf" ? downloadPaymentVoucher : printPaymentVoucher)(entry, profile);
      }
    } catch { setError("Unable to prepare the Payment Voucher."); }
    finally { setVoucherBusy(null); }
  };
  const setError = message => actionToast(message, false, 3000);
  useEffect(() => { api.get("/finance/ledgers/", auth).then(({ data }) => {
    // Cash in Hand / Bank Accounts ledgers go to Accounts only; every other ledger to Ledger.
    const all = data.results ?? data; const sundry = all.filter(item => !isAccountLedger(item));
    setAccounts(all.filter(isAccountLedger)); setSundryLedgers(sundry);
    // Select the ledger just created from (+), only if it is eligible for this field.
    if (incoming?.createdId) {
      const created = sundry.find(item => String(item.id) === String(incoming.createdId));
      if (created) setForm(current => ({ ...current, ledger: String(created.id), ledger_group: created.group }));
      else setError("The new ledger's group is not available for Payment Entry.");
    }
    if (incoming) clearLedgerReturn();
  }).catch(() => setError("Unable to load accounts.")); }, []);
  useEffect(() => { api.get("/finance/loans/", { ...auth, params: { page_size: 1000 } }).then(({ data }) => setLoans(data.results ?? data ?? [])).catch(() => {}); }, []);
  const addLedger = () => startLedgerCreate(go, { origin: ORIGIN, field: "ledger", draft: { form, details, denomQty, coinsAmount, denomEnabled } });
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const setDetail = (key, value) => setDetails(current => ({ ...current, [key]: value }));
  // Changing the Payment Mode clears what no longer applies (not on mount / draft restore):
  // the previous mode's payment details, and the cash denomination for a bank mode.
  const lastMode = useRef(form.payment_mode);
  useEffect(() => { if (lastMode.current === form.payment_mode) return; lastMode.current = form.payment_mode; setDetails({}); if (!isCashMode) clearDenomination(); }, [form.payment_mode]);
  const reset = () => { setForm(current => ({ ...blank(), done_by_staff: current.done_by_staff })); setDetails({}); clearDenomination(); };
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.ledger_group || !form.date || !(Number(form.amount) > 0)) return setError("Ledger, Date and an Amount greater than zero are required.");
    if (!account) return setError("Select an Account.");
    if (!form.payment_mode) return setError("Select a Payment Mode.");
    const required = modeFields(form.payment_mode).map(([key]) => key);
    if (required.some(key => !String(details[key] || "").trim())) return setError("Complete the required payment details.");
    const modeDetails = Object.fromEntries(required.map(key => [key, details[key]]));
    setSaving(true);
    try {
      const { data } = await api.post("/finance/payment-entries/", { ...form, loan: form.loan || null, ...modeDetails, account: form.account, cheque_date: modeDetails.cheque_date || null, done_by_staff: form.done_by_staff || null }, auth);
      // Stay on Payment Entry: clear every entered value (including Resources) for the next entry.
      setForm(blank()); setDetails({}); clearDenomination(); setSavedEntry(data);
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to save Payment Entry.")); }
    finally { setSaving(false); }
  };
  const selectedLedger = sundryLedgers.find(item => String(item.id) === String(form.ledger));
  // Optional Loan Plan: only the selected ledger's own customer loans; empty = direct party-ledger payment (null on save).
  const ledgerCustomer = selectedLedger?.customer != null && selectedLedger.customer !== "" ? String(selectedLedger.customer?.id ?? selectedLedger.customer) : "";
  const ledgerLoans = ledgerCustomer ? loans.filter(x => String(x.customer?.id ?? x.customer_id) === ledgerCustomer && x.status !== "Completed") : [];
  const loanLabel = x => `${x.loan_no} · ${x.loan_type?.name || "Loan"}${x.plan?.name ? ` · ${x.plan.name}` : ""}`;
  // Preview-only: the chosen ledger's balance and dues from the existing party summary endpoint.
  const [ledgerInfo, setLedgerInfo] = useState(null);
  useEffect(() => {
    setLedgerInfo(null);
    if (!form.ledger) return;
    let active = true;
    api.get("/finance/party-collections/summary/", { ...auth, params: { party: form.ledger } })
      .then(({ data }) => { if (active) setLedgerInfo(data); })
      .catch(() => { if (active) setLedgerInfo({}); });
    return () => { active = false; };
  }, [form.ledger]);
  return <div className="ce-fill"><div className="collection-entry-page payment-entry-page ce-v2">
    <div className="collection-entry-heading">
      <PageBreadcrumb className="pe-breadcrumb" current="Payment Entry" />
      <label className="system-date">Date<input aria-label="Date" type="date" required value={form.date} onChange={event => update("date", event.target.value)}/></label>
    </div>
    <section className="collection-entry-card">
      <form onSubmit={save}>
        <div className="ce-v2-body"><div className="ce-v2-fields"><div className="ce-v2-grid">
          <Field label="Ledger" required><LedgerSelect value={form.ledger} options={sundryLedgers} onAdd={addLedger} onChange={id => { const picked = sundryLedgers.find(item => String(item.id) === id); setForm(current => ({ ...current, ledger: id, ledger_group: picked?.group || "", loan: "" })); }}/></Field>
          <Field label="Accounts" required><AccountSelect value={form.account} accounts={accounts} onChange={chooseAccount}/></Field>
          <Field label="Loan Plan" className={ledgerLoans.length ? "" : "ce-v2-disabled"}><SearchableSelect value={form.loan} disabled={!ledgerLoans.length} onChange={event => update("loan", event.target.value)}><option value="">Select (No Loan Plan)</option>{ledgerLoans.map(x => <option value={x.id} key={x.id}>{loanLabel(x)}</option>)}</SearchableSelect></Field>
          <Field label="Amount" required><div className="currency-input"><span>₹</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={event => update("amount", event.target.value)} placeholder="0.00"/></div></Field>
          <Field label="Payment Mode" required><PaymentModeSelect value={form.payment_mode} modes={modeOptions} locked={isCashAccount(account)} onChange={value => update("payment_mode", value)}/>{isCashMode && <DenominationToggle checked={denomEnabled} onChange={toggleDenomination}/>}{isCashMode && denomEnabled && totalCashAmount > 0 && <button type="button" className="cash-denom-chip" onClick={() => setCashPopupOpen(true)}>{formatINR(totalCashAmount)} entered · Edit</button>}</Field>
          <Field label="Resources"><StaffDropdown api={api} auth={auth} value={form.done_by_staff} onChange={value => update("done_by_staff", value)} placeholder="Select resource" allowClear/></Field>
          <div className="pe-payment-details">{modeFields(form.payment_mode).map(([key, label, type]) => <Field key={key} label={label} required><input type={type} value={details[key] || ""} onChange={event => setDetail(key, event.target.value)}/></Field>)}</div>
          <Field label="Notes" className="entry-notes"><div className="notes-wrap"><textarea rows="2" maxLength="200" value={form.notes} onChange={event => update("notes", event.target.value)} placeholder="Enter notes..."/><small>{form.notes.length} / 200</small></div></Field>
          </div>
        </div>
        <aside className="ce-v2-preview pe-preview" aria-label="Payment Preview">
          <h2>Payment Preview</h2>
          <dl>{[["Ledger Balance", !selectedLedger ? formatINR(0) : ledgerInfo ? ledgerBalanceLabel(ledgerInfo) : "Loading..."], ["Outstanding", !selectedLedger ? formatINR(0) : ledgerInfo ? formatINR(ledgerInfo.remaining_outstanding || 0) : "Loading..."], ["Payment Mode", form.payment_mode]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "-"}</dd></div>)}</dl>
          <div className="pe-total"><span>Total Amount</span><strong>{formatINR(form.amount || 0)}</strong></div>
        </aside></div>
        <footer className="collection-entry-actions">
          <button type="button" onClick={() => go("/payment-list")}>Cancel</button>
          <button type="button" onClick={reset}>Reset</button>
          <button className="save-entry" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>
    {savedEntry && <SaveConfirmModal title="Payment Saved Successfully" subtitle="Your payment entry has been recorded." busy={voucherBusy === `pdf-${savedEntry.id}` ? "pdf" : voucherBusy === `print-${savedEntry.id}` ? "print" : null} onDownload={() => voucher(savedEntry, "pdf")} onPrint={() => voucher(savedEntry, "print")} onClose={() => { if (!voucherBusy) setSavedEntry(null); }}/>}
    {isCashMode && denomEnabled && cashPopupOpen && <CashDenominationModal rows={cashRows} coinsAmount={coinsAmount} onQtyChange={setDenomQuantity} onCoinsChange={setCoinsAmount} total={totalCashAmount} onClose={() => setCashPopupOpen(false)}/>}
  </div></div>;
}
