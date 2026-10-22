import { useEffect, useState } from "react";
import SearchableDropdown from "../SearchableDropdown/SearchableDropdown";

// Shared searchable Customer picker for report filter toolbars. Shows
// "Name — Code — Phone" and searches all three; saves the customer's id.
export default function CustomerDropdown({ api, auth, value, onChange, placeholder = "All Customers", disabled = false, allowClear = true, onEnterNext }) {
  const [customers, setCustomers] = useState([]);
  useEffect(() => {
    let active = true;
    api.get("/customers/", { ...auth, params: { page_size: 5000 } })
      .then(({ data }) => { if (active) setCustomers(data.results ?? data ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [api]);
  const options = customers.map(item => ({
    value: item.id, label: `${item.full_name} — ${item.customer_code} — ${item.primary_mobile}`,
    full_name: item.full_name, customer_code: item.customer_code, primary_mobile: item.primary_mobile,
  }));
  return <SearchableDropdown options={options} searchKeys={["full_name", "customer_code", "primary_mobile"]}
    value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} allowClear={allowClear} onEnterNext={onEnterNext} />;
}
