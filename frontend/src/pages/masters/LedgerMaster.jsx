import { useEffect, useState } from "react";
import RowActions from "../../components/RowActions";
import confirmDelete from "../../utils/confirmDelete";
import { formatINR } from "../../utils/currency";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import GroupDropdown from "../../components/GroupDropdown/GroupDropdown";
import StaffDropdown from "../../components/StaffDropdown/StaffDropdown";
import "../collections/collection-entry.css";
import "./ledger-master.css";

const pageSize = 10;
const blank = () => ({ name: "", group_detail: "", done_by_staff: "", opening_balance: "0" });
// Convention: a positive Opening Balance is Dr, a negative one is Cr.
const balanceType = value => Number(value || 0) < 0 ? "CR" : "DR";
const BalanceBadge = ({ value }) => <span className={`ledger-balance-type ${balanceType(value).toLowerCase()}`}>{balanceType(value)}</span>;

export default function LedgerMaster({ api, auth, go, view = "add" }) {
  const isListView = view === "list";
  const [form, setForm] = useState(blank), [items, setItems] = useState([]), [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const setError = message => actionToast(message, false, 3000), setSuccess = message => actionToast(message, true, 3000);
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const load = () => api.get("/finance/ledgers/", auth).then(({ data }) => setItems(data.results ?? data)).catch(() => setError("Unable to load ledgers."));
  useEffect(() => { load(); }, []);
  const reset = () => { setForm(blank()); setEditing(null); };
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.name.trim() || !form.group_detail) return setError("Name and Group are required.");
    if (!form.done_by_staff) return setError("Done By is required.");
    setSaving(true);
    try {
      const payload = { ...form, name: form.name.trim(), opening_balance: form.opening_balance || "0" };
      if (editing) await api.put(`/finance/ledgers/${editing}/`, payload, auth);
      else await api.post("/finance/ledgers/", payload, auth);
      reset(); setSuccess("Ledger saved successfully."); load();
    } catch (requestError) { setError(requestError.response?.data?.detail || JSON.stringify(requestError.response?.data || "Unable to save ledger.")); }
    finally { setSaving(false); }
  };
  const remove = async item => {
    if (!await confirmDelete("Delete this ledger?")) return;
    try { await api.delete(`/finance/ledgers/${item.id}/`, auth); if (editing === item.id) reset(); setSuccess("Ledger deleted successfully."); load(); }
    catch (requestError) { setError(apiErrorMessage(requestError, "Unable to delete ledger.")); }
  };
  const needle = search.trim().toLowerCase();
  const filtered = items.filter(item => !needle || `${item.name} ${item.group}`.toLowerCase().includes(needle));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize);
  const first = filtered.length ? (current - 1) * pageSize + 1 : 0, last = Math.min(current * pageSize, filtered.length);
  const fields = <div className="ledger-fields">
    <label className="ledger-field">
      <span>Name <i>*</i></span>
      <span className="ledger-input"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg><input required maxLength={150} placeholder="Enter ledger name" value={form.name} onChange={event => update("name", event.target.value)}/></span>
    </label>
    <label className="ledger-field">
      <span>Group <i>*</i></span>
      <GroupDropdown api={api} auth={auth} value={form.group_detail} onChange={value => update("group_detail", value)} placeholder="Select Group" allowClear/>
    </label>
    <label className="ledger-field">
      <span>Opening Balance</span>
      <span className="ledger-input ledger-money"><b>₹</b><input type="number" step="0.01" placeholder="0.00" value={form.opening_balance} onChange={event => update("opening_balance", event.target.value)}/><BalanceBadge value={form.opening_balance}/></span>
    </label>
    <label className="ledger-field">
      <span>Done By <i>*</i></span>
      <StaffDropdown api={api} auth={auth} value={form.done_by_staff} onChange={value => update("done_by_staff", value)} placeholder="Select staff" allowClear/>
    </label>
  </div>;
  return <div className="ledger-page">
    <nav className="ledger-breadcrumb" aria-label="Breadcrumb">
      <button type="button" className="ledger-back" aria-label="Back" onClick={() => go("/masters")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"/></svg></button>
      <button type="button" className="ledger-crumb" onClick={() => go("/masters")}>Masters</button>
      <svg className="ledger-sep" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
      <strong>Ledger</strong>
    </nav>
    {!isListView && <section className="ledger-card">
      <h2 className="ledger-card-title">Add Ledger</h2>
      <form onSubmit={save}>
        {fields}
        <footer className="ledger-actions">
          <button type="button" onClick={() => go("/masters")}>Cancel</button>
          <button type="button" onClick={reset}>Reset</button>
          <button className="ledger-save" disabled={saving}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>}
    {isListView && <section className="ledger-card ledger-list">
      <header className="ledger-list-head">
        <h2 className="ledger-card-title">Ledger List</h2>
        <label className="ledger-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input placeholder="Search ledger name or group..." value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}/></label>
      </header>
      <div className="ledger-table-wrap"><table className="ledger-table">
        <thead><tr><th>S.No</th><th>Name</th><th>Group</th><th className="num">Opening Balance</th><th>Action</th></tr></thead>
        <tbody>{rows.map((item, index) => <tr key={item.id}><td>{String(first + index).padStart(2, "0")}</td><td>{item.name}</td><td>{item.group}</td><td className="num">{formatINR(Math.abs(item.opening_balance))} <BalanceBadge value={item.opening_balance}/></td><td><RowActions onEdit={() => { setEditing(item.id); setForm({ name: item.name, group_detail: item.group_detail || "", done_by_staff: item.done_by_staff || "", opening_balance: item.opening_balance }); }} onDelete={() => remove(item)}/></td></tr>)}</tbody>
      </table>{!filtered.length && <div className="ledger-empty">No ledgers found.</div>}</div>
      <footer className="ledger-pager">
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
          {fields}
          <footer className="ledger-actions">
            <button type="button" onClick={reset}>Cancel</button>
            <button className="ledger-save" disabled={saving}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>{saving ? "Saving..." : "Save"}</button>
          </footer>
        </form>
      </div>
    </div>}
  </div>;
}
