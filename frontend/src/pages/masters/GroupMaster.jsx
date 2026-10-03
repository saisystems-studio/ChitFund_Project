import { useEffect, useMemo, useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import RowActions from "../../components/RowActions";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import "./group-master.css";

const blank = () => ({ parent_group_id: "", group_name: "" });

// Depth-first order so sub-groups sort under their parent in the Group Tag
// dropdown; the hierarchy is driven entirely by parent_group_id, never by name.
function orderGroups(items) {
  const byParent = new Map();
  items.forEach(item => {
    const key = item.parent_group_id ?? "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(item);
  });
  byParent.forEach(list => list.sort((a, b) => a.group_name.localeCompare(b.group_name)));
  const ordered = [];
  const walk = (key, depth) => (byParent.get(key) || []).forEach(item => { ordered.push({ ...item, depth }); walk(item.id, depth + 1); });
  walk("root", 0);
  return ordered;
}

export default function GroupMaster({ api, auth, go, view = "add" }) {
  const isListView = view === "list";
  const [form, setForm] = useState(blank);
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const setError = message => actionToast(message, false, 3000), setSuccess = message => actionToast(message, true, 3000);
  const load = () => api.get("/finance/groups/", auth).then(({ data }) => setItems(data.results ?? data)).catch(() => setError("Unable to load groups."));
  useEffect(() => { load(); }, []);
  const tagOptions = useMemo(() => orderGroups(items).filter(item => item.id !== editing).map(item => ({ value: item.id, label: `${"— ".repeat(item.depth)}${item.group_name}` })), [items, editing]);
  // Group Tag column resolves parent_group_id -> its group_name for display only; the stored relationship stays ID-based.
  const nameById = useMemo(() => new Map(items.map(item => [item.id, item.group_name])), [items]);
  // Root/seed groups are Group Tag options only, not list rows the user "created".
  const rows = useMemo(() => items.filter(item => !item.is_system).slice().sort((a, b) => a.id - b.id), [items]);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const reset = () => { setForm(blank()); setEditing(null); };
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.parent_group_id) return setError("Group Tag is required.");
    if (!form.group_name.trim()) return setError("Group Name is required.");
    setSaving(true);
    try {
      const payload = { parent_group_id: form.parent_group_id, group_name: form.group_name.trim() };
      if (editing) await api.put(`/finance/groups/${editing}/`, payload, auth);
      else await api.post("/finance/groups/", payload, auth);
      reset();
      setSuccess("Group saved successfully.");
      load();
    } catch (requestError) { setError(apiErrorMessage(requestError, "Unable to save group.")); }
    finally { setSaving(false); }
  };
  const remove = async item => {
    if (!await confirmDelete("Delete this group?")) return;
    try { await api.delete(`/finance/groups/${item.id}/`, auth); if (editing === item.id) reset(); setSuccess("Group deleted successfully."); load(); }
    catch (requestError) { setError(apiErrorMessage(requestError, "Unable to delete group.")); }
  };
  const fields = <div className="group-fields">
    <label className="group-field">
      <span>Group Tag <i>*</i></span>
      <SearchableDropdown options={tagOptions} value={form.parent_group_id} onChange={value => update("parent_group_id", value)} placeholder="Select Group"/>
    </label>
    <label className="group-field">
      <span>Group Name <i>*</i></span>
      <span className="group-input"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg><input required maxLength={150} placeholder="Enter group name" value={form.group_name} onChange={event => update("group_name", event.target.value)}/></span>
    </label>
  </div>;
  return <div className="group-page">
    <nav className="group-breadcrumb" aria-label="Breadcrumb">
      <button type="button" className="group-back" aria-label="Back" onClick={() => go("/masters")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"/></svg></button>
      <button type="button" className="group-crumb" onClick={() => go("/masters")}>Masters</button>
      <svg className="group-sep" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
      <strong>Group</strong>
    </nav>
    {!isListView && <section className="group-card">
      <h2 className="group-card-title">Add Group</h2>
      <form onSubmit={save}>
        {fields}
        <footer className="group-actions">
          <button type="button" onClick={() => go("/masters")}>Cancel</button>
          <button className="group-save" disabled={saving}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>}
    {isListView && <section className="group-card group-list">
      <h2 className="group-card-title">Group List</h2>
      <div className="group-table-wrap">
        <table className="group-table">
          <thead><tr><th>S.No</th><th>Group Tag</th><th>Group Name</th><th>Action</th></tr></thead>
          <tbody>{rows.map((item, index) => <tr key={item.id}>
            <td>{String(index + 1).padStart(2, "0")}</td>
            <td>{nameById.get(item.parent_group_id) ?? "—"}</td>
            <td>{item.group_name}</td>
            <td><RowActions onEdit={() => { setEditing(item.id); setForm({ parent_group_id: item.parent_group_id || "", group_name: item.group_name }); }} onDelete={() => remove(item)}/></td>
          </tr>)}</tbody>
        </table>
        {!rows.length && <div className="group-empty">No groups found.</div>}
      </div>
    </section>}
    {isListView && editing && <div className="group-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && reset()}>
      <div className="group-modal">
        <h2 className="group-card-title">Edit Group</h2>
        <form onSubmit={save}>
          {fields}
          <footer className="group-actions">
            <button type="button" onClick={reset}>Cancel</button>
            <button className="group-save" disabled={saving}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>{saving ? "Saving..." : "Save"}</button>
          </footer>
        </form>
      </div>
    </div>}
  </div>;
}
