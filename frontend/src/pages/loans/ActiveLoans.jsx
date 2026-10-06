import { useEffect, useMemo, useState } from "react";
import "./active-loans.css";
import "./active-loans-final.css";
import "./active-loans-popup-ui.css";
import "./loan-detail-redesign.css";
import "../modules/report-common.css";
import { formatINR } from "../../utils/currency";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import RowActions from "../../components/RowActions";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import { periodRange, PERIOD_OPTIONS } from "../../utils/periodRange";

const money = formatINR;
const rowsOf = value => value?.results ?? value ?? [];
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const startDateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const typeName = row => row.loan_type?.name || row.loan_type_name || "—";
const customerName = row => row.customer?.name || row.customer_name || "—";
const planName = row => row.plan?.name || row.plan_name || (typeName(row).toLowerCase() === "interest" ? "Flat Interest" : "—");

export default function ActiveLoans({ api, auth, go }) {
  const [items, setItems] = useState([]), [customers, setCustomers] = useState([]), [customer, setCustomer] = useState(""), [loanId, setLoanId] = useState(""), [planType, setPlanType] = useState(""), [period, setPeriod] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [page, setPage] = useState(1), [detail, setDetail] = useState(null), [expanded, setExpanded] = useState(false), [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const pageSize = 10;
  const load = () => setReload(value => value + 1);
  useEffect(() => {
    let active = true;
    setItems([]);
    api.get("/finance/loans/", { ...auth, params: { page_size: 10000 } })
      .then(({ data }) => { if (active) { setItems(rowsOf(data)); setError(""); } })
      .catch(() => { if (active) setError("Unable to load active loan data."); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    let active = true;
    api.get("/customers/", { ...auth, params: { page_size: 5000 } })
      .then(({ data }) => { if (active) setCustomers(data.results ?? data ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [api]);
  const range = useMemo(() => periodRange(period, from, to), [period, from, to]);
  const customerOptions = useMemo(() => [
    { value: "", label: "All Customers", full_name: "", customer_code: "", primary_mobile: "" },
    ...customers.map(item => ({ value: item.id, label: `${item.full_name} — ${item.customer_code} — ${item.primary_mobile}`, full_name: item.full_name, customer_code: item.customer_code, primary_mobile: item.primary_mobile })),
  ], [customers]);
  const planTypeOptions = useMemo(() => [...new Set(items.map(row => typeName(row)).filter(name => name && name !== "—"))].sort(), [items]);
  const loanOptions = useMemo(() => {
    const scoped = customer ? items.filter(row => String(row.customer?.id ?? row.customer_id) === String(customer)) : items;
    return [
      { value: "", label: "All Loan Numbers", doc_no: "", customer_name: "" },
      ...scoped.map(row => ({ value: row.id, label: `${row.doc_no || row.loan_no} — ${customerName(row)}`, doc_no: row.doc_no || row.loan_no || "", customer_name: customerName(row) })),
    ];
  }, [items, customer]);
  useEffect(() => {
    if (!loanId) return;
    if (!loanOptions.some(option => String(option.value) === String(loanId))) setLoanId("");
  }, [loanOptions, loanId]);
  const filtered = useMemo(() => items.filter(row => {
    if (customer && String(row.customer?.id ?? row.customer_id) !== String(customer)) return false;
    if (loanId && String(row.id) !== String(loanId)) return false;
    if (planType && typeName(row) !== planType) return false;
    if (range.from && (!row.start_date || row.start_date < range.from)) return false;
    if (range.to && (!row.start_date || row.start_date > range.to)) return false;
    return true;
  }), [items, customer, loanId, planType, range]);
  useEffect(() => setPage(1), [customer, loanId, planType, period, from, to]);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize), pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const performance = items.reduce((all, row) => ({ count: all.count + 1, total: all.total + Number(row.total_amount || 0), outstanding: all.outstanding + Number(row.outstanding_amount || 0), overdue: all.overdue + ((row.status || "").toLowerCase() === "overdue" ? Number(row.next_due_amount || 0) : 0) }), { count: 0, total: 0, outstanding: 0, overdue: 0 });
  const viewLoan = async row => { try { const { data } = await api.get(`/finance/loans/${row.id}/`, auth); setDetail(data); } catch { setError("Unable to load loan details."); setDetail(row); } };
  const deleteLoan = async row => { if (!await confirmDelete(`Delete loan ${row.doc_no || row.loan_no || "record"}?`)) return; try { await api.delete(`/finance/loans/${row.id}/`, auth); actionToast("Loan deleted successfully."); load(); } catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to delete loan."), false); } };
  const hasActiveFilters = customer || loanId || planType || period;
  const clearFilters = () => { setCustomer(""); setLoanId(""); setPlanType(""); setPeriod(""); setFrom(""); setTo(""); };
  return <div className="active-loans-page rpt-page">
    <nav className="rpt-breadcrumb" aria-label="Breadcrumb">
      <button type="button" className="rpt-back" aria-label="Back" onClick={() => go("/dashboard")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7" /></svg></button>
      <span>Reports</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg><strong>Active Loans</strong>
    </nav>
    <div className="rpt-toolbar rpt-toolbar-pinned">
      <label className="rpt-field rpt-field-customer">Customer
        <div className={`rpt-dropdown-wrap ${customer ? "has-value" : ""}`}>
          <SearchableDropdown options={customerOptions} searchKeys={["full_name", "customer_code", "primary_mobile"]} value={customer} onChange={setCustomer} placeholder="All Customers" />
        </div>
      </label>
      <label className="rpt-field rpt-field-loan">Loan Number
        <div className={`rpt-dropdown-wrap ${loanId ? "has-value" : ""}`}>
          <SearchableDropdown options={loanOptions} searchKeys={["doc_no", "customer_name"]} value={loanId} onChange={setLoanId} placeholder="All Loan Numbers" />
        </div>
      </label>
      <label className="rpt-field rpt-field-status">Plan Type
        <select value={planType} onChange={event => setPlanType(event.target.value)}>
          <option value="">All Plan Types</option>
          {planTypeOptions.map(option => <option key={option}>{option}</option>)}
        </select>
      </label>
      <label className="rpt-field rpt-field-period">Period
        <select value={period} onChange={event => setPeriod(event.target.value)}>
          {PERIOD_OPTIONS.slice(0, -1).map(option => <option key={option}>{option}</option>)}
          <option value="">All Time</option>
          <option>{PERIOD_OPTIONS.at(-1)}</option>
        </select>
      </label>
      {period === "Custom Range" && <>
        <label className="rpt-field rpt-field-date">From<input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></label>
        <label className="rpt-field rpt-field-date">To<input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></label>
      </>}
      {hasActiveFilters && <button type="button" className="rpt-clear" onClick={clearFilters}>Clear Filters</button>}
      <button type="button" className="performance-button rpt-toolbar-pinned-end" aria-label="Performance" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Performance <span>{expanded ? "⌃" : "⌄"}</span></button>
    </div>
    {error && <div className="active-error">{error}</div>}
    {expanded && <div className="active-performance"><div><small>ACTIVE LOANS</small><strong>{performance.count}</strong></div><div><small>TOTAL LENT</small><strong>{money(performance.total)}</strong></div><div><small>OUTSTANDING</small><strong>{money(performance.outstanding)}</strong></div><div><small>OVERDUE</small><strong>{money(performance.overdue)}</strong></div></div>}
    <section className="active-table-card"><div className="active-table-wrap"><table><thead><tr>{["S.No", "Start Date", "Loan Number", "Customer", "Plan Type", "Collection Date", "Total Amount", "Outstanding", "Status", "Action"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{visible.map((row, index) => <LoanRow key={row.id} row={row} index={(page - 1) * pageSize + index + 1} onView={() => viewLoan(row)} onEdit={() => go(`/loan-application/${row.id}/edit`)} onDelete={() => deleteLoan(row)} />)}</tbody></table>{!visible.length && <div className="active-empty"><strong>No active loans found.</strong><span>Loans created from Loan Application will appear here.</span></div>}</div><footer className="active-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries</span><div><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>{Array.from({ length: pages }, (_, index) => <button className={page === index + 1 ? "current" : ""} key={index} onClick={() => setPage(index + 1)}>{index + 1}</button>)}<button disabled={page === pages} onClick={() => setPage(value => value + 1)}>Next</button></div></footer></section>
    {detail && <LoanDetailsModal row={detail} onClose={() => setDetail(null)} onCollect={() => go("/collection-entry")} />}
  </div>;
}

function LoanRow({ row, index, onView, onEdit, onDelete, onRowClick }) { return <tr onClick={onRowClick} tabIndex="0" onKeyDown={event => event.key === "Enter" && onRowClick?.()}><td className="serial-cell">{String(index).padStart(2, "0")}</td><td>{startDateLabel(row.start_date)}</td><td><b>{row.doc_no || row.loan_no || "—"}</b></td><td><b>{customerName(row)}</b></td><td>{typeName(row)}</td><td className="collection-date-cell">{dateLabel(row.next_due_date)}</td><td className="money-cell">{money(row.total_amount)}</td><td className={`money-cell outstanding ${Number(row.outstanding_amount || 0) > 0 ? "pending" : ""}`}>{money(row.outstanding_amount)}</td><td className="status-cell"><Status value={row.status} /></td><td className="action-cell"><RowActions onView={() => onView(row)} onEdit={onEdit} onDelete={onDelete} /></td></tr>; }
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
    <header><div><small>LOAN DETAILS</small><h2>{row.doc_no || row.loan_no}</h2></div><button type="button" aria-label="Close loan details" onClick={onClose}>×</button></header>
    <div className="detail-grid loan-info-grid"><section><small>CUSTOMER</small><b>{customerName(row)}</b><span>{row.customer?.code || row.customer_code || "-"}</span><span>{row.customer?.phone || row.phone || "-"}</span></section><section><small>LOAN</small><b>{typeName(row)}</b><span>{planName(row)}</span><span>{row.periodicity?.name || row.periodicity_name || "Other"}</span></section><section><small>DATES</small><span>Start: {dateLabel(row.start_date)}</span><span>End: {dateLabel(row.end_date)}</span></section></div>
    <div className="detail-finance loan-summary-grid"><div><small>Total Amount</small><b>{money(row.total_amount)}</b></div><div><small>Collected</small><b>{money(row.collected_amount)}</b></div><div><small>Outstanding</small><b>{money(row.outstanding_amount)}</b></div><div><small>Progress</small><b>{progress}%</b></div></div>
    <h3>INSTALLMENT SCHEDULE</h3><div className="detail-table installment-table-wrap"><table className="installment-table"><thead><tr><th>S.No</th><th>Due Date</th><th>Installment</th><th>Payment Date</th><th>Status</th></tr></thead><tbody>{shown.map(item => { const status = item.status || "Pending"; return <tr key={item.id || item.installment_number}><td>{item.installment_number}</td><td>{dateLabel(item.due_date)}</td><td>{money(item.installment_amount)}</td><td>{dateLabel(item.payment_date)}</td><td><span className={`loan-status ${String(status).toLowerCase()}`}>{status}</span></td></tr>; })}{!shown.length && <tr><td colSpan="5" className="detail-empty-row">No installments found.</td></tr>}</tbody></table></div>
    <footer className="detail-footer table-pagination"><span>Showing {shown.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, rows.length)} of {rows.length}</span><div><button aria-label="Previous page" disabled={page === 1} onClick={() => setPage(value => value - 1)}>‹</button><b>{page}</b><button aria-label="Next page" disabled={page === pages} onClick={() => setPage(value => value + 1)}>›</button></div></footer>
    <footer className="loan-modal-footer"><div><small>Loan Status</small><Status value={row.status} /></div><button className="detail-collect open-collection-btn" onClick={onCollect}>₹ &nbsp; Open Collection Entry</button></footer>
  </aside></div>;
}

function LoanDetail({ row, onClose, onCollect }) { const [page, setPage] = useState(1), rows = row.installments || [], pageSize = 10, shown = rows.slice((page - 1) * pageSize, page * pageSize), pages = Math.max(1, Math.ceil(rows.length / pageSize)); useEffect(() => { const closeOnEscape = event => event.key === "Escape" && onClose(); window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]); return <div className="loan-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><aside className="loan-detail"><header><div><small>LOAN DETAILS</small><h2>{row.doc_no || row.loan_no}</h2></div><button type="button" aria-label="Close loan details" onClick={onClose}>×</button></header><div className="loan-detail-status"><Status value={row.status} /></div><div className="detail-grid"><section><small>CUSTOMER</small><b>{customerName(row)}</b><span>{row.customer?.code || row.customer_code || "—"}</span><span>{row.customer?.phone || row.phone || "—"}</span></section><section><small>LOAN</small><b>{typeName(row)}</b><span>{planName(row)}</span><span>{row.periodicity?.name || row.periodicity_name || "Other"}</span></section><section><small>DATES</small><span>Start: {dateLabel(row.start_date)}</span><span>End: {dateLabel(row.end_date)}</span></section></div><div className="detail-finance"><div><small>Total Amount</small><b>{money(row.total_amount)}</b></div><div><small>Collected</small><b>{money(row.collected_amount)}</b></div><div><small>Outstanding</small><b>{money(row.outstanding_amount)}</b></div><div><small>Progress</small><b>{row.total_installments ? `${Math.round((row.paid_installments || 0) / row.total_installments * 100)}%` : "0%"}</b></div></div><h3>INSTALLMENT SCHEDULE</h3><div className="detail-table"><table><thead><tr><th>S.No</th><th>Due Date</th><th>Installment</th><th>Paid</th><th>Balance</th><th>Payment Date</th><th>Status</th></tr></thead><tbody>{shown.map(item => <tr key={item.installment_number}><td>{item.installment_number}</td><td>{dateLabel(item.due_date)}</td><td>{money(item.installment_amount)}</td><td>{money(item.paid_amount)}</td><td>{money(item.balance)}</td><td>{dateLabel(item.payment_date)}</td><td>{item.status}</td></tr>)}</tbody></table></div><footer className="detail-footer"><span>Showing {shown.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, rows.length)} of {rows.length}</span><div><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>‹</button><b>{page}</b><button disabled={page === pages} onClick={() => setPage(value => value + 1)}>›</button></div></footer><button className="detail-collect" onClick={onCollect}>₹ &nbsp; Open Collection Entry</button></aside></div>; }
