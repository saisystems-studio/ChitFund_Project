import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./CustomerForm.module.css";
import { actionToast } from "../../utils/actionToast";
import DistrictDropdown from "../../components/DistrictDropdown";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import { ROLE_ROOT_NAMES, findRootGroup, descendantOptions } from "../../utils/groupHierarchy";
import "./CustomerFormCompact.css";
import "./CustomerWhatsapp.css";
import "./CustomerFormGrid.css";
import PageBreadcrumb from "../../components/PageBreadcrumb";

const empty = { customer_code: "", full_name: "", dob: "", gender: "", occupation: "", monthly_income: "", role: "", group: "", email: "", primary_mobile: "", alternate_mobile: "", whatsapp_number: "", is_whatsapp_same_as_phone: false, aadhaar_number: "", pan_number: "", address: "", district: "", state: "", country: "India", pincode: "", is_active: true };
const CUSTOMER_DRAFT_KEY = "chitufund:draft:add-customer";
const loadDraft = () => {
  try {
    const saved = sessionStorage.getItem(CUSTOMER_DRAFT_KEY);
    const parsed = saved ? JSON.parse(saved) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...empty, ...parsed } : empty;
  } catch { return empty; }
};
const numeric = new Set(["primary_mobile", "alternate_mobile", "whatsapp_number", "aadhaar_number", "pincode"]);
const validators = {
  full_name: value => value.trim().length < 2 ? "Enter at least 2 characters." : !/^[A-Za-z .'-]+$/.test(value.trim()) ? "Use letters, spaces, dot or hyphen only." : "",
  email: value => value && !/^\S+@\S+\.\S+$/.test(value) ? "Enter a valid email address." : "",
  primary_mobile: value => !/^\d{10}$/.test(value) ? "Phone Number must contain 10 digits." : "",
  alternate_mobile: value => value && !/^\d{10}$/.test(value) ? "Alternative Number must contain 10 digits." : "",
  whatsapp_number: value => value && !/^\d{10}$/.test(value) ? "WhatsApp Number must contain 10 digits." : "",
  aadhaar_number: value => value && !/^\d{12}$/.test(value) ? "Aadhar Number must contain 12 digits." : "",
  pan_number: value => value && !/^[A-Z]{5}\d{4}[A-Z]$/.test(value) ? "PAN Number must be in format ABCDE1234F." : "",
  dob: value => value && new Date(`${value}T00:00:00`) > new Date() ? "Date of Birth cannot be in the future." : "",
  monthly_income: value => value && Number(value) < 0 ? "Income cannot be negative." : "",
  address: value => value.trim().length < 5 ? "Enter a complete address." : "",
  pincode: value => value && !/^\d{6}$/.test(value) ? "Pincode must contain 6 digits." : ""
};
const required = new Set(["full_name", "primary_mobile", "address", "district", "state", "role"]);

export default function CustomerFormStepper({ api, auth, go }) {
  const [form, setForm] = useState(loadDraft);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState([]);
  const refs = useRef({});
  const checkboxEnter = useRef(0);

  useEffect(() => {
    let active = true;
    api.get("/customers/next-code/", auth).then(({ data }) => {
      if (active && data?.customer_code) setForm(current => ({ ...current, customer_code: data.customer_code }));
    }).catch(() => { if (active) actionToast("Unable to generate customer code.", false); });
    return () => { active = false; };
  }, [api, auth]);
  useEffect(() => {
    let active = true;
    api.get("/finance/groups/", auth).then(({ data }) => { if (active) setGroups(data.results ?? data); }).catch(() => {});
    return () => { active = false; };
  }, [api, auth]);
  useEffect(() => { try { sessionStorage.setItem(CUSTOMER_DRAFT_KEY, JSON.stringify(form)); } catch {} }, [form]);
  // Customer Type's two options come straight from Group_tbl's root records (never a hardcoded id);
  // the Group dropdown is then limited to that root's descendants, nested to any depth.
  const customerTypeOptions = useMemo(() => Object.entries(ROLE_ROOT_NAMES)
    .map(([role, rootName]) => [role, findRootGroup(groups, rootName)])
    .filter(([, root]) => root)
    .map(([role, root]) => ({ value: role, label: root.group_name })), [groups]);
  const groupRootId = form.role === "BORROWER" || form.role === "LENDER" ? findRootGroup(groups, ROLE_ROOT_NAMES[form.role])?.id ?? null : null;
  const groupOptions = useMemo(() => descendantOptions(groups, groupRootId), [groups, groupRootId]);

  const focus = key => refs.current[key]?.focus();
  const nextKey = key => {
    const order = ["full_name", "email", "primary_mobile", "is_whatsapp_same_as_phone", "whatsapp_number", "alternate_mobile", "dob", "gender", "occupation", "monthly_income", "role", "group", "address", "district", "state", "pincode", "aadhaar_number", "pan_number"];
    const index = order.indexOf(key);
    return index >= 0 ? order[index + 1] : undefined;
  };
  const moveNext = key => { const next = nextKey(key); if (next) setTimeout(() => focus(next), 0); };
  const set = (key, raw) => {
    let value = raw;
    if (numeric.has(key)) value = String(value).replace(/\D/g, "").slice(0, key === "aadhaar_number" ? 12 : key === "pincode" ? 6 : 10);
    if (key === "pan_number") value = String(value).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10);
    setForm(current => ({ ...current, [key]: key === "is_whatsapp_same_as_phone" ? Boolean(raw) : value, ...(key === "is_whatsapp_same_as_phone" ? { whatsapp_number: raw ? current.primary_mobile : "" } : {}), ...(key === "primary_mobile" && current.is_whatsapp_same_as_phone ? { whatsapp_number: value } : {}), ...(key === "role" && value !== current.role ? { group: "" } : {}) }));
    if (errors[key]) setErrors(current => ({ ...current, [key]: validators[key]?.(value) || "" }));
  };
  const validate = () => {
    const next = {};
    ["full_name", "email", "primary_mobile", "alternate_mobile", "whatsapp_number", "aadhaar_number", "pan_number", "dob", "monthly_income", "address", "pincode"].forEach(key => { const message = validators[key]?.(String(form[key] || "")); if (message) next[key] = message; });
    required.forEach(key => { if (!String(form[key] || "").trim()) next[key] = key === "district" ? "District is required." : key === "state" ? "State is required." : key === "country" ? "Country is required." : key === "role" ? "Customer Role is required." : `${key === "aadhaar_number" ? "Aadhar Number" : key === "pan_number" ? "PAN Number" : key === "dob" ? "Date of Birth" : key} is required.`; });
    setErrors(next);
    const first = ["full_name", "email", "primary_mobile", "alternate_mobile", "whatsapp_number", "address", "district", "state", "pincode", "aadhaar_number", "pan_number", "dob", "role"].find(key => next[key]);
    if (first) setTimeout(() => focus(first), 0);
    return !Object.keys(next).length;
  };
  const save = async event => {
    if (event && !event.altKey && !event.nativeEvent?.submitter) { event.preventDefault(); return; }
    event?.preventDefault();
    if (saving || !validate()) { if (!saving) actionToast("Unable to save customer. Please check the highlighted fields.", false); return; }
    setSaving(true); setNotice(""); setSaveError("");
    try {
      const { data } = await api.post("/customers/", { ...form, dob: form.dob || null, monthly_income: form.monthly_income === "" ? null : form.monthly_income, group: form.group || null }, auth);
      actionToast("Customer saved successfully.");
      try { sessionStorage.removeItem(CUSTOMER_DRAFT_KEY); } catch {}
      const next = await api.get("/customers/next-code/", auth);
      setForm({ ...empty, customer_code: next.data.customer_code }); setErrors({}); focus("full_name");
    } catch (error) {
      const raw = error.response?.data;
      const entries = raw && typeof raw === "object" ? Object.entries(raw) : [];
      const mapped = Object.fromEntries(entries.map(([key, value]) => [key, Array.isArray(value) ? value[0] : typeof value === "object" ? Object.values(value).flat()[0] : String(value)]));
      setErrors(mapped); const message = Object.values(mapped).filter(Boolean).join(" ") || "Unable to save customer. Please check the highlighted fields."; actionToast(message, false);
    } finally { setSaving(false); }
  };
  const reset = () => { try { sessionStorage.removeItem(CUSTOMER_DRAFT_KEY); } catch {} setForm(current => ({ ...empty, customer_code: current.customer_code })); setErrors({}); setNotice(""); setSaveError(""); focus("full_name"); };
  const keyDown = (event, key) => {
    if (event.altKey && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); save(event); return; }
    if (event.key !== "Enter" || event.isComposing) return;
    if (key === "is_whatsapp_same_as_phone") {
      event.preventDefault(); const now = Date.now(); if (now - checkboxEnter.current < 650) { const checked = !form[key]; set(key, checked); setTimeout(() => focus(checked ? "alternate_mobile" : "whatsapp_number"), 0); } checkboxEnter.current = now; return;
    }
    if (key === "address") return;
    event.preventDefault(); moveNext(key);
  };
  const field = (key, label, options = {}) => <Field key={key} inputRef={node => { refs.current[key] = node; }} label={label} required={required.has(key)} error={errors[key]} onKeyDown={event => keyDown(event, key)} value={form[key] || ""} onChange={event => set(key, event.target.value)} {...options}/>;
  const location = (key, label, kind, next, onSelect) => <label className={`${styles.field} ${errors[key] ? styles.invalid : ""}`} key={key}>{label} <b>*</b><DistrictDropdown kind={kind} value={form[key] || ""} inputRef={node => { refs.current[key] = node; }} nextRef={{ get current() { return refs.current[next]; } }} error={errors[key]} onChange={value => set(key, value)} onSelect={onSelect} /><FieldError message={errors[key]}/></label>;

  const cancel = () => { try { sessionStorage.removeItem(CUSTOMER_DRAFT_KEY); } catch {} go("/customers"); };
  return <div className={`${styles.page} add-customer-page`}><header className={styles.header}><PageBreadcrumb root="Masters" current="Add Customer" onBack={() => go("/masters")} /></header><form className={`${styles.form} ${styles.singleForm} add-customer-form`} onSubmit={save} onKeyDown={event => { if (event.altKey && event.key.toLowerCase() === "s") keyDown(event, ""); }} noValidate><div className={`${styles.formGrid} customer-form-grid`}>
    <Field label="Customer Code" value={form.customer_code} readOnly tabIndex={-1} aria-readonly="true" className={styles.generatedCode}/>
    {field("full_name", "Customer Name")}{field("email", "Email", { type: "email" })}
    {field("primary_mobile", "Phone Number", { inputMode: "numeric" })}{field("alternate_mobile", "Alternative Number", { inputMode: "numeric" })}
    {field("whatsapp_number", "WhatsApp Number", { inputMode: "numeric", placeholder: "Enter WhatsApp Number", readOnly: form.is_whatsapp_same_as_phone, "aria-readonly": form.is_whatsapp_same_as_phone, labelExtra: <span className={styles.whatsappSame} onKeyDown={event => keyDown(event, "is_whatsapp_same_as_phone")}><input ref={node => { refs.current.is_whatsapp_same_as_phone = node; }} type="checkbox" checked={form.is_whatsapp_same_as_phone} onChange={event => set("is_whatsapp_same_as_phone", event.target.checked)}/> Same as Phone</span> })}
    {field("dob", "DOB", { type: "date" })}{field("gender", "Gender", { children: <select value={form.gender} onChange={event => set("gender", event.target.value)} onKeyDown={event => keyDown(event, "gender")}><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select> })}{field("occupation", "Occupation")}
    {field("monthly_income", "Monthly Income", { type: "number", min: "0", step: "0.01" })}
    {field("role", "Customer Type", { children: <select ref={node => { refs.current.role = node; }} value={form.role} onChange={event => set("role", event.target.value)} onKeyDown={event => keyDown(event, "role")}><option value="">Select</option>{customerTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> })}
    {field("group", "Group", { children: <SearchableDropdown options={groupOptions} value={form.group || ""} onChange={value => set("group", value)} onEnterNext={() => moveNext("group")} placeholder={form.role ? "Select Group" : "Select Customer Type first"} disabled={!form.role} allowClear/> })}
    {field("address", "Address", { type: "textarea" })}
    {location("district", "District", "district", "state", item => setForm(current => ({ ...current, district: item.name, state: item.state, country: item.country, pincode: item.pincode || "" })))}
    {location("state", "State", "state", "pincode", item => set("state", item.name))}
    {field("pincode", "Pincode", { inputMode: "numeric" })}{field("aadhaar_number", "Aadhar Number", { inputMode: "numeric" })}{field("pan_number", "PAN Number")}
  </div><div className="form-action-footer customer-form-actions"><button type="button" className={styles.cancel} onClick={cancel}>Cancel</button><button type="button" className={styles.cancel} onClick={reset}>Reset</button><button type="submit" className={styles.primary} disabled={saving}>{saving ? "Saving..." : "Save Customer"}</button></div></form></div>;
}

function Field({ label, required, error, wide, inputRef, type = "text", children, labelExtra, ...props }) { return <label className={`${styles.field} ${labelExtra ? "whatsapp-field" : ""} ${wide ? styles.wide : ""} ${error ? styles.invalid : ""}`}>{labelExtra ? <span className={styles.whatsappLabelRow}>{label}{required && <b> *</b>}{labelExtra}</span> : <>{label}{required && <b> *</b>}</>}{children || <input ref={inputRef} type={type} {...props}/>}<FieldError message={error}/></label>; }
function FieldError({ message }) { return message ? <small className={styles.error}>{message}</small> : null; }
