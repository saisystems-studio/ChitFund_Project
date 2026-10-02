export const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export function overdueDays(dueDate, today = localToday()) {
  if (!dueDate) return 0;
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000)) || 0;
}

export function filterPendingRows(rows, filters, today = localToday()) {
  return rows.filter(row => {
    const due = row.due_date;
    if (!due || due > today || Number(row.balance ?? row.outstanding ?? 0) <= 0) return false;
    if (filters.from && due < filters.from || filters.to && due > filters.to) return false;
    if (filters.customer_code && row.customer_code !== filters.customer_code) return false;
    if (filters.loan_number && row.loan_no !== filters.loan_number) return false;
    if (filters.customer_type && String(row.customer_type).toUpperCase() !== filters.customer_type) return false;
    if (filters.search && ![row.customer, row.customer_code, row.phone, row.loan_no, row.loan_type].join(" ").toLowerCase().includes(filters.search.trim().toLowerCase())) return false;
    if (filters.status === "OVERDUE" && overdueDays(due, today) === 0) return false;
    if (filters.status === "PENDING" && !["PENDING", "UPCOMING"].includes(row.status)) return false;
    if (filters.status === "PARTIAL" && !(Number(row.paid) > 0)) return false;
    if (filters.status === "PAID") return false;
    return true;
  });
}

// Follow the API's pagination so dropdowns and lists include every saved entry.
export async function fetchAllPages(api, endpoint, auth) {
  const rows = [];
  let next = endpoint;
  while (next) {
    const { data } = await api.get(next, auth);
    rows.push(...(data.results ?? data));
    next = data.next || null;
  }
  return rows;
}

export function creationDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB");
}
