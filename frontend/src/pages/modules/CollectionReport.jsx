import { useEffect, useMemo, useRef, useState } from "react";
import "./collection-report.css";
import "./collection-report-histogram.css";
import "./collection-report-split.css";
import "./pending-report-table.css";
import { formatINR } from "../../utils/currency";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { downloadReceipt, printReceipt } from "../../utils/collectionReceipt";
import { useCompanyProfile } from "../../components/CompanyProfileContext";

import { creationDate, fetchAllPages, filterPendingRows, localToday, overdueDays } from "../../utils/pendingReport";

const money = formatINR;
const initial = { from: "", to: "", search: "", status: "", loan_number: "", customer_type: "", customer_code: "" };
const number = value => Number(value || 0);

export default function CollectionReport({ api, auth, initialView = "pending" }) {
  const [view, setView] = useState(initialView), [filters, setFilters] = useState(initial);
  const [data, setData] = useState({ summary: {}, results: [] }), [mode, setMode] = useState("numeric");
  const [matches, setMatches] = useState([]), [customer, setCustomer] = useState(null), [customerData, setCustomerData] = useState(null), [error, setError] = useState("");
  const [performance, setPerformance] = useState(false), [moreMetrics, setMoreMetrics] = useState(false), [detail, setDetail] = useState(null), [activeMatch, setActiveMatch] = useState(0);
  const performanceRef = useRef(null), searchTimer = useRef(null);
  const { profile: companyProfile, refreshProfile } = useCompanyProfile() || {};
  const [receiptBusy, setReceiptBusy] = useState(null);
  const [entryDates, setEntryDates] = useState([]);
  const today = localToday();
  const selectedCustomerId = view === "outstanding" && filters.customer_code
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
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const endpoint = view === "history" ? "/finance/collection-history/" : view === "outstanding" ? "/finance/reports/loan-wise/" : "/finance/reports/day-wise/";
        const params = view === "pending" ? { to: today } : { ...filters, customer_id: selectedCustomerId,
          ...(view === "outstanding" ? { to: filters.to && filters.to < today ? filters.to : today } : {}) };
        const response = await api.get(endpoint, { ...auth, params });
        if (active) { setData(response.data || { summary: {}, results: [] }); setError(""); }
      } catch { if (active) setError("Unable to load report data."); }
    }, view === "history" && filters.search ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [view, today, view !== "pending" ? JSON.stringify(filters) : "", view !== "pending" ? selectedCustomerId : ""]);
  useEffect(() => {
    if (view === "history") return;
    let active = true;
    setEntryDates([]);
    fetchAllPages(api, view === "outstanding" ? "/finance/loans/?status=ALL" : "/finance/customer-loan-installments/", auth)
      .then(rows => { if (active) setEntryDates(rows); })
      .catch(() => { if (active) setError("Unable to load voucher creation dates."); });
    return () => { active = false; };
  }, [view]);
  useEffect(() => { clearTimeout(searchTimer.current); if (customer || filters.search.trim().length < 1) { setMatches([]); return; } searchTimer.current = setTimeout(() => api.get("/customers/search/", { ...auth, params: { q: filters.search.trim() } }).then(response => setMatches(response.data || [])).catch(() => setMatches([])), 350); return () => clearTimeout(searchTimer.current); }, [filters.search, customer]);
  useEffect(() => { if (!customer?.id || view === "history") { setCustomerData(null); return; } api.get(`/finance/reports/customer/${customer.id}/`, auth).then(response => setCustomerData(response.data || null)).catch(() => setCustomerData(null)); }, [customer, view]);
  useEffect(() => { const close = event => { if (performanceRef.current && !performanceRef.current.contains(event.target)) setPerformance(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  const update = (key, value) => { if (key === "search") { setCustomer(null); setCustomerData(null); } setFilters(current => ({ ...current, ...(key === "search" ? { customer_code: "" } : {}), [key]: value })); };
  const chooseCustomer = item => { setCustomer(item); setCustomerData(null); setFilters(current => ({ ...current, search: item.customer_name, customer_code: item.customer_code || "" })); setMatches([]); };
  const reset = () => { setFilters(initial); setCustomer(null); setCustomerData(null); setPerformance(false); setMoreMetrics(false); };
  const reportRows = useMemo(() => {
    const dates = new Map(entryDates.map(entry => [view === "outstanding" ? String(entry.id) : `${entry.loan}-${entry.installment_number}`, entry]));
    return (data.results || []).map(row => {
      const entry = dates.get(view === "outstanding" ? String(row.loan_id) : `${row.loan_id}-${row.installment_number}`);
      const due = view === "outstanding" ? filterPendingRows((entry?.installments || []).map(item => ({ ...row, ...item, paid: item.paid_amount, status: item.due_date < today ? "OVERDUE" : Number(item.paid_amount) > 0 ? "PARTIAL" : "PENDING" })), { from: filters.from, to: filters.to, status: filters.status }, today).map(item => item.due_date).sort()[0] : row.due_date;
      return { ...row, voucher_date: entry?.create_date, due_date: due, days_overdue: overdueDays(due, today), installments: entry?.installments || [] };
    });
  }, [data.results, entryDates, view, today, filters.from, filters.to, filters.status]);
  const rows = useMemo(() => {
    if (view === "history") return (data.results || []).filter(row => number(row.paid ?? row.paid_amount) > 0);
    if (view === "outstanding") return reportRows.filter(row => Number(row.outstanding) > 0 && row.due_date && row.due_date <= today);
    return filterPendingRows(reportRows, filters, today);
  }, [data.results, reportRows, filters, view, today]);
  const optionRows = view === "outstanding" ? entryDates.map(entry => ({ loan_no: entry.loan_no, customer_code: entry.customer?.code, customer: entry.customer?.name })) : data.results || [];
  const customers = [...new Map(optionRows.map(row => [row.customer_code, row.customer])).entries()].filter(([code]) => code);
  const loans = [...new Set(optionRows.map(row => row.loan_no).filter(Boolean))];
  const sum = key => rows.reduce((total, row) => total + number(row[key]), 0);
  const summary = view === "history" ? data.summary || {} : view === "pending"
    ? { ...data.summary, scheduled: sum("scheduled"), payable: sum("scheduled"), collected: sum("paid"), outstanding: sum("balance"), overdue: rows.filter(row => row.days_overdue > 0).reduce((total, row) => total + number(row.balance), 0) }
    : { ...data.summary, principal: sum("principal"), payable: sum("total_payable"), collected: sum("paid"), outstanding: sum("outstanding") };
  const title = view === "pending" ? "Pending & Outstanding" : view === "outstanding" ? "Outstanding" : "Collection History";
  const searchPlaceholder = view === "history" ? "Search customer / loan / receipt..." : "Search customer / loan / phone...";
  const keyDown = event => { if (!matches.length) return; if (event.key === "ArrowDown") { event.preventDefault(); setActiveMatch(value => (value + 1) % matches.length); } else if (event.key === "ArrowUp") { event.preventDefault(); setActiveMatch(value => (value - 1 + matches.length) % matches.length); } else if (event.key === "Enter") { event.preventDefault(); chooseCustomer(matches[activeMatch]); } else if (event.key === "Escape") setMatches([]); };
  const selectedProfile = customerData ? { ...customerData.customer, receivable_schedule: customerData.receivable_schedule || [], payable_schedule: customerData.payable_schedule || [], receivable_summary: customerData.receivable_summary || {}, payable_summary: customerData.payable_summary || {} } : customer;
  const profileLoans = customerData?.loans || [];
  const profileOutstanding = customerData?.receivable_summary?.outstanding ?? customerData?.payable_summary?.outstanding ?? rows.reduce((sum, row) => sum + number(row.outstanding), 0);
  const profilePending = customerData?.receivable_summary?.pending ?? rows.reduce((sum, row) => sum + number(row.balance), 0);
  return <div className="collection-report-page report-redesign"><div className="report-topbar"><button className="report-breadcrumb" type="button" aria-label="Back" title="Back" onClick={() => window.history.back()}>← Reports / <strong>{title}</strong></button><div className="report-top-actions"><div className="report-search-wrap"><input value={filters.search} onChange={event => update("search", event.target.value)} onKeyDown={keyDown} placeholder={searchPlaceholder}/>{matches.length > 0 && <div className="customer-suggestions">{matches.map((item, index) => <button className={index === activeMatch ? "active" : ""} key={item.id} onMouseDown={() => chooseCustomer(item)}>{item.customer_name} | {item.customer_code} | {item.phone}</button>)}</div>}</div><div className="performance-wrapper" ref={performanceRef}><button className="performance-button" aria-expanded={performance} onClick={() => setPerformance(value => !value)}>Performance <span>{performance ? "⌃" : "⌄"}</span></button>{performance && <PerformancePanel view={view} summary={summary} mode={mode} setMode={setMode} more={moreMetrics} setMore={setMoreMetrics}/>}</div><button className="report-pdf" onClick={() => window.print()}>PDF</button></div></div><main className="collection-report-container report-redesign-container"><div className="report-filter-bar compact-report-filters">
        {view !== "history" && <label>Customer<select value={filters.customer_code} onChange={event => { update("search", ""); update("customer_code", event.target.value); }}><option value="">All Customers</option>{customers.map(([code, name]) => <option key={code} value={code}>{name} | {code}</option>)}</select></label>}
        <label>Status<select value={filters.status} onChange={event => update("status", event.target.value)}><option value="">{view === "history" ? "All Statuses" : "All Status"}</option>{view === "history" && <option value="PAID">Paid</option>}<option value="PENDING">Pending</option><option value="OUTSTANDING">Outstanding</option><option value="OVERDUE">Overdue</option></select></label>
        <label>{view === "history" ? "From Date" : "Date Range - From"}<input aria-label="Date Range From" max={view !== "history" ? today : undefined} type="date" value={filters.from} onChange={event => update("from", event.target.value)}/></label>
        <label>To Date<input aria-label="Date Range To" max={view !== "history" ? today : undefined} type="date" value={filters.to} onChange={event => update("to", event.target.value)}/></label>
        <label>Loan Number<select value={filters.loan_number} onChange={event => update("loan_number", event.target.value)}><option value="">All Loan Numbers</option>{loans.map(loan => <option key={loan}>{loan}</option>)}</select></label>
        {view === "history" && <label>Customer Type<select value={filters.customer_type} onChange={event => update("customer_type", event.target.value)}><option value="">All Customer Types</option><option value="BORROWER">Borrower</option><option value="LENDER">Lender</option><option value="BOTH">Both</option></select></label>}
        <button className="report-reset" onClick={reset}>Reset</button>
      </div>{error && <div className="report-error">{error}</div>}{customer && <CustomerSummary profile={selectedProfile} loans={profileLoans} outstanding={profileOutstanding} pending={profilePending} onClear={() => update("search", "")}/>} {mode === "numeric" ? <ReportTable rows={rows} view={view} customerSelected={Boolean(customer)} onDetail={setDetail} onReceipt={receipt} receiptBusy={receiptBusy}/> : <Histogram rows={rows}/>} {detail && <DetailDialog row={detail} view={view} onClose={() => setDetail(null)}/>}</main></div>;
}

function PerformancePanel({ view, summary, mode, setMode, more, setMore }) { const value = key => summary[key] ?? 0; const cards = view === "pending" ? [["Total Pending", value("pending") ?? value("outstanding")], ["Overdue", value("overdue")], ["Partial", value("partial")], ["Upcoming", value("upcoming")]] : view === "outstanding" ? [["Total Outstanding", value("outstanding")], ["Customers", value("customers")], ["Loans", value("loans")], ["Overdue Amount", value("overdue")]] : [["Total Collected", value("collected")], ["Transactions", value("transactions")], ["Cash", value("cash")], ["Digital", value("digital")]]; return <section className="performance-panel"><div className="performance-panel-title"><strong>Performance Summary</strong><div className="report-mode-toggle"><button className={mode === "numeric" ? "active" : ""} onClick={() => setMode("numeric")}>Numeric</button><button className={mode === "chart" ? "active" : ""} onClick={() => setMode("chart")}>Histogram</button></div></div><div className="performance-cards">{cards.map(([label, metric]) => <article key={label}><small>{label}</small><strong>{money(metric)}</strong></article>)}</div><button className="performance-more" onClick={() => setMore(value => !value)}>{more ? "View Less" : "View More"} <span>{more ? "⌃" : "⌄"}</span></button>{more && <div className="performance-extra"><span>Scheduled / Payable <b>{money(summary.scheduled ?? summary.payable)}</b></span><span>Paid <b>{money(summary.paid ?? summary.collected)}</b></span><span>Pending Balance <b>{money(summary.pending ?? summary.outstanding)}</b></span></div>}</section>; }
function ReportTable({ rows, view, onDetail, onReceipt, receiptBusy }) { const history = view === "history"; const headers = view === "pending" ? ["S.No", "Voucher Date", "Customer", "Loan No", "Due Date", "Due Amount", "Balance", "OVERDUE DAYS"] : view === "outstanding" ? ["S.No", "Voucher Date", "Customer", "Loan No", "Plan", "Total Amount", "Outstanding", "OVERDUE DAYS"] : ["S.No", "Date", "Customer", "Loan No", "Amount", "Mode", "Status", "Receipt"]; const onRowKey = (event, row) => { if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button,a,input,select,textarea")) { event.preventDefault(); onDetail(row); } }; return <div className="report-table-wrap report-essential-table"><table className={`report-table report-table-${view}`}><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="clickable-data-row" tabIndex="0" key={(row.id || row.loan_id || "row") + index} onClick={() => onDetail(row)} onKeyDown={event => onRowKey(event, row)}>{view === "pending" && <><td>{index + 1}</td><td>{creationDate(row.voucher_date)}</td><td>{row.customer}</td><td>{row.loan_no}</td><td>{row.due_date}</td><td>{money(row.scheduled ?? row.due_amount)}</td><td>{money(row.balance ?? row.outstanding)}</td><td>{row.days_overdue > 0 ? `${row.days_overdue} ${row.days_overdue === 1 ? "Day" : "Days"}` : ""}</td></>}{view === "outstanding" && <><td>{index + 1}</td><td>{creationDate(row.voucher_date)}</td><td>{row.customer}</td><td>{row.loan_no}</td><td>{row.loan_type || row.plan || "—"}</td><td>{money(row.total_payable)}</td><td>{money(row.outstanding)}</td><td>{row.days_overdue > 0 ? `${row.days_overdue} ${row.days_overdue === 1 ? "Day" : "Days"}` : ""}</td></>}{history && <><td>{index + 1}</td><td>{row.payment_date}</td><td>{row.customer}</td><td>{row.loan_no}</td><td>{money(row.paid ?? row.paid_amount)}</td><td>{row.payment_mode || row.mode || "—"}</td><td><Badge value={row.status}/></td><td className="report-receipt-cell"><ReceiptActions row={row} onReceipt={onReceipt} busy={receiptBusy}/></td></>}</tr>)}</tbody></table>{!rows.length && <div className="report-empty">No records found.</div>}</div>; }
function ReceiptActions({ row, onReceipt, busy }) {
  const button = (action, label, icon) => <button type="button" className={`report-receipt-button receipt-${action}`} aria-label={`${label} receipt`} title={`${label} receipt`} disabled={Boolean(busy)} onClick={event => { event.stopPropagation(); onReceipt(row, action); }} onKeyDown={event => event.stopPropagation()}>{busy === `${action}-${row.id}` ? <span className="report-receipt-spinner" aria-hidden="true"/> : icon}</button>;
  return <div className="report-receipt-actions">{button("pdf", "Download PDF", <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M12 12v6m-3-3 3 3 3-3"/></svg>)}{button("print", "Print", <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></svg>)}</div>;
}
function Badge({ value }) { return <span className={`report-status status-${String(value || "Pending").toLowerCase()}`}>{value || "Pending"}</span>; }
function Histogram({ rows }) { return <div className="report-histogram simple-histogram">{rows.slice(0, 12).map((row, index) => <div className="histogram-column" key={index}><strong>{money(row.paid ?? row.scheduled ?? row.outstanding)}</strong><div className="histogram-bar" style={{ height: "80px" }}/><small>{row.due_date || row.payment_date || row.loan_no}</small></div>)}</div>; }
function DetailDialog({ row, view, onClose }) { const fields = view === "pending" ? [["Customer", row.customer], ["Loan / Plan", row.loan_type || row.plan], ["Installment No", row.installment_number], ["Scheduled Amount", money(row.scheduled)], ["Paid", money(row.paid)], ["Balance", money(row.balance)], ["Payment Date", row.payment_date], ["Due Date", row.due_date], ["Days Overdue", row.days_overdue], ["Status", row.status]] : view === "outstanding" ? [["Customer", row.customer], ["Loan No", row.loan_no], ["Plan", row.loan_type || row.plan], ["Start Date", row.start_date], ["Principal", money(row.principal)], ["Total Payable", money(row.total_payable)], ["Paid", money(row.paid)], ["Outstanding", money(row.outstanding)], ["Status", row.status || row.loan_status]] : [["Collection Date", row.payment_date], ["Customer", row.customer], ["Loan No", row.loan_no], ["Due Amount", money(row.due_amount ?? row.scheduled)], ["Collected Amount", money(row.paid ?? row.paid_amount)], ["Payment Mode", row.payment_mode || row.mode], ["Reference", row.reference || row.utr || row.cheque_no], ["Collected By", row.collected_by], ["Status", row.status]]; return <div className="report-detail-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="report-detail-dialog" role="dialog" aria-modal="true"><header><strong>Report Details</strong><button onClick={onClose} aria-label="Close">×</button></header><div className="report-detail-grid">{fields.map(([label, value]) => <div key={label}><small>{label}</small><b>{value || "—"}</b></div>)}</div><footer><button onClick={onClose}>Close</button></footer></section></div>; }
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
