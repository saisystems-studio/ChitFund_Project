import { sortPendingDues } from "../../utils/fifoAllocation";
import { completeEntryOutput } from "../../utils/entryOutput";
import { useEffect, useMemo, useRef, useState } from "react";
import "./collection-entry.css";
import "./collection-entry-v2.css";
import { formatINR } from "../../utils/currency";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import SaveConfirmModal from "../../components/SaveConfirmModal";
import CashDenominationModal from "../../components/CashDenominationModal";
import DenominationToggle from "../../components/DenominationToggle";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadReceipt, printReceipt } from "../../utils/collectionReceipt";
import StaffDropdown from "../../components/StaffDropdown/StaffDropdown";
import { clearLedgerReturn, incomingLedgerReturn } from "../../utils/ledgerReturn";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import { actionToast } from "../../utils/actionToast";

const CASH_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10];
const ORIGIN = "/collection-entry";

const money = formatINR;
const rowsOf = data => data?.results ?? data ?? [];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const LEDGER_OPTIONS = ["Sundry Debtors", "Sundry Creditors", "Indirect Expense", "Direct Expense", "Income"];
const ACCOUNT_GROUPS = ["Cash-in-Hand", "Bank Accounts"];
const apiError = (e, fallback) => { const data = e.response?.data; if (typeof data?.detail === "string") return data.detail; if (data && typeof data === "object") { const messages = Object.values(data).flat().filter(x => typeof x === "string"); if (messages.length) return messages.join(" "); } return e.response ? `${fallback} (server error ${e.response.status})` : `${fallback} Check that the server is running.`; };
const balanceOf = item => Number(item.balance ?? Number(item.installment_amount || 0) - Number(item.paid_amount || 0));
// Ledger balance from the party summary: "₹1,000.00 Dr" / "Cr" (outstanding is the absolute closing balance).
export const ledgerBalanceLabel = info => info?.outstanding == null ? money(0) : `${money(info.outstanding)} ${info.outstanding_type === "CR" ? "Cr" : "Dr"}`;
const cents = value => Math.round(Number(value || 0) * 100);
const fromCents = value => (value / 100).toFixed(2);
// Ledger collection types retain their existing due allocation and advance rules.
const isCollectionParty = item => item?.group === "Sundry Debtors" && Boolean(item?.collection_type);

