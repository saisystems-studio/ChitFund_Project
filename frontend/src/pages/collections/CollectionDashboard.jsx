import "../../styles/compact-report-toolbar.css";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { useEffect, useMemo, useState } from "react";
import { formatINR } from "../../utils/currency";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import { periodRange } from "../../utils/periodRange";
import { StatusBadge } from "./TodayCollectionDetail";
import { detailPath } from "../reportDetail/reportDetailRoute";
import "../modules/report-common.css";
import "../../styles/report-layout.css";

// Today Collection Report: collection dues as of the report date (period end, capped at
// today) — one row per schedule installment that is still unpaid or was collected in the
// period, with Due Amount, Received (saved collections allocated to it), Balance and Status
// (Completed / Partial / Pending), served by /finance/reports/today-collection/. Clicking
// Customer / Particulars opens the read-only details (with admin Edit / Delete).
const money = formatINR;
const LOAN_TYPES = ["All", "Chit", "Interest", "Mortgage"];
const PERIODS = ["Today", "This Week", "Past Week", "This Month", "All Time", "Custom Range"];
const EMPTY = { rows: [], asOf: "" };
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const dayMonthYear = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "";
const loanTypeName = loan => loan.loan_type?.name || "";
const loanNumber = loan => loan.doc_no || loan.loan_no || `#${loan.id}`;

