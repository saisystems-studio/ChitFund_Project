import PageBreadcrumb from "../../components/PageBreadcrumb";
import { useEffect, useMemo, useRef, useState } from "react";
import { groupTree } from "../../components/ListFilters/ListFilters";
import RowActions from "../../components/RowActions";
import ListPageToolbar from "../../components/ListPageToolbar";
import ListExport, { exportFiltersLine } from "../../components/ListExport/ListExport";
import confirmDelete from "../../utils/confirmDelete";
import { formatINR } from "../../utils/currency";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import GroupDropdown from "../../components/GroupDropdown/GroupDropdown";
import { fullGroupName } from "../../utils/groupHierarchy";
import { noteLedgerCreated, pendingLedgerReturn, returnFromLedger } from "../../utils/ledgerReturn";
import { goBack } from "../../utils/navigation";
import { clearCustomerLink, returningCustomerLink, startCustomerFromLedger } from "../../utils/customerLedgerLink";
import "../collections/collection-entry.css";
import "./ledger-master.css";

const pageSize = 10;
const BANK_GROUP = "Bank Accounts";
const CASH_GROUP = "Cash-in-Hand";
const DEBTORS_GROUP = "Sundry Debtors";
// Party ledger groups: a ledger here can open Add Customer (Customer Name = Party Ledger Name).
const PARTY_GROUPS = [DEBTORS_GROUP, "Sundry Creditors"].map(name => name.toLowerCase());
// Same rule as Customer Name (Customer Name = Party Ledger Name).
const PARTY_NAME = /^[A-Za-z .'-]+$/;
const blankBank = () => ({ bank_name: "", branch_name: "", ifsc_code: "", account_number: "" });
const TAX_RATES = [0, 5, 12, 18, 28];
const TAXABLE_NATURES = ["INCOME", "EXPENSE"];
const blank = () => ({ name: "", group_detail: "", opening_balance: "0", opening_balance_type: "DR", hsn_code: "", rate_of_tax: 0, ...blankBank() });
const bankDetails = item => ({ bank_name: item.bank_name || "", branch_name: item.branch_name || "", ifsc_code: item.ifsc_code || "", account_number: item.account_number || "" });
// Same rules as the API: IFSC is 4 letters, a 0, then 6 letters/digits; Account Number is 9-18 digits.
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_PATTERN = /^\d{9,18}$/;
const bankError = form => {
  if (!form.bank_name.trim() || !form.branch_name.trim() || !form.ifsc_code.trim() || !form.account_number.trim()) return "Bank Name, Branch Name, IFSC Code and Account Number are required.";
  if (!IFSC_PATTERN.test(form.ifsc_code)) return "Enter a valid 11-character IFSC Code (e.g. SBIN0001234).";
  if (!ACCOUNT_PATTERN.test(form.account_number)) return "Account Number must be 9 to 18 digits.";
  return "";
};
// Convention: a positive Opening Balance is Dr, a negative one is Cr.
const balanceType = value => Number(value || 0) < 0 ? "CR" : "DR";
const BalanceBadge = ({ value }) => <span className={`ledger-balance-type ${balanceType(value).toLowerCase()}`}>{balanceType(value)}</span>;
// The input only ever shows/collects the magnitude; DR/CR is the explicit
// dropdown next to it, not a sign the user has to type.
const splitBalance = value => ({ opening_balance: String(Math.abs(Number(value || 0))), opening_balance_type: balanceType(value) });
const signedBalance = form => (form.opening_balance_type === "CR" ? -1 : 1) * Math.abs(Number(form.opening_balance || 0));

export default function LedgerMaster({ api, auth, go, view = "add" }) {
  const isListView = view === "list";
  // Back from Add Customer (opened by this form): restore the unsaved ledger form; when the
  // customer was saved, its linked Party Ledger already exists and Save completes it by ID.
  const [incomingLink] = useState(() => isListView ? null : returningCustomerLink());
  const [linked, setLinked] = useState(() => incomingLink?.customer?.ledger_id ? { ledgerId: incomingLink.customer.ledger_id, name: incomingLink.customer.full_name } : null);
  const [form, setForm] = useState(() => incomingLink ? { ...blank(), ...incomingLink.draft, ...(incomingLink.customer ? { name: incomingLink.customer.full_name } : {}) } : blank());
  const [items, setItems] = useState([]), [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const setError = message => actionToast(message, false, 3000), setSuccess = message => actionToast(message, true, 3000);
  const [search, setSearch] = useState(""), [page, setPage] = useState(1), [groupFilter, setGroupFilter] = useState("");
  // Opened from a transaction's Ledger (+): Back/Cancel return there, and the Group
  // list is limited to the groups that transaction field accepts.
  const [roundTrip, setRoundTrip] = useState(() => isListView ? null : pendingLedgerReturn());
  const [groups, setGroups] = useState([]);
  const load = () => api.get("/finance/ledgers/", auth).then(({ data }) => setItems(data.results ?? data)).catch(() => setError("Unable to load ledgers."));
  // The returned draft stays in session storage until Save / Reset / Cancel, so a browser refresh
  // here still finishes the same linked ledger; a stale draft from an abandoned trip is dropped.
  useEffect(() => {
    if (isListView) return;
    if (!incomingLink) { clearCustomerLink(); return; }
    if (incomingLink.customer) setSuccess(`Customer ${incomingLink.customer.full_name} saved. Enter the Opening Balance and Save the ledger.`);
    else setError("Customer not saved. A Sundry Debtors / Creditors ledger needs its customer: Save opens Add Customer again, or choose another group.");
  }, []);
  useEffect(() => { load(); api.get("/finance/groups/", auth).then(({ data }) => setGroups(data.results ?? data)).catch(() => {}); }, []);
  const leave = () => { if (!isListView) clearCustomerLink(); if (!returnFromLedger(go)) goBack(); };
  // Legacy ledgers saved before group_detail existed only carry the root group name;
  // resolve it to that root group's id so Edit shows the saved group.
  // Older names differ only in singular/plural (e.g. "Indirect Expense" vs "Indirect Expenses").
  const sameRootName = (a, b) => { const key = value => String(value || "").trim().toLowerCase().replace(/s$/, ""); return key(a) === key(b); };
  const groupIdFor = item => item.group_detail || groups.find(group => group.parent_group_id == null && sameRootName(group.group_name, item.group))?.id || "";
  // A ledger is a Bank ledger when its group (at any depth) sits under the "Bank Accounts" root.
  const rootOf = groupId => {
    const byId = new Map(groups.map(group => [String(group.id), group]));
    let node = byId.get(String(groupId)), guard = 0;
    while (node && node.parent_group_id != null && guard++ < 50) node = byId.get(String(node.parent_group_id)) || null;
    return node || null;
  };
  const selectedRoot = form.group_detail ? rootOf(form.group_detail) : null;
  const isBank = (selectedRoot?.group_name || "").toLowerCase() === BANK_GROUP.toLowerCase();
  // Only one Cash in Hand ledger is allowed (Bank Accounts may have any number).
  const isCash = (selectedRoot?.group_name || "").toLowerCase() === CASH_GROUP.toLowerCase();
  // Editing a ledger that is already Cash in Hand is always allowed.
  const editingCash = items.some(item => item.id === editing && item.group === CASH_GROUP);
  const cashExists = !editingCash && items.some(item => item.group === CASH_GROUP && item.id !== editing);
  const isPartyRoot = groupId => PARTY_GROUPS.includes((rootOf(groupId)?.group_name || "").toLowerCase());
  // Add Ledger + a Sundry Debtors / Creditors group (and a valid name) opens Add Customer on its
  // own. Only the user's own actions (choosing the group, finishing the name, Save) call this --
  // never an effect -- so restoring the form on return can never redirect again (no loops).
  const redirecting = useRef(false);
  const openCustomerFor = next => {
    if (isListView || editing || linked || redirecting.current || !next.group_detail || !isPartyRoot(next.group_detail)) return false;
    const name = String(next.name || "").trim().replace(/\s+/g, " ");
    if (!name) { setError("Enter the Ledger Name to continue to Add Customer."); return true; }
    // Customer Name = Party Ledger Name, so the customer name rules apply here too.
    if (name.length < 2 || !PARTY_NAME.test(name)) { setError("Party name: use at least 2 letters (letters, spaces, dot, apostrophe or hyphen)."); return true; }
    redirecting.current = true;
    startCustomerFromLedger(go, { ...next, name });
    return true;
  };
  const chooseGroup = value => { const next = { ...form, group_detail: value }; setForm(next); openCustomerFor(next); };
  // HSN Code / Rate of Tax apply only to Income and Expense ledgers (by the root group's nature).
  const isTaxable = TAXABLE_NATURES.includes(selectedRoot?.nature);
  const reset = () => { setForm(blank()); setEditing(null); setLinked(null); clearCustomerLink(); };
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.name.trim() || !form.group_detail) return setError("Name and Group are required.");
    if (isCash && cashExists) return setError("A Cash in Hand ledger already exists. Only one Cash in Hand ledger is allowed.");
    if (isBank) { const message = bankError(form); if (message) return setError(message); }
    // A new party ledger is always created with its customer (e.g. after Cancel on Add Customer).
    if (openCustomerFor(form)) return;
    setSaving(true);
    try {
      // collection_type is never sent (no field here), so a saved value used by Party Collection
      // stays as it is on the server.
      const { opening_balance_type, ...rest } = form;
      // Bank details are sent only for Bank ledgers; the API clears them for every other group.
      const bank = isBank ? { bank_name: form.bank_name.trim(), branch_name: form.branch_name.trim(), ifsc_code: form.ifsc_code, account_number: form.account_number } : blankBank();
      const payload = { ...rest, ...bank, name: form.name.trim(), hsn_code: isTaxable ? String(form.hsn_code || "").trim() : "", rate_of_tax: isTaxable ? Number(form.rate_of_tax || 0) : 0, opening_balance: String(signedBalance(form)) };
      if (editing) await api.put(`/finance/ledgers/${editing}/`, payload, auth);
      else if (linked) {
        // Completes the Party Ledger created with the customer -- never a second ledger.
        await api.put(`/finance/ledgers/${linked.ledgerId}/`, payload, auth);
        if (roundTrip) { noteLedgerCreated(linked.ledgerId); setRoundTrip(current => current && { ...current, createdId: linked.ledgerId }); }
      } else {
        const { data } = await api.post("/finance/ledgers/", payload, auth);
        if (roundTrip && data?.id) { noteLedgerCreated(data.id); setRoundTrip(current => current && { ...current, createdId: data.id }); }
      }
      reset(); redirecting.current = false; setSuccess(roundTrip && !editing ? "Ledger saved successfully. Click Back to return to the transaction." : "Ledger saved successfully."); load();
    } catch (requestError) {
      const data = requestError.response?.data;
      const fieldError = data && ["group", "bank_name", "branch_name", "ifsc_code", "account_number", "hsn_code", "rate_of_tax"].map(key => data[key]).find(Boolean);
      setError(data?.detail || (fieldError ? [].concat(fieldError)[0] : JSON.stringify(data || "Unable to save ledger.")));
    }
    finally { setSaving(false); }
  };
  const remove = async item => {
    if (!await confirmDelete("Delete this ledger?")) return;
    try { await api.delete(`/finance/ledgers/${item.id}/`, auth); if (editing === item.id) reset(); setSuccess("Ledger deleted successfully."); load(); }
    catch (requestError) { setError(apiErrorMessage(requestError, "Unable to delete ledger.")); }
  };
  const needle = search.trim().toLowerCase();
  // Group filter: the ledger's group or any of its sub-groups (client-side only).
  const groupFilterTree = useMemo(() => groupTree(groups), [groups]);
  const filtered = items.filter(item => groupFilterTree.isWithin(groupIdFor(item), groupFilter)).filter(item => !needle ||`${item.name} ${item.group} ${item.group_detail_name || ""} ${item.bank_name || ""} ${item.ifsc_code || ""} ${item.account_number || ""}`.toLowerCase().includes(needle));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize);
  const first = filtered.length ? (current - 1) * pageSize + 1 : 0, last = Math.min(current * pageSize, filtered.length);
  const fields = <div className="ledger-fields">
    <label className="ledger-field">
      <span>Name <i>*</i></span>
      <span className="ledger-input"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg><input required maxLength={150} placeholder="Enter ledger name" value={form.name} readOnly={Boolean(linked)} title={linked ? "Linked to the customer: edit the name in Customer Master" : undefined} onChange={event => update("name", event.target.value)} onBlur={event => { if (!event.relatedTarget?.closest?.(".ledger-actions")) openCustomerFor(form); }}/></span>
    </label>
    <label className="ledger-field">
      <span>Group <i>*</i></span>
      <GroupDropdown api={api} auth={auth} showTag portal value={form.group_detail} onChange={chooseGroup} placeholder="Select Group" allowClear={!linked} disabled={Boolean(linked)}/>
      {linked && <small className="ledger-linked-note">Linked to customer {linked.name}</small>}
    </label>
    <label className="ledger-field">
      <span>Opening Balance</span>
      <span className="ledger-input ledger-money"><b>₹</b><input type="number" min="0" step="0.01" placeholder="0.00" value={form.opening_balance} onChange={event => update("opening_balance", event.target.value)}/><select className={`ledger-balance-type-select ${(form.opening_balance_type || "DR").toLowerCase()}`} aria-label="Opening Balance type" value={form.opening_balance_type || "DR"} onChange={event => update("opening_balance_type", event.target.value)}><option value="DR">DR</option><option value="CR">CR</option></select></span>
    </label>
    {isTaxable && <><label className="ledger-field">
      <span>HSN Code</span>
      <span className="ledger-input"><input maxLength={30} placeholder="Enter HSN code" value={form.hsn_code || ""} onChange={event => update("hsn_code", event.target.value)}/></span>
    </label>
    <label className="ledger-field">
      <span>Rate of Tax (ROT)</span>
      <span className="ledger-input"><select value={form.rate_of_tax ?? 0} onChange={event => update("rate_of_tax", Number(event.target.value))}>{TAX_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}</select></span>
    </label></>}
  </div>;
  const bankField = (key, label, inputProps) => <label className="ledger-field">
    <span>{label} <i>*</i></span>
    <span className="ledger-input"><input required value={form[key]} onChange={event => update(key, inputProps.clean ? inputProps.clean(event.target.value) : event.target.value)} placeholder={inputProps.placeholder} maxLength={inputProps.maxLength} inputMode={inputProps.inputMode} pattern={inputProps.pattern} title={inputProps.title} autoComplete="off" spellCheck="false"/></span>
  </label>;
  const bankFields = isBank && <fieldset className="ledger-bank">
    <legend>Bank Details</legend>
    <div className="ledger-bank-grid">
      {bankField("bank_name", "Bank Name", { placeholder: "Enter bank name", maxLength: 150 })}
      {bankField("branch_name", "Branch Name", { placeholder: "Enter branch name", maxLength: 150 })}
      {bankField("ifsc_code", "IFSC Code", { placeholder: "e.g. SBIN0001234", maxLength: 11, pattern: "[A-Z]{4}0[A-Z0-9]{6}", title: "11 characters: 4 letters, 0, then 6 letters or digits", clean: value => value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
      {bankField("account_number", "Account Number", { placeholder: "Enter account number", maxLength: 18, inputMode: "numeric", pattern: "\\d{9,18}", title: "9 to 18 digits", clean: value => value.replace(/\D/g, "") })}
    </div>
  </fieldset>;
  return <div className={`ledger-page ${isListView ? "data-page" : ""}`}>
    {isListView
      ? <ListPageToolbar title="Ledger List" onBack={leave} search={search} onSearch={value => { setSearch(value); setPage(1); }} placeholder="Search ledger name or group..." filters={[{ label: "Group", value: groupFilter, onChange: value => { setGroupFilter(value); setPage(1); }, options: groupFilterTree.options }]}
          action={<ListExport title="Ledger List" rows={filtered} filtersLine={exportFiltersLine([["Search", search], ["Group", groupFilterTree.options.find(option => option.value && option.value === groupFilter)?.label?.replace(/^(— )+/, "")]])} columns={[{ header: "S.No", value: (item, index) => index + 1, align: "center" }, { header: "Name", value: item => item.name }, { header: "Group", value: item => fullGroupName(item.group_detail_name || item.group) }, { header: "Bank Details", value: item => [item.bank_name, item.branch_name, item.ifsc_code, item.account_number && `A/c ${item.account_number}`].filter(Boolean).join(" · ") }, { header: "Opening Balance", value: item => `${formatINR(Math.abs(item.opening_balance))} ${Number(item.opening_balance) < 0 ? "CR" : "DR"}`, align: "right" }]} />} />
      : <PageBreadcrumb className="ledger-breadcrumb" current="Add Ledger" onBack={leave} />}
    {!isListView && <section className="ledger-card">
      
      {roundTrip && <p className="ledger-return-hint">{roundTrip.createdId ? "Ledger created. Click Back to return to the transaction with it selected." : "Save the new ledger, then click Back to return to the transaction."}</p>}
      <form onSubmit={save}>
        {fields}{bankFields}
        <footer className="ledger-actions">
          <button type="button" onClick={leave}>Cancel</button>
          <button type="button" onClick={reset}>Reset</button>
          <button className="ledger-save" disabled={saving}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>}
    {isListView && <section className="ledger-card ledger-list data-container">
      <div className="ledger-table-wrap data-table-area"><table className="ledger-table">
        <thead><tr><th>S.No</th><th>Name</th><th>Group</th><th className="num">Opening Balance</th><th>Action</th></tr></thead>
        <tbody>{rows.map((item, index) => <tr key={item.id}><td>{String(first + index).padStart(2, "0")}</td><td>{item.name}{item.ifsc_code && <small className="ledger-bank-summary">{[item.bank_name, item.branch_name, item.ifsc_code, item.account_number && `A/c ${item.account_number}`].filter(Boolean).join(" · ")}</small>}{(item.hsn_code || Number(item.rate_of_tax) > 0) && <small className="ledger-bank-summary">{[item.hsn_code && `HSN ${item.hsn_code}`, `ROT ${Number(item.rate_of_tax || 0)}%`].filter(Boolean).join(" · ")}</small>}</td><td>{fullGroupName(item.group_detail_name || item.group)}</td><td className="num">{formatINR(Math.abs(item.opening_balance))} <BalanceBadge value={item.opening_balance}/></td><td><RowActions onEdit={() => { setEditing(item.id); setForm({ name: item.name, group_detail: groupIdFor(item), ...splitBalance(item.opening_balance), hsn_code: item.hsn_code || "", rate_of_tax: Number(item.rate_of_tax || 0), ...bankDetails(item) }); }} onDelete={() => remove(item)}/></td></tr>)}</tbody>
      </table>{!filtered.length && <div className="ledger-empty">No ledgers found.</div>}</div>
      <footer className="ledger-pager data-footer">
        <span>Showing {first} to {last} of {filtered.length} entries</span>
        <div>
          <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
          {Array.from({ length: pages }, (_, i) => i + 1).map(number => <button type="button" key={number} className={number === current ? "active" : ""} onClick={() => setPage(number)}>{number}</button>)}
          <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      </footer>
    </section>}
    {isListView && editing && <div className="ledger-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && reset()}>
      <div className="ledger-modal">
        <h2 className="ledger-card-title">Edit Ledger</h2>
        <form onSubmit={save}>
          {fields}{bankFields}
          <footer className="ledger-actions">
            <button type="button" onClick={reset}>Cancel</button>
            <button className="ledger-save" disabled={saving}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>{saving ? "Saving..." : "Save"}</button>
          </footer>
        </form>
      </div>
    </div>}
  </div>;
}
