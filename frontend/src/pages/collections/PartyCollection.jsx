import { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import CashDenominationModal from "../../components/CashDenominationModal";
import DenominationToggle from "../../components/DenominationToggle";
import StaffDropdown from "../../components/StaffDropdown/StaffDropdown";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import confirmDelete from "../../utils/confirmDelete";
import { useSession } from "../../components/SessionContext";
import { formatINR } from "../../utils/currency";
import { AccountSelect, DynamicFields, Field, PaymentModeSelect, isAccountLedger, isCashAccount, modesForAccount, nextModeFor, today } from "./CollectionEntry";
import "./collection-entry.css";
import "./party-collection.css";

// Party Collection: ledger-based collection for Sundry Debtors parties (Ledger Master
// "Collection Type"), independent of the Customer/Loan Collection Entry.
//   Due-wise      -> receipt split across the party's pending dues, plus "Others" (advance).
//   Consolidated  -> one receipt against the party, no due split-up.
// Each save is one voucher (PC-xxxxxx): Dr Cash/Bank, Cr Party. Applying an advance later
// only allocates it to dues; it is never a second receipt.
const money = formatINR;
const CASH_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10];
export const DUE_WISE = "DUE_WISE";
export const PARTY_COLLECTION_TYPES = { DUE_WISE: "Due-wise Collection", CONSOLIDATED: "Consolidated Collection" };
const DEBTORS_GROUP = "Sundry Debtors";

// Payment details each bank mode needs (same as Collection Entry).
export const PARTY_MODE_DETAILS = { UPI: ["upi_id", "transaction_utr"], Cheque: ["cheque_number", "cheque_date", "bank_name"], NEFT: ["transaction_utr", "bank_name"], RTGS: ["transaction_utr", "bank_name"], IMPS: ["transaction_utr", "bank_name"] };
const cents = value => Math.round(Number(value || 0) * 100);
const rowsOf = data => data?.results ?? data ?? [];
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
export const isParty = item => item?.group === DEBTORS_GROUP && Boolean(item?.collection_type);
const blankDue = () => ({ due_date: today(), due_number: "", amount: "", counter_ledger: "", notes: "" });

