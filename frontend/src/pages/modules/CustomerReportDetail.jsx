import "../../styles/compact-report-toolbar.css";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { selectCustomer, selectLoan, scopeReady, loansForCustomer } from "../../utils/customerReportSelection";
import { useEffect, useMemo, useState } from "react";
import { formatINR } from "../../utils/currency";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import ReadOnlyAttachmentsModal, { attachmentSources } from "../../components/KycDocuments/ReadOnlyAttachments";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import { periodRange, FULL_PERIOD_OPTIONS } from "../../utils/periodRange";
import "./report-common.css";
import "../../styles/report-layout.css";
import { rowDetail } from "../reportDetail/reportDetailRoute";

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const money = formatINR;
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const EMPTY_SECTION = { customer: null, openingSigned: 0, transactionRows: [] };

function Icon({ name }) {
  const paths = {
    back: <path d="M19 12H5m7 7-7-7 7-7" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    chevronLeft: <path d="m15 6-6 6 6 6" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

// Debit = positive, Credit = negative. Splits a signed net balance into the Debit/Credit
// summary columns it belongs under, each shown as a non-negative amount + Dr/Cr suffix
// (never a bare negative number).

function drCrSplit(value) {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return { debit: money(0), credit: "" };
  return rounded > 0 ? { debit: `${money(rounded)} Dr`, credit: "" } : { debit: "", credit: `${money(Math.abs(rounded))} Cr` };
}
// Single-column balance label (used only for the optional per-row running Balance).
function balanceLabel(value) {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return money(0);
  return rounded > 0 ? `${money(rounded)} Dr` : `${money(Math.abs(rounded))} Cr`;
}
function signedOf(row) {
  if (!row) return 0;
  return Number(row.debit) > 0 ? Number(row.debit) : -Number(row.credit || 0);
}

// Single source of truth for the running balance / totals, shared by the on-screen
// ledger table and the PDF/Excel exports so they can never drift apart.
function buildLedgerView(section) {
  const { openingSigned, transactionRows } = section;
  let running = openingSigned;
  const rows = transactionRows.map(row => { running += Number(row.debit || 0) - Number(row.credit || 0); return { ...row, balance: running }; });
  const debitTotal = transactionRows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const creditTotal = transactionRows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  const closingSigned = openingSigned + debitTotal - creditTotal;
  return { rows, debitTotal, creditTotal, openingSigned, closingSigned, openingSplit: drCrSplit(openingSigned), closingSplit: drCrSplit(closingSigned) };
}

export default function CustomerReportDetail({ api, auth, go, id }) {
  const [customers, setCustomers] = useState([]);
  const [loans, setLoans] = useState([]);
  const [customer, setCustomer] = useState(id || "");
  const [loanId, setLoanId] = useState("");
  const [period, setPeriod] = useState("All");
  const [customFrom, setCustomFrom] = useState(""), [customTo, setCustomTo] = useState("");
  const [section, setSection] = useState(EMPTY_SECTION);
  const [loading, setLoading] = useState(true), [ledgerLoading, setLedgerLoading] = useState(false), [error, setError] = useState("");
  const [showBalance, setShowBalance] = useState(false);
  const [exportBusy, setExportBusy] = useState(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const { profile } = useCompanyProfile() || {};

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.get("/customers/", { ...auth, params: { page_size: 5000 } }),
      api.get("/finance/loans/", { ...auth, params: { page_size: 10000 } }),
    ]).then(([customersRes, loansRes]) => {
      if (!active) return;
      setCustomers(customersRes.data.results ?? customersRes.data ?? []);
      setLoans(loansRes.data.results ?? loansRes.data ?? []);
      setError("");
    }).catch(() => { if (active) setError("Unable to load report data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  // Transactions/voucher dates are filtered by the selected Period; capped at today so a
  // forward-looking range (e.g. "This Year") never pulls in not-yet-accrued installments.
  const dateRange = useMemo(() => {
    const { from, to } = periodRange(period, customFrom, customTo);
    const today = localToday();
    return { from, to: to && to > today ? today : to };
  }, [period, customFrom, customTo]);
  const pairReady = scopeReady(loans, { customer, loanId }) && customers.some(row => String(row.id) === String(customer));
  const changePair = pair => { setCustomer(pair.customer); setLoanId(pair.loanId); setSection(EMPTY_SECTION); setLoadedScope(""); };
  const changeCustomer = value => changePair(selectCustomer(loans, { customer, loanId }, value));
  const changeLoan = value => changePair(value ? selectLoan(loans, value) : { customer, loanId: "" });
  const reportScope = JSON.stringify([String(customer), String(loanId), dateRange.from, dateRange.to]);
  const exportReady = !loading && pairReady && !ledgerLoading && !!section.customer && loadedScope === reportScope;

  useEffect(() => {
    if (!pairReady) { setSection(EMPTY_SECTION); setLoadedScope(""); setLedgerLoading(false); return; }
    let active = true;
    setLedgerLoading(true);
    const dateParams = { from: dateRange.from || undefined, to: dateRange.to || undefined };
    const request = loanId
      ? Promise.all([
          api.get("/finance/reports/customer-wise/", { ...auth, params: { customer } }),
          api.get("/finance/reports/customer-wise/", { ...auth, params: { customer, loan_id: loanId, ...dateParams } }),
        ]).then(([openingRes, loanRes]) => {
          const openingResult = (openingRes.data.results || [])[0];
          const loanResult = (loanRes.data.results || [])[0];
          const openingRow = openingResult ? openingResult.rows.find(row => row.is_opening) : null;
          return loanResult ? { customer: loanResult.customer, openingSigned: signedOf(openingRow), transactionRows: loanResult.rows } : EMPTY_SECTION;
        })
      : api.get("/finance/reports/customer-wise/", { ...auth, params: { customer, ...dateParams } }).then(({ data }) => {
          const result = (data.results || [])[0];
          if (!result) return EMPTY_SECTION;
          const openingRow = result.rows.find(row => row.is_opening);
          return { customer: result.customer, openingSigned: signedOf(openingRow), transactionRows: result.rows.filter(row => !row.is_opening) };
        });
    request.then(value => { if (active) { setSection(value); setLoadedScope(reportScope); setError(""); } })
      .catch(() => { if (active) setError("Unable to load the customer's statement."); })
      .finally(() => { if (active) setLedgerLoading(false); });
    return () => { active = false; };
  }, [api, customer, loanId, pairReady, dateRange.from, dateRange.to]);

  const customerOptions = useMemo(() => customers.map(item => ({
    value: item.id, label: `${item.full_name} — ${item.primary_mobile}`, full_name: item.full_name, primary_mobile: item.primary_mobile,
  })), [customers]);

  const loanOptions = useMemo(() => {
    return loansForCustomer(loans, customer).map(row => {
      const type = row.loan_type?.name || "Loan";
      const plan = row.plan?.name || "";
      const label = type.toLowerCase() === "chit" && plan ? `${row.doc_no} • ${type} • ${plan}` : `${row.doc_no} • ${type}`;
      return { value: row.id, label, doc_no: row.doc_no, plan_name: plan, loan_type: type };
    });
  }, [loans, customer]);

  const selectedCustomerObj = useMemo(() => customers.find(row => String(row.id) === String(customer)), [customers, customer]);
  const selectedLoanDocNo = useMemo(() => loans.find(row => String(row.id) === String(loanId))?.doc_no, [loans, loanId]);
  const ledger = useMemo(() => buildLedgerView(section), [section]);
  // View-only attachments: the customer's saved KYC documents plus the saved documents of
  // the selected loan (or of every loan of this customer when no loan is chosen).
  const attachmentLoans = useMemo(() => loanId ? loans.filter(row => String(row.id) === String(loanId)) : loansForCustomer(loans, customer), [loans, loanId, customer]);
  const attachmentList = useMemo(() => attachmentSources(selectedCustomerObj, attachmentLoans), [selectedCustomerObj, attachmentLoans]);

  const filtersLine = [
    selectedCustomerObj && `Customer: ${selectedCustomerObj.full_name} — ${selectedCustomerObj.primary_mobile}`,
    loanId && selectedLoanDocNo && `Loan: ${selectedLoanDocNo}`,
    period !== "All" && `Period: ${period}${period === "Custom Date" ? ` (${dateRange.from || "…"} to ${dateRange.to || "…"})` : ""}`,
  ].filter(Boolean).join("   •   ");
  const exportFilename = () => reportFilename("Customer_Wise_Report", selectedCustomerObj?.full_name, selectedLoanDocNo);

  const pdfColumns = () => [
    { header: "Date", align: "left", width: 22 }, { header: "Particulars", align: "left", width: showBalance ? 42 : 51 },
    { header: "Loan Type", align: "left", width: showBalance ? 21 : 25 }, { header: "Vch No.", align: "left", width: showBalance ? 22 : 26 },
    { header: "Dr", align: "right", width: showBalance ? 24 : 28 }, { header: "Cr", align: "right", width: showBalance ? 24 : 28 },
    ...(showBalance ? [{ header: "Balance", align: "right", width: 25 }] : []),
  ];
  const excelColumns = () => [
    { header: "Date", width: 14 }, { header: "Particulars", width: 32 },
    { header: "Loan Type", width: 14 }, { header: "Vch No.", width: 14 },
    { header: "Dr", numeric: true, width: 14 }, { header: "Cr", numeric: true, width: 14 },
    ...(showBalance ? [{ header: "Balance", width: 18 }] : []),
  ];

  const buildSummaryPdfRows = () => {
    const pad = showBalance ? [""] : [];
    return [
      { cells: [{ content: "Opening Balance :", colSpan: 4, styles: { halign: "right" } }, ledger.openingSplit.debit, ledger.openingSplit.credit, ...pad] },
      { cells: [{ content: "Current Total :", colSpan: 4, styles: { halign: "right" } }, money(ledger.debitTotal), money(ledger.creditTotal), ...pad], dividerAfter: true },
      { cells: [{ content: "Closing Balance :", colSpan: 4, styles: { halign: "right" } }, ledger.closingSplit.debit, ledger.closingSplit.credit, ...pad], bold: true, dividerAfter: true },
    ];
  };
  const buildSummaryExcelRows = columnCount => {
    const row = (label, dr, cr) => { const cells = new Array(columnCount).fill(""); cells[0] = label; cells[4] = dr; cells[5] = cr; return cells; };
    return [
      row("Opening Balance", ledger.openingSplit.debit, ledger.openingSplit.credit),
      row("Current Total", money(ledger.debitTotal), money(ledger.creditTotal)),
      row("Closing Balance", ledger.closingSplit.debit, ledger.closingSplit.credit),
    ];
  };

  const handleExportPdf = async (mode = "pdf") => {
    if (exportBusy || !customer || !exportReady) return;
    setExportBusy(mode);
    setError("");
    try {
      const columns = pdfColumns();
      const rows = ledger.rows.map(row => [
        dateLabel(row.date), row.particulars, row.loan_type || "—", row.voucher_no || "—",
        Number(row.debit) > 0 ? money(row.debit) : "", Number(row.credit) > 0 ? money(row.credit) : "",
        ...(showBalance ? [balanceLabel(row.balance)] : []),
      ]);
      await (mode === "print" ? printReportPdf : downloadReportPdf)({
        title: "Customer-wise Report", filtersLine, columns, rows,
        summaryRows: buildSummaryPdfRows(), profile, summaryAtBottom: true,
      }, exportFilename());
    } catch { setError("PDF download failed. Please retry after the statement finishes loading."); }
    finally { setExportBusy(null); }
  };
  const handleExportExcel = async () => {
    if (exportBusy || !customer || !exportReady) return;
    setExportBusy("excel");
    setError("");
    try {
      const columns = excelColumns();
      const rows = ledger.rows.map(row => [
        row.date || "", row.particulars, row.loan_type || "", row.voucher_no || "",
        Number(row.debit) > 0 ? Number(row.debit) : "", Number(row.credit) > 0 ? Number(row.credit) : "",
        ...(showBalance ? [balanceLabel(row.balance)] : []),
      ]);
      await downloadReportExcel({
        filename: exportFilename(), title: "Customer-wise Report", subtitle: filtersLine || undefined,
        columns, rows, summaryRows: buildSummaryExcelRows(columns.length),
      });
    } catch { setError("Excel download failed. Please retry after the statement finishes loading."); }
    finally { setExportBusy(null); }
  };

  return <div className="rpt-page rl-page data-page compact-report-page">
    <div className="rl-header">
      <PageBreadcrumb className="rpt-breadcrumb" current="Customer-wise Report" />
      <div className="rl-status" role="status">{error ? <span className="rpt-error" role="alert">{error}</span> : (loading || ledgerLoading) ? "Updating…" : null}</div>
      
    </div>
    <div className="rl-filters" role="search">
      <label className="rl-field"><span className="rl-label">Customer</span>
        <div className={`rpt-dropdown-wrap ${customer ? "has-value" : ""}`}>
          <SearchableDropdown options={customerOptions} searchKeys={["full_name", "primary_mobile"]} value={customer} onChange={changeCustomer} portal searchInside placeholder="Select Customer" />
        </div>
      </label>
      <label className="rl-field"><span className="rl-label">Loan Number</span>
        <div className={`rpt-dropdown-wrap ${loanId ? "has-value" : ""}`}>
          <SearchableDropdown options={loanOptions} searchKeys={["doc_no", "plan_name", "loan_type"]} value={loanId} onChange={changeLoan} portal searchInside placeholder="Select Loan Number" />
        </div>
      </label>
      <label className="rl-field"><span className="rl-label">Period</span>
        <select value={period} onChange={event => setPeriod(event.target.value)}>
          {FULL_PERIOD_OPTIONS.map(option => <option key={option}>{option}</option>)}
        </select>
      </label>
      {period === "Custom Date" && <>
        <label className="rl-field"><span className="rl-label">From Date</span><input type="date" value={customFrom} max={customTo || undefined} onChange={event => setCustomFrom(event.target.value)} /></label>
        <label className="rl-field"><span className="rl-label">To Date</span><input type="date" value={customTo} min={customFrom || undefined} onChange={event => setCustomTo(event.target.value)} /></label>
      </>}
      <div className="rl-actions">
        <button type="button" className="rpt-attachments-view" disabled={!selectedCustomerObj} title="View attached documents" onClick={() => setAttachmentsOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>View
        </button>
        <ReportExportButtons portal downloadLabels onPdf={() => handleExportPdf()} onExcel={handleExportExcel} onPrint={() => handleExportPdf("print")} busy={exportBusy} disabled={!customer || !exportReady} />
      </div>
    </div>

    <CustomerLedgerSection go={go} ledger={ledger} showBalance={showBalance} onToggleBalance={() => setShowBalance(value => !value)} />
    {attachmentsOpen && selectedCustomerObj && <ReadOnlyAttachmentsModal api={api} auth={auth} title={selectedCustomerObj.full_name} sources={attachmentList} onClose={() => setAttachmentsOpen(false)} />}
  </div>;
}

// Date | Particulars | Vch Type | Vch No. | Dr | Cr [| Balance] | chevron — shared by the
// transaction table and the footer table below it, so the two stay pixel-aligned without
// either one hard-coding margins to fake the lineup. Particulars gives up a little width
// to the optional Balance column when it's expanded.
const LEDGER_COL_WIDTHS = ["11%", "34%", "15%", "12%", "12%", "12%", "4%"];
const LEDGER_COL_WIDTHS_WITH_BALANCE = ["10%", "27%", "13%", "11%", "11%", "11%", "13%", "4%"];
function LedgerColgroup({ showBalance }) {
  const widths = showBalance ? LEDGER_COL_WIDTHS_WITH_BALANCE : LEDGER_COL_WIDTHS;
  return <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;
}

// Flex-column report container: header + transaction rows on top (flex: 1, so the empty
// space between data and footer flexes), then the complete 3-row Opening / Current Total /
// Closing footer (flex-shrink: 0) flush at the container's bottom edge. Both tables use the
// same <colgroup> and fixed table layout, so footer Dr/Cr amounts sit exactly under the
// DR/CR headers.
function CustomerLedgerSection({ ledger, showBalance, onToggleBalance, go }) {
  const { rows, debitTotal, creditTotal, openingSplit, closingSplit } = ledger;
  const trailing = <>{showBalance && <td />}<td /></>;

  return <div className="rpt-card rpt-table-card rpt-ledger-card rpt-ledger-card-fill data-container">
    <div className="rpt-ledger-rows data-table-area">
      <div className="rpt-table-wrap">
        <table className="rpt-table rpt-ledger-table">
          <LedgerColgroup showBalance={showBalance} />
          <thead><tr>
            <th>Date</th><th>Particulars</th><th>Loan Type</th><th>Vch No.</th><th className="num">Dr</th><th className="num">Cr</th>
            {showBalance && <th className="num">Balance</th>}
            <th className="rpt-balance-toggle-th">
              <button type="button" className="rpt-balance-toggle" title={showBalance ? "Hide Balance" : "Show Balance"}
                aria-label={showBalance ? "Hide Balance column" : "Show Balance column"} onClick={onToggleBalance}>
                <Icon name={showBalance ? "chevronLeft" : "chevron"} />
              </button>
            </th>
          </tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={index} className={row.particulars === "Receipt" ? "rpt-receipt-row" : ""} {...rowDetail(go, "voucher", row.voucher_no)}>
              <td>{dateLabel(row.date)}</td><td>{row.particulars}</td><td>{row.loan_type || "—"}</td><td>{row.voucher_no || "—"}</td>
              <td className="num">{Number(row.debit) > 0 ? money(row.debit) : ""}</td>
              <td className="num">{Number(row.credit) > 0 ? money(row.credit) : ""}</td>
              {showBalance && <td className="num">{balanceLabel(row.balance)}</td>}
              <td />
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
    <div className="rpt-ledger-summary data-footer">
      <table className="rpt-table rpt-ledger-table rpt-ledger-summary-table">
        <LedgerColgroup showBalance={showBalance} />
        <tbody>
          <tr className="rpt-summary-row"><td colSpan={4}>Opening Balance :</td>
            <td className="num">{openingSplit.debit}</td><td className="num">{openingSplit.credit}</td>{trailing}</tr>
          <tr className="rpt-summary-row"><td colSpan={4}>Current Total :</td>
            <td className="num">{money(debitTotal)}</td><td className="num">{money(creditTotal)}</td>{trailing}</tr>
          <tr className="rpt-summary-row rpt-summary-row-closing"><td colSpan={4}>Closing Balance :</td>
            <td className="num">{closingSplit.debit}</td><td className="num">{closingSplit.credit}</td>{trailing}</tr>
        </tbody>
      </table>
    </div>
  </div>;
}
