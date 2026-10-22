const cents = value => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0; };
export function sortPendingDues(rows, balanceOf) {
  return rows.filter(row => cents(balanceOf(row)) > 0).slice().sort((a,b) =>
    String(a.due_date || "9999-12-31").localeCompare(String(b.due_date || "9999-12-31")) ||
    String(a.id).localeCompare(String(b.id), "en", {numeric:true}));
}
export function allocateFifo(rows, amount, balanceOf) {
  let remaining = cents(amount);
  const allocations = {};
  for (const row of sortPendingDues(rows, balanceOf)) {
    if (!remaining) break;
    const applied = Math.min(remaining, cents(balanceOf(row)));
    allocations[row.id] = (applied / 100).toFixed(2);
    remaining -= applied;
  }
  return { allocations, excess: (remaining / 100).toFixed(2) };
}
