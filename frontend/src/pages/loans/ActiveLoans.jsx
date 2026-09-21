import { useEffect, useMemo, useState } from "react";
import "./active-loans.css";
import "./active-loans-final.css";
import "./active-loans-popup-ui.css";
import "./loan-detail-redesign.css";
import { formatINR } from "../../utils/currency";
import confirmDelete from "../../utils/confirmDelete";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import RowActions from "../../components/RowActions";

const money = formatINR;
const rowsOf = value => value?.results ?? value ?? [];
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const typeName = row => row.loan_type?.name || row.loan_type_name || "—";
const customerName = row => row.customer?.name || row.customer_name || "—";
const planName = row => row.plan?.name || row.plan_name || (typeName(row).toLowerCase() === "interest" ? "Flat Interest" : "—");

function Icon({ name }) {
  const paths = { view: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /></>, edit: <><path d="m4 16-.7 4 4-.7L18.8 7.8a2.1 2.1 0 0 0-3-3L4 16Z" /><path d="m14.5 6.5 3 3" /></>, delete: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></> };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function ActiveLoans({ api, auth, go }) {
  const [items, setItems] = useState([]), [search, setSearch] = useState(""), [type, setType] = useState("ALL"), [status, setStatus] = useState("ALL"), [page, setPage] = useState(1), [detail, setDetail] = useState(null), [expanded, setExpanded] = useState(false), [error, setError] = useState("");
  const pageSize = 10;
  const load = () => api.get("/finance/loans/", { ...auth, params: { page_size: 1000 } }).then(({ data }) => { setItems(rowsOf(data)); setError(""); }).catch(() => setError("Unable to load active loan data."));
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => items.filter(row => {
    const text = `${row.loan_no || ""} ${customerName(row)} ${row.customer?.code || row.customer_code || ""} ${row.customer?.phone || row.phone || ""} ${planName(row)}`.toLowerCase();
    return (!search || text.includes(search.toLowerCase())) && (type === "ALL" || typeName(row).toLowerCase() === type.toLowerCase()) && (status === "ALL" || (row.status || "").toLowerCase() === status.toLowerCase());
  }), [items, search, type, status]);
  useEffect(() => setPage(1), [search, type, status]);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize), pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const performance = items.reduce((all, row) => ({ count: all.count + 1, total: all.total + Number(row.total_amount || 0), outstanding: all.outstanding + Number(row.outstanding_amount || 0), overdue: all.overdue + ((row.status || "").toLowerCase() === "overdue" ? Number(row.next_due_amount || 0) : 0) }), { count: 0, total: 0, outstanding: 0, overdue: 0 });
  const viewLoan = async row => { try { const { data } = await api.get(`/finance/loans/${row.id}/`, auth); setDetail(data); } catch { setError("Unable to load loan details."); setDetail(row); } };
  const deleteLoan = async row => { if (!await confirmDelete(`Delete loan ${row.loan_no || "record"}?`)) return; try { await api.delete(`/finance/loans/${row.id}/`, auth); load(); } catch { setError("Unable to delete loan."); } };
  return <div className="active-loans-page">
    <PageBreadcrumb root="Transactions" current="Active Loans" onBack={() => go("/dashboard")} />
    <div className="active-loans-toolbar">
      <label className="active-loans-search"><Icon name="view" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search customer, loan or phone" /></label>
      <select value={type} onChange={event => setType(event.target.value)}><option value="ALL">All Types</option><option value="Chit">Chit</option><option value="Interest">Interest</option><option value="Mortgage">Mortgage</option></select>
      <select value={status} onChange={event => setStatus(event.target.value)}><option value="ALL">All Status</option><option>Active</option><option>Overdue</option><option>Pending</option><option>Completed</option></select>
      <button type="button" className="performance-button" aria-label="Performance" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Performance <span>{expanded ? "⌃" : "⌄"}</span></button>
    </div>
    {error && <div className="active-error">{error}</div>}
    {expanded && <div className="active-performance"><div><small>ACTIVE LOANS</small><strong>{performance.count}</strong></div><div><small>TOTAL LENT</small><strong>{money(performance.total)}</strong></div><div><small>OUTSTANDING</small><strong>{money(performance.outstanding)}</strong></div><div><small>OVERDUE</small><strong>{money(performance.overdue)}</strong></div></div>}
    <section className="active-table-card"><div className="active-table-wrap"><table><thead><tr>{["S.No", "Loan No", "Customer", "Loan / Plan", "Total", "Outstanding", "Status"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{visible.map((row, index) => <LoanRow key={row.id} row={row} index={(page - 1) * pageSize + index + 1} onView={viewLoan} onEdit={() => go(`/loan-application/${row.id}/edit`)} onDelete={() => deleteLoan(row)} onRowClick={() => go(`/loan-application/${row.id}/edit`)} />)}</tbody></table>{!visible.length && <div className="active-empty"><strong>No active loans found.</strong><span>Loans created from Loan Application will appear here.</span></div>}</div><footer className="active-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries</span><div><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>{Array.from({ length: pages }, (_, index) => <button className={page === index + 1 ? "current" : ""} key={index} onClick={() => setPage(index + 1)}>{index + 1}</button>)}<button disabled={page === pages} onClick={() => setPage(value => value + 1)}>Next</button></div></footer></section>
    {detail && <LoanDetailsModal row={detail} onClose={() => setDetail(null)} onCollect={() => go("/collection-entry")} />}
  </div>;
}

function LoanRow({ row, index, onView, onEdit, onDelete, onRowClick }) { return <tr onClick={onRowClick} tabIndex="0" onKeyDown={event => event.key === "Enter" && onRowClick()}><td className="serial-cell">{String(index).padStart(2, "0")}</td><td><b className="loan-number">{row.loan_no || "—"}</b></td><td><b>{customerName(row)}</b></td><td><b>{typeName(row)}</b><small>{planName(row)}</small></td><td className="money-cell">{money(row.total_amount)}</td><td className={`money-cell outstanding ${Number(row.outstanding_amount || 0) > 0 ? "pending" : ""}`}>{money(row.outstanding_amount)}</td><td className="status-cell"><Status value={row.status} /><RowActions className="floating-row-actions" onView={() => onView(row)} onEdit={onEdit} onDelete={onDelete} /></td></tr>; }
function Status({ value }) { const normalized = (value || "Active").toLowerCase(); return <span className={`loan-status ${normalized}`}>{value || "Active"}</span>; }
function LoanDetailsModal({ row, onClose, onCollect }) {
  const [page, setPage] = useState(1);
  const rows = row.installments || [];
  const pageSize = 10;
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => { const closeOnEscape = event => event.key === "Escape" && onClose(); window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);
  const progress = row.total_installments ? Math.round((row.paid_installments || 0) / row.total_installments * 100) : 0;
  return <div className="loan-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><aside className="loan-detail loan-details-modal">
    <header><div><small>LOAN DETAILS</small><h2>{row.loan_no}</h2></div><button type="button" aria-label="Close loan details" onClick={onClose}>×</button></header>
    <div className="detail-grid loan-info-grid"><section><small>CUSTOMER</small><b>{customerName(row)}</b><span>{row.customer?.code || row.customer_code || "-"}</span><span>{row.customer?.phone || row.phone || "-"}</span></section><section><small>LOAN</small><b>{typeName(row)}</b><span>{planName(row)}</span><span>{row.periodicity?.name || row.periodicity_name || "Other"}</span></section><section><small>DATES</small><span>Start: {dateLabel(row.start_date)}</span><span>End: {dateLabel(row.end_date)}</span></section></div>
    <div className="detail-finance loan-summary-grid"><div><small>Total Amount</small><b>{money(row.total_amount)}</b></div><div><small>Collected</small><b>{money(row.collected_amount)}</b></div><div><small>Outstanding</small><b>{money(row.outstanding_amount)}</b></div><div><small>Progress</small><b>{progress}%</b></div></div>
    <h3>INSTALLMENT SCHEDULE</h3><div className="detail-table installment-table-wrap"><table className="installment-table"><thead><tr><th>S.No</th><th>Due Date</th><th>Installment</th><th>Paid</th><th>Balance</th><th>Payment Date</th><th>Status</th></tr></thead><tbody>{shown.map(item => { const status = item.status || "Pending"; return <tr key={item.id || item.installment_number}><td>{item.installment_number}</td><td>{dateLabel(item.due_date)}</td><td>{money(item.installment_amount)}</td><td>{money(item.paid_amount)}</td><td>{money(item.balance)}</td><td>{dateLabel(item.payment_date)}</td><td><span className={`loan-status ${String(status).toLowerCase()}`}>{status}</span></td></tr>; })}{!shown.length && <tr><td colSpan="7" className="detail-empty-row">No installments found.</td></tr>}</tbody></table></div>
    <footer className="detail-footer table-pagination"><span>Showing {shown.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, rows.length)} of {rows.length}</span><div><button aria-label="Previous page" disabled={page === 1} onClick={() => setPage(value => value - 1)}>‹</button><b>{page}</b><button aria-label="Next page" disabled={page === pages} onClick={() => setPage(value => value + 1)}>›</button></div></footer>
    <footer className="loan-modal-footer"><div><small>Loan Status</small><Status value={row.status} /></div><button className="detail-collect open-collection-btn" onClick={onCollect}>₹ &nbsp; Open Collection Entry</button></footer>
  </aside></div>;
}