// Collection Entry: fields on the left, live dues and allocation on the right.
// A ledger linked to a customer with loans (Scenario A) collects against the chosen loan's
// installments, allocated due by due in the Pending List. A ledger without loans (Scenario B)
// keeps Loan Plan visible but disabled and records the collection against the ledger itself
// (Dr Cash/Bank, Cr Ledger).
export default function CollectionEntry({ api, auth, go }) {
  // Returning from Add Ledger (+): restore the in-progress entry exactly as it was left.
  const [incoming] = useState(() => incomingLedgerReturn(ORIGIN));
  const draft = incoming?.draft || {};
  // While restoring, the "reset on ledger/loan/account change" effects below must not
  // overwrite the restored values; released once customers/loans have loaded.
  const restoring = useRef(Boolean(incoming));
  const [dataReady, setDataReady] = useState(false);
  const [collectionDate, setCollectionDate] = useState(() => draft.collectionDate || today());
  const [customers, setCustomers] = useState([]), [loans, setLoans] = useState([]), [customerId, setCustomerId] = useState(draft.customerId || ""), [loanId, setLoanId] = useState(draft.loanId || "");
  const [search, setSearch] = useState(""), [customerOpen, setCustomerOpen] = useState(false), [mode, setMode] = useState(draft.mode || ""), [details, setDetails] = useState(draft.details || {});
  // Collection Amount follows the allocated dues until the user types an amount of their own.
  const [amount, setAmount] = useState(draft.amount || ""), [amountTouched, setAmountTouched] = useState(Boolean(draft.amountTouched));
  const [notes, setNotes] = useState(draft.notes || "");
  const [accounts, setAccounts] = useState([]), [accountId, setAccountId] = useState(draft.accountId || ""), [allLedgers, setAllLedgers] = useState([]);
  // Ledger field: any Ledger Master ledger except Cash/Bank. A ledger linked to a customer
  // selects that customer internally (Customer ID <-> Ledger ID), so its loans are listed.
  const [partyLedgerId, setPartyLedgerId] = useState(draft.partyLedgerId || "");
  const [doneByStaff, setDoneByStaff] = useState(draft.doneByStaff || "");
  // {installment id: allocated amount} -- the checked pending dues.
  const manualAllocation = useRef(false), inFlight = useRef(false), requestIdentity = useRef(null);
  const [allocs, setAllocs] = useState(draft.allocs || {});
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null), [receiptBusy, setReceiptBusy] = useState(null);
  const { profile: companyProfile, refreshProfile } = useCompanyProfile() || {};
  const [denomQty, setDenomQty] = useState(draft.denomQty || {}), [coinsAmount, setCoinsAmount] = useState(draft.coinsAmount || ""), [cashPopupOpen, setCashPopupOpen] = useState(false), [denomEnabled, setDenomEnabled] = useState(Boolean(draft.denomEnabled));
  const setDenomQuantity = (value, qty) => setDenomQty(current => ({ ...current, [value]: qty }));
  const clearDenomination = () => { setDenomEnabled(false); setCashPopupOpen(false); setDenomQty({}); setCoinsAmount(""); };
  const toggleDenomination = checked => { if (checked) { setDenomEnabled(true); setCashPopupOpen(true); } else clearDenomination(); };
  const cashRows = CASH_DENOMINATIONS.map(value => ({ value, qty: denomQty[value] || "", amount: Number(denomQty[value] || 0) * value }));
  const totalCashAmount = cashRows.reduce((sum, row) => sum + row.amount, 0) + Number(coinsAmount || 0);
  const loadLoans = () => api.get("/finance/loans/", { ...auth, params: { page_size: 1000 } }).then(({ data }) => setLoans(rowsOf(data)));
  useEffect(() => { Promise.all([api.get("/customers/", { ...auth, params: { page_size: 1000 } }), loadLoans()]).then(([c]) => setCustomers(rowsOf(c.data))).catch(() => setError("Unable to load collection data.")).finally(() => setDataReady(true)); api.get("/finance/ledgers/", auth).then(({ data }) => { const all = rowsOf(data); setAccounts(all.filter(isAccountLedger)); setAllLedgers(all.filter(x => !isAccountLedger(x))); if (incoming) clearLedgerReturn(); }).catch(() => setError("Unable to load accounts.")); }, []);
  // The selected Account drives Payment Mode: a Cash in Hand account is always Cash
  // (denomination offered); a Bank account offers the bank modes only.
  const account = accounts.find(x => String(x.id) === String(accountId));
  const isCashMode = mode === "Cash";
  const modeOptions = modesForAccount(account);
  const chooseAccount = id => { const next = accounts.find(x => String(x.id) === String(id)); setAccountId(id); setMode(current => nextModeFor(next, current)); };
  const customerOfLedger = item => item?.customer != null && item.customer !== "" ? String(item.customer?.id ?? item.customer) : "";
  // Shown ledger: the one picked, else (restored draft) that customer's own ledger.
  const partyLedger = allLedgers.find(x => String(x.id) === String(partyLedgerId))
    || (customerId ? allLedgers.find(x => customerOfLedger(x) === String(customerId)) : undefined);
  // Customer linked to the shown ledger (Customer_tbl <-> Ledger_tbl); empty for ledgers like Rent.
  const activeCustomerId = customerOfLedger(partyLedger);
  const customer = customers.find(x => String(x.id) === activeCustomerId);
  const customerById = useMemo(() => Object.fromEntries(customers.map(x => [String(x.id), x])), [customers]);
  // Search by ledger name, plus the linked customer's code / phone (display stays name only).
  const ledgerMatches = item => { const c = customerById[customerOfLedger(item)]; return `${item.name} ${c?.customer_code || ""} ${c?.primary_mobile || ""}`.toLowerCase().includes(search.trim().toLowerCase()); };
  const chooseParty = item => { const nextCustomer = customerOfLedger(item); setPartyLedgerId(String(item.id)); if (String(item.id) !== String(partyLedgerId) && !amountTouched) setAmount(""); if (nextCustomer !== String(customerId)) { setCustomerId(nextCustomer); setLoanId(""); } setSearch(""); setCustomerOpen(false); setError(""); };
  // Only loans that belong to the selected ledger's own customer.
  const customerLoans = activeCustomerId ? loans.filter(x => String(x.customer?.id ?? x.customer_id) === activeCustomerId && x.status !== "Completed") : [];
  const [loanDetail, setLoanDetail] = useState(null), [loanLoading, setLoanLoading] = useState(false);
  const loan = (String(loanDetail?.id) === String(loanId) ? loanDetail : null) || customerLoans.find(x => String(x.id) === String(loanId));
  useEffect(() => {
    setLoanDetail(null);
    if (!loanId) { setLoanLoading(false); return; }
    let active = true; setLoanLoading(true);
    api.get(`/finance/loans/${loanId}/`, auth).then(({ data }) => { if (active) setLoanDetail(data); })
      .catch(e => { if (active) setError(apiError(e, "Unable to refresh pending installments.")); })
      .finally(() => { if (active) setLoanLoading(false); });
    return () => { active = false; };
  }, [loanId]);
  const hasLoans = customerLoans.length > 0;
  // Scenario B: a ledger without loans is collected directly against the ledger.
  const ledgerOnly = Boolean(partyLedger) && dataReady && !hasLoans;
  const partyCollection = ledgerOnly && isCollectionParty(partyLedger);
  const normalLedger = ledgerOnly && !partyCollection;
  const [partySummary, setPartySummary] = useState(null), [partyLoading, setPartyLoading] = useState(false);
  const [partyAllocs, setPartyAllocs] = useState({}), [, setOthers] = useState(""), [advanceOn, setAdvanceOn] = useState(true);
  // Others (Advance) takes the whole Amount as unallocated credit; otherwise only dues are paid.
  const others = normalLedger || advanceOn || (hasLoans && !loan) ? amount : "";
  useEffect(() => {
    setPartySummary(null); setPartyAllocs({}); setOthers("");
    if (!ledgerOnly) return;
    let active = true; setPartyLoading(true);
    api.get("/finance/party-collections/summary/", { ...auth, params: { party: partyLedger.id } })
      .then(({ data }) => { if (active) setPartySummary(data); })
      .catch(e => { if (active) setError(apiError(e, "Unable to load ledger dues.")); })
      .finally(() => { if (active) setPartyLoading(false); });
    return () => { active = false; };
  }, [partyLedger?.id, ledgerOnly]);
  // Preview-only: the shown ledger's own balance (Ledger Balance) and dues, from the same summary endpoint.
  const [ledgerInfo, setLedgerInfo] = useState(null);
  useEffect(() => {
    setLedgerInfo(null);
    if (!partyLedger?.id) return;
    let active = true;
    api.get("/finance/party-collections/summary/", { ...auth, params: { party: partyLedger.id } })
      .then(({ data }) => { if (active) setLedgerInfo(data); })
      .catch(() => { if (active) setLedgerInfo({}); });
    return () => { active = false; };
  }, [partyLedger?.id]);
  const partyDues = sortPendingDues(partySummary?.dues || [], row => row.pending);
  const partyDueWise = partyCollection && partyLedger.collection_type === "DUE_WISE";
  const partyAllocated = Object.values(partyAllocs).reduce((sum, value) => sum + cents(value), 0) + cents(others);
  const partyRemaining = cents(amount) - partyAllocated;
  const togglePartyDue = row => { manualAllocation.current = true; setPartyAllocs(current => {
    if (row.id in current) { const { [row.id]: _, ...rest } = current; return rest; }
    const left = Math.max(0, cents(amount) - Object.values(current).reduce((sum, value) => sum + cents(value), 0) - cents(others));
    if (left <= 0) return current;
    return { ...current, [row.id]: fromCents(Math.min(left, cents(row.pending))) };
  }); };
  const installments = loan?.installments || [];
  const pendingRows = sortPendingDues(installments, balanceOf);
  const allocatedCents = pendingRows.reduce((sum, row) => sum + (row.id in allocs ? cents(allocs[row.id]) : 0), 0) + cents(others);
  const remainingCents = cents(amount) - allocatedCents;
  const loanPending = pendingRows.reduce((s, x) => s + balanceOf(x), 0);
  // Others is the default mode; the Pending List can be chosen only when the ledger actually has dues.
  const hasDues = loan ? pendingRows.length > 0 : partyDueWise ? partyDues.length > 0 : false;
  useEffect(() => { manualAllocation.current = false; setOthers(""); setAdvanceOn(true); }, [loanId, partyLedger?.id]);
  const pendingSignature = pendingRows.map(row => `${row.id}:${row.due_date}:${balanceOf(row)}`).join("|");
  useEffect(() => {
    if (restoring.current || manualAllocation.current || !loan || loanLoading) return;
    // The Amount is typed by the user only; a new Loan Plan / refreshed dues just clear the ticks.
    setAllocs({});
  }, [loanId, pendingSignature, loanLoading]);
  useEffect(() => { if (restoring.current) return; setLoanId(current => customerLoans.some(item => String(item.id) === current) ? current : ""); setAllocs({}); }, [activeCustomerId, loans.length]);
  useEffect(() => { if (restoring.current) return; setDetails({}); if (!isCashMode) clearDenomination(); }, [mode]);
  // Declared after the reset effects so, in the commit where data arrives, they skip first.
  useEffect(() => { if (dataReady) restoring.current = false; }, [dataReady]);
  const setDetail = (key, value) => setDetails(x => ({ ...x, [key]: value }));
  const changeAmount = value => {
    manualAllocation.current = false; setAmount(value); setAmountTouched(true);
    setOthers(normalLedger ? value : "");
    // Ticked dues are never redistributed behind the user's back: if the Amount drops below what is
    // allocated, the Pending List asks them to reduce / untick, and Save is blocked until they match.
  };
  // Ticking a due allocates what is left of a typed Collection Amount (else its full pending).
  const toggleDue = row => { manualAllocation.current = true; setAllocs(current => {
    if (row.id in current) { const { [row.id]: _, ...rest } = current; return rest; }
    const used = pendingRows.reduce((sum, item) => sum + (item.id in current ? cents(current[item.id]) : 0), 0);
    // Never allocate beyond the entered Amount (less Others); a larger due is taken partially.
    const left = Math.max(0, cents(amount) - used - cents(others));
    if (left <= 0) return current;
    return { ...current, [row.id]: fromCents(Math.min(left, cents(balanceOf(row)))) };
  }); };
  // A typed allocation is capped by the pending due and by the Amount left after the other dues and Others.
  const capAllocation = (value, rows, current, row, pendingOf) => {
    if (value === "") return value;
    const others_ = rows.reduce((sum, item) => sum + (item.id !== row.id && item.id in current ? cents(current[item.id]) : 0), 0);
    return cents(value) > Math.min(cents(pendingOf(row)), Math.max(0, cents(amount) - others_ - cents(others))) ? fromCents(Math.min(cents(pendingOf(row)), Math.max(0, cents(amount) - others_ - cents(others)))) : value;
  };
  const setAllocation = (row, value) => { manualAllocation.current = true; setAllocs(current => ({ ...current, [row.id]: capAllocation(value, pendingRows, current, row, balanceOf) })); };
  // After a successful Save (or Reset) the page stays open, cleared for the next entry.
  const toggleAdvance = checked => { manualAllocation.current = true; setAdvanceOn(checked); setAllocs({}); setPartyAllocs({}); };
  const resetEntry = () => { manualAllocation.current = false; setAdvanceOn(true); requestIdentity.current = null; setOthers(""); setCollectionDate(today()); setCustomerId(""); setPartyLedgerId(""); setSearch(""); setCustomerOpen(false); setLoanId(""); setAllocs({}); setAmount(""); setAmountTouched(false); setMode(""); setDetails({}); setNotes(""); setDoneByStaff(""); clearDenomination(); setAccountId(""); setError(""); };
  const paymentDetailsMissing = () => { const required = mode === "UPI" ? ["upi_id", "transaction_utr"] : mode === "Cheque" ? ["cheque_number", "cheque_date", "bank_name"] : ["NEFT", "IMPS", "RTGS"].includes(mode) ? ["transaction_utr", "bank_name"] : []; return required.some(key => !String(details[key] || "").trim()); };
  const save = async event => {
    event.preventDefault();
    if (saving || inFlight.current) return;
    if (!collectionDate) return setError("Date is required.");
    if (!partyLedger) return setError("Select a Ledger.");
    if (!(cents(amount) > 0)) return setError("Collection Amount must be greater than zero.");
    if (!account) return setError("Select an Account.");
    if (!mode) return setError("Select a Payment Mode.");
    if (paymentDetailsMissing()) return setError("Complete the required payment details.");
    if (partyDueWise) {
      if (!advanceOn && cents(amount) > partyDues.reduce((sum, row) => sum + cents(row.pending), 0)) return setError("Enter the excess above pending dues under Others (Advance).");
      if (partyLoading || !partySummary) return setError("Wait for the ledger dues to load.");
      for (const row of partyDues) {
        if (row.id in partyAllocs && (cents(partyAllocs[row.id]) < 0 || cents(partyAllocs[row.id]) > cents(row.pending))) return setError(`${row.due_number}: allocation cannot exceed its pending ${money(row.pending)}.`);
      }
      if (cents(others) < 0) return setError("Others amount cannot be negative.");
      if (partyRemaining !== 0) return setError(`Allocated amount must equal the Collection Amount (remaining ${money(partyRemaining / 100)}).`);
    }
    if (normalLedger && (cents(others) <= 0 || cents(others) !== cents(amount))) return setError("Enter an Others amount matching the Collection Amount.");
    // Others on a ledger that has loans is recorded like any ledger-only receipt: credited to the party ledger and
    // never applied to a due, so the loan schedule and outstanding are untouched.
    if (ledgerOnly || (partyLedger && hasLoans && (advanceOn || !loan))) {
      inFlight.current = true; setSaving(true); setError("");
      try {
        const { data } = await api.post("/finance/party-collections/", { party: partyLedger.id, date: collectionDate, amount, account: account.id, payment_mode: mode, notes, done_by_staff: doneByStaff || null,
          ...(partyCollection ? { allocations: partyDueWise && !advanceOn ? Object.entries(partyAllocs).filter(([, value]) => cents(value) > 0).map(([due, value]) => ({ due, amount: value })) : [], advance_amount: partyDueWise ? others || "0" : "0" } : {}),
          ...details, cheque_date: details.cheque_date || null }, auth);
        actionToast(`Collection ${data.voucher_no} saved successfully.`); resetEntry();
      } catch (e) { setError(apiError(e, "Unable to save collection.")); }
      finally { inFlight.current = false; setSaving(false); }
      return;
    }
    if (!loan) return setError("Select a Loan Plan.");
    if (loanLoading) return setError("Wait for pending installments to refresh.");
        if (!advanceOn && (cents(others) < 0 || cents(others) > Math.max(0, cents(amount) - cents(loanPending)))) return setError("Others may contain only the excess above all pending dues.");
    const chosen = advanceOn ? [] : pendingRows.filter(row => row.id in allocs && cents(allocs[row.id]) > 0);
    if (!chosen.length && !(cents(others) > 0)) return setError("Select at least one installment in the Pending List.");
    const over = chosen.find(row => cents(allocs[row.id]) > cents(balanceOf(row)));
    if (over) return setError(`Installment #${over.installment_number}: allocation cannot exceed its pending ${money(balanceOf(over))}.`);
    if (remainingCents !== 0) return setError(`Allocated installments must equal the Collection Amount (difference ${money(remainingCents / 100)}).`);
    inFlight.current = true; setSaving(true); setError("");
    try {
      const payload = { payment_date: collectionDate, payment_mode: mode, customer_paid_amount: amount, allocations: chosen.map(row => ({ installment_id: row.id, amount: allocs[row.id] })), advance_amount: others || "0", account_id: accountId, discount: "0", party_ledger_id: partyLedger.id, ledger_amount: "0", notes, done_by_staff: doneByStaff || null, ...details };
      const fingerprint = JSON.stringify([loan.id, payload]);
      if (requestIdentity.current?.fingerprint !== fingerprint) requestIdentity.current = { fingerprint, key: crypto.randomUUID() };
      const { data } = await api.post(`/finance/customer-loan-installments/${(chosen[0] || installments[0]).id}/collect/`, { ...payload, request_key: requestIdentity.current.key }, auth);
      try { const refreshed = await api.get(`/finance/loans/${loan.id}/`, auth); setLoans(current => current.map(item => String(item.id) === String(loan.id) ? refreshed.data : item)); } catch { /* list refreshes on next load */ }
      resetEntry();
      if (data?.collection_id) setReceipt({ id: data.collection_id }); else actionToast("Collection saved successfully.");
    } catch (e) { setError(apiError(e, "Unable to save collection.")); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const handleReceipt = async action => {
    if (receiptBusy || !receipt) return;
    setReceiptBusy(action);
    try {
      const { data: voucher } = await api.get("/finance/collections/receipt/", { ...auth, params: { ids: receipt.id } });
      const profile = await (refreshProfile ? refreshProfile().catch(() => companyProfile) : companyProfile);
      await completeEntryOutput(() => (action === "pdf" ? downloadReceipt : printReceipt)(voucher, profile), action, "receipt-print-frame", () => setReceipt(null));
    } catch { setError("Unable to prepare the Collection Receipt."); }
    finally { setReceiptBusy(null); }
  };
  const loanPlaceholder = "Select (No Loan Plan)";
  return <div className="collection-entry-page ce-v2">
    <div className="collection-entry-heading"><PageBreadcrumb current="Collection Entry" /><label className="system-date">Date<input aria-label="Date" type="date" required value={collectionDate} onChange={event => setCollectionDate(event.target.value)}/></label></div>
    <section className="collection-entry-card">
      <form onSubmit={save} noValidate>
        <div className="ce-v2-body">
          <div className="ce-v2-fields"><div className="ce-v2-grid">
            <Field label="Ledger" required><div className="entry-customer-picker"><button type="button" className="entry-picker-button" onClick={() => setCustomerOpen(x => !x)}><span className="entry-picker-value">{partyLedger ? partyLedger.name : "Search ledger..."}</span><span>⌄</span></button>{customerOpen && <div className="entry-customer-options"><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ledger..." onKeyDown={e => e.key === "Escape" && setCustomerOpen(false)}/>{allLedgers.filter(ledgerMatches).map(x => <button type="button" key={x.id} onClick={() => chooseParty(x)}>{x.name}</button>)}{!allLedgers.some(ledgerMatches) && <span className="entry-customer-empty">No ledgers found</span>}</div>}</div></Field>
            <Field label="Accounts" required><AccountSelect value={accountId} accounts={accounts} onChange={chooseAccount}/></Field>
            <Field label="Loan Plan" className={ledgerOnly ? "ce-v2-disabled" : ""}><SearchableSelect value={loanId} disabled={!hasLoans} onChange={e => { setLoanId(e.target.value); setAllocs({}); }}><option value="">{loanPlaceholder}</option>{customerLoans.map(x => <option value={x.id} key={x.id}>{x.loan_no} · {x.loan_type?.name || "Loan"}{x.plan?.name ? ` · ${x.plan.name}` : ""}</option>)}</SearchableSelect></Field>
            <Field label="Amount" required><div className="currency-input"><span>₹</span><input type="number" min="0" step="0.01" value={amount} onChange={e => changeAmount(e.target.value)} placeholder="0.00"/></div></Field>
            <Field label="Payment Mode" required><PaymentModeSelect value={mode} modes={modeOptions} locked={isCashAccount(account)} onChange={setMode}/>{isCashMode && <DenominationToggle checked={denomEnabled} onChange={toggleDenomination}/>}{isCashMode && denomEnabled && totalCashAmount > 0 && <button type="button" className="cash-denom-chip" onClick={() => setCashPopupOpen(true)}>{money(totalCashAmount)} entered · Edit</button>}</Field>
            <Field label="Resources"><StaffDropdown api={api} auth={auth} value={doneByStaff} onChange={setDoneByStaff} placeholder="Select resource" allowClear/></Field>
            <DynamicFields mode={mode} details={details} setDetail={setDetail}/>
          </div>
          <Field label="Notes" className="entry-notes"><div className="notes-wrap"><textarea rows="2" maxLength="200" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Enter notes..."/><small>{notes.length} / 200</small></div></Field>
          {error && <div className="collection-entry-error" role="alert">{error}</div>}
          </div>
          <aside className="ce-v2-preview pe-preview" aria-label="Collection Preview">
            <h2>Collection Preview</h2>
            <dl>{[
              ["Ledger Balance", !partyLedger ? money(0) : ledgerInfo ? ledgerBalanceLabel(ledgerInfo) : "Loading..."],
              ["Outstanding", partySummary ? money(partySummary.remaining_outstanding) : loan ? money(loanPending) : partyLedger && !ledgerInfo ? "Loading..." : money(partyLedger ? ledgerInfo?.remaining_outstanding : 0)],
              ["Loan Plan", loan ? `${loan.loan_no} · ${loan.loan_type?.name || "Loan"}${loan.plan?.name ? ` · ${loan.plan.name}` : ""}` : partyLedger ? "Select (No Loan Plan)" : "None"],
              ["Payment Mode", mode],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "-"}</dd></div>)}</dl>
            <div className="pe-total"><span>Total Amount</span><strong>{money(amount || 0)}</strong></div>
            {hasDues && <div className="ce-mode" role="group" aria-label="Collection mode"><button type="button" className={advanceOn ? "active" : ""} aria-pressed={advanceOn} onClick={() => toggleAdvance(true)}>Others</button><button type="button" className={!advanceOn ? "active" : ""} aria-pressed={!advanceOn} onClick={() => toggleAdvance(false)}>Pending List</button></div>}
            <div className="ce-mode-area">{hasDues && !advanceOn && <div className="ce-fade"><StatementDialog inline loan={loan} installments={installments} allocs={allocs} amount={amount} allocatedCents={partyDueWise ? partyAllocated : allocatedCents} remainingCents={partyDueWise ? partyRemaining : remainingCents} onToggle={toggleDue} onChange={setAllocation} partyLedger={partyCollection ? partyLedger : null} partySummary={partySummary} partyLoading={partyLoading} partyDues={partyDues} partyAllocs={partyAllocs} onPartyToggle={togglePartyDue} onPartyChange={(row, value) => { manualAllocation.current = true; setPartyAllocs(current => ({ ...current, [row.id]: capAllocation(value, partyDues, current, row, due => due.pending) })); }} others={others} onOthersToggle={checked => { manualAllocation.current = true; setOthersOn(checked); setOthers(checked ? fromCents(Math.max(0, partyDueWise ? partyRemaining : remainingCents)) : ""); }} onOthersChange={value => { manualAllocation.current = true; setOthers(value); }}/></div>}</div>
          </aside>
        </div>
        <footer className="collection-entry-actions">
          <button type="button" onClick={() => go("/collection-list")}>Cancel</button>
          <button type="button" onClick={resetEntry}>Reset</button>
          <button className="save-entry" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>
    {receipt && <SaveConfirmModal title="Collection Saved Successfully" subtitle="Your payment has been recorded." busy={receiptBusy} onDownload={() => handleReceipt("pdf")} onPrint={() => handleReceipt("print")} onClose={() => { if (!receiptBusy) setReceipt(null); }}/>}
    {isCashMode && denomEnabled && cashPopupOpen && <CashDenominationModal rows={cashRows} coinsAmount={coinsAmount} onQtyChange={setDenomQuantity} onCoinsChange={setCoinsAmount} total={totalCashAmount} onClose={() => setCashPopupOpen(false)}/>}
  </div>;
}
function Field({ label, required, className = "", children }) { return <label className={`entry-field ${className}`}><span className="entry-label">{label}{required && <i>*</i>}</span>{children}</label>; }
function DynamicFields({ mode, details, setDetail }) { const field = (label, key, required = false, type = "text") => <Field label={label} required={required}><input type={type} value={details[key] || ""} onChange={e => setDetail(key, e.target.value)}/></Field>; if (mode === "UPI") return <div className="dynamic-fields">{field("UPI ID / Number", "upi_id", true)}{field("UTR / Transfer Number", "transaction_utr", true)}</div>; if (mode === "Cheque") return <div className="dynamic-fields">{field("Cheque Number", "cheque_number", true)}{field("Cheque Date", "cheque_date", true, "date")}{field("Bank Name", "bank_name", true)}</div>; if (["NEFT", "IMPS", "RTGS"].includes(mode)) return <div className="dynamic-fields">{field("UTR / Transaction Reference Number", "transaction_utr", true)}{field("Bank Name", "bank_name", true)}</div>; return null; }

// Pending installments of the chosen loan: fully paid dues are never selectable, a partly
// paid due offers only what is still pending, and each selected due takes its own amount.
function StatementDialog({ loan, installments, allocs, amount, allocatedCents, remainingCents, onToggle, onChange, onClose, inline = false, partyLedger, partySummary, partyLoading, partyDues, partyAllocs, onPartyToggle, onPartyChange, others, onOthersChange }) {
  useEffect(() => {
    if (inline) return;
    const previous = document.activeElement;
    const close = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("keydown", close); previous?.focus(); };
  }, [onClose, inline]);
  const isParty = Boolean(partyLedger);
  const dueWise = !isParty || partyLedger.collection_type === "DUE_WISE";
  const pending = isParty ? partyDues : sortPendingDues(installments, balanceOf);
  const rows = pending.map(row => ({
    source: row, id: row.id, number: isParty ? row.due_number : `#${row.installment_number}`,
    date: row.due_date, due: isParty ? row.amount : row.installment_amount,
    paid: isParty ? Number(row.amount || 0) - Number(row.pending || 0) : row.paid_amount,
    balance: isParty ? Number(row.pending) : balanceOf(row),
  }));
  const values = isParty ? partyAllocs : allocs;
  const toggle = isParty ? onPartyToggle : onToggle;
  const change = isParty ? onPartyChange : onChange;
  const title = "Pending List";
  const titleId = inline ? "inline-statement-title" : "statement-title";
  const statement = <section className={`ce-statement-panel ${inline ? "ce-inline-statement" : "ce-statement-modal"}`} role={inline ? undefined : "dialog"} aria-modal={inline ? undefined : "true"} aria-labelledby={titleId}>
    <header className="ce-statement-heading"><strong id={titleId}>{title}</strong>{!inline && <button type="button" autoFocus onClick={onClose} aria-label="Close">&times;</button>}</header>
    {isParty && partySummary && <p className="ce-statement-summary">Total Due: {money(partySummary.total_due)} | Collected: {money(partySummary.total_received)} | Outstanding: {money(partySummary.outstanding)}</p>}
    {dueWise ? <div className="ce-statement-scroll" tabIndex="0" aria-label="Pending dues"><table className="ce-statement-table" data-own-scroll>
      <colgroup><col className="ce-select-col"/><col/><col/><col/><col className="ce-allocation-col"/></colgroup>
      <thead><tr><th scope="col">Select</th><th scope="col">Due / Date</th><th scope="col">Due Amount</th><th scope="col">Pending</th><th scope="col">Paid</th></tr></thead>
      <tbody>{rows.map(row => { const checked = row.id in values; return <tr key={row.id} className={`ce-selectable-due ${checked ? "selected" : ""}`}>
        <td className="ce-check-cell"><input type="checkbox" aria-label={isParty ? `Select ${row.number}` : `Select installment ${row.source.installment_number}`} checked={checked} disabled={!checked && (remainingCents <= 0 || row.balance <= 0)} title={!checked && remainingCents <= 0 ? (cents(amount) > 0 ? "The entered Amount is fully allocated" : "Enter the Amount first") : undefined} onChange={() => toggle(row.source)}/></td>
        <td><b>{row.number}</b><small>{dateLabel(row.date)}</small></td><td>{money(row.due)}</td><td>{money(row.balance)}<small>Left {money(Math.max(0, row.balance - Number(values[row.id] || 0)))}</small></td>
        <td><input type="number" min="0" step="0.01" max={row.balance} disabled={!checked} value={checked ? values[row.id] : ""} placeholder="0.00" aria-label={isParty ? `Paid for ${row.number}` : `Paid for installment ${row.source.installment_number}`} aria-invalid={checked && cents(values[row.id]) > cents(row.balance)} onChange={e => change(row.source, e.target.value)}/></td>
      </tr>; })}
      {!rows.length && <tr><td colSpan="5" className="ce-statement-empty">{isParty && partyLoading ? "Loading pending dues..." : "No pending dues. Fully paid installments are excluded."}</td></tr>}
      </tbody></table></div> : <p className="ce-statement-summary">Consolidated collection against this ledger.</p>}
    {(!inline || remainingCents < 0) && <footer className="ce-statement-footer">{!inline && <dl className="ce-statement-totals"><div><dt>Amount</dt><dd>{money(amount)}</dd></div></dl>}{remainingCents < 0 && <p className="ce-statement-warning" role="alert">Selected payments exceed the Amount by {money(-remainingCents / 100)}. Reduce a PAID value or untick a due.</p>}{!inline && <button type="button" className="apply-selection" onClick={onClose}>Done</button>}</footer>}
  </section>;
  if (inline) return statement;
  return <div className="installment-dialog-backdrop ce-statement-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>{statement}</div>;
}