export default function PartyCollection({ api, auth, go, tabs, preset }) {
  const [ledgers, setLedgers] = useState([]);
  const [date, setDate] = useState(today()), [partyId, setPartyId] = useState(""), [staff, setStaff] = useState(""), [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(""), [mode, setMode] = useState(""), [details, setDetails] = useState({}), [notes, setNotes] = useState("");
  const [allocations, setAllocations] = useState({}), [othersOn, setOthersOn] = useState(false), [others, setOthers] = useState("");
  const [summary, setSummary] = useState(null), [summaryLoading, setSummaryLoading] = useState(false), [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false), [error, setError] = useState(""), [dueSearch, setDueSearch] = useState("");
  const [dueOpen, setDueOpen] = useState(false), [advanceOpen, setAdvanceOpen] = useState(false);
  const [denomQty, setDenomQty] = useState({}), [coinsAmount, setCoinsAmount] = useState(""), [cashPopupOpen, setCashPopupOpen] = useState(false), [denomEnabled, setDenomEnabled] = useState(false);
  const clearDenomination = () => { setDenomEnabled(false); setCashPopupOpen(false); setDenomQty({}); setCoinsAmount(""); };
  const toggleDenomination = checked => { if (checked) { setDenomEnabled(true); setCashPopupOpen(true); } else clearDenomination(); };
  const cashRows = CASH_DENOMINATIONS.map(value => ({ value, qty: denomQty[value] || "", amount: Number(denomQty[value] || 0) * value }));
  const totalCashAmount = cashRows.reduce((sum, row) => sum + row.amount, 0) + Number(coinsAmount || 0);

  useEffect(() => { api.get("/finance/ledgers/", auth).then(({ data }) => setLedgers(rowsOf(data))).catch(() => setError("Unable to load ledgers.")); }, []);
  const parties = useMemo(() => ledgers.filter(isParty), [ledgers]);
  const accounts = useMemo(() => ledgers.filter(isAccountLedger), [ledgers]);
  const party = parties.find(item => String(item.id) === String(partyId));
  const account = accounts.find(item => String(item.id) === String(accountId));
  const isDueWise = party?.collection_type === DUE_WISE;
  const isCashMode = mode === "Cash";

  useEffect(() => {
    if (!partyId) { setSummary(null); return undefined; }
    let active = true;
    setSummaryLoading(true);
    api.get("/finance/party-collections/summary/", { ...auth, params: { party: partyId } })
      .then(({ data }) => { if (active) setSummary(data); })
      .catch(requestError => { if (active) { setSummary(null); setError(apiErrorMessage(requestError, "Unable to load the party summary.")); } })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [partyId, reload]);

  // Switching party starts its allocation afresh (the amount and payment side are kept).
  const chooseParty = id => { setPartyId(id); setAllocations({}); setOthersOn(false); setOthers(""); setDueSearch(""); setError(""); };
  useEffect(() => { if (preset?.id) chooseParty(preset.id); }, [preset]);
  const chooseAccount = id => { const next = accounts.find(item => String(item.id) === String(id)); setAccountId(id); setMode(current => nextModeFor(next, current)); };
  useEffect(() => { setDetails({}); if (mode !== "Cash") clearDenomination(); }, [mode]);

  const pendingDues = (summary?.dues || []).filter(row => Number(row.pending) > 0);
  const needle = dueSearch.trim().toLowerCase();
  const visibleDues = pendingDues.filter(row => !needle || `${row.due_number} ${dateLabel(row.due_date)}`.toLowerCase().includes(needle));
  const allocatedCents = Object.values(allocations).reduce((sum, value) => sum + cents(value), 0) + (othersOn ? cents(others) : 0);
  const remainingCents = cents(amount) - allocatedCents;
  const toggleDue = row => setAllocations(current => {
    if (row.id in current) { const { [row.id]: _, ...rest } = current; return rest; }
    // A newly ticked due takes what is left of the Collection Amount, up to its pending.
    const left = Math.max(0, cents(amount) - Object.values(current).reduce((sum, value) => sum + cents(value), 0) - (othersOn ? cents(others) : 0));
    return { ...current, [row.id]: (Math.min(left, cents(row.pending)) / 100).toFixed(2) };
  });
  const setAllocation = (row, value) => setAllocations(current => ({ ...current, [row.id]: value }));
  const toggleOthers = checked => { setOthersOn(checked); setOthers(checked ? (Math.max(0, remainingCents) / 100).toFixed(2) : ""); };

  const resetEntry = () => { setAmount(""); setAccountId(""); setMode(""); setDetails({}); setNotes(""); setAllocations({}); setOthersOn(false); setOthers(""); setDueSearch(""); clearDenomination(); setError(""); };
  const resetAll = () => { resetEntry(); setDate(today()); setPartyId(""); setStaff(""); };

  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!date) return setError("Date is required.");
    if (!party) return setError("Select a Party Ledger.");
    if (!(cents(amount) > 0)) return setError("Collection Amount must be greater than zero.");
    if (!account) return setError("Select an Account.");
    if (!mode) return setError("Select a Payment Mode.");
    const needed = PARTY_MODE_DETAILS[mode] || [];
    if (needed.some(key => !String(details[key] || "").trim())) return setError("Complete the required payment details.");
    let payloadAllocations = [], advance = "0";
    if (isDueWise) {
      for (const row of pendingDues) {
        if (!(row.id in allocations)) continue;
        if (cents(allocations[row.id]) < 0 || cents(allocations[row.id]) > cents(row.pending)) return setError(`${row.due_number}: allocation cannot exceed its pending ${money(row.pending)}.`);
      }
      if (remainingCents !== 0) return setError(`Allocated amount must equal the Collection Amount (remaining ${money(remainingCents / 100)}).`);
      payloadAllocations = Object.entries(allocations).filter(([, value]) => cents(value) > 0).map(([due, value]) => ({ due, amount: value }));
      advance = othersOn ? others || "0" : "0";
    }
    setSaving(true); setError("");
    try {
      const { data } = await api.post("/finance/party-collections/", {
        party: party.id, date, amount, account: account.id, payment_mode: mode, notes, done_by_staff: staff || null,
        ...Object.fromEntries(needed.map(key => [key, details[key]])), allocations: payloadAllocations, advance_amount: advance,
      }, auth);
      actionToast(`Party Collection ${data.voucher_no} saved successfully.`);
      resetEntry(); setReload(value => value + 1);
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to save the Party Collection.")); }
    finally { setSaving(false); }
  };

  const cards = summary ? [
    ["Total Due", money(summary.total_due)], ["Total Collected", money(summary.total_received)],
    ["Outstanding", `${money(summary.outstanding)} ${summary.outstanding_type === "CR" ? "Cr" : "Dr"}`],
    ...(isDueWise ? [["Unallocated Advance", money(summary.unallocated_advance)]] : []),
  ] : [];

  return <div className="collection-entry-page party-collection-page">
    <div className="collection-entry-heading"><PageBreadcrumb current="Collection Entry" />{tabs}</div>
    <section className="collection-entry-card pc-card">
      <form onSubmit={save} noValidate>
        <div className="pc-grid">
          <Field label="Date" required><input type="date" value={date} onChange={event => setDate(event.target.value)}/></Field>
          <Field label="Party Ledger" required><SearchableSelect value={partyId} onChange={event => chooseParty(event.target.value)} searchPlaceholder="Search party..."><option value="">{parties.length ? "Select Party" : "No Sundry Debtors party has a Collection Type"}</option>{parties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SearchableSelect></Field>
          <Field label="Resources"><StaffDropdown api={api} auth={auth} value={staff} onChange={setStaff} placeholder="Select resource" allowClear/></Field>
          <Field label="Collection Amount" required><div className="currency-input"><span>₹</span><input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00"/></div></Field>
        </div>
        <div className="pc-grid pc-payment-row">
          <Field label="Accounts" required><AccountSelect value={accountId} accounts={accounts} onChange={chooseAccount}/></Field>
          <Field label="Payment Mode" required><PaymentModeSelect value={mode} modes={modesForAccount(account)} locked={isCashAccount(account)} onChange={setMode}/>{isCashMode && <DenominationToggle checked={denomEnabled} onChange={toggleDenomination}/>}{isCashMode && denomEnabled && totalCashAmount > 0 && <button type="button" className="cash-denom-chip" onClick={() => setCashPopupOpen(true)}>{money(totalCashAmount)} entered · Edit</button>}</Field>
          <DynamicFields mode={mode} details={details} setDetail={(key, value) => setDetails(current => ({ ...current, [key]: value }))}/>
        </div>

        {party && <div className="pc-party-bar">
          <span className="pc-type-badge">{PARTY_COLLECTION_TYPES[party.collection_type]}</span>
          <div className="pc-party-actions">
            {isDueWise && Number(summary?.unallocated_advance) > 0 && <button type="button" className="pc-link-button" onClick={() => setAdvanceOpen(true)}>Allocate Advance</button>}
            <button type="button" className="pc-link-button pc-primary-link" onClick={() => setDueOpen(true)}>+ Add Due</button>
          </div>
        </div>}
        {party && <div className="pc-cards" aria-busy={summaryLoading}>{cards.map(([label, value]) => <div key={label} className="pc-summary-card"><span>{label}</span><strong>{value}</strong></div>)}</div>}

        {party && isDueWise && <div className="pc-allocation">
          <div className="pc-allocation-head"><strong>Pending Due Allocation</strong>{pendingDues.length > 6 && <input type="search" value={dueSearch} onChange={event => setDueSearch(event.target.value)} placeholder="Search due no / date..." aria-label="Search pending dues"/>}</div>
          <div className="pc-table-wrap"><table className="pc-table">
            <thead><tr><th className="pc-check">Select</th><th>Due Date</th><th>Due No</th><th className="num">Due Amount</th><th className="num">Pending</th><th className="num pc-allocate">Allocate</th></tr></thead>
            <tbody>
              {visibleDues.map(row => { const checked = row.id in allocations; return <tr key={row.id} className={checked ? "selected" : ""}>
                <td className="pc-check"><input type="checkbox" aria-label={`Select ${row.due_number}`} checked={checked} onChange={() => toggleDue(row)}/></td>
                <td>{dateLabel(row.due_date)}</td><td>{row.due_number}</td><td className="num">{money(row.amount)}</td><td className="num">{money(row.pending)}</td>
                <td className="num pc-allocate"><input type="number" min="0" step="0.01" max={row.pending} disabled={!checked} value={checked ? allocations[row.id] : ""} placeholder="0.00" aria-label={`Allocate to ${row.due_number}`} className={checked && cents(allocations[row.id]) > cents(row.pending) ? "invalid" : ""} onChange={event => setAllocation(row, event.target.value)}/></td>
              </tr>; })}
              {!pendingDues.length && <tr className="pc-empty"><td colSpan={6}>{summaryLoading ? "Loading dues…" : "No pending dues. Use + Add Due, or collect through Others as an advance."}</td></tr>}
              <tr className={`pc-others ${othersOn ? "selected" : ""}`}>
                <td className="pc-check"><input type="checkbox" aria-label="Select Others (Advance)" checked={othersOn} onChange={event => toggleOthers(event.target.checked)}/></td>
                <td>Others</td><td>Advance</td><td className="num">—</td><td className="num">—</td>
                <td className="num pc-allocate"><input type="number" min="0" step="0.01" disabled={!othersOn} value={othersOn ? others : ""} placeholder="0.00" aria-label="Others (Advance) amount" onChange={event => setOthers(event.target.value)}/></td>
              </tr>
            </tbody>
          </table></div>
          <div className="pc-allocation-foot">
            <span>Collection Amount <b>{money(cents(amount) / 100)}</b></span>
            <span>Allocated <b>{money(allocatedCents / 100)}</b></span>
            <span className={remainingCents === 0 ? "ok" : "warn"}>Remaining <b>{money(remainingCents / 100)}</b></span>
          </div>
        </div>}

        {party && !isDueWise && <div className="pc-allocation">
          <div className="pc-allocation-head"><strong>Consolidated Collection</strong></div>
          <div className="pc-table-wrap"><table className="pc-table">
            <thead><tr><th>Collection Option</th><th className="num">Outstanding</th><th className="num pc-allocate">Amount</th><th className="num">Outstanding After</th></tr></thead>
            <tbody><tr className="pc-others selected"><td>Others</td><td className="num">{summary ? `${money(summary.outstanding)} ${summary.outstanding_type === "CR" ? "Cr" : "Dr"}` : "—"}</td><td className="num pc-allocate">{money(cents(amount) / 100)}</td>
              <td className="num">{summary ? (() => { const after = (summary.outstanding_type === "CR" ? -1 : 1) * cents(summary.outstanding) - cents(amount); return `${money(Math.abs(after) / 100)} ${after < 0 ? "Cr" : "Dr"}`; })() : "—"}</td></tr></tbody>
          </table></div>
        </div>}

        <Field label="Notes" className="entry-notes pc-notes"><div className="notes-wrap"><textarea rows="2" maxLength="500" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Enter notes..."/><small>{notes.length} / 500</small></div></Field>
        {error && <div className="collection-entry-error" role="alert">{error}</div>}
        <footer className="collection-entry-actions pc-actions">
          <button type="button" onClick={() => go("/collection-list")}>Cancel</button>
          <button type="button" onClick={resetAll}>Reset</button>
          <button className="save-entry" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>
    {dueOpen && party && <PartyDueModal api={api} auth={auth} party={party} ledgers={ledgers} defaultCounter={summary?.last_counter_ledger} onClose={() => setDueOpen(false)} onChanged={() => setReload(value => value + 1)}/>}
    {advanceOpen && party && summary && <AllocateAdvanceModal api={api} auth={auth} party={party} summary={summary} onClose={() => setAdvanceOpen(false)} onSaved={() => { setAdvanceOpen(false); setAllocations({}); setReload(value => value + 1); }}/>}
    {isCashMode && denomEnabled && cashPopupOpen && <CashDenominationModal rows={cashRows} coinsAmount={coinsAmount} onQtyChange={(value, qty) => setDenomQty(current => ({ ...current, [value]: qty }))} onCoinsChange={setCoinsAmount} total={totalCashAmount} onClose={() => setCashPopupOpen(false)}/>}
  </div>;
}

function useEscape(onClose, busy) {
  useEffect(() => { const close = event => event.key === "Escape" && !busy && onClose(); document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [onClose, busy]);
}

function Modal({ title, onClose, busy, children, wide }) {
  useEscape(onClose, busy);
  return <div className="pc-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section className={`pc-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button type="button" aria-label="Close" disabled={busy} onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>;
}

// Add Due (and manage the party's existing dues). The counter ledger is chosen, never assumed.
function PartyDueModal({ api, auth, party, ledgers, defaultCounter, onClose, onChanged }) {
  const [form, setForm] = useState(() => ({ ...blankDue(), counter_ledger: defaultCounter ? String(defaultCounter) : "" }));
  const [editing, setEditing] = useState(null), [dues, setDues] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  // Editing / deleting a saved due is admin-only, like every other saved record.
  const { isAdmin } = useSession() || {};
  const counters = ledgers.filter(item => !isAccountLedger(item) && String(item.id) !== String(party.id));
  const load = () => api.get("/finance/party-dues/", { ...auth, params: { party: party.id } }).then(({ data }) => setDues(rowsOf(data))).catch(() => setError("Unable to load dues."));
  useEffect(() => { load(); }, []);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const reset = () => { setEditing(null); setForm(current => ({ ...blankDue(), counter_ledger: current.counter_ledger })); setError(""); };
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    if (!form.due_date || !form.due_number.trim() || !(cents(form.amount) > 0) || !form.counter_ledger) return setError("Due Date, Due Number, Due Amount and Credit Ledger are required.");
    setBusy(true); setError("");
    try {
      const payload = { ...form, party: party.id, due_number: form.due_number.trim() };
      if (editing) await api.patch(`/finance/party-dues/${editing}/`, payload, auth); else await api.post("/finance/party-dues/", payload, auth);
      actionToast(editing ? "Due updated successfully." : "Due saved successfully.");
      reset(); load(); onChanged();
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to save the due.")); }
    finally { setBusy(false); }
  };
  const remove = async row => {
    if (busy || !await confirmDelete(`Delete ${row.due_number}?`)) return;
    setBusy(true);
    try { await api.delete(`/finance/party-dues/${row.id}/`, auth); actionToast("Due deleted successfully."); if (editing === row.id) reset(); load(); onChanged(); }
    catch (requestError) { setError(apiErrorMessage(requestError, "Unable to delete the due.")); }
    finally { setBusy(false); }
  };
  const total = dues.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return <Modal title={`${editing ? "Edit" : "Add"} Due · ${party.name}`} onClose={onClose} busy={busy} wide>
    <form className="pc-modal-body" onSubmit={save} noValidate>
      <div className="pc-due-grid">
        <Field label="Due Date" required><input type="date" value={form.due_date} onChange={event => update("due_date", event.target.value)}/></Field>
        <Field label="Due Number" required><input maxLength={50} value={form.due_number} onChange={event => update("due_number", event.target.value)} placeholder="e.g. 1st Due"/></Field>
        <Field label="Due Amount" required><div className="currency-input"><span>₹</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={event => update("amount", event.target.value)} placeholder="0.00"/></div></Field>
        <Field label="Credit Ledger" required><SearchableSelect value={form.counter_ledger} onChange={event => update("counter_ledger", event.target.value)} searchPlaceholder="Search ledger..."><option value="">Select ledger to credit</option>{counters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SearchableSelect></Field>
        <Field label="Notes" className="pc-due-notes"><input maxLength={500} value={form.notes} onChange={event => update("notes", event.target.value)} placeholder="Optional notes"/></Field>
      </div>
      {error && <div className="collection-entry-error" role="alert">{error}</div>}
      <footer className="pc-modal-actions">{editing && <button type="button" onClick={reset}>Cancel Edit</button>}<button type="submit" className="save-entry" disabled={busy}>{busy ? "Saving..." : editing ? "Update Due" : "Save Due"}</button></footer>
      <div className="pc-table-wrap pc-due-list"><table className="pc-table">
        <thead><tr><th>Due No</th><th>Date</th><th className="num">Amount</th><th>Credit Ledger</th>{isAdmin && <th className="pc-row-actions">Action</th>}</tr></thead>
        <tbody>
          {dues.map(row => <tr key={row.id} className={editing === row.id ? "selected" : ""}><td>{row.due_number}</td><td>{dateLabel(row.due_date)}</td><td className="num">{money(row.amount)}</td><td>{row.counter_ledger_name}</td>
            {isAdmin && <td className="pc-row-actions"><button type="button" onClick={() => { setEditing(row.id); setError(""); setForm({ due_date: row.due_date, due_number: row.due_number, amount: String(row.amount), counter_ledger: String(row.counter_ledger), notes: row.notes || "" }); }}>Edit</button><button type="button" className="danger" onClick={() => remove(row)}>Delete</button></td>}</tr>)}
          {!dues.length && <tr className="pc-empty"><td colSpan={isAdmin ? 5 : 4}>No dues yet.</td></tr>}
        </tbody>
        {dues.length > 0 && <tfoot><tr><td colSpan={2}>Total</td><td className="num">{money(total)}</td><td colSpan={isAdmin ? 2 : 1}/></tr></tfoot>}
      </table></div>
    </form>
  </Modal>;
}

// Applies the party's unallocated advance to its dues: no money is received again.
function AllocateAdvanceModal({ api, auth, party, summary, onClose, onSaved }) {
  const [values, setValues] = useState({}), [date, setDate] = useState(today()), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dues = (summary.dues || []).filter(row => Number(row.pending) > 0);
  const totalCents = Object.values(values).reduce((sum, value) => sum + cents(value), 0);
  const available = cents(summary.unallocated_advance);
  const save = async () => {
    if (busy) return;
    if (!totalCents) return setError("Enter an amount for at least one due.");
    if (totalCents > available) return setError(`Allocation exceeds the unallocated advance ${money(available / 100)}.`);
    const over = dues.find(row => cents(values[row.id]) > cents(row.pending));
    if (over) return setError(`${over.due_number}: allocation cannot exceed its pending ${money(over.pending)}.`);
    setBusy(true); setError("");
    try {
      await api.post("/finance/party-collections/allocate-advance/", { party: party.id, date, allocations: Object.entries(values).filter(([, value]) => cents(value) > 0).map(([due, amount]) => ({ due, amount })) }, auth);
      actionToast("Advance allocated successfully."); onSaved();
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to allocate the advance.")); }
    finally { setBusy(false); }
  };
  return <Modal title={`Allocate Advance · ${party.name}`} onClose={onClose} busy={busy}>
    <div className="pc-modal-body">
      <div className="pc-advance-head"><span>Unallocated Advance <b>{money(available / 100)}</b></span><Field label="Allocation Date" required><input type="date" value={date} onChange={event => setDate(event.target.value)}/></Field></div>
      <div className="pc-table-wrap"><table className="pc-table">
        <thead><tr><th>Due Date</th><th>Due No</th><th className="num">Pending</th><th className="num pc-allocate">Allocate</th></tr></thead>
        <tbody>
          {dues.map(row => <tr key={row.id}><td>{dateLabel(row.due_date)}</td><td>{row.due_number}</td><td className="num">{money(row.pending)}</td>
            <td className="num pc-allocate"><input type="number" min="0" step="0.01" value={values[row.id] || ""} placeholder="0.00" aria-label={`Allocate advance to ${row.due_number}`} onChange={event => setValues(current => ({ ...current, [row.id]: event.target.value }))}/></td></tr>)}
          {!dues.length && <tr className="pc-empty"><td colSpan={4}>No pending dues to allocate to.</td></tr>}
        </tbody>
      </table></div>
      <div className="pc-allocation-foot"><span>Allocating <b>{money(totalCents / 100)}</b></span><span className={totalCents <= available ? "ok" : "warn"}>Advance left <b>{money((available - totalCents) / 100)}</b></span></div>
      {error && <div className="collection-entry-error" role="alert">{error}</div>}
      <footer className="pc-modal-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="save-entry" disabled={busy || !dues.length} onClick={save}>{busy ? "Saving..." : "Allocate"}</button></footer>
    </div>
  </Modal>;
}

// Edit a saved Party Collection voucher (opened from Today Report). Its due allocations are
// kept as saved; the amount cannot drop below what is already allocated.
export function PartyCollectionEditModal({ api, auth, id, onClose, onSaved }) {
  const [form, setForm] = useState(null), [accounts, setAccounts] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api.get(`/finance/party-collections/${id}/`, auth), api.get("/finance/ledgers/", auth)])
      .then(([entry, ledgerList]) => { setAccounts(rowsOf(ledgerList.data).filter(isAccountLedger)); setForm({ ...entry.data, account: String(entry.data.account), cheque_date: entry.data.cheque_date || "" }); })
      .catch(requestError => setError(apiErrorMessage(requestError, "Unable to load the Party Collection.")));
  }, [id]);
  const account = accounts.find(item => String(item.id) === String(form?.account));
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async event => {
    event.preventDefault();
    if (busy || !form) return;
    const needed = PARTY_MODE_DETAILS[form.payment_mode] || [];
    if (!form.date || !(cents(form.amount) > 0) || !account || !form.payment_mode) return setError("Date, Amount, Account and Payment Mode are required.");
    if (needed.some(key => !String(form[key] || "").trim())) return setError("Complete the required payment details.");
    setBusy(true); setError("");
    try {
      await api.patch(`/finance/party-collections/${id}/`, { date: form.date, amount: form.amount, account: account.id, payment_mode: form.payment_mode, notes: form.notes || "", ...Object.fromEntries(needed.map(key => [key, form[key]])) }, auth);
      onSaved();
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to update the Party Collection.")); }
    finally { setBusy(false); }
  };
  return <Modal title={`Edit Party Collection${form ? ` · ${form.voucher_no}` : ""}`} onClose={onClose} busy={busy}>
    <form className="pc-modal-body" onSubmit={save} noValidate>
      {!form && !error && <p>Loading…</p>}
      {form && <>
        <p className="pc-edit-party">Party: <strong>{form.party_name}</strong>{Number(form.allocated) > 0 && <> · Allocated to dues: <strong>{money(form.allocated)}</strong></>}</p>
        <div className="pc-due-grid">
          <Field label="Date" required><input type="date" value={form.date} onChange={event => update("date", event.target.value)}/></Field>
          <Field label="Amount" required><div className="currency-input"><span>₹</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={event => update("amount", event.target.value)}/></div></Field>
          <Field label="Accounts" required><AccountSelect value={form.account} accounts={accounts} onChange={value => { const next = accounts.find(item => String(item.id) === String(value)); setForm(current => ({ ...current, account: value, payment_mode: nextModeFor(next, current.payment_mode) })); }}/></Field>
          <Field label="Payment Mode" required><PaymentModeSelect value={form.payment_mode} modes={modesForAccount(account)} locked={isCashAccount(account)} onChange={value => update("payment_mode", value)}/></Field>
          <DynamicFields mode={form.payment_mode} details={form} setDetail={update}/>
          <Field label="Notes" className="pc-due-notes"><input maxLength={500} value={form.notes || ""} onChange={event => update("notes", event.target.value)}/></Field>
        </div>
      </>}
      {error && <div className="collection-entry-error" role="alert">{error}</div>}
      <footer className="pc-modal-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="save-entry" disabled={busy || !form}>{busy ? "Saving..." : "Save"}</button></footer>
    </form>
  </Modal>;
}
