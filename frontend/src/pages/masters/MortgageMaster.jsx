import { useEffect, useRef, useState } from "react";
import ListPageToolbar from "../../components/ListPageToolbar";
import CustomSelect from "../../components/CustomSelect";
import RowActions from "../../components/RowActions";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import "./MortgageMaster.css";
import MortgageEditModal from "./MortgageEditModal";
import MortgageViewModal from "./MortgageViewModal";

const rowsOf = data => data?.results ?? data ?? [];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const blank = () => ({ product_group: "", product_name: "", quantity: "", unit: "", current_rate: "", rate_date: today() });

export default function MortgageMaster({ api, auth }) {
  const original = useRef(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [units, setUnits] = useState(["Gram", "No", "Pcs"]);
  useEffect(() => { api.get("/finance/mortgages/units/", auth).then(({ data }) => setUnits(data)).catch(() => {}); }, []);
  const addUnit = async name => { const { data } = await api.post("/finance/mortgages/units/", { name }, auth); setUnits(current => [...new Set([...current, data.name])]); return data.name; };
  const [productGroups, setProductGroups] = useState(["Gold", "Silver", "Brass", "Bronze"]);
  useEffect(() => { api.get("/finance/mortgages/product-groups/", auth).then(({ data }) => setProductGroups(data)).catch(() => {}); }, []);
  const addProductGroup = async name => { const { data } = await api.post("/finance/mortgages/product-groups/", { name }, auth); setProductGroups(current => [...new Set([...current, data.name])]); return data.name; };
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = () => api.get("/finance/mortgages/", { ...auth, params: { search } }).then(({ data }) => { setItems(rowsOf(data)); setError(""); }).catch(() => setError("Unable to load Mortgage Rate History."));
  useEffect(() => { load(); }, [search]);
  const visibleItems = groupFilter ? items.filter(item => item.product_group === groupFilter) : items;
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async event => {
    event.preventDefault();
    if (!form.product_group.trim()) return setError("Product Group is required.");
    if (!form.product_name.trim()) return setError("Product Name is required.");
    if (!form.unit.trim()) return setError("Unit is required.");
    if (!(Number(form.current_rate) > 0)) return setError("Current Rate must be greater than zero.");
    setSaving(true); setError("");
    try {
      const payload = { product_group: form.product_group.trim(), product_name: form.product_name.trim(), unit: form.unit.trim(), current_rate: form.current_rate, rate_date: form.rate_date };
      payload.quantity = form.quantity === "" || form.quantity == null ? null : form.quantity;
      if (form.id) await api.put(`/finance/mortgages/${form.id}/`, payload, auth);
      else await api.post("/finance/mortgages/", payload, auth);
      setForm(null); load();
    } catch (requestError) {
      setError(requestError.response?.data ? Object.values(requestError.response.data).flat().join(" ") : "Unable to save Mortgage Product.");
    } finally {
      setSaving(false);
    }
  };
  const remove = async item => {
    if (!await confirmDelete(`Delete ${item.product_name}?`)) return;
    try { await api.delete(`/finance/mortgages/${item.id}/`, auth); actionToast("Mortgage Product deleted successfully."); load(); }
    catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to delete Mortgage Product."), false); }
  };
  const editItem = async item => { try { const { data } = await api.get(`/finance/mortgages/${item.id}/`, auth); original.current = { ...data, rate_date: data.rate_date || today() }; setDetail(null); setForm(original.current); } catch { setError("Unable to load Mortgage Product."); } };
  const viewItem = async item => { try { const { data } = await api.get(`/finance/mortgages/${item.id}/`, auth); setDetail(data); } catch { setError("Unable to load Mortgage Product."); } };
  return <div className="mortgage-master-page">
    <ListPageToolbar eyebrow="MASTERS" title="Mortgage Rate History" search={search} onSearch={setSearch} placeholder="Search mortgage products..." filters={[{ label: "Group", value: groupFilter, onChange: setGroupFilter, options: [{ value: "", label: "All Groups" }, ...productGroups.map(group => ({ value: group, label: group }))] }]} action={<button className="primary" onClick={() => setForm(blank())}>+ Add Mortgage</button>} />
    {error && <div className="error mortgage-error">{error}</div>}
    <section className="panel list-container mortgage-master-surface">
      <div className="table-wrap"><table><thead><tr><th>S.No</th><th>Product Group</th><th>Product Name</th><th>Unit</th><th>Current Rate</th><th>Date</th><th className="mortgage-action-head">Action</th></tr></thead><tbody>{visibleItems.map((item, index) => <tr key={item.id} className="mortgage-row-clickable" tabIndex="0" onClick={() => viewItem(item)} onKeyDown={event => event.target === event.currentTarget && event.key === "Enter" && viewItem(item)}><td>{index + 1}</td><td>{item.product_group || "-"}</td><td><strong>{item.product_name}</strong></td><td>{item.unit}</td><td>{formatINR(item.current_rate)}</td><td>{item.rate_date || "-"}</td><td className="mortgage-row-action-cell"><RowActions onEdit={() => editItem(item)} onDelete={() => remove(item)} /></td></tr>)}</tbody></table>{!visibleItems.length && <div className="empty">No mortgage products found.</div>}</div>
      <footer className="footer paginationFooter"><span>Showing {visibleItems.length ? `1-${visibleItems.length}` : 0} of {visibleItems.length}</span><div>Previous&nbsp;&nbsp; 1 &nbsp;&nbsp; Next</div></footer>
    </section>
    {detail && <MortgageViewModal item={detail} onClose={() => setDetail(null)} onEdit={() => editItem(detail)} />}
    {form?.id && <MortgageEditModal api={api} auth={auth} form={form} update={update} units={units} addUnit={addUnit} productGroups={productGroups} addProductGroup={addProductGroup} resetVersion={resetVersion} saving={saving} onSave={save} onClose={() => setForm(null)} onReset={() => { setForm(original.current); setResetVersion(value => value + 1); setError(""); }} />}
    {form && !form.id && <div className="mortgage-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setForm(null)}><form className={`mortgage-modal${form.id ? "" : " mortgage-modal-add"}`} onSubmit={save}><header><h2>{form.id ? "Edit Mortgage Product" : "Add Mortgage Product"}</h2><button type="button" onClick={() => setForm(null)}>×</button></header><label>Product Group <b className="mortgage-required">*</b><CustomSelect key={`group-${form.id || "new"}-${resetVersion}`} label="product group" maxLength={50} value={form.product_group} options={productGroups} onChange={value => update("product_group", value)} onAdd={addProductGroup} /></label><label>Product Name <b className="mortgage-required">*</b><input value={form.product_name} onChange={event => update("product_name", event.target.value)} /></label><label>Unit <b className="mortgage-required">*</b><CustomSelect key={`${form.id || "new"}-${resetVersion}`} label="unit" maxLength={50} value={form.unit} options={units} onChange={value => update("unit", value)} onAdd={addUnit} /></label><label>Current Rate<input type="number" min="0" step="0.01" inputMode="decimal" value={form.current_rate} onChange={event => update("current_rate", event.target.value)} /></label><label>Date<input type="date" required value={form.rate_date || ""} onChange={event => update("rate_date", event.target.value)} /></label>{form.rate_history?.length > 0 && <div><h3>Rate History</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Rate</th></tr></thead><tbody>{form.rate_history.map(row => <tr key={row.date}><td>{row.date}</td><td>{formatINR(row.rate)}</td></tr>)}</tbody></table></div></div>}<footer><button type="button" onClick={() => { setForm(form.id ? original.current : blank()); setResetVersion(value => value + 1); setError(""); }}>Reset</button><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button></footer></form></div>}
  </div>;
}
