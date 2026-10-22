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
import { detailPath } from "../reportDetail/reportDetailRoute";
import "../modules/report-common.css";
import "../../styles/report-layout.css";
// These stylesheets are no longer used by this page, but their global `.collection-dashboard`
// rules also style Today Collection Report, which is loaded alongside — keep importing them.
import "./collection-dashboard.css";
import "./collection-entry-polish.css";
import "./collection-erp.css";
import "./today-collection-actions.css";

// Today Report: one register of saved Loan applications, Collection receipts, Payment Entries
// and Bank Transactions for the selected period, served by /finance/reports/today/ (never from schedules).
const money = formatINR;
const LOAN_TYPES = ["All", "Chit", "Interest", "Mortgage"];
const PERIODS = ["Today", "This Week", "Past Week", "This Month", "Custom Range"];
const EMPTY = { rows: [] };
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const dayMonthYear = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "";
// Payment Mode shows only Cash or Bank, from the linked Accounts ledger's category (API: account_type).
const PAYMENT_MODE_FILTER = [{ value: "", label: "All" }, { value: "Cash", label: "Cash" }, { value: "Bank", label: "Bank" }];
const accountTypeOf = row => row.account_type || "";
// Particulars shows the customer's name (a payment without a customer shows its ledger).
const particularsOf = row => row.party || row.customer || String(row.particulars || "").split(" — ")[0] || "—";

