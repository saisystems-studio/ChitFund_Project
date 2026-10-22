import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "../SearchableSelect/SearchableSelect";
import "./list-filters.css";

// Shared Group / Status filters for List pages. Filtering is purely client-side on
// the rows a page already loaded: it only hides rows, never changes data or the API
// calls the page makes.

export const STATUS_OPTIONS = [{ value: "", label: "All Status" }, { value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }];
export const matchesStatus = (item, status) => !status || (status === "ACTIVE" ? item.is_active !== false : item.is_active === false);

// Options built from the values present in the loaded rows (e.g. loan / payment
// status, ledger group), labelled in Title Case.
const titleCase = value => String(value).toLowerCase().replace(/(^|[\s_-])(\w)/g, (_, sep, char) => `${sep === "_" ? " " : sep}${char.toUpperCase()}`);
export const valueOptions = (rows, read, allLabel) => [
  { value: "", label: allLabel },
  ...[...new Set(rows.map(read).filter(value => value !== null && value !== undefined && value !== ""))].sort().map(value => ({ value: String(value), label: titleCase(value) })),
];

// Chart-of-accounts tree from /finance/groups/ ({ id, group_name, parent_group_id }).
// Options are listed depth-first with sub-groups indented under their parent, and a
// row matches a selected group when it belongs to that group or any of its sub-groups.
export function groupTree(groups, { rootNames, allLabel = "All Groups" } = {}) {
  const byId = new Map(groups.map(group => [String(group.id), group]));
  const children = new Map();
  groups.forEach(group => {
    const key = group.parent_group_id == null ? "root" : String(group.parent_group_id);
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(group);
  });
  children.forEach(list => list.sort((a, b) => String(a.group_name).localeCompare(String(b.group_name))));
  const allowedRoots = rootNames && new Set(rootNames.map(name => name.toLowerCase()));
  const options = [{ value: "", label: allLabel }];
  const walk = (key, depth) => (children.get(key) || []).forEach(group => {
    if (depth === 0 && allowedRoots && !allowedRoots.has(String(group.group_name).toLowerCase())) return;
    options.push({ value: String(group.id), label: `${"— ".repeat(depth)}${group.group_name}` });
    walk(String(group.id), depth + 1);
  });
  walk("root", 0);
  const isWithin = (groupId, selectedId) => {
    if (!selectedId) return true;
    let node = byId.get(String(groupId ?? "")), guard = 0;
    while (node && guard++ < 100) {
      if (String(node.id) === String(selectedId)) return true;
      node = node.parent_group_id == null ? null : byId.get(String(node.parent_group_id));
    }
    return false;
  };
  return { options, isWithin, byId };
}

// For pages that do not already load the group list themselves.
export function useGroupTree(api, auth, settings) {
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    let active = true;
    api.get("/finance/groups/", auth).then(({ data }) => { if (active) setGroups(data.results ?? data ?? []); }).catch(() => {});
    return () => { active = false; };
  }, [api]);
  const key = settings?.rootNames?.join("|") || "";
  return useMemo(() => groupTree(groups, settings), [groups, key]);
}

// One compact searchable dropdown per filter: { label, value, onChange, options }.
export default function ListFilters({ filters, className = "" }) {
  return <>{filters.map(filter => <SearchableSelect key={filter.label} className={`list-filter-select ${className}`} aria-label={filter.label} title={filter.label}
    value={filter.value ?? ""} onChange={event => filter.onChange?.(event.target.value)}>
    {filter.options.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}
  </SearchableSelect>)}</>;
}
