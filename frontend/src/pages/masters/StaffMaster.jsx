import { useEffect, useState } from "react";
import RowActions from "../../components/RowActions";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import "./staff-master.css";

const pageSize = 10;
const blank = () => ({ staff_name: "", phone_number: "", alternative_phone_number: "", aadhaar_number: "", gender: "", address: "", is_active: true });

export default function StaffMaster({ api, auth, go, view = "add" }) {
  const isListView = view === "list";
  const [form, setForm] = useState(blank), [items, setItems] = useState([]), [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const setError = message => actionToast(message, false, 3000), setSuccess = message => actionToast(message, true, 3000);
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const load = () => api.get("/staff/", { ...auth, params: { page_size: 1000 } }).then(({ data }) => setItems(data.results ?? data)).catch(() => setError("Unable to load staff."));
  useEffect(() => { load(); }, []);
  const reset = () => { setForm(blank()); setEditing(null); };
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.staff_name.trim()) return setError("Staff Name is required.");
    if (!/^\d{10}$/.test(form.phone_number)) return setError("Enter a valid 10-digit Phone Number.");
    setSaving(true);
    try {
      const payload = { ...form, staff_name: form.staff_name.trim() };
      if (editing) await api.put(`/staff/${editing}/`, payload, auth);
      else await api.post("/staff/", payload, auth);
      reset(); setSuccess("Staff saved successfully."); load();
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to save staff.")); }
    finally { setSaving(false); }
  };
  const remove = async item => {
    if (!await confirmDelete("Delete this staff record?")) return;
    try { await api.delete(`/staff/${item.id}/`, auth); if (editing === item.id) reset(); setSuccess("Staff deleted successfully."); load(); }
    catch (requestError) { setError(apiErrorMessage(requestError, "Unable to delete staff.")); }
  };
  const needle = search.trim().toLowerCase();
  const filtered = items.filter(item => !needle || `${item.staff_name} ${item.staff_id} ${item.phone_number}`.toLowerCase().includes(needle));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize);
  const first = filtered.length ? (current - 1) * pageSize + 1 : 0, last = Math.min(current * pageSize, filtered.length);
  const fields = <div className="staff-fields">
    <label className="staff-field">
      <span>Staff Name <i>*</i></span>
      <span className="staff-input"><input required maxLength={150} placeholder="Enter staff name" value={form.staff_name} onChange={event => update("staff_name", event.target.value)}/></span>
    </label>
    <label className="staff-field">
      <span>Phone Number <i>*</i></span>
      <span className="staff-input"><input required inputMode="numeric" placeholder="10-digit phone number" value={form.phone_number} onChange={event => update("phone_number", event.target.value.replace(/\D/g, "").slice(0, 10))}/></span>
    </label>
    <label className="staff-field">
      <span>Alternative Phone Number</span>
      <span className="staff-input"><input inputMode="numeric" placeholder="Optional" value={form.alternative_phone_number} onChange={event => update("alternative_phone_number", event.target.value.replace(/\D/g, "").slice(0, 10))}/></span>
    </label>
    <label className="staff-field">
      <span>Aadhaar Number</span>
      <span className="staff-input"><input inputMode="numeric" placeholder="12-digit Aadhaar" value={form.aadhaar_number} onChange={event => update("aadhaar_number", event.target.value.replace(/\D/g, "").slice(0, 12))}/></span>
    </label>
    <label className="staff-field">
      <span>Gender</span>
      <span className="staff-input"><select value={form.gender} onChange={event => update("gender", event.target.value)}><option value="">Select</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></span>
    </label>
    <label className="staff-field">
      <span>Active</span>
      <span className="staff-input"><select value={form.is_active ? "1" : "0"} onChange={event => update("is_active", event.target.value === "1")}><option value="1">Active</option><option value="0">Inactive</option></select></span>
    </label>
    <label className="staff-field">
      <span>Address</span>
      <span className="staff-input"><textarea placeholder="Enter address" value={form.address} onChange={event => update("address", event.target.value)}/></span>
    </label>
  </div>;
  return <div className="staff-page">
    <nav className="staff-breadcrumb" aria-label="Breadcrumb">
      <button type="button" className="staff-back" aria-label="Back" onClick={() => go("/masters")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"/></svg></button>
      <button type="button" className="staff-crumb" onClick={() => go("/masters")}>Masters</button>
      <svg className="staff-sep" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
      <strong>Staff</strong>
    </nav>
    {!isListView && <section className="staff-card">
      <h2 className="staff-card-title">Add Staff</h2>
      <form onSubmit={save}>
        {fields}
        <footer className="staff-actions">
          <button type="button" onClick={() => go("/masters")}>Cancel</button>
          <button type="button" onClick={reset}>Reset</button>
          <button className="staff-save" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>}
    {isListView && <section className="staff-card staff-list">
      <header className="staff-list-head">
        <h2 className="staff-card-title">Staff List</h2>
        <label className="staff-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input placeholder="Search staff name, ID or phone..." value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}/></label>
      </header>
      <div className="staff-table-wrap"><table className="staff-table">
        <thead><tr><th>S.No</th><th>Staff ID</th><th>Name</th><th>Phone</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{rows.map((item, index) => <tr key={item.id}><td>{String(first + index).padStart(2, "0")}</td><td>{item.staff_id}</td><td>{item.staff_name}</td><td>{item.phone_number}</td><td><span className={`staff-status ${item.is_active ? "active" : "inactive"}`}>{item.is_active ? "Active" : "Inactive"}</span></td><td><RowActions onEdit={() => { setEditing(item.id); setForm({ staff_name: item.staff_name, phone_number: item.phone_number, alternative_phone_number: item.alternative_phone_number || "", aadhaar_number: item.aadhaar_number || "", gender: item.gender || "", address: item.address || "", is_active: item.is_active }); }} onDelete={() => remove(item)}/></td></tr>)}</tbody>
      </table>{!filtered.length && <div className="staff-empty">No staff found.</div>}</div>
      <footer className="staff-pager">
        <span>Showing {first} to {last} of {filtered.length} entries</span>
        <div>
          <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
          {Array.from({ length: pages }, (_, i) => i + 1).map(number => <button type="button" key={number} className={number === current ? "active" : ""} onClick={() => setPage(number)}>{number}</button>)}
          <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      </footer>
    </section>}
    {isListView && editing && <div className="staff-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && reset()}>
      <div className="staff-modal">
        <h2 className="staff-card-title">Edit Staff</h2>
        <form onSubmit={save}>
          {fields}
          <footer className="staff-actions">
            <button type="button" onClick={reset}>Cancel</button>
            <button className="staff-save" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          </footer>
        </form>
      </div>
    </div>}
  </div>;
}
