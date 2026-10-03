import { useEffect, useState } from "react";
import SearchableDropdown from "../SearchableDropdown/SearchableDropdown";
import { allGroupOptions } from "../../utils/groupHierarchy";

// One shared searchable hierarchical Group dropdown, reused by Add/Edit
// Customer and Add/Edit Ledger. `rootNames` optionally restricts the tree to
// specific root groups (e.g. Customer only offers Sundry Debtors/Creditors);
// omit it to show every root (e.g. Ledger, which also needs Cash/Bank/
// Expense/Income groups).
export default function GroupDropdown({ api, auth, rootNames, value, onChange, placeholder = "Select Group", disabled = false, allowClear = true, onEnterNext }) {
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    let active = true;
    api.get("/finance/groups/", auth).then(({ data }) => { if (active) setGroups(data.results ?? data); }).catch(() => {});
    return () => { active = false; };
  }, [api]);
  const options = allGroupOptions(groups, rootNames);
  return <SearchableDropdown options={options} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} allowClear={allowClear} onEnterNext={onEnterNext}/>;
}
