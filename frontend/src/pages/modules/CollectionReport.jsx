import PartyCollectionReport from "./PartyCollectionReport";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import "./collection-report.css";
import "./collection-report-histogram.css";
import "./collection-report-split.css";
import "./pending-report-table.css";
import { formatINR } from "../../utils/currency";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { downloadReceipt, printReceipt } from "../../utils/collectionReceipt";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { detailPath } from "../reportDetail/reportDetailRoute";

import { creationDate, fetchAllPages, filterPendingRows, localToday, overdueDays } from "../../utils/pendingReport";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";

const money = formatINR;
const initial = { from: "", to: "", search: "", status: "", loan_number: "", customer_type: "", customer_code: "" };
const number = value => Number(value || 0);

const withTodayRange = () => ({ ...initial, from: localToday(), to: localToday() });

export default function CollectionReport({ api, auth, go, initialView = "pending" }) {
  const [reportScope, setReportScope] = useState("loans");
  const [view, setView] = useState(initialView), [filters, setFilters] = useState(() => initialView === "history" ? withTodayRange() : initial);
  const [data, setData] = useState({ summary: {}, results: [] }), [mode, setMode] = useState("numeric");
  const [matches, setMatches] = useState([]), [customer, setCustomer] = useState(null), [customerData, setCustomerData] = useState(null), [error, setError] = useState("");
  const [performance, setPerformance] = useState(false), [moreMetrics, setMoreMetrics] = useState(false), [detail, setDetail] = useState(null), [activeMatch, setActiveMatch] = useState(0);
  const performanceRef = useRef(null), searchTimer = useRef(null);
  const { profile: companyProfile, refreshProfile } = useCompanyProfile() || {};
  const [receiptBusy, setReceiptBusy] = useState(null);
  const [exportBusy, setExportBusy] = useState(null);
  const [entryDates, setEntryDates] = useState([]);
  const [retry, setRetry] = useState(0);
  // Double-click (or Enter) on a row opens its full-page details: a receipt voucher (history) or the loan (pending / outstanding).
  const openDetail = row => { if (row.loan_id || row.id) go(view === "history" ? detailPath("voucher", `RV-${String(row.id).padStart(6, "0")}`) : detailPath("loan", row.loan_id, view === "pending" ? { installment: row.id } : {})); };
  const changeScope = value => { setReportScope(value); setView(value === "total" ? "total" : "pending"); setData({summary:{},results:[]}); setDetail(null); };
  const today = localToday();
  const cutoff = filters.to || today;
  const selectedCustomerId = ["outstanding","total"].includes(view) && filters.customer_code
    ? entryDates.find(entry => entry.customer?.code === filters.customer_code)?.customer?.id || ""
    : customer?.id || "";
  const receipt = async (row, action) => {
    if (receiptBusy) return;
    setReceiptBusy(`${action}-${row.id}`);
    try {
      const { data: voucher } = await api.get("/finance/collections/receipt/", { ...auth, params: { ids: row.id } });
      const profile = await (refreshProfile ? refreshProfile().catch(() => companyProfile) : companyProfile);
      await (action === "pdf" ? downloadReceipt : printReceipt)(voucher, profile);
    } catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to prepare the receipt."), false); }
    finally { setReceiptBusy(null); }
  };
  useEffect(() => { setView(initialView); setPerformance(false); setMoreMetrics(false); setDetail(null); }, [initialView]);
  useEffect(() => { if (view === "history" && !filters.from && !filters.to) setFilters(current => ({ ...current, from: localToday(), to: localToday() })); }, [view]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const endpoint = view === "history" ? "/finance/collection-history/" : ["outstanding","total"].includes(view) ? "/finance/reports/loan-wise/" : "/finance/reports/day-wise/";
        const params = { ...filters, customer_id: selectedCustomerId, ...(view !== "history" ? { to: cutoff } : {}), ...(view === "total" ? {scope:"total"} : {}) };
        const response = await api.get(endpoint, { ...auth, params });
        if (active) { setData(response.data || { summary: {}, results: [] }); setError(""); }
      } catch (requestError) { if (active) { setData({ summary: {}, results: [] }); setError(apiErrorMessage(requestError, "Unable to load report data.")); } }
    }, view === "history" && filters.search ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [view, retry, today, JSON.stringify(filters), selectedCustomerId]);
  useEffect(() => {
    if (view === "history") return;
    let active = true;
    setEntryDates([]);
    fetchAllPages(api, ["outstanding","total"].includes(view) ? "/finance/loans/?status=ALL" : "/finance/customer-loan-installments/", auth)
      .then(rows => { if (active) setEntryDates(rows); })
      .catch(() => { if (active) setError("Unable to load voucher creation dates."); });
    return () => { active = false; };
  }, [view, retry]);
  useEffect(() => { clearTimeout(searchTimer.current); if (customer || filters.search.trim().length < 1) { setMatches([]); return; } searchTimer.current = setTimeout(() => api.get("/customers/search/", { ...auth, params: { q: filters.search.trim() } }).then(response => setMatches(response.data || [])).catch(() => setMatches([])), 350); return () => clearTimeout(searchTimer.current); }, [filters.search, customer]);
  useEffect(() => { if (!customer?.id || view === "history") { setCustomerData(null); return; } api.get(`/finance/reports/customer/${customer.id}/`, auth).then(response => setCustomerData(response.data || null)).catch(() => setCustomerData(null)); }, [customer, view]);
  useEffect(() => { const close = event => { if (performanceRef.current && !performanceRef.current.contains(event.target)) setPerformance(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  const update = (key, value) => { if (key === "search") { setCustomer(null); setCustomerData(null); } setFilters(current => ({ ...current, ...(key === "search" ? { customer_code: "" } : {}), [key]: value })); };
  const chooseCustomer = item => { setCustomer(item); setCustomerData(null); setFilters(current => ({ ...current, search: item.customer_name, customer_code: item.customer_code || "" })); setMatches([]); };
  const reset = () => { setFilters(view === "history" ? withTodayRange() : initial); setCustomer(null); setCustomerData(null); setPerformance(false); setMoreMetrics(false); };
  const reportRows = useMemo(() => {
    const dates = new Map(entryDates.map(entry => [["outstanding","total"].includes(view) ? String(entry.id) : `${entry.loan}-${entry.installment_number}`, entry]));
    return (data.results || []).map(row => {
      const entry = dates.get(["outstanding","total"].includes(view) ? String(row.loan_id) : `${row.loan_id}-${row.installment_number}`);
      const due = row.due_date;
      return { ...row, voucher_date: entry?.create_date, due_date: due, days_overdue: view === "total" ? row.days_overdue : overdueDays(due, cutoff), installments: row.installments || entry?.installments || [] };
    });
  }, [data.results, entryDates, view, cutoff]);
  const rows = useMemo(() => {
    if (view === "history") return (data.results || []).filter(row => number(row.paid ?? row.paid_amount) > 0);
    if (view === "total") return reportRows;
    if (view === "outstanding") return reportRows.filter(row => Number(row.outstanding) > 0 && row.due_date && row.due_date <= cutoff);
    return filterPendingRows(reportRows, filters, today);
  }, [data.results, reportRows, filters, view, today, cutoff]);
  const optionRows = ["outstanding","total"].includes(view) ? entryDates.map(entry => ({ loan_no: entry.loan_no, customer_code: entry.customer?.code, customer: entry.customer?.name })) : data.results || [];
  const customers = [...new Map(optionRows.map(row => [row.customer_code, row.customer])).entries()].filter(([code]) => code);
  const loans = [...new Set(optionRows.map(row => row.loan_no).filter(Boolean))];
  const sum = key => rows.reduce((total, row) => total + number(row[key]), 0);
  const historyCash = rows.filter(row => String(row.payment_mode || "").toLowerCase() === "cash").reduce((total, row) => total + number(row.paid), 0);
  const summary = view === "history" ? { ...data.summary, collected: sum("paid"), transactions: rows.length, cash: historyCash, digital: sum("paid") - historyCash } : view === "pending"
    ? { ...data.summary, scheduled: sum("scheduled"), payable: sum("scheduled"), collected: sum("paid"), outstanding: sum("balance"), overdue: rows.filter(row => row.days_overdue > 0).reduce((total, row) => total + number(row.balance), 0) }
    : { ...data.summary, principal: sum("principal"), payable: sum("total_payable"), collected: sum("paid"), outstanding: sum("outstanding") };
  const title = ["pending","total"].includes(view) ? "Pending & Outstanding" : view === "outstanding" ? "Outstanding" : "Today Collection History";
  const searchPlaceholder = view === "history" ? "Search customer / loan / receipt..." : "Search customer / loan / phone...";
  const keyDown = event => { if (!matches.length) return; if (event.key === "ArrowDown") { event.preventDefault(); setActiveMatch(value => (value + 1) % matches.length); } else if (event.key === "ArrowUp") { event.preventDefault(); setActiveMatch(value => (value - 1 + matches.length) % matches.length); } else if (event.key === "Enter") { event.preventDefault(); chooseCustomer(matches[activeMatch]); } else if (event.key === "Escape") setMatches([]); };
  const selectedProfile = customerData ? { ...customerData.customer, receivable_schedule: customerData.receivable_schedule || [], payable_schedule: customerData.payable_schedule || [], receivable_summary: customerData.receivable_summary || {}, payable_summary: customerData.payable_summary || {} } : customer;
  const profileLoans = customerData?.loans || [];
  const profileOutstanding = customerData?.receivable_summary?.outstanding ?? customerData?.payable_summary?.outstanding ?? rows.reduce((sum, row) => sum + number(row.outstanding), 0);
  const profilePending = customerData?.receivable_summary?.pending ?? rows.reduce((sum, row) => sum + number(row.balance), 0);

  const filtersLine = [
    filters.customer_code && `Customer: ${customers.find(([code]) => code === filters.customer_code)?.[1] || filters.customer_code}`,
    filters.status && `Status: ${filters.status}`, filters.loan_number && `Loan: ${filters.loan_number}`,
    filters.from && `From ${filters.from}`, filters.to && `To ${filters.to}`,
    view === "history" && filters.customer_type && `Customer Type: ${filters.customer_type}`,
  ].filter(Boolean).join("   •   ");
  const overdueLabel = row => row.days_overdue > 0 ? `${row.days_overdue} ${row.days_overdue === 1 ? "Day" : "Days"}` : "";
  const totalColumns = ["Customer","Loan Number","Total Due","Collected","Remaining Balance","Unallocated Others"];
  const exportPdfColumns = () => view === "total" ? totalColumns.map((header,i)=>({header,align:i>=2?"right":"left"})) : view === "pending"
    ? [{ header: "S.No", align: "center" }, { header: "Voucher Date" }, { header: "Customer" }, { header: "Loan No" }, { header: "Due Date" }, { header: "Due Amount", align: "right" }, { header: "Balance", align: "right" }, { header: "Overdue" }]
    : view === "outstanding"
    ? [{ header: "S.No", align: "center" }, { header: "Voucher Date" }, { header: "Customer" }, { header: "Loan No" }, { header: "Plan" }, { header: "Total Amount", align: "right" }, { header: "Outstanding", align: "right" }, { header: "Overdue" }]
    : [{ header: "S.No", align: "center" }, { header: "Date" }, { header: "Customer" }, { header: "Loan No" }, { header: "Amount", align: "right" }, { header: "Mode" }, { header: "Status" }];
  const exportPdfRows = () => rows.map((row, index) => view === "total" ? [row.customer,row.loan_no,money(row.total_payable),money(row.paid),money(row.outstanding),money(row.unallocated_others)] : view === "pending"
    ? [String(index + 1), creationDate(row.voucher_date), row.customer, row.loan_no, row.due_date, money(row.scheduled ?? row.due_amount), money(row.balance ?? row.outstanding), overdueLabel(row)]
    : view === "outstanding"
    ? [String(index + 1), creationDate(row.voucher_date), row.customer, row.loan_no, row.loan_type || row.plan || "—", money(row.total_payable), money(row.outstanding), overdueLabel(row)]
    : [String(index + 1), row.payment_date, row.customer, row.loan_no, money(row.paid ?? row.paid_amount), row.payment_mode || row.mode || "—", row.status || "Pending"]);
  const exportExcelColumns = () => view === "total" ? totalColumns.map((header,i)=>({header,width:22,numeric:i>=2})) : view === "pending"
    ? [{ header: "S.No", width: 8 }, { header: "Voucher Date", width: 14 }, { header: "Customer", width: 22 }, { header: "Loan No", width: 14 }, { header: "Due Date", width: 14 }, { header: "Due Amount", numeric: true, width: 14 }, { header: "Balance", numeric: true, width: 14 }, { header: "Overdue", width: 12 }]
    : view === "outstanding"
    ? [{ header: "S.No", width: 8 }, { header: "Voucher Date", width: 14 }, { header: "Customer", width: 22 }, { header: "Loan No", width: 14 }, { header: "Plan", width: 16 }, { header: "Total Amount", numeric: true, width: 14 }, { header: "Outstanding", numeric: true, width: 14 }, { header: "Overdue", width: 12 }]
    : [{ header: "S.No", width: 8 }, { header: "Date", width: 14 }, { header: "Customer", width: 22 }, { header: "Loan No", width: 14 }, { header: "Amount", numeric: true, width: 14 }, { header: "Mode", width: 14 }, { header: "Status", width: 14 }];
  const exportExcelRows = () => rows.map((row, index) => view === "total" ? [row.customer,row.loan_no,Number(row.total_payable),Number(row.paid),Number(row.outstanding),Number(row.unallocated_others)] : view === "pending"
    ? [index + 1, row.voucher_date || "", row.customer, row.loan_no, row.due_date || "", Number(row.scheduled ?? row.due_amount ?? 0), Number(row.balance ?? row.outstanding ?? 0), overdueLabel(row)]
    : view === "outstanding"
    ? [index + 1, row.voucher_date || "", row.customer, row.loan_no, row.loan_type || row.plan || "", Number(row.total_payable || 0), Number(row.outstanding || 0), overdueLabel(row)]
    : [index + 1, row.payment_date || "", row.customer, row.loan_no, Number(row.paid ?? row.paid_amount ?? 0), row.payment_mode || row.mode || "", row.status || "Pending"]);
  const handleExportPdf = async (mode = "pdf") => {
    if (exportBusy) return;
    setExportBusy(mode);
    try {
      const reportProfile = await (refreshProfile ? refreshProfile().catch(() => companyProfile) : companyProfile);
      await (mode === "print" ? printReportPdf : downloadReportPdf)({ title, filtersLine, profile: reportProfile, orientation: "landscape", columns: exportPdfColumns(), rows: exportPdfRows() }, reportFilename(title.replace(/[^a-z0-9]+/gi, "_")));
    } catch { setError("Unable to prepare the PDF."); }
    finally { setExportBusy(null); }
  };
  const handleExportExcel = async () => {
    if (exportBusy) return;
    setExportBusy("excel");
    try {
      await downloadReportExcel({ filename: reportFilename(title.replace(/[^a-z0-9]+/gi, "_")), title, subtitle: filtersLine || undefined, columns: exportExcelColumns(), rows: exportExcelRows() });
    } finally { setExportBusy(null); }
  };

  const refresh = () => { reset(); setRetry(value => value + 1); };
  if (view !== "history" && reportScope === "ledger") return <PartyCollectionReport api={api} auth={auth} go={go} onScopeChange={changeScope} customerId={selectedCustomerId} customerCode={filters.customer_code} onCustomerChange={code=>setFilters(current=>({...current,customer_code:code}))} initialFrom={filters.from} initialTo={filters.to} onDatesChange={(from,to)=>setFilters(current=>({...current,from,to}))}/>;
  return <div className="collection-report-page report-redesign data-page"><div className="report-topbar"><PageBreadcrumb className="report-breadcrumb" current={title} /><div className="report-top-actions">{view !== "history" && <select aria-label="Report scope" value={reportScope} onChange={event => changeScope(event.target.value)} style={{width:"auto",margin:0}}><option value="loans">Loan Dues</option><option value="total">Total Outstanding</option><option value="ledger">Ledger Outstanding</option></select>}<div className="report-search-wrap"><input value={filters.search} onChange={event => update("search", event.target.value)} onKeyDown={keyDown} placeholder={searchPlaceholder}/>{matches.length > 0 && <div className="customer-suggestions">{matches.map((item, index) => <button className={index === activeMatch ? "active" : ""} key={item.id} onMouseDown={() => chooseCustomer(item)}>{item.customer_name} | {item.customer_code} | {item.phone}</button>)}</div>}</div><div className="performance-wrapper" ref={performanceRef}><button className="performance-button" aria-expanded={performance} onClick={() => setPerformance(value => !value)}>Performance <span>{performance ? "⌃" : "⌄"}</span></button>{performance && <PerformancePanel view={view === "total" ? "outstanding" : view} summary={summary} mode={mode} setMode={setMode} more={moreMetrics} setMore={setMoreMetrics}/>}</div><ReportExportButtons onPdf={() => handleExportPdf()} onExcel={handleExportExcel} onPrint={() => handleExportPdf("print")} busy={exportBusy} disabled={!rows.length || Boolean(error)} /></div></div><main className="collection-report-container report-redesign-container data-fill"><div className="report-filter-bar compact-report-filters report-filter-row">
        {view !== "history" && <label className="f-wide">Customer<SearchableSelect value={filters.customer_code} onChange={event => { update("search", ""); update("customer_code", event.target.value); }}><option value="">All Customers</option>{customers.map(([code, name]) => <option key={code} value={code}>{name} | {code}</option>)}</SearchableSelect></label>}
        {view === "pending" && <label className="f-scope">Due Scope<select aria-label="Due scope" value={filters.scope || "current"} onChange={event=>update("scope",event.target.value)}><option value="current">Current / Overdue</option><option value="all_pending">All Pending / Total Outstanding</option></select></label>}
        <label>Status<select value={filters.status} onChange={event => update("status", event.target.value)}><option value="">{view === "history" ? "All Statuses" : "All Status"}</option>{view === "history" && <option value="PAID">Paid</option>}<option value="PENDING">Pending</option><option value="OUTSTANDING">Outstanding</option><option value="OVERDUE">Overdue</option></select></label>
        <label className="f-date">From Date<input aria-label="Date Range From" type="date" value={filters.from} onChange={event => update("from", event.target.value)}/></label>
        <label className="f-date">To Date<input aria-label="Date Range To" type="date" value={filters.to} onChange={event => update("to", event.target.value)}/></label>
        <label className="f-wide">Loan Number<SearchableSelect value={filters.loan_number} onChange={event => update("loan_number", event.target.value)}><option value="">All Loan Numbers</option>{loans.map(loan => <option key={loan}>{loan}</option>)}</SearchableSelect></label>
        {view === "history" && <label>Customer Type<select value={filters.customer_type} onChange={event => update("customer_type", event.target.value)}><option value="">All Customer Types</option><option value="BORROWER">Borrower</option><option value="LENDER">Lender</option><option value="BOTH">Both</option></select></label>}
        <button className="report-reset" type="button" aria-label="Refresh" title="Refresh (reset filters and reload)" onClick={refresh}>Refresh</button>
      </div>{error && <div className="report-error">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}{customer && view !== "total" && <CustomerSummary profile={selectedProfile} loans={profileLoans} outstanding={profileOutstanding} pending={profilePending} onClear={() => update("search", "")}/>} {view === "total" ? <TotalOutstandingTable rows={rows} onOpen={loanId => go(detailPath("loan", loanId))}/> : mode === "numeric" ? <ReportTable error={error} rows={rows} view={view} customerSelected={Boolean(customer)} onDetail={openDetail} onReceipt={receipt} receiptBusy={receiptBusy}/> : <Histogram rows={rows}/>} </main></div>;
}

function PerformancePanel({ view, summary, mode, setMode, more, setMore }) { const value = key => summary[key] ?? 0; const cards = view === "pending" ? [["Total Pending", value("pending") ?? value("outstanding")], ["Overdue", value("overdue")], ["Partial", value("partial")], ["Upcoming", value("upcoming")]] : view === "outstanding" ? [["Total Outstanding", value("outstanding")], ["Customers", value("customers")], ["Loans", value("loans")], ["Overdue Amount", value("overdue")]] : [["Total Collected", value("collected")], ["Transactions", value("transactions")], ["Cash", value("cash")], ["Digital", value("digital")]]; return <section className="performance-panel"><div className="performance-panel-title"><strong>Performance Summary</strong><div className="report-mode-toggle"><button className={mode === "numeric" ? "active" : ""} onClick={() => setMode("numeric")}>Numeric</button><button className={mode === "chart" ? "active" : ""} onClick={() => setMode("chart")}>Histogram</button></div></div><div className="performance-cards">{cards.map(([label, metric]) => <article key={label}><small>{label}</small><strong>{money(metric)}</strong></article>)}</div><button className="performance-more" onClick={() => setMore(value => !value)}>{more ? "View Less" : "View More"} <span>{more ? "⌃" : "⌄"}</span></button>{more && <div className="performance-extra"><span>Scheduled / Payable <b>{money(summary.scheduled ?? summary.payable)}</b></span><span>Paid <b>{money(summary.paid ?? summary.collected)}</b></span><span>Pending Balance <b>{money(summary.pending ?? summary.outstanding)}</b></span></div>}</section>; }
function ReportTable({ error, rows, view, onDetail, onReceipt, receiptBusy }) { const [page,setPage]=useState(0); useEffect(()=>setPage(0),[rows]); const paged=view==="pending"; const count=Math.max(1,Math.ceil(rows.length/25)); const visible=paged?rows.slice(page*25,(page+1)*25):rows; const history = view === "history"; const headers = view === "pending" ? ["S.No", "Voucher Date", "Customer", "Loan No", "Due Date", "Due Amount", "Balance", "OVERDUE DAYS"] : view === "outstanding" ? ["S.No", "Voucher Date", "Customer", "Loan No", "Plan", "Total Amount", "Outstanding", "OVERDUE DAYS"] : ["S.No", "Date", "Customer", "Loan No", "Amount", "Mode", "Status", "Receipt"]; const onRowKey = (event, row) => { if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button,a,input,select,textarea")) { event.preventDefault(); onDetail(row); } }; return <><div className="report-table-wrap report-essential-table data-container"><table className={`report-table report-table-${view}`}><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{visible.map((row, index) => <tr className="clickable-data-row" tabIndex="0" key={(row.id || row.loan_id || "row") + index} onDoubleClick={event => { if (!event.target.closest("button,a,input,select,textarea")) onDetail(row); }} title="Double-click to view more" onKeyDown={event => onRowKey(event, row)}>{view === "pending" && <><td>{page*25 + index + 1}</td><td>{creationDate(row.voucher_date)}</td><td>{row.customer}</td><td>{row.loan_no}</td><td>{row.due_date}</td><td>{money(row.scheduled ?? row.due_amount)}</td><td>{money(row.balance ?? row.outstanding)}</td><td>{row.days_overdue > 0 ? `${row.days_overdue} ${row.days_overdue === 1 ? "Day" : "Days"}` : ""}</td></>}{view === "outstanding" && <><td>{index + 1}</td><td>{creationDate(row.voucher_date)}</td><td>{row.customer}</td><td>{row.loan_no}</td><td>{row.loan_type || row.plan || "—"}</td><td>{money(row.total_payable)}</td><td>{money(row.outstanding)}</td><td>{row.days_overdue > 0 ? `${row.days_overdue} ${row.days_overdue === 1 ? "Day" : "Days"}` : ""}</td></>}{history && <><td>{index + 1}</td><td>{row.payment_date}</td><td>{row.customer}</td><td>{row.loan_no}</td><td>{money(row.paid ?? row.paid_amount)}</td><td>{row.payment_mode || row.mode || "—"}</td><td><Badge value={row.status}/></td><td className="report-receipt-cell"><ReceiptActions row={row} onReceipt={onReceipt} busy={receiptBusy}/></td></>}</tr>)}</tbody></table>{!rows.length && <div className="report-empty">{error ? "Report could not be loaded." : "No records found."}</div>}</div>{paged && <div className="ledger-outstanding-pagination"><button type="button" disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} of {count}</span><button type="button" disabled={page+1>=count} onClick={()=>setPage(p=>p+1)}>Next</button></div>}</>; }
function ReceiptActions({ row, onReceipt, busy }) {
  const button = (action, label, icon) => <button type="button" className={`report-receipt-button receipt-${action}`} aria-label={`${label} receipt`} title={`${label} receipt`} disabled={Boolean(busy)} onClick={event => { event.stopPropagation(); onReceipt(row, action); }} onKeyDown={event => event.stopPropagation()}>{busy === `${action}-${row.id}` ? <span className="report-receipt-spinner" aria-hidden="true"/> : icon}</button>;
  return <div className="report-receipt-actions">{button("pdf", "Download PDF", <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M12 12v6m-3-3 3 3 3-3"/></svg>)}{button("print", "Print", <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></svg>)}</div>;
}
function Badge({ value }) { return <span className={`report-status status-${String(value || "Pending").toLowerCase()}`}>{value || "Pending"}</span>; }
function Histogram({ rows }) { return <div className="report-histogram simple-histogram">{rows.slice(0, 12).map((row, index) => <div className="histogram-column" key={index}><strong>{money(row.paid ?? row.scheduled ?? row.outstanding)}</strong><div className="histogram-bar" style={{ height: "80px" }}/><small>{row.due_date || row.payment_date || row.loan_no}</small></div>)}</div>; }
function CustomerSummary({ profile, loans, outstanding, pending, onClear }) { const name = profile?.customer_name || profile?.full_name || "—"; const code = profile?.customer_code || profile?.code || "—"; const phone = profile?.phone || profile?.primary_mobile || "—"; const type = profile?.customer_type || profile?.role_display || profile?.role || "—"; const address = [profile?.address, profile?.district].filter(Boolean).join(", ") || "—"; return <section className="customer-report-summary"><div className="customer-summary-head"><strong>Customer Summary</strong><button onClick={onClear} aria-label="Clear customer">×</button></div><div className="customer-summary-grid"><SummaryValue label="Customer" value={name}/><SummaryValue label="Code" value={code}/><SummaryValue label="Phone" value={phone}/><SummaryValue label="Type" value={type}/><SummaryValue label="Total Loans" value={loans.length || "—"}/><SummaryValue label="Address" value={address}/><SummaryValue label="Total Outstanding" value={money(outstanding)}/><SummaryValue label="Total Pending" value={money(pending)}/></div></section>; }
function SummaryValue({ label, value }) { return <div><small>{label}</small><strong>{value}</strong></div>; }

function CustomerCollectionSummary({ profile, loans, outstanding, pending, onClear }) {
  const [tab, setTab] = useState("receivable");
  const value = item => item === null || item === undefined || item === "" ? "—" : item;
  const receivable = profile?.receivable_schedule || [], payable = profile?.payable_schedule || [];
  const receivableSummary = profile?.receivable_summary || {}, payableSummary = profile?.payable_summary || {};
  const rows = tab === "receivable" ? receivable : payable;
  return <section className="customer-report-summary customer-collection-details"><div className="customer-summary-head"><strong>Overall Collection Details</strong><button onClick={onClear} aria-label="Clear customer">×</button></div><div className="customer-summary-grid"><SummaryValue label="Customer" value={profile?.customer_name || profile?.full_name || "—"}/><SummaryValue label="Code" value={profile?.customer_code || profile?.code || "—"}/><SummaryValue label="Phone" value={profile?.phone || profile?.primary_mobile || "—"}/><SummaryValue label="Type" value={profile?.customer_type || profile?.role_display || profile?.role || "—"}/><SummaryValue label="Total Loans" value={loans.length || "—"}/><SummaryValue label="Total Outstanding" value={money(outstanding)}/><SummaryValue label="Total Pending" value={money(pending)}/><SummaryValue label="Overall Receivable" value={money(receivableSummary.overall)}/></div><div className="collection-split-tabs"><button className={tab === "receivable" ? "active" : ""} onClick={() => setTab("receivable")}>Receivable <b>{money(receivableSummary.overall)}</b></button><button className={tab === "payable" ? "active" : ""} onClick={() => setTab("payable")}>Payable <b>{money(payableSummary.overall)}</b></button></div><div className="collection-split-summary">{tab === "receivable" ? <><SummaryValue label="Outstanding" value={money(receivableSummary.outstanding)}/><SummaryValue label="Pending" value={money(receivableSummary.pending)}/><SummaryValue label="Overdue" value={money(receivableSummary.overdue)}/></> : <><SummaryValue label="Paid" value={money(payableSummary.paid ?? payableSummary.overall)}/><SummaryValue label="Fully Paid" value={money(payableSummary.fully_paid)}/><SummaryValue label="Partial Paid" value={money(payableSummary.partial_paid)}/></>}</div><div className="collection-split-table-wrap"><table><thead><tr>{tab === "receivable" ? <><th>S.No</th><th>Due Date</th><th>Duration</th><th>Installment</th><th>Receivable Balance</th><th>Status</th></> : <><th>S.No</th><th>Payment Date</th><th>Due Date</th><th>Duration</th><th>Installment</th><th>Paid Amount</th><th>Status</th></>}</tr></thead><tbody>{rows.map((row,index) => <tr key={row.id || `${row.loan_id}-${row.cycle}-${index}`}>{tab === "receivable" ? <><td>{index + 1}</td><td>{value(row.date)}</td><td>{value(row.duration)} · {value(row.cycle)}</td><td>{money(row.amount)}</td><td>{money(row.balance)}</td><td><span className="report-status">{value(row.status)}</span></td></> : <><td>{index + 1}</td><td>{value(row.payment_date)}</td><td>{value(row.date)}</td><td>{value(row.duration)} · {value(row.cycle)}</td><td>{money(row.amount)}</td><td>{money(row.paid)}</td><td><span className="report-status">{value(row.status)}</span></td></>}</tr>)}</tbody></table>{!rows.length && <div className="report-empty">No {tab} records found.</div>}</div></section>;
}

CustomerSummary = CustomerCollectionSummary;


const dayLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
function Chevron({ open }) {
  return <svg className="row-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d={open ? "M4 6l4 4 4-4" : "M6 4l4 4-4 4"}/></svg>;
}
function InstallmentBreakdown({ installments }) {
  return <div className="installment-detail-panel"><table className="installment-breakdown">
    <colgroup><col className="col-sno"/><col className="col-date"/><col/><col className="col-receipt"/><col/></colgroup>
    <thead><tr><th>S.No</th><th>Due Date</th><th className="num">Original Due Amount</th><th className="num">Collected Amount / Receipt</th><th className="num">Remaining Due Balance</th></tr></thead>
    <tbody>{installments.map((due, index) => <tr key={due.id}>
      <td>{due.installment_number ?? index + 1}</td>
      <td>{dayLabel(due.due_date)}</td>
      <td className="num">{money(due.scheduled)}</td>
      <td className="num"><span className="installment-collected">{money(due.paid)}</span>{(due.collections || []).map(receipt => <span className="installment-receipt" key={receipt.id}><b>{receipt.voucher}</b> {dayLabel(receipt.date)}{receipt.particulars && receipt.particulars !== "Collection" ? ` (${receipt.particulars})` : ""} {money(receipt.amount)}</span>)}</td>
      <td className="num">{money(due.balance)}</td>
    </tr>)}
    {!installments.length && <tr><td colSpan="5" className="installment-empty">No saved installments for this loan.</td></tr>}</tbody>
  </table></div>;
}
function TotalOutstandingTable({ rows, onOpen }) {
  const [page,setPage]=useState(0), [expanded,setExpanded]=useState({});
  useEffect(()=>{setPage(0);setExpanded({});},[rows]);
  const size=25,count=Math.max(1,Math.ceil(rows.length/size));
  const headers=["Customer","Loan Number","Total Due","Collected","Remaining Balance","Unallocated Others"];
  const toggle = id => setExpanded(old => ({ ...old, [id]: !old[id] }));
  return <><div className="report-table-wrap report-essential-table data-container"><table className="report-table total-outstanding-table"><thead><tr>{headers.map((header,i)=><th key={header} className={i>=2?"num":""}>{header}</th>)}</tr></thead><tbody>
    {rows.slice(page*size,(page+1)*size).map(row=>{ const open = Boolean(expanded[row.loan_id]); return <Fragment key={row.loan_id}><tr className={`clickable-data-row total-parent-row${open ? " is-expanded" : ""}`} tabIndex={0} aria-expanded={open} title={open ? "Hide installments" : "Show installments"} onClick={()=>toggle(row.loan_id)} onDoubleClick={event=>{ if(!event.target.closest("button,a,input")) onOpen(row.loan_id); }} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();toggle(row.loan_id);}}}><td>{row.customer}</td><td><span className="total-loan-cell"><Chevron open={open}/><span>{row.loan_no}</span></span></td>{[row.total_payable,row.paid,row.outstanding,row.unallocated_others].map((amount,i)=><td className="num" key={i}>{money(amount)}</td>)}</tr>{open && <tr className="installment-detail-row"><td colSpan={6}><InstallmentBreakdown installments={row.installments || []}/></td></tr>}</Fragment>; })}
    {!rows.length && <tr><td colSpan="6">No outstanding receivables for these filters.</td></tr>}
  </tbody><tfoot><tr><td colSpan="2">Total</td>{["total_payable","paid","outstanding","unallocated_others"].map(key=><td className="num" key={key}>{money(rows.reduce((sum,row)=>sum+number(row[key]),0))}</td>)}</tr></tfoot></table></div>
    <div className="ledger-outstanding-pagination"><button type="button" disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} of {count}</span><button type="button" disabled={page+1>=count} onClick={()=>setPage(p=>p+1)}>Next</button></div></>;
}