export { CollectionEntry as CollectionEntryPage };

export const BANK_ACCOUNTS_GROUP = "Bank Accounts";
export const CASH_IN_HAND_GROUP = "Cash-in-Hand";
export const PAYMENT_MODE_OPTIONS = [["Cash", "Cash"], ["UPI", "UPI"], ["Cheque", "Cheque"], ["NEFT", "NEFT"], ["RTGS", "RTGS"], ["IMPS", "IMPS"]];
const BANK_MODE_OPTIONS = PAYMENT_MODE_OPTIONS.filter(([value]) => value !== "Cash");
// Cash in Hand / Bank Accounts ledgers belong to the Accounts dropdown, never the Ledger dropdown.
export const isAccountLedger = item => ACCOUNT_GROUPS.includes(item?.group);
export const isCashAccount = item => item?.group === CASH_IN_HAND_GROUP;
// Account -> Payment Mode: Cash in Hand is always Cash; a Bank account offers the bank modes.
export const modesForAccount = item => !item ? [] : isCashAccount(item) ? PAYMENT_MODE_OPTIONS.filter(([value]) => value === "Cash") : BANK_MODE_OPTIONS;
// Mode to keep after the Account changes: Cash for a Cash account, the current bank mode if still valid, else none.
export const nextModeFor = (item, current) => isCashAccount(item) ? "Cash" : modesForAccount(item).some(([value]) => value === current) ? current : "";
// Always leads with "Select Mode" so no mode ever looks pre-chosen; `modes` is the caller's already-filtered applicable list.
// `locked` (Cash account) shows the single fixed mode without a choice.
export function PaymentModeSelect({ value, onChange, modes, locked = false }) { return <select value={value} disabled={!modes.length || locked} onChange={event => onChange(event.target.value)}>{!locked && <option value="">{modes.length ? "Select Mode" : "Select Account first"}</option>}{modes.map(([modeValue, label]) => <option key={modeValue} value={modeValue}>{label}</option>)}</select>; }
// Accounts dropdown: every Cash in Hand and Bank Accounts ledger from Ledger Master, by name only
// (the Cash/Bank category stays on the ledger and drives Payment Mode).
export function AccountSelect({ value, onChange, accounts }) { return <SearchableSelect value={value} onChange={event => onChange(event.target.value)}><option value="">Select Account</option>{accounts.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</SearchableSelect>; }
export { DynamicFields, today, Field, LEDGER_OPTIONS, ACCOUNT_GROUPS };
