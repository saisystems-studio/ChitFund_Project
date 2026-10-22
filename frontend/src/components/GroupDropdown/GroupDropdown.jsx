import { useEffect, useState } from "react";
import SearchableDropdown from "../SearchableDropdown/SearchableDropdown";
import { allGroupOptions, ledgerGroupOptions } from "../../utils/groupHierarchy";

// One shared searchable hierarchical Group dropdown, reused by Add/Edit
// Customer and Add/Edit Ledger. `rootNames` optionally restricts the tree to
// specific root groups (e.g. Customer only offers Sundry Debtors/Creditors);
// omit it to show every root (e.g. Ledger, which also needs Cash/Bank/
// Expense/Income groups). Groups always come from Group Master (/finance/groups/),
// re-read whenever the window regains focus so a group created elsewhere shows up.
// `showTag` (Add/Edit Ledger) lists every group by its Group Name only, in full
// words; search also matches the Group Tag (parent name), which is not displayed.
export default function GroupDropdown({ api, auth, rootNames, value, onChange, placeholder = "Select Group", disabled = false, allowClear = true, onEnterNext, showTag = false, portal = false }) {
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    let active = true;
    const load = () => api.get("/finance/groups/", auth).then(({ data }) => { if (active) setGroups(data.results ?? data); }).catch(() => {});
    load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [api]);
  const options = showTag ? ledgerGroupOptions(groups, rootNames) : allGroupOptions(groups, rootNames);
  return <SearchableDropdown options={options} searchKeys={showTag ? ["label", "group_name", "group_tag"] : ["label", "group_name"]} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} allowClear={allowClear} onEnterNext={onEnterNext} portal={portal}/>;
}