function Icon({ name }) {
  const paths = { back: <path d="M19 12H5m7 7-7-7 7-7" />, chevron: <path d="m9 6 6 6-6 6" /> };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function CollectionEntryPage({ api, auth, go }) {
  const [search, setSearch] = useState("");
  const [loanType, setLoanType] = useState("All");
  const [paymentMode, setPaymentMode] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [period, setPeriod] = useState("Today");
  const [customFrom, setCustomFrom] = useState(""), [customTo, setCustomTo] = useState("");
  const [report, setReport] = useState(EMPTY);
  const [loadedScope, setLoadedScope] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [exportBusy, setExportBusy] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { profile } = useCompanyProfile() || {};

  // "Past Week" is the previous Monday–Sunday week, matching the shared Last Week range.
  const range = useMemo(() => period === "Custom Range" ? { from: customFrom, to: customTo } : periodRange(period === "Past Week" ? "Last Week" : period), [period, customFrom, customTo]);
  const rangeError = period === "Custom Range" && (!range.from || !range.to) ? "Select both From and To dates." : range.from && range.to && range.from > range.to ? "From Date cannot be after To Date." : "";
  const scope = JSON.stringify([range.from, range.to, loanType]);

  useEffect(() => {
    if (rangeError) { setReport(EMPTY); setLoadedScope(""); setLoading(false); return undefined; }
    let active = true;
    setLoading(true);
    api.get("/finance/reports/today/", { ...auth, params: { from: range.from, to: range.to, loan_type: loanType === "All" ? undefined : loanType } })
      .then(({ data }) => { if (active) { setReport({ rows: data.rows || [], documentsAllowed: !!data.documents_allowed }); setLoadedScope(scope); setError(""); } })
      .catch(requestError => { if (active) { setReport(EMPTY); setLoadedScope(""); setError(requestError.response?.data?.detail || "Unable to load the Today Report."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, scope, rangeError, reloadKey]);

  const changeLoanType = value => setLoanType(value);
  const changePeriod = value => {
    setPeriod(value);
    if (value !== "Custom Range") { setCustomFrom(""); setCustomTo(""); }
  };
  const hasActiveFilters = Boolean(search.trim() || loanType !== "All" || paymentMode || transactionType || period !== "Today");
  const clearFilters = () => {
    setSearch("");
    setLoanType("All");
    setPaymentMode("");
    setTransactionType("");
    setPeriod("Today");
    setCustomFrom("");
    setCustomTo("");
  };

  const rows = loadedScope === scope ? report.rows : [];
  const transactionTypeOptions = useMemo(() => [
    { value: "", label: "All Transaction Types" },
    ...[...new Set(rows.map(row => row.transaction_type).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map(value => ({ value: String(value), label: String(value) })),
  ], [rows]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      if (transactionType && String(row.transaction_type) !== transactionType) return false;
      if (paymentMode && accountTypeOf(row) !== paymentMode) return false;
      if (!query) return true;
      return [
        row.date, dateLabel(row.date), particularsOf(row), row.voucher_no, row.loan_no,
        row.transaction_type, accountTypeOf(row), row.loan_type, row.amount,
      ].some(value => String(value ?? "").toLowerCase().includes(query));
    });
  }, [rows, search, transactionType, paymentMode]);
  const amountOf = row => { const amount = Number(row.amount ?? 0); return Number.isFinite(amount) ? amount : 0; };
  const overallTotal = filteredRows.reduce((sum, row) => sum + amountOf(row), 0);
  const summaryTotals = [["Grand Total", overallTotal]];
  // Double-click (or Enter) opens the full-page details: the loan for a Loan row, otherwise the row's voucher.
  const openRow = row => go(row.transaction_type === "Loan" ? detailPath("loan", row.transaction_id) : detailPath("voucher", row.voucher_no));
  const exportReady = !loading && !rangeError && loadedScope === scope;
  const rangeLine = range.from === range.to ? dateLabel(range.from) : `${dateLabel(range.from)} to ${dateLabel(range.to)}`;
  const filtersLine = [
    search.trim() && `Search: ${search.trim()}`,
    loanType !== "All" && `Loan Type: ${loanType}`,
    paymentMode && `Payment Mode: ${paymentMode}`,
    transactionType && `Transaction Type: ${transactionType}`,
    `Period: ${period} (${rangeLine})`,
  ].filter(Boolean).join("   •   ");
  // reportFilename appends the export date, so name the period (exact dates only for a custom range).
  const exportFilename = () => reportFilename("Today_Report", loanType !== "All" && loanType, paymentMode,
    period === "Today" ? "" : period === "Custom Range" ? `${dayMonthYear(range.from)}_to_${dayMonthYear(range.to)}` : period);

  const handleExportPdf = async (mode = "pdf") => {
    if (exportBusy || !exportReady) return;
    setExportBusy(mode); setError("");
    try {
      await (mode === "print" ? printReportPdf : downloadReportPdf)({
        title: "Today Report", filtersLine, profile,
        columns: [
          { header: "S.No", align: "center", width: 11 }, { header: "Date", align: "left", width: 21 }, { header: "Particulars", align: "left", width: 38 },
          { header: "Voucher No", align: "left", width: 21 }, { header: "Loan Number", align: "left", width: 20 },
          { header: "Transaction Type", align: "left", width: 21 }, { header: "Amount", align: "right", width: 25 }, { header: "Payment Mode", align: "left", width: 23 },
        ],
        rows: filteredRows.map((row, index) => [index + 1, dateLabel(row.date), particularsOf(row), row.voucher_no || "—", row.loan_no || "—", row.transaction_type, money(row.amount), accountTypeOf(row) || "—"]),
        summaryRows: summaryTotals.map(([label, value]) => ({ cells: [{ content: label, colSpan: 6 }, money(value), ""], bold: true })),
        summaryAtBottom: true,
      }, exportFilename());
    } catch { setError("PDF download failed. Please retry after the report finishes loading."); }
    finally { setExportBusy(null); }
  };
  const handleExportExcel = async () => {
    if (exportBusy || !exportReady) return;
    setExportBusy("excel"); setError("");
    try {
      const columns = [
        { header: "S.No", numeric: true, width: 7 }, { header: "Date", width: 13 }, { header: "Particulars", width: 32 }, { header: "Voucher No", width: 14 },
        { header: "Loan Number", width: 15 }, { header: "Transaction Type", width: 17 }, { header: "Amount", numeric: true, width: 16 }, { header: "Payment Mode", width: 15 },
      ];
      await downloadReportExcel({
        filename: exportFilename(), title: "Today Report", subtitle: filtersLine, columns,
        rows: filteredRows.map((row, index) => [index + 1, dayMonthYear(row.date), particularsOf(row), row.voucher_no || "—", row.loan_no || "—", row.transaction_type, Number(row.amount || 0), accountTypeOf(row) || "—"]),
        summaryRows: summaryTotals.map(([label, value]) => [label, "", "", "", "", "", value, ""]),
      });
    } catch { setError("Excel download failed. Please retry after the report finishes loading."); }
    finally { setExportBusy(null); }
  };

  return <div className="rpt-page rl-page today-report-page data-page compact-report-page">
    <div className="rl-header">
      <PageBreadcrumb className="rpt-breadcrumb" current="Today Report" />
      <div className="rl-status" role="status">{(error || rangeError) ? <span className="rpt-error" role="alert">{error || rangeError}</span> : loading ? "Updating…" : null}</div>
      
    </div>
    <div className="rl-filters" role="search">
      <label className="rl-field"><span className="rl-label">Search</span>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search transactions..." autoComplete="off" />
      </label>
      <label className="rl-field"><span className="rl-label">Loan Type</span>
        <select value={loanType} onChange={event => changeLoanType(event.target.value)}>{LOAN_TYPES.map(option => <option key={option}>{option}</option>)}</select>
      </label>
      <label className="rl-field"><span className="rl-label">Payment Mode</span>
        <div className={`rpt-dropdown-wrap ${paymentMode ? "has-value" : ""}`}>
          <SearchableDropdown options={PAYMENT_MODE_FILTER} value={paymentMode} onChange={value => setPaymentMode(String(value || ""))} portal searchInside placeholder="All" />
        </div>
      </label>
      <label className="rl-field"><span className="rl-label">Transaction Type</span>
        <div className="rpt-dropdown-wrap">
          <SearchableDropdown options={transactionTypeOptions} value={transactionType} onChange={value => setTransactionType(String(value || ""))} portal searchInside placeholder="All Transaction Types" />
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
        <button type="button" className="rpt-clear" onClick={clearFilters} disabled={!hasActiveFilters}>Clear Filters</button>
        <ReportExportButtons portal downloadLabels onPdf={() => handleExportPdf()} onExcel={handleExportExcel} onPrint={() => handleExportPdf("print")} busy={exportBusy} disabled={!exportReady} />
      </div>
    </div>

    <div className="rpt-card rpt-table-card data-container">
      <div className="rpt-table-wrap data-table-area today-report-table-area">
        <table className="rpt-table">
          <colgroup>{["5%", "10%", "24%", "11%", "11%", "12%", "13%", "14%"].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
          <thead><tr>
            <th>S.No</th><th>Date</th><th>Particulars</th><th>Voucher No</th><th>Loan Number</th><th>Transaction Type</th><th className="num">Amount</th><th>Payment Mode</th>
          </tr></thead>
          <tbody>
            {filteredRows.map((row, index) => <tr key={row.key} className="clickable-data-row" tabIndex={0} title="Double-click to view more" style={{ cursor: "pointer" }}
              onDoubleClick={event => { if (!event.target.closest("button,a,input,select,textarea")) openRow(row); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); openRow(row); } }}>
              <td>{index + 1}</td><td>{dateLabel(row.date)}</td>
              <td title={row.particulars}><strong>{particularsOf(row)}</strong></td>
              <td>{row.voucher_no || "—"}</td><td>{row.loan_no || "—"}</td><td>{row.transaction_type}</td>
              <td className="num">{money(row.amount)}</td><td>{accountTypeOf(row) || "—"}</td>
            </tr>)}
            {!filteredRows.length && <tr className="rpt-empty-row"><td colSpan={8}>
              <strong>{loading ? "Loading transactions…" : rangeError ? rangeError : rows.length ? "No transactions match the selected filters." : "No transactions found"}</strong>
              {!loading && !rangeError && <span>{rows.length ? "Try adjusting Search, Payment Mode or Transaction Type." : `No loans, receipts, payments or bank transactions were recorded for ${rangeLine}.`}</span>}
            </td></tr>}
          </tbody>
        </table>
        <div className="today-report-total">
          <table className="rpt-table">
            <colgroup>{["5%", "10%", "24%", "11%", "11%", "12%", "13%", "14%"].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
            <tfoot><tr><td colSpan={6}>Grand Total</td><td className="num">{money(overallTotal)}</td><td /></tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  </div>;
}
