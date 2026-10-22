import { useEffect, useRef, useState } from "react";
import "../../styles/customer-actions.css";
import { actionToast } from "../../utils/actionToast";
import DistrictDropdown from "../../components/DistrictDropdown";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import GroupDropdown from "../../components/GroupDropdown/GroupDropdown";
import { KycDocumentsSection } from "../../components/KycDocuments/KycDocuments";
import "./CustomerFormCompact.css";
import "./CustomerWhatsapp.css";
import "./CustomerEditOverrides.css";
import CustomerFormStepper from "./CustomerFormStepper";

const CUSTOMER_LIST_ROUTE = "/customers";
const validCustomerId = value => /^\d+$/.test(String(value || "")) && Number(value) > 0;
let editLocationConfig = null;

// Edit Customer is the Add Customer form itself in edit mode (same layout, fields,
// KYC section and buttons); see CustomerFormStepper's `id` prop.
export function CustomerEdit({ api, auth, go, id }) {
  const validId = validCustomerId(id);
  useEffect(() => { if (!validId) go(CUSTOMER_LIST_ROUTE); }, [validId]);
  if (!validId) return null;
  return <CustomerFormStepper key={id} api={api} auth={auth} go={go} id={id} />;
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
  return <><PageBreadcrumb current="Customer Details" /><header><div><h2 className="customer-profile-name">{value(customer.full_name)}</h2></div><button type="button" className="primary" onClick={() => go(`/customers/${id}/edit`)}>Edit Customer</button></header><section className="panel profile-card"><span className="mono">{value(customer.customer_code)}</span><h2>{value(customer.full_name)}</h2><div className="customer-detail-grid">{[["Email", customer.email], ["Phone", customer.primary_mobile], ["WhatsApp", customer.whatsapp_number], ["Address", customer.address], ["District", customer.district], ["State", customer.state], ["Country", customer.country], ["Pincode", customer.pincode], ["Customer Type", customer.role_display || customer.role], ["Status", customer.is_active ? "Active" : "Inactive"], ["Created Date", customer.created_at], ["Updated Date", customer.updated_at]].filter(([, item]) => item !== null && item !== undefined && item !== "").map(([label, item]) => <div key={label}><small>{label}</small><strong>{value(item)}</strong></div>)}</div>{loans.length > 0 && <div className="customer-loans"><h3>Loan Information</h3>{loans.map(loan => <div key={loan.id}><strong>{value(loan.loan_no)}</strong><span>{value(loan.loan_type?.name)} · {value(loan.plan?.name)} · {value(loan.start_date || loan.loan_start_date)}</span></div>)}</div>}</section></>;
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
  return <><PageBreadcrumb current="Customer Details" /><header><div><h2 className="customer-profile-name">{value(customer.full_name)}</h2></div><button type="button" className="primary" onClick={() => go(`/customers/${id}/edit`)}>Edit Customer</button></header><section className="panel profile-card"><div className="customer-detail-grid">{details.map(([label, item]) => <div className={label === "Address" ? "customer-detail-wide" : ""} key={label}><small>{label}</small><strong>{value(item)}</strong></div>)}</div></section></>;
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
