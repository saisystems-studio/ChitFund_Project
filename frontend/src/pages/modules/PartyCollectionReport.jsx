import { fetchAllPages, localToday } from "../../utils/pendingReport";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { useEffect, useMemo, useState } from "react";
import { formatINR } from "../../utils/currency";
import apiErrorMessage from "../../utils/apiErrorMessage";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import { DUE_WISE, PARTY_COLLECTION_TYPES } from "../collections/PartyCollection";
import "./report-common.css";
import "../collections/party-collection.css";
import { rowDetail } from "../reportDetail/reportDetailRoute";

// Party Collection Report: Due-wise parties show each due (Original / Collected / Pending)
// with the Unallocated Advance and Net Outstanding; Consolidated parties show only Total
// Due, Total Collection and Outstanding. Outstanding is the party ledger's actual balance.
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const drCr = (amount, type) => `${formatINR(amount)} ${type === "CR" ? "Cr" : "Dr"}`;

// Which record a ledger entry opens on double-click (null when it has no record of its own).
const entryTarget = entry => {
  const id = String(entry.id ?? "");
  if (id.startsWith("due-")) return ["voucher", `DUE-${id.slice(4).padStart(6, "0")}`];
  if (/^(collection|loan-receipt|charge-receipt|payment|journal)-/.test(id) && entry.reference) return ["voucher", entry.reference];
  return [];
};

