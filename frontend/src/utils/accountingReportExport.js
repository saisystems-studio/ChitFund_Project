// Flattens a Group -> Sub-group -> Ledger tree (as returned by the Trial
// Balance / Balance Sheet APIs) into a flat row list, depth-first, for
// both the on-screen table and the PDF/CSV exports to share one layout.
export function flattenTree(nodes) {
  const rows = [];
  const walk = node => { rows.push(node); (node.children || []).forEach(walk); };
  (nodes || []).forEach(walk);
  return rows;
}

const csvCell = value => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Plain CSV (opens cleanly in Excel) -- no new charting/formatting library
// is wired into this project yet, so this is the lightweight "Excel"
// export until a real .xlsx writer is added.
export function downloadCsv(filename, header, rows) {
  const lines = [header, ...rows].map(row => row.map(csvCell).join(","));
  const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
