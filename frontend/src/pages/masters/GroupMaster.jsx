import PageBreadcrumb from "../../components/PageBreadcrumb";
import { useEffect, useMemo, useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import RowActions from "../../components/RowActions";
import { groupTree } from "../../components/ListFilters/ListFilters";
import ListPageToolbar from "../../components/ListPageToolbar";
import ListExport, { exportFiltersLine } from "../../components/ListExport/ListExport";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import MortgageTaxFields from "./MortgageTaxFields";
import "./group-master.css";

const pageSize = 10;
const TAXABLE_NATURES = ["INCOME", "EXPENSE"];
const blank = () => ({ parent_group_id: "", group_name: "", hsn_code: "", rate_of_tax: 0 });

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
  // Every group from the database, except (when editing) the group itself and its own
  // sub-groups -- tagging a group under its own descendant would create a loop.
  const tagOptions = useMemo(() => {
    const blocked = new Set();
    if (editing != null) {
      blocked.add(String(editing));
      let grew = true;
      while (grew) { grew = false; items.forEach(item => { if (item.parent_group_id != null && blocked.has(String(item.parent_group_id)) && !blocked.has(String(item.id))) { blocked.add(String(item.id)); grew = true; } }); }
    }
    return orderGroups(items).filter(item => !blocked.has(String(item.id))).map(item => ({ value: item.id, label: `${"— ".repeat(item.depth)}${item.group_name}` }));
  }, [items, editing]);
  const openEdit = item => {
    setEditing(item.id);
    setForm({ parent_group_id: item.parent_group_id ?? "", group_name: item.group_name, hsn_code: item.hsn_code || "", rate_of_tax: item.rate_of_tax ?? 0 });
    load();
  };
  // HSN Code / Rate of Tax only for groups whose Group Tag sits under an Income or Expense root
  // (Direct / Indirect Expenses, Direct / Indirect Income), read from the root's nature -- never
  // from hardcoded IDs or names. Any other tag hides both fields and saves them blank.
  const isTaxable = useMemo(() => {
    const byId = new Map(items.map(item => [String(item.id), item]));
    let node = byId.get(String(form.parent_group_id)), guard = 0;
    while (node && node.parent_group_id != null && guard++ < 50) node = byId.get(String(node.parent_group_id));
    return TAXABLE_NATURES.includes(node?.nature);
  }, [items, form.parent_group_id]);
  // Group Tag column resolves parent_group_id -> its group_name for display only; the stored relationship stays ID-based.
  const nameById = useMemo(() => new Map(items.map(item => [item.id, item.group_name])), [items]);
  // Root/seed groups are Group Tag options only, not list rows the user "created".
  const rows = useMemo(() => items.filter(item => !item.is_system).slice().sort((a, b) => a.id - b.id), [items]);
  // Search + pagination, same behaviour as the Ledger List.
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  // Group = the row's main/parent group (any level above it); Status = Active / Inactive.
  const [groupFilter, setGroupFilter] = useState("");
  const filterTree = useMemo(() => groupTree(items), [items]);
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(item => (!groupFilter || (item.parent_group_id != null && filterTree.isWithin(item.parent_group_id, groupFilter)))).filter(item => !needle ||`${item.group_name} ${nameById.get(item.parent_group_id) ?? ""}`.toLowerCase().includes(needle));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages);
  const pageRows = filtered.slice((current - 1) * pageSize, current * pageSize);
  const first = filtered.length ? (current - 1) * pageSize + 1 : 0, last = Math.min(current * pageSize, filtered.length);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const reset = () => { setForm(blank()); setEditing(null); };
  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (!form.group_name.trim()) return setError("Group Name is required.");
    if (!form.parent_group_id) return setError("Group Tag is required.");
    setSaving(true);
    try {
      const payload = { parent_group_id: form.parent_group_id, group_name: form.group_name.trim(), hsn_code: isTaxable ? form.hsn_code.trim() : "", rate_of_tax: isTaxable ? Number(form.rate_of_tax) || 0 : 0 };
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
  // Add Group Cancel: never saves; asks first when the form holds unsaved input.
  const cancelAdd = () => {
    const dirty = Object.entries(blank()).some(([key, value]) => String(form[key] ?? "") !== String(value));
    if (dirty && !window.confirm("Discard changes and return to Dashboard?")) return;
    go("/dashboard");
  };
  // Shared by Add Group and Edit Group: Group Name first, then Group Tag. The Group Tag
  // list is portalled so it is never clipped by the Edit modal's scroll area.
  const fields = <div className="group-fields">
    <label className="group-field">
      <span>Group Name <i>*</i></span>
      <span className="group-input"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg><input required maxLength={150} placeholder="Enter group name" value={form.group_name} onChange={event => update("group_name", event.target.value)}/></span>
    </label>
    <div className="group-field">
      <span>Group <i>*</i></span>
      <SearchableDropdown options={tagOptions} value={form.parent_group_id} onChange={value => update("parent_group_id", value)} placeholder="Select Group Tag" allowClear={false} portal/>
    </div>
    {isTaxable && <div className="group-tax-row"><MortgageTaxFields key={`group-tax-${editing ?? "new"}`} optional showUnits={false} form={form} update={update}/></div>}
  </div>;
  return <div className={`group-page ${isListView ? "data-page" : ""}`}>
    {isListView
      ? <ListPageToolbar title="Group List" search={search} onSearch={value => { setSearch(value); setPage(1); }} placeholder="Search group name or main group..." filters={[{ label: "Group", value: groupFilter, onChange: value => { setGroupFilter(value); setPage(1); }, options: filterTree.options }]}
          action={<ListExport title="Group List" rows={filtered} filtersLine={exportFiltersLine([["Search", search], ["Group", filterTree.options.find(option => option.value && option.value === groupFilter)?.label?.replace(/^(— )+/, "")]])} columns={[{ header: "S.No", value: (item, index) => index + 1, align: "center" }, { header: "Name", value: item => item.group_name }, { header: "Group", value: item => nameById.get(item.parent_group_id) }]} />} />
      : <PageBreadcrumb className="group-breadcrumb" current="Add Group" />}
    {!isListView && <section className="group-card">
      
      <form onSubmit={save}>
        {fields}
        <footer className="group-actions">
          <button type="button" onClick={cancelAdd}>Cancel</button>
          <button className="group-save" disabled={saving}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>{saving ? "Saving..." : "Save"}</button>
        </footer>
      </form>
    </section>}
    {isListView && <section className="group-card group-list data-container">
      <div className="group-table-wrap data-table-area">
        <table className="group-table">
          <thead><tr><th>S.No</th><th>Name</th><th>Group</th><th>Action</th></tr></thead>
          <tbody>{pageRows.map((item, index) => <tr key={item.id}>
            <td>{String(first + index).padStart(2, "0")}</td>
            <td>{item.group_name}</td>
            <td>{nameById.get(item.parent_group_id) ?? "—"}</td>
            <td><RowActions onEdit={() => openEdit(item)} onDelete={() => remove(item)}/></td>
          </tr>)}</tbody>
        </table>
        {!filtered.length && <div className="group-empty">No groups found.</div>}
      </div>
      <footer className="group-pager data-footer">
        <span>Showing {first} to {last} of {filtered.length} entries</span>
        <div>
          <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
          {Array.from({ length: pages }, (_, i) => i + 1).map(number => <button type="button" key={number} className={number === current ? "active" : ""} onClick={() => setPage(number)}>{number}</button>)}
          <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      </footer>
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
