import "../../styles/compact-report-toolbar.css";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { useEffect, useMemo, useState } from "react";
import "../modules/report-common.css";
import "../../styles/report-layout.css";
import { formatINR } from "../../utils/currency";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import CustomerDropdown from "../../components/CustomerDropdown/CustomerDropdown";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import { periodRange, PERIOD_OPTIONS } from "../../utils/periodRange";
import { rowDetail } from "../reportDetail/reportDetailRoute";

const money = formatINR;
const rowsOf = value => value?.results ?? value ?? [];
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";

function Icon({ name }) {
  const paths = { back: <path d="M19 12H5m7 7-7-7 7-7" />, chevron: <path d="m9 6 6 6-6 6" /> };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function completedDate(row) {
  const dates = (row.installments || []).map(item => item.payment_date).filter(Boolean);
  return dates.length ? dates.sort().at(-1) : null;
}

const blankFilters = { customer: "", loan: "", period: "", from: "", to: "" };

export default function CompletedLoans({ api, auth, go }) {
  const [items, setItems] = useState([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [page, setPage] = useState(1);
  const [filters, setFilters] = useState(blankFilters);
  const [exportBusy, setExportBusy] = useState(null);
  const { profile } = useCompanyProfile() || {};
  const pageSize = 10;
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get("/finance/loans/", { ...auth, params: { page_size: 10000, status: "Completed" } })
      .then(({ data }) => { if (active) { setItems(rowsOf(data).filter(row => (row.status || "").toLowerCase() === "completed")); setError(""); } })
      .catch(() => { if (active) setError("Unable to load completed loan data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);
  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const hasActiveFilters = filters.customer || filters.loan || filters.period;
  const clearFilters = () => setFilters(blankFilters);
  const range = useMemo(() => periodRange(filters.period, filters.from, filters.to), [filters.period, filters.from, filters.to]);
  const loanOptions = useMemo(() => items.map(row => ({ value: row.id, label: `${row.doc_no} — ${row.customer?.name || "—"}`, doc_no: row.doc_no, customer_name: row.customer?.name || "" })), [items]);
  const filtered = useMemo(() => items.filter(row => {
    if (filters.customer && String(row.customer?.id) !== String(filters.customer)) return false;
    if (filters.loan && String(row.id) !== String(filters.loan)) return false;
    if (range.from && (!row.start_date || row.start_date < range.from)) return false;
    if (range.to && (!row.start_date || row.start_date > range.to)) return false;
    return true;
  }), [items, filters.customer, filters.loan, range]);
  useEffect(() => setPage(1), [filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  const filtersLine = [
    filters.period && `Period: ${filters.period}`,
    range.from && `From ${range.from}`, range.to && `To ${range.to}`,
  ].filter(Boolean).join("   •   ");
  const handleExportPdf = async (mode = "pdf") => {
    if (exportBusy) return;
    setExportBusy(mode);
    try {
      await (mode === "print" ? printReportPdf : downloadReportPdf)({
        title: "Completed Loans", filtersLine, profile,
        columns: [
          { header: "S.No", align: "center" }, { header: "Loan No" }, { header: "Customer" }, { header: "Plan / Group" },
          { header: "Start Date" }, { header: "Completed Date" }, { header: "Total Amount", align: "right" }, { header: "Collected", align: "right" },
        ],
        rows: filtered.map((row, index) => [
          String(index + 1), row.doc_no, row.customer?.name || "—", row.plan?.name || row.loan_type?.name || "—",
          dateLabel(row.start_date), dateLabel(completedDate(row)), money(row.total_amount), money(row.collected_amount),
        ]),
      }, reportFilename("Completed_Loans"));
    } catch { setError("Unable to prepare the PDF."); }
    finally { setExportBusy(null); }
  };
  const handleExportExcel = async () => {
    if (exportBusy) return;
    setExportBusy("excel");
    try {
      await downloadReportExcel({
        filename: reportFilename("Completed_Loans"), title: "Completed Loans", subtitle: filtersLine || undefined,
        columns: [
          { header: "S.No", width: 8 }, { header: "Loan No", width: 14 }, { header: "Customer", width: 24 }, { header: "Plan / Group", width: 18 },
          { header: "Start Date", width: 14 }, { header: "Completed Date", width: 16 }, { header: "Total Amount", numeric: true, width: 16 }, { header: "Collected", numeric: true, width: 16 },
        ],
        rows: filtered.map((row, index) => [
          index + 1, row.doc_no, row.customer?.name || "—", row.plan?.name || row.loan_type?.name || "—",
          row.start_date || "", completedDate(row) || "", Number(row.total_amount || 0), Number(row.collected_amount || 0),
        ]),
      });
    } finally { setExportBusy(null); }
  };

  return <div className="rpt-page rl-page data-page compact-report-page">
    <div className="rl-header">
      <PageBreadcrumb className="rpt-breadcrumb" current="Completed Loans" />
      <div className="rl-status" role="status">{error ? <span className="rpt-error" role="alert">{error}</span> : loading ? "Updating…" : null}</div>
      
    </div>
    <div className="rl-filters" role="search">
      <label className="rl-field"><span className="rl-label">Customer</span><CustomerDropdown api={api} auth={auth} value={filters.customer} onChange={value => update("customer", value)} /></label>
      <label className="rl-field"><span className="rl-label">Loan Number</span><SearchableDropdown options={loanOptions} searchKeys={["doc_no", "customer_name"]} value={filters.loan} onChange={value => update("loan", value)} placeholder="All Loan Numbers" /></label>
      <label className="rl-field"><span className="rl-label">Period</span>
        <select value={filters.period} onChange={event => update("period", event.target.value)}>
          <option value="">All Time</option>
          {PERIOD_OPTIONS.map(option => <option key={option}>{option}</option>)}
        </select>
      </label>
      {filters.period === "Custom Range" && <>
        <label className="rl-field"><span className="rl-label">From Date</span><input type="date" value={filters.from} max={filters.to || undefined} onChange={event => update("from", event.target.value)} /></label>
        <label className="rl-field"><span className="rl-label">To Date</span><input type="date" value={filters.to} min={filters.from || undefined} onChange={event => update("to", event.target.value)} /></label>
      </>}
      <div className="rl-actions">
        <button type="button" className="rpt-clear" onClick={clearFilters} disabled={!hasActiveFilters}>Clear Filters</button>
        <ReportExportButtons onPdf={() => handleExportPdf()} onExcel={handleExportExcel} onPrint={() => handleExportPdf("print")} busy={exportBusy} disabled={!filtered.length} />
      </div>
    </div>
    <div className="rpt-card rpt-table-card data-container">
      <div className="rpt-table-wrap data-table-area"><table className="rpt-table">
        <thead><tr>
          <th className="center">S.No</th><th>Loan No</th><th>Customer</th><th>Plan / Group</th>
          <th>Start Date</th><th>Completed Date</th><th className="num">Total Amount</th><th className="num">Collected</th>
        </tr></thead>
        <tbody>
          {visible.map((row, index) => <tr key={row.id} {...rowDetail(go, "loan", row.id)}>
            <td className="center">{String((page - 1) * pageSize + index + 1).padStart(2, "0")}</td>
            <td><b>{row.doc_no}</b></td>
            <td><b>{row.customer?.name || "—"}</b></td>
            <td>{row.plan?.name || row.loan_type?.name || "—"}</td>
            <td>{dateLabel(row.start_date)}</td>
            <td>{dateLabel(completedDate(row))}</td>
            <td className="num">{money(row.total_amount)}</td>
            <td className="num">{money(row.collected_amount)}</td>
          </tr>)}
          {!visible.length && !loading && <tr className="rpt-empty-row"><td colSpan={8}>
            <strong>No completed loans found</strong><span>Fully settled loans will appear here.</span>
          </td></tr>}
        </tbody>
      </table></div>
      <div className="rpt-footer data-footer">
        <span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} entries</span>
        <div className="rpt-footer-pages">
          <button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>
          {Array.from({ length: pages }, (_, index) => <button className={page === index + 1 ? "current" : ""} key={index} onClick={() => setPage(index + 1)}>{index + 1}</button>)}
          <button disabled={page === pages} onClick={() => setPage(value => value + 1)}>Next</button>
        </div>
      </div>
    </div>
  </div>;
}
