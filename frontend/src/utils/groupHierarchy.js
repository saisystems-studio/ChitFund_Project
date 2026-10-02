// Shared helpers for binding UI fields to the Group_tbl hierarchy by ID only.
// Display text (group_name) is for the UI; every relationship/value passed
// to the API or stored is the group's id, resolved dynamically -- never a
// hardcoded id and never a name used as the relationship.

// Customer Type codes map to the matching Group_tbl root group name, resolved
// at runtime (never a hardcoded id) so the UI can filter the Group dropdown
// to that root's descendants.
export const ROLE_ROOT_NAMES = { BORROWER: "Sundry Debtors", LENDER: "Sundry Creditors" };

export function findRootGroup(groups, name) {
  return groups.find(item => item.is_system && String(item.group_name || "").toLowerCase() === name.toLowerCase()) || null;
}

// Depth-first list of every descendant (direct and nested) of the given root
// id(s), each annotated with its depth so the dropdown can show the hierarchy.
export function descendantOptions(groups, rootIds) {
  const roots = new Set((Array.isArray(rootIds) ? rootIds : [rootIds]).filter(id => id !== null && id !== undefined && id !== ""));
  if (!roots.size) return [];
  const byParent = new Map();
  groups.forEach(item => {
    const key = item.parent_group_id ?? "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(item);
  });
  byParent.forEach(list => list.sort((a, b) => a.group_name.localeCompare(b.group_name)));
  const ordered = [];
  const walk = (id, depth) => (byParent.get(id) || []).forEach(item => { ordered.push({ ...item, depth }); walk(item.id, depth + 1); });
  roots.forEach(rootId => walk(rootId, 0));
  return ordered.map(item => ({ value: item.id, label: `${"— ".repeat(item.depth)}${item.group_name}` }));
}

// Walks parent_group_id up to the top-most ancestor (the root) for a given group id.
export function resolveRootId(groups, groupId) {
  const byId = new Map(groups.map(item => [item.id, item]));
  let node = byId.get(groupId);
  while (node?.parent_group_id != null) node = byId.get(node.parent_group_id);
  return node ? node.id : null;
}
