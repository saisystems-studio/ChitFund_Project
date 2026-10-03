// Shared helpers for binding UI fields to the Group_tbl hierarchy by ID only.
// Display text (group_name) is for the UI; every relationship/value passed
// to the API or stored is the group's id, resolved dynamically -- never a
// hardcoded id and never a name used as the relationship.

// Depth-first list of every group, each annotated with its depth, so a
// dropdown can show the full forest (or just the given root names' subtrees)
// with ">" indentation marking the hierarchy.
export function allGroupOptions(groups, rootNames) {
  const byParent = new Map();
  groups.forEach(item => {
    const key = item.parent_group_id ?? "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(item);
  });
  byParent.forEach(list => list.sort((a, b) => a.group_name.localeCompare(b.group_name)));
  const roots = rootNames
    ? (byParent.get("root") || []).filter(item => rootNames.some(name => name.toLowerCase() === String(item.group_name).toLowerCase()))
    : byParent.get("root") || [];
  const ordered = [];
  const walk = (item, depth) => { ordered.push({ ...item, depth }); (byParent.get(item.id) || []).forEach(child => walk(child, depth + 1)); };
  roots.forEach(item => walk(item, 0));
  return ordered.map(item => ({ value: item.id, label: item.depth === 0 ? item.group_name : `${"  ".repeat(item.depth - 1)}> ${item.group_name}`, group_name: item.group_name }));
}
