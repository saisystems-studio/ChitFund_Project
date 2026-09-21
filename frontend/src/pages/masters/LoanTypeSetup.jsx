import { useEffect, useMemo, useRef, useState } from "react";
import "./LoanTypeSetup.css";

const short = { Daily: "D", Weekly: "W", Monthly: "M", Others: "O", "100 Days": "100" };
const months = Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: new Date(2000, index, 1).toLocaleString("en-IN", { month: "long" }) }));
const dayCount = month => month === 2 ? 29 : [4, 6, 9, 11].includes(Number(month)) ? 30 : 31;
const normalizedName = value => String(value || "").trim().toLowerCase() === "other" ? "Others" : String(value || "").trim();

export default function LoanTypeSetup({ api, auth, go }) {
  const [types, setTypes] = useState([]), [installments, setInstallments] = useState([]);
  const [editing, setEditing] = useState(null), [form, setForm] = useState({ name: "", allowed_installment_ids: [], repeat_type: "", due_month: "", due_day: "", is_active: true });
  const [error, setError] = useState(""), [periodicError, setPeriodicError] = useState(""), [saving, setSaving] = useState(false);
  const modalRef = useRef(null);
  const otherId = installments.find(item => normalizedName(item.name) === "Others")?.id;
  const annualId = installments.find(item => String(item.name || "").trim().toLowerCase() === "annual")?.id;
  const canonicalIds = ids => ids.map(Number).map(value => annualId && otherId && value === Number(annualId) ? Number(otherId) : value).filter((value, index, all) => all.indexOf(value) === index);
  const isOthers = form.allowed_installment_ids.map(Number).includes(Number(otherId));
  const isFixedType = item => ["chit", "interest"].includes(String(item?.name || "").trim().toLowerCase());
  const editingFixed = isFixedType(types.find(item => String(item.id) === String(editing)));
  const load = async () => {
    setError(""); setPeriodicError("");
    const [typeResult, periodicResult] = await Promise.allSettled([api.get("/finance/loan-types/", auth), api.get("/finance/loan-installments/", auth)]);
    if (typeResult.status === "fulfilled") setTypes(typeResult.value.data.results ?? typeResult.value.data);
    else setError("Unable to load loan type settings.");
    if (periodicResult.status === "fulfilled") setInstallments((periodicResult.value.data.results ?? periodicResult.value.data).filter(item => item.is_active && !["annual", "half-yearly", "half yearly", "quarterly"].includes(String(item.name || "").trim().toLowerCase())));
    else setPeriodicError("Unable to load periodic options.");
  };
  useEffect(() => { load(); }, []);
  const close = () => go("/dashboard");
  const begin = item => { const ids = canonicalIds(item?.allowed_installment_ids || []); setEditing(item?.id || null); setForm({ name: item?.name || "", allowed_installment_ids: ids, repeat_type: item?.repeat_type || "", due_month: item?.due_month || "", due_day: item?.due_day || "", is_active: item?.is_active ?? true }); setError(""); setPeriodicError(""); requestAnimationFrame(() => modalRef.current?.scrollTo({ top: 0, behavior: "smooth" })); };
  const toggle = id => { const numericId = Number(id); setForm(current => ({ ...current, allowed_installment_ids: current.allowed_installment_ids.map(Number).includes(numericId) ? current.allowed_installment_ids.filter(value => Number(value) !== numericId) : [...current.allowed_installment_ids, numericId] })); };
  const setRule = (key, value) => setForm(current => ({ ...current, [key]: value, ...(key === "due_month" && Number(value) && Number(current.due_day) > dayCount(value) ? { due_day: String(dayCount(value)) } : {}) }));
  const apiError = requestError => { const data = requestError.response?.data; if (typeof data === "string") return data; if (data?.detail) return data.detail; return data ? Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join(" | ") : "Unable to save Loan Type."; };
  const save = async event => {
    event.preventDefault();
    if (!form.name.trim() || !form.allowed_installment_ids.length) return setError("Loan Type Name and at least one Supported Period are required.");
    if (isOthers && (form.repeat_type !== "Year" || !form.due_month || !form.due_day || Number(form.due_day) > dayCount(form.due_month))) return setError("Select a valid yearly month and custom due date.");
    setSaving(true); setError("");
    const payload = { ...form, allowed_installment_ids: canonicalIds(form.allowed_installment_ids), repeat_type: isOthers ? "Year" : "", due_month: isOthers ? Number(form.due_month) : null, due_day: isOthers ? Number(form.due_day) : null };
    try { const response = editing ? await api.patch(`/finance/loan-types/${editing}/`, payload, auth) : await api.post("/finance/loan-types/", payload, auth); setTypes(current => editing ? current.map(item => String(item.id) === String(editing) ? response.data : item) : [...current, response.data]); begin(null); }
    catch (requestError) { setError(apiError(requestError)); } finally { setSaving(false); }
  };
  const deactivate = async item => { if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return; try { await api.delete(`/finance/loan-types/${item.id}/`, auth); setTypes(current => current.filter(row => row.id !== item.id)); } catch (requestError) { setError(apiError(requestError)); } };
  const displayPeriod = item => normalizedName(item.name);
  const selected = id => form.allowed_installment_ids.map(Number).includes(Number(id));
  return <div className="loan-type-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}><section ref={modalRef} className="loan-type-modal" role="dialog" aria-modal="true" aria-labelledby="loan-type-title"><div className="loan-type-modal-head"><div><p className="eyebrow">MASTERS / LOAN TYPE</p><h1 id="loan-type-title">Loan Type Setup</h1><p>Configure which collection periods each loan type can use.</p></div><button type="button" className="modal-close" onClick={close} aria-label="Close">×</button></div>{error && <div className="loan-type-error">{error}</div>}{editing && <form onSubmit={save} className="loan-type-form"><label>Loan Type Name *<input autoFocus value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="e.g. Chit" required readOnly={editingFixed} /></label><div><span className="field-label">Collection Plan *</span>{periodicError && <small className="periodic-error">{periodicError}</small>}<div className="periodic-chips">{installments.map(item => <button type="button" key={item.id} title={displayPeriod(item)} aria-label={displayPeriod(item)} className={selected(item.id) ? "selected" : ""} onClick={() => toggle(item.id)}><b>{short[displayPeriod(item)] || displayPeriod(item).slice(0, 1)}</b><small>{displayPeriod(item)}</small>{selected(item.id) && <b>✓</b>}</button>)}</div></div>{isOthers && <div className="yearly-rule"><label>Repeat By *<select value={form.repeat_type} onChange={event => setRule("repeat_type", event.target.value)}><option value="">Select</option><option value="Year">Year</option></select></label>{form.repeat_type === "Year" && <div className="yearly-rule-fields"><label>Month *<select value={form.due_month} onChange={event => setRule("due_month", event.target.value)}><option value="">Select Month</option>{months.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}</select></label><label>Custom Due Date *<select value={form.due_day} onChange={event => setRule("due_day", event.target.value)}><option value="">Select Date</option>{Array.from({ length: dayCount(form.due_month || 1) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label></div>}</div>}{!editingFixed && <label className="active-check"><input type="checkbox" checked={form.is_active} onChange={event => setForm({ ...form, is_active: event.target.checked })} /> Active</label>}<div className="loan-type-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving..." : editing ? "Update" : "Save"}</button></div></form>}<div className="loan-type-list"><div className="list-heading"><h2>Existing Loan Types</h2></div>{types.filter(isFixedType).map(item => <div className={`loan-type-row ${!item.is_active ? "inactive" : ""}`} key={item.id}><div><strong>{item.name}</strong><span>{installments.filter(period => canonicalIds(item.allowed_installment_ids || []).includes(Number(period.id))).map(displayPeriod).join(" · ") || "No period configured"}</span></div><em>{item.is_active ? "Active" : "Inactive"}</em><button type="button" onClick={() => begin(item)}>Edit</button>{item.is_active && !isFixedType(item) && <button type="button" onClick={() => deactivate(item)}>Deactivate</button>}</div>)}</div></section></div>;
}
