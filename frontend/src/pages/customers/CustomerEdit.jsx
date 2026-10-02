import { useEffect, useMemo, useRef, useState } from "react";
import "../../styles/customer-actions.css";
import { actionToast } from "../../utils/actionToast";
import DistrictDropdown from "../../components/DistrictDropdown";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import { ROLE_ROOT_NAMES, findRootGroup, descendantOptions } from "../../utils/groupHierarchy";
import "./CustomerFormCompact.css";
import "./CustomerWhatsapp.css";
import "./CustomerEditOverrides.css";

const CUSTOMER_LIST_ROUTE = "/customers";
const validCustomerId = value => /^\d+$/.test(String(value || "")) && Number(value) > 0;
const roleLabel = value => ({ BORROWER: "Sundry Debtors", LENDER: "Sundry Creditors", BOTH: "Sundry Debtors & Sundry Creditors" }[value] || value || "");
let editLocationConfig = null;

export function CustomerEdit({ api, auth, go, id }) {
  const [form, setForm] = useState(null), [error, setError] = useState(""), [saved, setSaved] = useState(""), [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const original = useRef(null), districtRef = useRef(null), stateRef = useRef(null), countryRef = useRef(null), pincodeRef = useRef(null);
  const validId = validCustomerId(id);
  useEffect(() => {
    if (!validId) { go(CUSTOMER_LIST_ROUTE); return undefined; }
    let active = true;
    setLoading(true);
    api.get(`/customers/${id}/`, auth).then(response => { if (active) { original.current = response.data; setForm(response.data); } }).catch(() => { if (active) setError("Unable to load customer."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, id, validId]);
  useEffect(() => {
    let active = true;
    api.get("/finance/groups/", auth).then(({ data }) => { if (active) setGroups(data.results ?? data); }).catch(() => {});
    return () => { active = false; };
  }, [api]);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value, ...(key === "role" && value !== current.role ? { group: "" } : {}) }));
  const setPhone = value => setForm(current => ({ ...current, primary_mobile: value, ...(current.is_whatsapp_same_as_phone ? { whatsapp_number: value } : {}) }));
  const setWhatsappSame = checked => setForm(current => ({ ...current, is_whatsapp_same_as_phone: checked, whatsapp_number: checked ? current.primary_mobile : current.whatsapp_number }));
  const handleCancel = () => go(CUSTOMER_LIST_ROUTE);
  // Customer Type's options come from Group_tbl's root records (never a hardcoded id); the Group
  // dropdown is limited to that root's descendants -- for a legacy "Both" record, both roots' trees.
  const customerTypeOptions = useMemo(() => Object.entries(ROLE_ROOT_NAMES)
    .map(([role, rootName]) => [role, findRootGroup(groups, rootName)])
    .filter(([, root]) => root)
    .map(([role, root]) => ({ value: role, label: root.group_name })), [groups]);
  const groupRootIds = useMemo(() => {
    const role = form?.role;
    if (role === "BOTH") return Object.values(ROLE_ROOT_NAMES).map(name => findRootGroup(groups, name)?.id).filter(Boolean);
    if (role === "BORROWER" || role === "LENDER") return [findRootGroup(groups, ROLE_ROOT_NAMES[role])?.id].filter(Boolean);
    return [];
  }, [groups, form?.role]);
  const groupOptions = useMemo(() => {
    const options = descendantOptions(groups, groupRootIds);
    // Defensive: never hide an already-saved Group just because it falls outside the current filter.
    if (form?.group && !options.some(option => String(option.value) === String(form.group))) {
      const current = groups.find(item => String(item.id) === String(form.group));
      if (current) options.push({ value: current.id, label: current.group_name });
    }
    return options;
  }, [groups, groupRootIds, form?.group]);
  if (!validId) return null;
  if (loading) return <section className="panel">Loading customer...</section>;
  if (!form) return <section className="panel"><div className="alert">{error || "Customer could not be loaded."}</div><button type="button" className="secondary" onClick={handleCancel}>Back to Customers</button></section>;
  editLocationConfig = { inputRef: districtRef, stateRef, countryRef, nextRef: pincodeRef, onChange: value => setForm(current => ({ ...current, district: value })), onSelect: item => setForm(current => ({ ...current, district: item.name, state: item.state, country: item.country, pincode: item.pincode || current.pincode })), onStateChange: value => set("state", value), onCountryChange: value => set("country", value) };
  const save = async event => { event.preventDefault(); setError(""); setSaved(""); try { const response = await api.patch(`/customers/${id}/`, { ...form, group: form.group || null }, auth); if (response?.status >= 200 && response?.status < 300) { actionToast("Customer updated successfully"); setSaved("Customer updated successfully."); } else { actionToast("Customer update failed", false); } } catch (requestError) { actionToast("Customer update failed", false); setError(JSON.stringify(requestError.response?.data || "Unable to update customer.")); } };
  return <><PageBreadcrumb root="Customers" rootPath={CUSTOMER_LIST_ROUTE} items={[{ label: form.customer_code }]} current="Edit" onBack={handleCancel}/><header><div><p className="eyebrow">CUSTOMERS / EDIT</p><h1>Customer Details</h1></div><button type="button" className="secondary" onClick={handleCancel}>Cancel</button></header>{(error || saved) && <div className={error ? "alert" : "success"}>{error || saved}</div>}<form className="panel edit-form" onSubmit={save}><h2>Customer Details</h2><div className="form-grid"><Field label="Customer Code" value={form.customer_code} readOnly/><Field label="Customer Name *" value={form.full_name} onChange={event => set("full_name", event.target.value)}/><label>Customer Type<select value={form.role || ""} onChange={event => set("role", event.target.value)}><option value="">Select</option>{customerTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}{form.role === "BOTH" && <option value="BOTH">{roleLabel("BOTH")}</option>}</select></label><label>Group<SearchableDropdown options={groupOptions} value={form.group || ""} onChange={value => set("group", value)} placeholder={form.role ? "Select Group" : "Select Customer Type first"} disabled={!form.role} allowClear/></label><Field label="DOB" type="date" value={form.dob || ""} onChange={event => set("dob", event.target.value)}/><label>Gender<select value={form.gender || ""} onChange={event => set("gender", event.target.value)}><option value="">Select</option>{[...new Set(["Male", "Female", "Other", form.gender].filter(Boolean))].map(value => <option key={value}>{value}</option>)}</select></label><Field label="Occupation" value={form.occupation || ""} onChange={event => set("occupation", event.target.value)}/><Field label="Monthly Income" type="number" value={form.monthly_income ?? ""} onChange={event => set("monthly_income", event.target.value === "" ? null : event.target.value)}/><Field label="Phone Number *" value={form.primary_mobile} onChange={event => setPhone(event.target.value)}/><WhatsAppField value={form.whatsapp_number || ""} sameAsPhone={Boolean(form.is_whatsapp_same_as_phone)} onChange={value => set("whatsapp_number", value)} onSameChange={setWhatsappSame}/><Field label="Alternative Number" value={form.alternate_mobile || ""} onChange={event => set("alternate_mobile", event.target.value)}/><Field label="Email" value={form.email || ""} onChange={event => set("email", event.target.value)}/><Field label="Aadhaar Number" value={form.aadhaar_number || ""} onChange={event => set("aadhaar_number", event.target.value)}/><Field label="PAN Number" value={form.pan_number || ""} onChange={event => set("pan_number", event.target.value)}/><Field label="Address *" type="textarea" value={form.address || ""} onChange={event => set("address", event.target.value)}/><Field label="District" value={form.district || ""} onChange={event => set("district", event.target.value)}/><Field label="State" value={form.state || ""} onChange={event => set("state", event.target.value)}/><Field label="Pincode" value={form.pincode || ""} onChange={event => set("pincode", event.target.value)}/></div><div className="form-action-footer"><button type="button" className="secondary" onClick={handleCancel}>Cancel</button><button type="button" className="secondary" onClick={() => { setForm(original.current); setError(""); setSaved(""); }}>Reset</button><button type="submit" className="primary">Save</button></div></form></>;
}

function WhatsAppField({ value, sameAsPhone, onChange, onSameChange }) { return <div className="form-field whatsapp-field"><div className="whatsapp-header"><label htmlFor="customer-edit-whatsapp">WhatsApp Number</label><label className="same-phone-option"><input type="checkbox" checked={sameAsPhone} onChange={event => onSameChange(event.target.checked)}/><span>Same as Phone</span></label></div><input id="customer-edit-whatsapp" type="text" value={value} placeholder="Enter WhatsApp Number" readOnly={sameAsPhone} onChange={event => onChange(event.target.value)}/></div>; }

function CustomerViewLegacy({ api, auth, go, id }) {
  const [customer, setCustomer] = useState(null), [loans, setLoans] = useState([]), [loading, setLoading] = useState(true);
  const validId = validCustomerId(id);
  useEffect(() => { if (!validId) { go(CUSTOMER_LIST_ROUTE); return undefined; } let active = true; setLoading(true); Promise.all([api.get(`/customers/${id}/`, auth), api.get("/finance/loans/", { ...auth, params: { customer: id, page_size: 1000 } })]).then(([customerResponse, loanResponse]) => { if (!active) return; setCustomer(customerResponse.data); setLoans(loanResponse.data.results ?? loanResponse.data ?? []); }).catch(() => {}).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [api, id, validId]);
  if (!validId) return null;
  if (loading) return <section className="panel">Loading customer...</section>;
  if (!customer) return <section className="panel"><div className="alert">Customer could not be loaded.</div><button type="button" className="secondary" onClick={() => go(CUSTOMER_LIST_ROUTE)}>Back to Customers</button></section>;
  const value = (item, fallback = "-") => item === null || item === undefined || item === "" ? fallback : item;
  return <><PageBreadcrumb root="Customers" rootPath={CUSTOMER_LIST_ROUTE} items={[{ label: value(customer.customer_code) }]} current="Details" onBack={() => go(CUSTOMER_LIST_ROUTE)}/><header><div><p className="eyebrow">CUSTOMER PROFILE</p><h1>{value(customer.full_name)}</h1></div><button type="button" className="primary" onClick={() => go(`/customers/${id}/edit`)}>Edit Customer</button></header><section className="panel profile-card"><span className="mono">{value(customer.customer_code)}</span><h2>{value(customer.full_name)}</h2><div className="customer-detail-grid">{[["Email", customer.email], ["Phone", customer.primary_mobile], ["WhatsApp", customer.whatsapp_number], ["Address", customer.address], ["District", customer.district], ["State", customer.state], ["Country", customer.country], ["Pincode", customer.pincode], ["Customer Type", customer.role_display || customer.role], ["Status", customer.is_active ? "Active" : "Inactive"], ["Created Date", customer.created_at], ["Updated Date", customer.updated_at]].filter(([, item]) => item !== null && item !== undefined && item !== "").map(([label, item]) => <div key={label}><small>{label}</small><strong>{value(item)}</strong></div>)}</div>{loans.length > 0 && <div className="customer-loans"><h3>Loan Information</h3>{loans.map(loan => <div key={loan.id}><strong>{value(loan.loan_no)}</strong><span>{value(loan.loan_type?.name)} · {value(loan.plan?.name)} · {value(loan.start_date || loan.loan_start_date)}</span></div>)}</div>}</section></>;
}

export function CustomerView({ api, auth, go, id }) {
  const [customer, setCustomer] = useState(null), [loading, setLoading] = useState(true);
  const validId = validCustomerId(id);
  useEffect(() => { if (!validId) { go(CUSTOMER_LIST_ROUTE); return undefined; } let active = true; api.get(`/customers/${id}/`, auth).then(response => { if (active) setCustomer(response.data); }).catch(() => {}).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [api, id, validId]);
  if (!validId) return null;
  if (loading) return <section className="panel">Loading customer...</section>;
  if (!customer) return <section className="panel"><div className="alert">Customer could not be loaded.</div><button type="button" className="secondary" onClick={() => go(CUSTOMER_LIST_ROUTE)}>Back to Customers</button></section>;
  const value = (item, fallback = "-") => item === null || item === undefined || item === "" ? fallback : item;
  const parts = [customer.address, customer.district, customer.state, customer.country?.toLowerCase() === "india" ? "" : customer.country].filter(Boolean);
  const address = `${parts.join(", ")}${customer.pincode ? `${parts.length ? " - " : ""}${customer.pincode}` : ""}`;
  const details = [["Customer Code", customer.customer_code], ["Customer Name", customer.full_name], ["Phone Number", customer.primary_mobile], ["WhatsApp Number", customer.whatsapp_number], ["Alternative Number", customer.alternate_mobile], ["Email", customer.email], ["DOB", customer.dob], ["Gender", customer.gender], ["PAN Number", customer.pan_number], ["Aadhaar Number", customer.aadhaar_number], ["Address", address]].filter(([, item]) => item !== null && item !== undefined && item !== "");
  return <><PageBreadcrumb root="Customers" rootPath={CUSTOMER_LIST_ROUTE} items={[{ label: value(customer.customer_code) }]} current="Details" onBack={() => go(CUSTOMER_LIST_ROUTE)}/><header><div><p className="eyebrow">CUSTOMER PROFILE</p><h1>{value(customer.full_name)}</h1></div><button type="button" className="primary" onClick={() => go(`/customers/${id}/edit`)}>Edit Customer</button></header><section className="panel profile-card"><div className="customer-detail-grid">{details.map(([label, item]) => <div className={label === "Address" ? "customer-detail-wide" : ""} key={label}><small>{label}</small><strong>{value(item)}</strong></div>)}</div></section></>;
}

function Field({ label, type = "text", ...props }) {
  const required = label.endsWith(" *");
  const baseLabel = required ? label.slice(0, -2) : label;
  const star = required ? <> <span className="required-star">*</span></> : null;
  if (baseLabel.startsWith("District") && editLocationConfig) return <label>{baseLabel}{star}<DistrictDropdown {...editLocationConfig} kind="district" value={props.value || ""}/></label>;
  if (baseLabel.startsWith("State") && editLocationConfig) return <label>{baseLabel}{star}<DistrictDropdown kind="state" value={props.value || ""} inputRef={editLocationConfig.stateRef} nextRef={editLocationConfig.nextRef} onChange={editLocationConfig.onStateChange} onSelect={item => editLocationConfig.onStateChange(item.name)}/></label>;
  if (baseLabel.startsWith("Country") && editLocationConfig) return <label>{baseLabel}{star}<DistrictDropdown kind="country" value={props.value || ""} inputRef={editLocationConfig.countryRef} nextRef={editLocationConfig.nextRef} onChange={editLocationConfig.onCountryChange} onSelect={item => editLocationConfig.onCountryChange(item.name)}/></label>;
  return <label>{baseLabel}{star}{type === "textarea" ? <textarea {...props}/> : <input ref={baseLabel.startsWith("Pincode") ? editLocationConfig?.nextRef : undefined} type={type} {...props}/>}</label>;
}