function SavedPartyCollectionReport({ api, auth, go, onScopeChange }) {
  const [parties, setParties] = useState([]), [partyId, setPartyId] = useState("");
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(""), [exportBusy, setExportBusy] = useState(null);
  const { profile } = useCompanyProfile() || {};
  useEffect(() => { api.get("/finance/ledgers/", auth).then(({ data }) => setParties((data.results ?? data).filter(item => !["Cash-in-Hand", "Bank Accounts"].includes(item.group)))).catch(() => setError("Unable to load parties.")); }, []);
  useEffect(() => {
    if (!partyId) { setData(null); return undefined; }
    let active = true;
    setLoading(true);
    api.get("/finance/party-collections/summary/", { ...auth, params: { party: partyId } })
      .then(({ data }) => { if (active) { setData(data); setError(""); } })
      .catch(requestError => { if (active) { setData(null); setError(apiErrorMessage(requestError, "Unable to load the Party Collection Report.")); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [partyId]);
  const isDueWise = data?.collection_type === DUE_WISE;
  const title = "Pending & Outstanding Report";
  const filtersLine = data ? `Party: ${data.party_name}   •   ${(PARTY_COLLECTION_TYPES[data.collection_type] || "Ledger Collections")}` : "";
  // One table shape drives the screen and both exports.
  const table = useMemo(() => {
    if (!data) return null;
    if (isDueWise) return {
      columns: [["Date"], ["Due Number"], ["Original Due", true], ["Collected Amount", true], ["Pending Amount", true]],
      targets: data.dues.map(row => ["voucher", row.voucher_no]),
      rows: data.dues.map(row => [dateLabel(row.due_date), row.due_number, formatINR(row.amount), formatINR(row.collected), formatINR(row.pending)]),
      summary: [["Total", formatINR(data.total_due), formatINR(data.total_collected), formatINR(data.total_pending)], ["Unallocated Advance", "", "", formatINR(data.unallocated_advance)], ["Net Outstanding", "", "", drCr(data.outstanding, data.outstanding_type)]],
    };
    return {
      columns: [["Date"], ["Particulars"], ["Debit (Dr)", true], ["Credit (Cr)", true]],
      targets: (data.entries || []).map(entryTarget),
      rows: (data.entries || []).map(row => [dateLabel(row.date), `${row.particulars}${row.reference ? ` - ${row.reference}` : ""}`, Number(row.debit) ? formatINR(row.debit) : "-", Number(row.credit) ? formatINR(row.credit) : "-"]),
      summary: [["Closing Due / Collection Balance", drCr(data.due_balance, data.due_balance_type)], ["Pending Outstanding", formatINR(data.remaining_outstanding)], ["Unallocated Credit", formatINR(data.unallocated_credit)]],
    };
  }, [data, isDueWise]);
  const span = table ? table.columns.length - (table.summary[0].length - 1) : 1;
  const exportPdf = async (mode = "pdf") => {
    if (exportBusy || !table) return;
    setExportBusy(mode);
    try {
      await (mode === "print" ? printReportPdf : downloadReportPdf)({
        title, filtersLine, profile, summaryAtBottom: true,
        columns: table.columns.map(([header, numeric]) => ({ header, align: numeric ? "right" : "left" })),
        rows: table.rows,
        summaryRows: table.summary.map(([label, ...values], index) => ({ cells: [{ content: label, colSpan: span, styles: { halign: "right" } }, ...values], bold: index === table.summary.length - 1 })),
      }, reportFilename("Party_Collection_Report", data.party_name));
    } catch { setError("Unable to prepare the PDF."); }
    finally { setExportBusy(null); }
  };
  const exportExcel = async () => {
    if (exportBusy || !table) return;
    setExportBusy("excel");
    try {
      await downloadReportExcel({
        filename: reportFilename("Party_Collection_Report", data.party_name), title, subtitle: filtersLine,
        columns: table.columns.map(([header]) => ({ header, width: 20 })), rows: table.rows,
        summaryRows: table.summary.map(([label, ...values]) => [label, ...new Array(span - 1).fill(""), ...values]),
      });
    } finally { setExportBusy(null); }
  };
  return <div className="rpt-page data-page">
    <div className="rpt-header-row">
      <PageBreadcrumb className="rpt-breadcrumb" current={title} />
      <div className="rpt-toolbar rpt-toolbar-pinned">
        {onScopeChange && <select aria-label="Report scope" value="ledger" onChange={event => onScopeChange(event.target.value)} style={{width:"auto",margin:0}}><option value="loans">Loan Dues</option><option value="total">Total Outstanding</option><option value="ledger">Ledger Dues &amp; Others</option></select>}
        {loading && <span className="rpt-loading">Updating…</span>}
        {error && <span className="rpt-error" role="alert">{error}</span>}
        <label className="rpt-field" style={{ minWidth: 240 }}>Ledger
          <SearchableSelect value={partyId} onChange={event => setPartyId(event.target.value)} searchPlaceholder="Search ledger..."><option value="">Select Ledger</option>{parties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SearchableSelect>
        </label>
        <ReportExportButtons portal onPdf={() => exportPdf()} onExcel={exportExcel} onPrint={() => exportPdf("print")} busy={exportBusy} disabled={!table || loading} />
      </div>
    </div>
    <div className="rpt-card rpt-table-card data-container">
      {data && <div className="pc-cards" style={{ margin: "12px 12px 0" }}>
        <div className="pc-summary-card"><span>Collection Type</span><strong>{(PARTY_COLLECTION_TYPES[data.collection_type] || "Ledger Collections")}</strong></div>
        <div className="pc-summary-card"><span>Consolidated Ledger Balance</span><strong>{drCr(data.outstanding, data.outstanding_type)}</strong></div>
        <div className="pc-summary-card"><span>Pending Outstanding</span><strong>{formatINR(data.remaining_outstanding)}</strong></div>
        {isDueWise && <div className="pc-summary-card"><span>Unallocated Advance</span><strong>{formatINR(data.unallocated_advance)}</strong></div>}
      </div>}
      <div className="rpt-table-wrap data-table-area">
        <table className="rpt-table">
          <thead><tr>{(table?.columns || [["Party Collection"]]).map(([header, numeric]) => <th key={header} className={numeric ? "num" : ""}>{header}</th>)}</tr></thead>
          <tbody>
            {table?.rows.map((row, index) => <tr key={index} {...rowDetail(go, ...(table.targets?.[index] || []))}>{row.map((cell, cellIndex) => <td key={cellIndex} className={table.columns[cellIndex][1] ? "num" : ""}>{cell}</td>)}</tr>)}
            {!table && <tr className="rpt-empty-row"><td><strong>{partyId ? "Loading…" : "Select a party"}</strong><span>Select a ledger to see its saved dues and collections.</span></td></tr>}
            {table && !table.rows.length && <tr className="rpt-empty-row"><td colSpan={table.columns.length}><strong>No saved dues or collections for this ledger.</strong></td></tr>}
          </tbody>
          {table && <tfoot>{table.summary.map(([label, ...values]) => <tr key={label}><td colSpan={span} className="num"><strong>{label}</strong></td>{values.map((value, index) => <td key={index} className="num"><strong>{value}</strong></td>)}</tr>)}</tfoot>}
        </table>
      </div>
    </div>
  </div>;
}


export default function PartyCollectionReport(props) {
  return props.onScopeChange ? <LedgerOutstandingView {...props}/> : <SavedPartyCollectionReport {...props}/>;
}

function LedgerOutstandingView({ api, auth, go, onScopeChange, customerId, customerCode, onCustomerChange, initialFrom = "", initialTo = "", onDatesChange }) {
  const [ledgers, setLedgers] = useState([]), [ledgerId, setLedgerId] = useState("");
  const [from, setFrom] = useState(initialFrom), [to, setTo] = useState(initialTo);
  const [search, setSearch] = useState(""), [data, setData] = useState(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [exportBusy, setExportBusy] = useState(null), [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const { profile } = useCompanyProfile() || {};
  const [dueScope,setDueScope] = useState("current");
  const cutoff = to || localToday();
  useEffect(() => {
    let active = true;
    // Customer-linked Party Ledgers and ledgers with saved dues/receipts; the customer picked
    // in Loan Dues / Total Outstanding opens its own Party Ledger directly.
    fetchAllPages(api, "/finance/party-collections/ledger-options/", auth).then(rows => {
      if (!active) return;
      setLedgers(rows);
      const match = rows.find(row => (customerId && String(row.customer) === String(customerId)) || (customerCode && row.customer_code === customerCode));
      if (match) setLedgerId(String(match.id));
    }).catch(requestError => { if (active) setError(apiErrorMessage(requestError, "Unable to load ledgers.")); });
    return () => { active = false; };
  }, []);
  const chooseLedger = value => { setLedgerId(value); onCustomerChange?.(ledgers.find(row => String(row.id) === String(value))?.customer_code || ""); };
  useEffect(() => {
    setPage(0); setData(null);
    if (!ledgerId) { setLoading(false); setError(""); return; }
    let active = true; setLoading(true); setError("");
    const timer = setTimeout(() => {
      api.get("/finance/party-collections/summary/", { ...auth, params: { view:"ledger", party:ledgerId, from:from || undefined, to:cutoff, search, due_scope:dueScope } })
        .then(({ data }) => { if (active) setData(data); })
        .catch(e => { if (active) setError(apiErrorMessage(e, "Unable to load Ledger Outstanding.")); })
        .finally(() => { if (active) setLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [ledgerId, from, cutoff, search, dueScope, retry]);
  const signed = value => `${formatINR(Math.abs(Number(value || 0)))} ${Number(value) < 0 ? "Cr" : "Dr"}`;
  const summaries = data ? [
    ["Total Due", formatINR(data.total_due)], ["Total Allocated Collection", formatINR(data.allocated_collection)],
    ["Due-wise Pending (through cutoff)", formatINR(data.due_pending)], ["Unallocated Others", formatINR(data.unallocated_others)],
    [dueScope === "all_saved" ? "Scheduled Ledger Balance (including future dues)" : "Net Ledger Outstanding", signed(data.closing_balance)], ["Future Receivables", formatINR(data.future_receivables)],
    ["Total Outstanding (including future)", formatINR(data.total_outstanding)],
  ] : [];
  const columns = ["Date", "Customer", "Particulars", "Voucher No", "Dr", "Cr", "Running Balance"];
  const customerName = data?.customer_name || data?.party_name;
  const allRows = (data?.entries || []).map(row => [dateLabel(row.date), customerName, row.particulars, row.reference, Number(row.debit) ? formatINR(row.debit) : "-", Number(row.credit) ? formatINR(row.credit) : "-", signed(row.balance)]);
  const subtitle = `Ledger: ${data?.party_name || ""} | From: ${from || "Beginning"} | Receipts through: ${cutoff} | Dues: ${dueScope === "all_saved" ? "All saved, including future" : "Through cutoff"}${search ? ` | Search: ${search}` : ""}`;
  const exportReport = async mode => {
    if (!data || exportBusy || loading) return;
    setExportBusy(mode);
    const rows = [["", customerName, "Opening Balance", "", "", "", signed(data.opening_balance)], ...allRows];
    try {
      if (mode === "excel") await downloadReportExcel({ filename:reportFilename("Ledger_Outstanding",data.party_name), title:"Pending & Outstanding - Ledger Outstanding", subtitle, columns:columns.map(header => ({ header, width:22 })), rows, summaryRows:summaries.map(([label,value])=>[label,"","","","","",value]) });
      else await (mode === "print" ? printReportPdf : downloadReportPdf)({ title:"Pending & Outstanding - Ledger Outstanding", filtersLine:subtitle, profile, summaryAtBottom:true, columns:columns.map((header,i)=>({header,align:i>=4?"right":"left"})), rows, summaryRows:summaries.map(([label,value])=>({cells:[{content:label,colSpan:6},value],bold:true})) },reportFilename("Ledger_Outstanding",data.party_name));
    } catch { setError("Unable to export Ledger Outstanding."); }
    finally { setExportBusy(null); }
  };
  const changeDates = (nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); onDatesChange?.(nextFrom,nextTo); };
  const size = 25, count = Math.max(1, Math.ceil(allRows.length / size));
  return <div className="collection-report-page report-redesign data-page">
    <div className="report-topbar"><PageBreadcrumb className="report-breadcrumb" current="Pending & Outstanding"/><div className="report-top-actions">
      <select aria-label="Report scope" value="ledger" onChange={e => onScopeChange(e.target.value)} style={{width:"auto",margin:0}}><option value="loans">Loan Dues</option><option value="total">Total Outstanding</option><option value="ledger">Ledger Outstanding</option></select>
      <div className="report-search-wrap"><input aria-label="Search ledger transactions" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search due / voucher / transaction..."/></div>
      <ReportExportButtons onPdf={()=>exportReport("pdf")} onPrint={()=>exportReport("print")} onExcel={()=>exportReport("excel")} busy={exportBusy} disabled={!data || loading}/>
    </div></div>
    <main className="collection-report-container report-redesign-container data-fill">
      {/* Status and Loan Number do not apply to a consolidated Party Ledger, so they are not shown. */}
      <div className="report-filter-bar compact-report-filters report-filter-row">
        <label className="f-wide">Customer / Party Ledger<SearchableSelect aria-label="Customer / Party Ledger" value={ledgerId} onChange={e=>chooseLedger(e.target.value)} searchPlaceholder="Search customer / ledger..."><option value="">Select Customer / Party Ledger</option>{ledgers.map(row=><option key={row.id} value={row.id}>{row.customer_code ? `${row.name} | ${row.customer_code}` : row.name}</option>)}</SearchableSelect></label>
        <label className="f-scope">Due Scope<select aria-label="Ledger due scope" value={dueScope} onChange={e=>setDueScope(e.target.value)}><option value="current">Through cutoff</option><option value="all_saved">All saved dues (including future)</option></select></label>
        <label className="f-date">From Date<input aria-label="From Date" type="date" value={from} onChange={e=>changeDates(e.target.value,to)}/></label>
        <label className="f-date">To Date<input aria-label="To Date" type="date" value={to} onChange={e=>changeDates(from,e.target.value)}/></label>
        <button className="report-reset" type="button" aria-label="Refresh" title="Refresh (reset filters and reload)" onClick={()=>{setSearch("");setDueScope("current");changeDates("","");setRetry(value=>value+1);}}>Refresh</button>
      </div>
      {error && <div className="report-error" role="alert">{error}</div>}
      {dueScope === "all_saved" && <p className="ledger-scope-note">Includes saved future dues at their original due dates. Receipts and allocations are included only through {cutoff}; the scheduled closing balance includes future dues.</p>}
      <div className="report-table-wrap report-essential-table data-container"><table className="report-table ledger-outstanding-table"><thead><tr>{columns.map((header,i)=><th key={header} className={i>=4?"num":""}>{header}</th>)}</tr></thead>
        <tbody>{data && <tr><td>-</td><td>{customerName}</td><td>{page?"Brought Forward":"Opening Balance"}</td><td/><td/><td/><td className="num">{signed(page ? data.entries[page*size-1]?.balance : data.opening_balance)}</td></tr>}
        {allRows.slice(page*size,(page+1)*size).map((row,index)=><tr key={data.entries[page*size+index].id} {...rowDetail(go, ...entryTarget(data.entries[page*size+index]))}>{row.map((cell,i)=><td key={i} className={i>=4?"num":""}>{cell}</td>)}</tr>)}
        {!allRows.length && <tr><td colSpan="7" className="ledger-empty">{loading ? "Loading transactions..." : error ? "Ledger transactions could not be loaded." : !ledgerId ? "Select a Customer / Party Ledger to view its Due, Collection and Others transactions." : data ? `No Due, Collection or Others transactions for ${customerName}${from ? ` from ${dateLabel(from)}` : ""} through ${dateLabel(cutoff)}${search ? ` matching "${search}"` : ""}.` : ""}</td></tr>}
        </tbody>{data && <tfoot>{summaries.map(([label,value])=><tr key={label}><td colSpan="6"><strong>{label}</strong></td><td className="num"><strong>{value}</strong></td></tr>)}</tfoot>}
      </table></div>
      {data && <div className="ledger-outstanding-pagination"><button type="button" disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} of {count}</span><button type="button" disabled={page+1>=count} onClick={()=>setPage(p=>p+1)}>Next</button></div>}
    </main>
  </div>;
}