function LoanDetail({ row, onClose, onCollect }) { const [page, setPage] = useState(1), rows = row.installments || [], pageSize = 10, shown = rows.slice((page - 1) * pageSize, page * pageSize), pages = Math.max(1, Math.ceil(rows.length / pageSize)); useEffect(() => { const closeOnEscape = event => event.key === "Escape" && onClose(); window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]); return <div className="loan-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><aside className="loan-detail"><header><div><small>LOAN DETAILS</small><h2>{row.loan_no}</h2></div><button type="button" aria-label="Close loan details" onClick={onClose}>×</button></header><div className="loan-detail-status"><Status value={row.status} /></div><div className="detail-grid"><section><small>CUSTOMER</small><b>{customerName(row)}</b><span>{row.customer?.code || row.customer_code || "—"}</span><span>{row.customer?.phone || row.phone || "—"}</span></section><section><small>LOAN</small><b>{typeName(row)}</b><span>{planName(row)}</span><span>{row.periodicity?.name || row.periodicity_name || "Other"}</span></section><section><small>DATES</small><span>Start: {dateLabel(row.start_date)}</span><span>End: {dateLabel(row.end_date)}</span></section></div><div className="detail-finance"><div><small>Total Amount</small><b>{money(row.total_amount)}</b></div><div><small>Collected</small><b>{money(row.collected_amount)}</b></div><div><small>Outstanding</small><b>{money(row.outstanding_amount)}</b></div><div><small>Progress</small><b>{row.total_installments ? `${Math.round((row.paid_installments || 0) / row.total_installments * 100)}%` : "0%"}</b></div></div><h3>INSTALLMENT SCHEDULE</h3><div className="detail-table"><table><thead><tr><th>S.No</th><th>Due Date</th><th>Installment</th><th>Paid</th><th>Balance</th><th>Payment Date</th><th>Status</th></tr></thead><tbody>{shown.map(item => <tr key={item.installment_number}><td>{item.installment_number}</td><td>{dateLabel(item.due_date)}</td><td>{money(item.installment_amount)}</td><td>{money(item.paid_amount)}</td><td>{money(item.balance)}</td><td>{dateLabel(item.payment_date)}</td><td>{item.status}</td></tr>)}</tbody></table></div><footer className="detail-footer"><span>Showing {shown.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, rows.length)} of {rows.length}</span><div><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>‹</button><b>{page}</b><button disabled={page === pages} onClick={() => setPage(value => value + 1)}>›</button></div></footer><button className="detail-collect" onClick={onCollect}>₹ &nbsp; Open Collection Entry</button></aside></div>; }