function Icon({ name }) {
  const paths = { back: <path d="M19 12H5m7 7-7-7 7-7" />, chevron: <path d="m9 6 6 6-6 6" /> };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function CollectionDashboard({ api, auth, go }) {
  const [loanType, setLoanType] = useState("All");
  const [loanId, setLoanId] = useState("");
  const [period, setPeriod] = useState("Today");
  const [customFrom, setCustomFrom] = useState(""), [customTo, setCustomTo] = useState("");
  const [loans, setLoans] = useState([]);
  const [report, setReport] = useState(EMPTY);
  const [loadedScope, setLoadedScope] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [reportError, setReportError] = useState("");
  const [exportBusy, setExportBusy] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { profile } = useCompanyProfile() || {};

  useEffect(() => {
    let active = true;
    api.get("/finance/loans/", { ...auth, params: { status: "ALL", page_size: 10000 } })
      .then(({ data }) => { if (active) setLoans(data.results ?? data ?? []); })
      .catch(() => { if (active) setError("Unable to load loan numbers."); });
    return () => { active = false; };
  }, [api]);

  // "Past Week" is the previous Monday–Sunday week, matching the shared Last Week range.
  const range = useMemo(() => period === "Custom Range" ? { from: customFrom, to: customTo } : period === "All Time" ? { from: "", to: "" } : periodRange(period === "Past Week" ? "Last Week" : period), [period, customFrom, customTo]);
  const rangeError = period === "Custom Range" && (!range.from || !range.to) ? "Select both From and To dates." : range.from && range.to && range.from > range.to ? "From Date cannot be after To Date." : "";
  const scope = JSON.stringify([period, range.from, range.to, loanType, loanId]);
  const changePeriod = value => {
    setPeriod(value);
    if (value !== "Custom Range") { setCustomFrom(""); setCustomTo(""); }
  };

  useEffect(() => {
    if (rangeError) { setReport(EMPTY); setLoadedScope(""); setReportError(""); setLoading(false); return undefined; }
    let active = true;
    setLoading(true);
    setReportError("");
    api.get("/finance/reports/today-collection/", { ...auth, params: { from: range.from || undefined, to: range.to || undefined, all_time: period === "All Time" ? "true" : undefined, loan_type: loanType === "All" ? undefined : loanType, loan_id: loanId || undefined } })
      .then(({ data }) => { if (active) { setReport({ rows: data.rows || [], asOf: data.as_of || "" }); setLoadedScope(scope); setError(""); setReportError(""); } })
      .catch(requestError => { if (active) { setReport(EMPTY); setLoadedScope(""); setReportError(requestError.response?.data?.detail || "Unable to load the Today Collection History."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, scope, rangeError, reloadKey]);

  const loanOptions = useMemo(() => loans
    .filter(loan => loanType === "All" || loanTypeName(loan).toLowerCase() === loanType.toLowerCase())
    .map(loan => ({ value: loan.id, label: `${loanNumber(loan)} • ${loanTypeName(loan) || "Loan"} • ${loan.customer?.full_name || loan.customer?.name || ""}`, doc_no: loanNumber(loan), customer: loan.customer?.full_name || loan.customer?.name || "", loan_type: loanTypeName(loan) })), [loans, loanType]);
  const changeLoanType = value => { setLoanType(value); if (loanId && !loans.some(loan => String(loan.id) === String(loanId) && (value === "All" || loanTypeName(loan).toLowerCase() === value.toLowerCase()))) setLoanId(""); };
  const selectedLoanNo = loanOptions.find(option => String(option.value) === String(loanId))?.doc_no;

  const rows = loadedScope === scope ? report.rows : [];
  // The open detail follows the refreshed report row (same filters) after an Edit / Delete.
  // Double-click opens the latest receipt voucher with its allocated dues; a due with no receipt yet opens its loan.
  const openRow = row => go(row.collection?.voucher_no ? detailPath("voucher", row.collection.voucher_no) : detailPath("loan", row.loan_id, { installment: row.installment_id }));
  const exportReady = !loading && !rangeError && loadedScope === scope;
  const rangeLine = period === "All Time" ? "All Time" : range.from === range.to ? dateLabel(range.from) : `${dateLabel(range.from)} to ${dateLabel(range.to)}`;
  const asOfLine = report.asOf ? `As of ${dateLabel(report.asOf)}` : "";
  const filtersLine = [asOfLine, `Period: ${period} (${rangeLine})`, loanType !== "All" && `Loan Type: ${loanType}`, selectedLoanNo && `Loan: ${selectedLoanNo}`].filter(Boolean).join("   •   ");
  const exportFilename = () => reportFilename("Today_Collection_Report", loanType !== "All" && loanType, selectedLoanNo,
    period === "Today" ? "" : period === "Custom Range" ? `${dayMonthYear(range.from)}_to_${dayMonthYear(range.to)}` : period);

  const handleExportPdf = async (mode = "pdf") => {
    if (exportBusy || !exportReady) return;
    setExportBusy(mode); setError("");
    try {
      await (mode === "print" ? printReportPdf : downloadReportPdf)({
        title: "Today Collection History", filtersLine, profile, orientation: "landscape",
        columns: [
          { header: "S.No", align: "center", width: 11 }, { header: "Date", align: "left", width: 22 }, { header: "Transaction Type", align: "left", width: 22 },
          { header: "Loan Type", align: "left", width: 18 }, { header: "Loan Number", align: "left", width: 22 },
          { header: "Customer / Particulars", align: "left", width: 58 }, { header: "Due Days", align: "right", width: 15 },
          { header: "Due Amount", align: "right", width: 25 }, { header: "Received", align: "right", width: 25 }, { header: "Balance", align: "right", width: 25 },
          { header: "Status", align: "left", width: 22 },
        ],
        rows: rows.map((row, index) => [index + 1, dateLabel(row.date), row.transaction_type, row.loan_type || "—", row.loan_no || "—",
          row.particulars, String(row.due_days), money(row.due_amount), money(row.received_amount), money(row.balance_amount), row.status]),
      }, exportFilename());
    } catch { setError("PDF download failed. Please retry after the report finishes loading."); }
    finally { setExportBusy(null); }
  };
  const handleExportExcel = async () => {
    if (exportBusy || !exportReady) return;
    setExportBusy("excel"); setError("");
    try {
      const columns = [
        { header: "S.No", numeric: true, width: 7 }, { header: "Date", width: 13 }, { header: "Transaction Type", width: 16 }, { header: "Loan Type", width: 12 },
        { header: "Loan Number", width: 15 }, { header: "Customer / Particulars", width: 42 }, { header: "Due Days", numeric: true, width: 10 },
        { header: "Due Amount", numeric: true, width: 14 }, { header: "Received", numeric: true, width: 14 }, { header: "Balance", numeric: true, width: 14 },
        { header: "Status", width: 12 },
      ];
      await downloadReportExcel({
        filename: exportFilename(), title: "Today Collection History", subtitle: filtersLine, columns,
        rows: rows.map((row, index) => [index + 1, dayMonthYear(row.date), row.transaction_type, row.loan_type || "—", row.loan_no || "—", row.particulars,
          Number(row.due_days || 0), Number(row.due_amount || 0), Number(row.received_amount || 0), Number(row.balance_amount || 0), row.status]),
      });
    } catch { setError("Excel download failed. Please retry after the report finishes loading."); }
    finally { setExportBusy(null); }
  };

  return <div className="rpt-page rl-page today-collection-page data-page compact-report-page">
    <div className="rl-header">
      <PageBreadcrumb className="rpt-breadcrumb" current="Today Collection History">{asOfLine && <span className="today-collection-as-of" style={{ marginLeft: 10, color: "var(--rpt-muted)", fontSize: 12 }}>{asOfLine}</span>}</PageBreadcrumb>
      <div className="rl-status" role="status">{(error || reportError || rangeError) ? <span className="rpt-error" role="alert">{error || reportError || rangeError}</span> : loading ? "Updating…" : null}</div>
      
    </div>
    <div className="rl-filters" role="search">
      <label className="rl-field"><span className="rl-label">Loan Type</span>
        <select value={loanType} onChange={event => changeLoanType(event.target.value)}>{LOAN_TYPES.map(option => <option key={option}>{option}</option>)}</select>
      </label>
      <label className="rl-field"><span className="rl-label">Loan Number</span>
        <div className={`rpt-dropdown-wrap ${loanId ? "has-value" : ""}`}>
          <SearchableDropdown options={loanOptions} searchKeys={["doc_no", "customer", "loan_type"]} value={loanId} onChange={value => setLoanId(value ? String(value) : "")} portal searchInside placeholder="All Loans" />
        </div>
      </label>
      <label className="rl-field"><span className="rl-label">Period</span>
        <select value={period} onChange={event => changePeriod(event.target.value)}>{PERIODS.map(option => <option key={option}>{option}</option>)}</select>
      </label>
      {period === "Custom Range" && <>
        <label className="rl-field"><span className="rl-label">From Date</span><input type="date" value={customFrom} max={customTo || undefined} onChange={event => setCustomFrom(event.target.value)} /></label>
        <label className="rl-field"><span className="rl-label">To Date</span><input type="date" value={customTo} min={customFrom || undefined} onChange={event => setCustomTo(event.target.value)} /></label>
      </>}
      <div className="rl-actions">
        <ReportExportButtons portal downloadLabels onPdf={() => handleExportPdf()} onExcel={handleExportExcel} onPrint={() => handleExportPdf("print")} busy={exportBusy} disabled={!exportReady} />
      </div>
    </div>

    <div className="rpt-card rpt-table-card data-container">
      <div className="rpt-table-wrap data-table-area">
        <table className="rpt-table">
          <colgroup>{["5%", "9%", "10%", "7%", "9%", "16%", "6%", "9%", "9%", "9%", "11%"].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
          <thead><tr>
            <th>S.No</th><th>Date</th><th>Transaction Type</th><th>Loan Type</th><th>Loan Number</th><th>Customer / Particulars</th>
            <th className="num">Due Days</th><th className="num">Due Amount</th><th className="num" title="Saved collections allocated to this due">Received</th>
            <th className="num" title="Due Amount − Received, as of the report date">Balance</th><th>Status</th>
          </tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.key} className="clickable-data-row" tabIndex={0} title="Double-click to view more" style={{ cursor: "pointer" }}
              onDoubleClick={event => { if (!event.target.closest("button,a,input,select,textarea")) openRow(row); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); openRow(row); } }}>
              <td>{index + 1}</td><td>{dateLabel(row.date)}</td><td>{row.transaction_type}</td>
              <td>{row.loan_type || "—"}</td><td>{row.loan_no || "—"}</td>
              <td style={{ whiteSpace: "normal", padding: "6px 10px" }}><span className="tcr-particulars">{row.particulars}</span></td>
              <td className="num">{row.status === "Completed" ? "—" : row.due_days}</td>
              <td className="num">{money(row.due_amount)}</td>
              <td className="num">{money(row.received_amount)}</td>
              <td className="num">{money(row.balance_amount)}</td>
              <td><StatusBadge status={row.status} /></td>
            </tr>)}
            {!rows.length && <tr className="rpt-empty-row"><td colSpan={11}>
              <strong>{loading ? "Loading collection dues…" : reportError ? "Unable to load collection dues." : rangeError || "No collection dues"}</strong>
              {reportError && <button type="button" className="tcr-btn tcr-retry" disabled={loading} onClick={() => setReloadKey(key => key + 1)}>Retry</button>}
              {!loading && !reportError && !rangeError && <span>Nothing is pending on or before {dateLabel(report.asOf || range.to)}, and no collections were received in this period.</span>}
            </td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}
