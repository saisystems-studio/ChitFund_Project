import { useEffect, useState } from "react";
import SearchableDropdown from "../SearchableDropdown/SearchableDropdown";

// Shared "Done By" searchable staff dropdown, reused on every Master Add
// form. Shows "Staff Name – Staff ID" and searches both; never surfaces
// Aadhaar/address. Saves the staff's id (FK), never the display text.
export default function StaffDropdown({ api, auth, value, onChange, placeholder = "Select staff", disabled = false, allowClear = true, onEnterNext }) {
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    let active = true;
    api.get("/staff/", { ...auth, params: { is_active: true, page_size: 1000 } }).then(({ data }) => { if (active) setStaff(data.results ?? data); }).catch(() => {});
    return () => { active = false; };
  }, [api]);
  const options = staff.map(item => ({ value: item.id, label: `${item.staff_name} – ${item.staff_id}`, staff_name: item.staff_name, staff_id: item.staff_id }));
  return <SearchableDropdown options={options} searchKeys={["staff_name", "staff_id"]} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} allowClear={allowClear} onEnterNext={onEnterNext}/>;
}
