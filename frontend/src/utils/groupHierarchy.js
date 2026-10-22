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

// Display-only expansion of abbreviated group names saved in Group Master
// (e.g. "Misc. Expenses (ASSET)" -> "Miscellaneous Expenses (Asset)"). The stored
// name -- which reports and signals match on -- is never changed.
const ABBREVIATIONS = [[/\bMisc\.?(?=\s|$)/gi, "Miscellaneous"], [/\s&\s/g, " and "], [/\bA\/c\b/gi, "Account"], [/\bExp\.?(?=\s|$)/gi, "Expenses"], [/\bAdv\.?(?=\s|$)/gi, "Advances"]];
const NATURE_WORDS = { ASSET: "Asset", ASSETS: "Assets", LIABILITY: "Liability", LIABILITIES: "Liabilities", INCOME: "Income", EXPENSE: "Expense", EXPENSES: "Expenses" };
export function fullGroupName(name) {
  let text = String(name ?? "").trim();
  ABBREVIATIONS.forEach(([pattern, word]) => { text = text.replace(pattern, word); });
  return text.replace(/\(([A-Z]+)\)/g, (match, word) => NATURE_WORDS[word] ? `(${NATURE_WORDS[word]})` : match);
}

// Add/Edit Ledger options: every saved group exactly once, in hierarchy order,
// labelled with the Group Name only (no Main Group / parent tag suffix). The
// parent's name is kept as `group_tag` so search still matches on it. Groups whose
// parent is missing from the list are appended so no Group Master record is lost.
export function ledgerGroupOptions(groups, rootNames) {
  const byId = new Map(groups.map(item => [item.id, item]));
  const ordered = allGroupOptions(groups, rootNames).map(option => option.value);
  if (!rootNames) {
    const seen = new Set(ordered);
    groups.forEach(item => { if (!seen.has(item.id)) { seen.add(item.id); ordered.push(item.id); } });
  }
  return ordered.map(id => {
    const group = byId.get(id);
    const parent = group?.parent_group_id != null ? byId.get(group.parent_group_id) : null;
    const name = fullGroupName(group?.group_name), tag = parent ? fullGroupName(parent.group_name) : "Main Group";
    return { value: id, label: name, group_name: `${group?.group_name ?? ""} ${name}`, group_tag: tag };
  });
}
