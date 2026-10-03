import { useState } from "react";
import { formatINR } from "../../utils/currency";

// Shared Group -> Sub-group -> Ledger renderer for Trial Balance and both
// sides of the Balance Sheet: click a group row to expand/collapse its
// children. Rows only (no <table>/<thead>) so callers compose their own.
// `amountColumns`: "split" (default) renders separate Debit/Credit columns
// (Trial Balance, Balance Sheet); "debit" or "credit" renders a single
// Amount column from just that field (Profit & Loss's two one-sided tables).
export default function AccountingGroupTable({ nodes, amountColumns = "split" }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = id => setCollapsed(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const renderRows = list => list.flatMap(node => {
    const hasChildren = node.children && node.children.length > 0;
    const isOpen = !collapsed.has(node.id);
    const label = <span className="acct-indent" style={{ paddingLeft: `${node.depth * 16}px` }}>
      {node.is_group && hasChildren ? <span className={`acct-chevron ${isOpen ? "open" : ""}`}>›</span> : <span className="acct-leaf-dot"/>}
      {node.is_group ? node.name.toUpperCase() : node.name}
    </span>;
    const row = <tr key={node.id} className={node.is_group ? "acct-row-group" : "acct-row-leaf"} onClick={node.is_group && hasChildren ? () => toggle(node.id) : undefined}>
      <td>{label}</td>
      {amountColumns === "split"
        ? <><td className="num">{node.debit ? formatINR(node.debit) : ""}</td><td className="num">{node.credit ? formatINR(node.credit) : ""}</td></>
        : <td className="num">{node[amountColumns] ? formatINR(node[amountColumns]) : ""}</td>}
    </tr>;
    return hasChildren && isOpen ? [row, ...renderRows(node.children)] : [row];
  });
  const colSpan = amountColumns === "split" ? 3 : 2;
  if (!nodes.length) return <tr><td colSpan={colSpan} className="acct-empty">No data for the selected period.</td></tr>;
  return <>{renderRows(nodes)}</>;
}
