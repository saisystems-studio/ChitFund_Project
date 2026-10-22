// Flattens a Group -> Sub-group -> Ledger tree (as returned by the Trial
// Balance / Balance Sheet APIs) into a flat row list, depth-first, for
// both the on-screen table and the PDF/CSV exports to share one layout.
export function flattenTree(nodes) {
  const rows = [];
  const walk = node => { rows.push(node); (node.children || []).forEach(walk); };
  (nodes || []).forEach(walk);
  return rows;
}
