import PageBreadcrumb from "../../components/PageBreadcrumb";
import { useEffect, useState } from "react";
import RowActions from "../../components/RowActions";
import ListPageToolbar from "../../components/ListPageToolbar";
import ListExport, { exportFiltersLine } from "../../components/ListExport/ListExport";
import DateInput from "../../components/DateInput/DateInput";
import { KycDocumentsSection } from "../../components/KycDocuments/KycDocuments";
import { savePendingDocuments } from "../../components/KycDocuments/pendingDocuments";
import { useSession } from "../../components/SessionContext";
import { formatLoanDate } from "../../utils/loanDateDisplay";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import "./staff-master.css";

const pageSize = 10;
const blank = () => ({ staff_name: "", phone_number: "", alternative_phone_number: "", aadhaar_number: "", gender: "", date_of_birth: "", anniversary_date: "", address: "", is_active: true });
const formFor = item => ({ staff_name: item.staff_name, phone_number: item.phone_number, alternative_phone_number: item.alternative_phone_number || "", aadhaar_number: item.aadhaar_number || "", gender: item.gender || "", date_of_birth: item.date_of_birth || "", anniversary_date: item.anniversary_date || "", address: item.address || "", is_active: item.is_active });
const documentsUrl = id => `/staff/${id}/kyc-documents/`;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function StaffMaster({ api, auth, go, view = "add" }) {
  const isListView = view === "list";
  const { isAdmin } = useSession();
  const [form, setForm] = useState(blank), [items, setItems] = useState([]), [editing, setEditing] = useState(null), [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);
  // Add Staff: documents are queued here and uploaded right after the staff is created.
  const [pendingDocuments, setPendingDocuments] = useState([]);
  const setError = message => actionToast(message, false, 3000), setSuccess = message => actionToast(message, true, 3000);
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const load = () => api.get("/staff/", { ...auth, params: { page_size: 1000 } }).then(({ data }) => setItems(data.results ?? data)).catch(() => setError("Unable to load staff."));
  useEffect(() => { load(); }, []);
  const reset = () => { setForm(blank()); setEditing(null); setPendingDocuments([]); };
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.staff_name.trim()) return setError("Staff Name is required.");
    if (!/^\d{10}$/.test(form.phone_number)) return setError("Enter a valid 10-digit Phone Number.");
    if (form.date_of_birth && form.anniversary_date && form.anniversary_date < form.date_of_birth) return setError("Anniversary Date cannot be before Date of Birth.");
    setSaving(true);
    try {
      const payload = { ...form, staff_name: form.staff_name.trim(), date_of_birth: form.date_of_birth || null, anniversary_date: form.anniversary_date || null };
      let staffId = editing;
      if (editing) await api.put(`/staff/${editing}/`, payload, auth);
      else staffId = (await api.post("/staff/", payload, auth)).data.id;
      if (pendingDocuments.length) {
        const { remaining, error } = await savePendingDocuments(api, auth, documentsUrl(staffId), pendingDocuments);
        setPendingDocuments(remaining);
        if (error) {
          // The staff record is saved; keep it open with the failed documents so Save retries only those.
          setEditing(staffId); load();
          return setError(`Staff saved, but ${remaining.length} document(s) could not be uploaded: ${apiErrorMessage(error, "upload failed")}. Click Save to retry.`);
        }
      }
      reset(); setSuccess("Staff saved successfully."); load();
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to save staff.")); }
    finally { setSaving(false); }
  };
  const remove = async item => {
    if (!await confirmDelete("Delete this staff record?")) return;
    try { await api.delete(`/staff/${item.id}/`, auth); if (editing === item.id) reset(); if (viewing?.id === item.id) setViewing(null); setSuccess("Staff deleted successfully."); load(); }
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
    <div className="staff-field">
      <span>Date of Birth</span>
      <span className="staff-input"><DateInput label="Date of Birth" max={today()} value={form.date_of_birth} onChange={value => update("date_of_birth", value)}/></span>
    </div>
    <div className="staff-field">
      <span>Anniversary Date</span>
      <span className="staff-input"><DateInput label="Anniversary Date" placeholder="DD/MM/YYYY (optional)" max={today()} value={form.anniversary_date} onChange={value => update("anniversary_date", value)}/></span>
    </div>
    <label className="staff-field">
      <span>Address</span>
      <span className="staff-input"><textarea placeholder="Enter address" value={form.address} onChange={event => update("address", event.target.value)}/></span>
    </label>
  </div>;
  // Add Staff queues documents (uploaded on Save); Edit Staff attaches/deletes directly.
  const addDocuments = <div className="staff-kyc">
    <KycDocumentsSection api={api} auth={auth} baseUrl={editing ? documentsUrl(editing) : undefined} pendingDocuments={pendingDocuments} onPendingChange={setPendingDocuments} allowDelete={isAdmin} disabled={saving} idProofRequired={false}/>
  </div>;
  const editDocuments = editing && <div className="staff-kyc">
    <KycDocumentsSection api={api} auth={auth} baseUrl={documentsUrl(editing)} allowDelete={isAdmin} disabled={saving} idProofRequired={false}/>
  </div>;
  const detail = (label, value) => <div className="staff-view-item"><span>{label}</span><strong>{value || "—"}</strong></div>;
  return <div className={`staff-page ${isListView ? "data-page" : ""}`}>
    {isListView
      ? <ListPageToolbar title="Staff List" search={search} onSearch={value => { setSearch(value); setPage(1); }} placeholder="Search staff name, ID or phone..."
          action={<ListExport title="Staff List" rows={filtered} filtersLine={exportFiltersLine([["Search", search]])} columns={[{ header: "S.No", value: (item, index) => index + 1, align: "center" }, { header: "Staff ID", value: item => item.staff_id }, { header: "Name", value: item => item.staff_name }, { header: "Phone", value: item => item.phone_number }, { header: "Status", value: item => item.is_active ? "Active" : "Inactive" }]} />} />
      : <PageBreadcrumb className="staff-breadcrumb" current="Add Staff" />}
    {!isListView && <section className="staff-card">

      <form onSubmit={save}>
        {fields}
        {addDocuments}
        <footer className="staff-actions">
          <button type="button" onClick={() => go("/masters")}>Cancel</button>
          <button type="button" onClick={reset}>Reset</button>
          <button className="staff-save" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>}
    {isListView && <section className="staff-card staff-list data-container">
      <div className="staff-table-wrap data-table-area"><table className="staff-table">
        <thead><tr><th>S.No</th><th>Staff ID</th><th>Name</th><th>Phone</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{rows.map((item, index) => <tr key={item.id}><td>{String(first + index).padStart(2, "0")}</td><td>{item.staff_id}</td><td>{item.staff_name}</td><td>{item.phone_number}</td><td><span className={`staff-status ${item.is_active ? "active" : "inactive"}`}>{item.is_active ? "Active" : "Inactive"}</span></td><td><RowActions onView={() => setViewing(item)} onEdit={() => { setEditing(item.id); setForm(formFor(item)); }} onDelete={() => remove(item)}/></td></tr>)}</tbody>
      </table>{!filtered.length && <div className="staff-empty">No staff found.</div>}</div>
      <footer className="staff-pager data-footer">
        <span>Showing {first} to {last} of {filtered.length} entries</span>
        <div>
          <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
          {Array.from({ length: pages }, (_, i) => i + 1).map(number => <button type="button" key={number} className={number === current ? "active" : ""} onClick={() => setPage(number)}>{number}</button>)}
          <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      </footer>
    </section>}
    {isListView && editing && <div className="staff-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && reset()}>
      <div className="staff-modal staff-modal-wide">
        <h2 className="staff-card-title">Edit Staff</h2>
        <form onSubmit={save}>
          {fields}
          {editDocuments}
          <footer className="staff-actions">
            <button type="button" onClick={reset}>Cancel</button>
            <button className="staff-save" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          </footer>
        </form>
      </div>
    </div>}
    {isListView && viewing && <div className="staff-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setViewing(null)}>
      <div className="staff-modal staff-modal-wide" role="dialog" aria-modal="true" aria-label={`Staff ${viewing.staff_name}`}>
        <h2 className="staff-card-title">Staff Details — {viewing.staff_name}</h2>
        <div className="staff-view-grid">
          {detail("Staff ID", viewing.staff_id)}
          {detail("Staff Name", viewing.staff_name)}
          {detail("Phone Number", viewing.phone_number)}
          {detail("Alternative Phone", viewing.alternative_phone_number)}
          {detail("Aadhaar Number", viewing.aadhaar_number)}
          {detail("Gender", viewing.gender)}
          {detail("Date of Birth", formatLoanDate(viewing.date_of_birth))}
          {detail("Anniversary Date", formatLoanDate(viewing.anniversary_date))}
          {detail("Status", viewing.is_active ? "Active" : "Inactive")}
          <div className="staff-view-item staff-view-wide"><span>Address</span><strong>{viewing.address || "—"}</strong></div>
        </div>
        <div className="staff-kyc"><KycDocumentsSection api={api} auth={auth} baseUrl={documentsUrl(viewing.id)} allowAdd={false}/></div>
        <footer className="staff-actions">
          <button type="button" onClick={() => setViewing(null)}>Close</button>
          {isAdmin && <button type="button" className="staff-save" onClick={() => { const item = viewing; setViewing(null); setEditing(item.id); setForm(formFor(item)); }}>Edit</button>}
        </footer>
      </div>
    </div>}
  </div>;
}
