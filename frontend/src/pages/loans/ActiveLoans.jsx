import "../../styles/compact-report-toolbar.css";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { useEffect, useMemo, useRef, useState } from "react";
import "./active-loans.css";
import "./active-loans-final.css";
import "./active-loans-popup-ui.css";
import "./loan-detail-redesign.css";
import "../modules/report-common.css";
import "../../styles/report-layout.css";
import { formatINR } from "../../utils/currency";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import RowActions from "../../components/RowActions";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import { periodRange } from "../../utils/periodRange";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import { detailPath } from "../reportDetail/reportDetailRoute";

const money = formatINR;
// Period presets (dates applied automatically); "" = All Time. From / To are shown only for Custom Range.
const PRESET_PERIODS = ["Today", "This Week", "Last Week", "This Month", "Last Month", "This Year"];
const CUSTOM_RANGE = "Custom Range";
const rowsOf = value => value?.results ?? value ?? [];
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const startDateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const typeName = row => row.loan_type?.name || row.loan_type_name || "—";
const customerName = row => row.customer?.name || row.customer_name || "—";
const planName = row => row.plan?.name || row.plan_name || (typeName(row).toLowerCase() === "interest" ? "Flat Interest" : "—");

export default function ActiveLoans({ api, auth, go }) {
  const [items, setItems] = useState([]), [customers, setCustomers] = useState([]), [customer, setCustomer] = useState(""), [planType, setPlanType] = useState(""), [period, setPeriod] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [page, setPage] = useState(1), [detail, setDetail] = useState(null), [expanded, setExpanded] = useState(false), [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [exportBusy, setExportBusy] = useState(null);
  const [search, setSearch] = useState("");
  // Rows stay on screen while a reload is in flight, so dropdown options and the
  // selected filters never disappear mid-load (see the Loan Number reset below).
  const [loaded, setLoaded] = useState(false);
  const { profile } = useCompanyProfile() || {};
  const pageSize = 10;
  const load = () => setReload(value => value + 1);
  useEffect(() => {
    let active = true;
    api.get("/finance/loans/", { ...auth, params: { page_size: 10000 } })
      .then(({ data }) => { if (active) { setItems(rowsOf(data)); setLoaded(true); setError(""); } })
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
  // Free-text search across loan number, customer (name / code / phone), plan type and status.
  const searchText = search.trim().toLowerCase();
  const filtered = useMemo(() => items.filter(row => {
    if (searchText && ![row.doc_no, row.loan_no, customerName(row), row.customer?.code, row.customer_code, row.customer?.phone, row.phone, typeName(row), row.status]
      .some(value => String(value ?? "").toLowerCase().includes(searchText))) return false;
    if (customer && String(row.customer?.id ?? row.customer_id) !== String(customer)) return false;
    if (planType && typeName(row) !== planType) return false;
    if (range.from && (!row.start_date || row.start_date < range.from)) return false;
    if (range.to && (!row.start_date || row.start_date > range.to)) return false;
    return true;
  }), [items, searchText, customer, planType, range]);
  useEffect(() => setPage(1), [searchText, customer, planType, period, from, to]);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize), pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const performance = items.reduce((all, row) => ({ count: all.count + 1, total: all.total + Number(row.total_amount || 0), outstanding: all.outstanding + Number(row.outstanding_amount || 0), overdue: all.overdue + ((row.status || "").toLowerCase() === "overdue" ? Number(row.next_due_amount || 0) : 0) }), { count: 0, total: 0, outstanding: 0, overdue: 0 });
  // Double-clicking a row opens that loan's full-page details (loaded there by its id).
  const viewLoan = row => go(detailPath("loan", row.id));
  const deleteLoan = async row => { if (!await confirmDelete(`Delete loan ${row.doc_no || row.loan_no || "record"}?`)) return; try { await api.delete(`/finance/loans/${row.id}/`, auth); actionToast("Loan deleted successfully."); load(); } catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to delete loan."), false); } };
  const hasActiveFilters = Boolean(searchText || customer || planType || period || from || to);
  const clearFilters = () => { setSearch(""); setCustomer(""); setPlanType(""); setPeriod(""); setFrom(""); setTo(""); };
  // From / To appear only for Custom Range; a preset Period applies its own dates. Switching
  // to Custom Range starts from the preset's range (so the rows don't change until edited).
  const isCustom = period === CUSTOM_RANGE;
  const changeDate = (end, value) => {
    if (value && (end === "to" ? from && value < from : to && value > to)) { actionToast("To Date cannot be earlier than From Date.", false); return; }
    (end === "from" ? setFrom : setTo)(value);
  };
  const changePeriod = value => {
    if (value === CUSTOM_RANGE) { if (!isCustom) { setFrom(range.from || ""); setTo(range.to || ""); } }
    else { setFrom(""); setTo(""); }
    setPeriod(value);
  };

  const filtersLine = [
    searchText && `Search: ${search.trim()}`,
    customer && `Customer: ${customerOptions.find(option => String(option.value) === String(customer))?.full_name}`,
    planType && `Plan Type: ${planType}`, period && `Period: ${period}`,
    range.from && `From ${range.from}`, range.to && `To ${range.to}`,
  ].filter(Boolean).join("   •   ");
  // PDF and Print share one layout: the filtered rows (all pages) and the data columns.
  const pdfOptions = () => ({
    title: "Active Loans", filtersLine, profile,
    columns: [
      { header: "S.No", align: "center" }, { header: "Start Date" }, { header: "Loan Number" }, { header: "Customer" }, { header: "Plan Type" },
      { header: "Collection Date" }, { header: "Total Amount", align: "right" }, { header: "Outstanding", align: "right" }, { header: "Status" },
    ],
    rows: filtered.map((row, index) => [
      String(index + 1), startDateLabel(row.start_date), row.doc_no || row.loan_no || "—", customerName(row), typeName(row),
      dateLabel(row.next_due_date), money(row.total_amount), money(row.outstanding_amount), row.status || "Active",
    ]),
  });
  const handleExportPdf = async () => {
    if (exportBusy) return;
    setExportBusy("pdf");
    try { await downloadReportPdf(pdfOptions(), reportFilename("Active_Loans")); }
    catch { setError("Unable to prepare the PDF."); }
    finally { setExportBusy(null); }
  };
  const handleExportPrint = async () => {
    if (exportBusy) return;
    setExportBusy("print");
    try { await printReportPdf(pdfOptions()); }
    catch { setError("Unable to prepare the print."); }
    finally { setExportBusy(null); }
  };
  const handleExportExcel = async () => {
    if (exportBusy) return;
    setExportBusy("excel");
    try {
      await downloadReportExcel({
        filename: reportFilename("Active_Loans"), title: "Active Loans", subtitle: filtersLine || undefined,
        columns: [
          { header: "S.No", width: 8 }, { header: "Start Date", width: 14 }, { header: "Loan Number", width: 16 }, { header: "Customer", width: 22 }, { header: "Plan Type", width: 14 },
          { header: "Collection Date", width: 16 }, { header: "Total Amount", numeric: true, width: 16 }, { header: "Outstanding", numeric: true, width: 16 }, { header: "Status", width: 12 },
        ],
        rows: filtered.map((row, index) => [
          index + 1, row.start_date || "", row.doc_no || row.loan_no || "", customerName(row), typeName(row),
          row.next_due_date || "", Number(row.total_amount || 0), Number(row.outstanding_amount || 0), row.status || "Active",
        ]),
      });
    } finally { setExportBusy(null); }
  };
  return <div className="active-loans-page rpt-page rl-page data-page compact-report-page">
    <div className="rl-header">
      <PageBreadcrumb className="rpt-breadcrumb" current="Active Loans" />
      
    </div>
    <div className="rl-filters" role="search">
      <label className="rl-field al-search"><span className="rl-label">Search</span>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Loan no, customer, phone..." autoComplete="off" />
      </label>
      <label className="rl-field al-customer"><span className="rl-label">Customer</span>
        <div className={`rpt-dropdown-wrap ${customer ? "has-value" : ""}`}>
          <SearchableDropdown options={customerOptions} searchKeys={["full_name", "customer_code", "primary_mobile"]} value={customer} onChange={setCustomer} placeholder="All Customers" portal />
        </div>
      </label>
      <label className="rl-field al-plan"><span className="rl-label">Plan Type</span>
        <SearchableSelect value={planType} onChange={event => setPlanType(event.target.value)}>
          <option value="">All Plan Types</option>
          {planType && !planTypeOptions.includes(planType) && <option>{planType}</option>}
          {planTypeOptions.map(option => <option key={option}>{option}</option>)}
        </SearchableSelect>
      </label>
      <label className="rl-field al-period"><span className="rl-label">Period</span>
        <select value={period} onChange={event => changePeriod(event.target.value)}>
          {PRESET_PERIODS.map(option => <option key={option}>{option}</option>)}
          <option value="">All Time</option>
          <option>{CUSTOM_RANGE}</option>
        </select>
      </label>
      {isCustom && <>
        <label className="rl-field al-date al-from"><span className="rl-label">From Date</span><input type="date" value={from} max={to || undefined} onChange={event => changeDate("from", event.target.value)} /></label>
        <label className="rl-field al-date al-to"><span className="rl-label">To Date</span><input type="date" value={to} min={from || undefined} onChange={event => changeDate("to", event.target.value)} /></label>
      </>}
      <div className="rl-actions">
        <button type="button" className="rpt-clear" onClick={clearFilters} disabled={!hasActiveFilters}>Clear Filters</button>
        <ReportExportButtons onPdf={handleExportPdf} onExcel={handleExportExcel} onPrint={handleExportPrint} busy={exportBusy} disabled={!filtered.length} />
        <button type="button" className="performance-button" aria-label="Performance" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Performance <span>{expanded ? "⌃" : "⌄"}</span></button>
      </div>
    </div>
    {error && <div className="active-error">{error}</div>}
    {expanded && <div className="active-performance"><div><small>ACTIVE LOANS</small><strong>{performance.count}</strong></div><div><small>TOTAL LENT</small><strong>{money(performance.total)}</strong></div><div><small>OUTSTANDING</small><strong>{money(performance.outstanding)}</strong></div><div><small>OVERDUE</small><strong>{money(performance.overdue)}</strong></div></div>}
    <section className="active-table-card data-container"><div className="active-table-wrap data-table-area"><table><thead><tr>{["S.No", "Start Date", "Loan Number", "Customer", "Plan Type", "Collection Date", "Total Amount", "Outstanding", "Status", "Action"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{visible.map((row, index) => <LoanRow key={row.id} row={row} index={(page - 1) * pageSize + index + 1} onRowClick={() => viewLoan(row)} onEdit={() => go(`/loan-application/${row.id}/edit`)} onDelete={() => deleteLoan(row)} />)}</tbody></table>{!visible.length && <div className="active-empty"><strong>No active loans found.</strong><span>Loans created from Loan Application will appear here.</span></div>}</div><footer className="active-footer data-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries</span><div><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>{Array.from({ length: pages }, (_, index) => <button className={page === index + 1 ? "current" : ""} key={index} onClick={() => setPage(index + 1)}>{index + 1}</button>)}<button disabled={page === pages} onClick={() => setPage(value => value + 1)}>Next</button></div></footer></section>
  </div>;
}

function LoanRow({ row, index, onEdit, onDelete, onRowClick }) { return <tr className="clickable-data-row" title="Double-click to view more" onDoubleClick={event => { if (!event.target.closest("button,a,input,select,textarea")) onRowClick?.(); }} tabIndex="0" onKeyDown={event => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); onRowClick?.(); } }}><td className="serial-cell">{String(index).padStart(2, "0")}</td><td>{startDateLabel(row.start_date)}</td><td><b>{row.doc_no || row.loan_no || "—"}</b></td><td><b>{customerName(row)}</b></td><td>{typeName(row)}</td><td className="collection-date-cell">{dateLabel(row.next_due_date)}</td><td className="money-cell">{money(row.total_amount)}</td><td className={`money-cell outstanding ${Number(row.outstanding_amount || 0) > 0 ? "pending" : ""}`}>{money(row.outstanding_amount)}</td><td className="status-cell"><Status value={row.status} /></td><td className="action-cell"><RowActions onEdit={onEdit} onDelete={onDelete} /></td></tr>; }
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
