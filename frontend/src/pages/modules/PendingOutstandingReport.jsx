import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import { rowDetail } from "../reportDetail/reportDetailRoute";
import { DEFAULTS, balanceText, dateLabel, exportTable, filtersLine, ledgerLines, queryParams } from "./pendingOutstanding";
import "../../styles/report-layout.css";
import "./report-common.css";
import "./pending-outstanding.css";

const PAGE_SIZE = 25;
const money = formatINR;

// Searchable, clearable party picker (single or multiple). Nothing selected means All Parties.
function PartyPicker({ parties, value, onChange }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState("");
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const needle = search.trim().toLowerCase();
  const shown = parties.filter(item => !needle || `${item.name} ${item.code} ${item.phone}`.toLowerCase().includes(needle));
  const chosen = new Set(value);
  const toggle = id => onChange(chosen.has(id) ? value.filter(item => item !== id) : [...value, id]);
  const label = !value.length ? "All Parties" : value.length === 1 ? parties.find(item => item.id === value[0])?.name || "1 party" : `${value.length} parties selected`;
  return <div className="po-party" ref={root}>
    <button type="button" className="po-party-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}><span>{label}</span><i aria-hidden="true">⌄</i></button>
    {open && <div className="po-party-panel" role="listbox" aria-multiselectable="true">
      <input type="search" autoFocus placeholder="Search name / code / contact" aria-label="Search party" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="po-party-tools">
        <button type="button" onClick={() => onChange([...new Set([...value, ...shown.map(item => item.id)])])}>Select All</button>
        <button type="button" onClick={() => onChange([])} disabled={!value.length}>Clear Selection</button>
      </div>
      <ul>{shown.map(item => <li key={item.id}><label><input type="checkbox" checked={chosen.has(item.id)} onChange={() => toggle(item.id)} />
        <span><b>{item.name}</b><small>{[item.code, item.phone].filter(Boolean).join(" · ")}</small></span></label></li>)}
        {!shown.length && <li className="po-party-empty">No parties found.</li>}</ul>
    </div>}
  </div>;
}

export default function PendingOutstandingReport({ api, auth, go }) {
  const [draft, setDraft] = useState(DEFAULTS), [applied, setApplied] = useState(DEFAULTS);
  const [parties, setParties] = useState([]), [data, setData] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0), [page, setPage] = useState(1), [busy, setBusy] = useState(null);
  const { profile } = useCompanyProfile() || {};

  useEffect(() => { api.get("/finance/reports/pending-outstanding/parties/", auth).then(({ data: list }) => setParties(list)).catch(() => setError("Unable to load the party list.")); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get("/finance/reports/pending-outstanding/", { ...auth, params: queryParams(applied) })
      .then(({ data: result }) => { if (active) { setData(result); setError(""); setPage(1); } })
      .catch(requestError => { if (active) { setData(null); setError(apiErrorMessage(requestError, "Unable to load the report.")); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applied, retry]);

  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const apply = () => {
    if (draft.view === "multiple" && draft.from && draft.to && draft.from > draft.to) return setError("From Date cannot be after To Date.");
    setError(""); setApplied(draft); setRetry(value => value + 1);
  };
  const reset = () => { setDraft(DEFAULTS); setApplied(DEFAULTS); setError(""); };

  const multiple = applied.view === "multiple";
  const lines = useMemo(() => data?.view === "individual" ? ledgerLines(data.parties) : [], [data]);
  const total = data ? data.rows?.length ?? 0 : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const shownRows = data?.view === "multiple" ? data.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const partyNames = applied.parties.map(id => parties.find(item => item.id === id)?.name).filter(Boolean);
  const line = filtersLine(applied, partyNames, data?.as_of);
  const title = multiple ? "Pending & Outstanding - Due-wise" : "Pending & Outstanding - Party Ledger";
  const empty = !loading && data && (data.view === "multiple" ? !data.rows.length : !data.count);

  // Summary lines for the exports: Opening / Closing carry their balance in the Balance column,
  // Total carries DR and CR, exactly as on screen.
  const options = () => {
    const table = exportTable(data);
    if (data.view === "multiple") {
      return { table, pdfSummary: table.summary.map(cells => ({ cells: [{ content: cells[0], colSpan: 5, styles: { halign: "right" } }, ...cells.slice(1)], bold: true })),
        xlsSummary: table.summary.map(cells => ["Total", "", "", "", "", ...cells.slice(1)]) };
    }
    const isTotal = label => label.endsWith("Total");
    const pdfSummary = table.summary.map(([label, a, b]) => ({ cells: [{ content: label, colSpan: 6, styles: { halign: "right" } }, isTotal(label) ? a : "", isTotal(label) ? b : "", isTotal(label) ? "" : b ?? a], bold: !label.endsWith("Opening Balance") }));
    const xlsSummary = table.summary.map(([label, a, b]) => { const cells = new Array(9).fill(""); cells[0] = label; if (isTotal(label)) { cells[6] = a; cells[7] = b; } else cells[8] = b ?? a; return cells; });
    if (table.combined) {
      pdfSummary.push({ cells: [{ content: table.combined[0], colSpan: 6, styles: { halign: "right" } }, table.combined[1], table.combined[2], ""], bold: true });
      const cells = new Array(9).fill(""); [cells[0], cells[6], cells[7]] = table.combined; xlsSummary.push(cells);
    }
    return { table, pdfSummary, xlsSummary };
  };
  const exportAs = async mode => {
    if (busy || !data || empty) return;
    setBusy(mode);
    try {
      const { table, pdfSummary, xlsSummary } = options();
      if (mode === "excel") {
        const numeric = data.view === "multiple" ? new Set([5, 6, 7, 8]) : new Set([6, 7]);
        await downloadReportExcel({ filename: reportFilename("Pending_Outstanding", multiple ? "Due_wise" : "Party_Ledger"), title, subtitle: line,
          columns: table.columns.map((column, index) => ({ header: column.header, numeric: numeric.has(index), width: index === 1 || index === 4 ? 26 : 15 })), rows: table.raw, summaryRows: xlsSummary });
      } else await (mode === "print" ? printReportPdf : downloadReportPdf)({ title, filtersLine: line, profile, orientation: "landscape", columns: table.columns, rows: table.rows, summaryRows: pdfSummary, summaryAtBottom: false },
        mode === "print" ? undefined : reportFilename("Pending_Outstanding", multiple ? "Due_wise" : "Party_Ledger"));
    } catch { setError("Unable to prepare the export."); } finally { setBusy(null); }
  };

  const single = data?.view === "individual" && data.parties.length === 1 ? data.parties[0] : null;
  return <div className="rl-page rpt-page data-page po-page">
    <div className="rl-header">
      <PageBreadcrumb className="rpt-breadcrumb" current="Pending & Outstanding Report" />
      <div className="rl-status" role="status">{loading ? "Loading…" : error && <span className="rpt-error">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></span>}</div>
    </div>
    <div className={`rl-filters ${draft.view === "individual" ? "po-single" : ""}`} role="search">
      <label className="rl-field po-wide"><span className="rl-label">Party</span><PartyPicker parties={parties} value={draft.parties} onChange={value => set("parties", value)} /></label>
      <label className="rl-field"><span className="rl-label">Report View</span>
        <SearchableSelect value={draft.view} onChange={event => set("view", event.target.value)}><option value="multiple">Multiple Date-wise</option><option value="individual">Individual Date-wise</option></SearchableSelect></label>
      <label className="rl-field"><span className="rl-label">Date Basis</span>
        <SearchableSelect value={draft.basis} onChange={event => set("basis", event.target.value)}><option value="voucher">Voucher Date</option><option value="due">Due Date</option></SearchableSelect></label>
      {draft.view === "multiple"
        ? <><label className="rl-field"><span className="rl-label">From Date</span><input type="date" value={draft.from} max={draft.to || undefined} onChange={event => set("from", event.target.value)} /></label>
            <label className="rl-field"><span className="rl-label">To Date</span><input type="date" value={draft.to} min={draft.from || undefined} onChange={event => set("to", event.target.value)} /></label></>
        : <label className="rl-field"><span className="rl-label">Select Date</span><input type="date" value={draft.date} onChange={event => set("date", event.target.value)} /></label>}
      <label className="rl-field"><span className="rl-label">Sort By</span>
        <SearchableSelect value={draft.sort} onChange={event => set("sort", event.target.value)}><option value="overdue">Overdue – Ascending</option><option value="party">Party-wise – Ascending</option></SearchableSelect></label>
      <div className="rl-actions po-actions">
        <button type="button" className="primary" onClick={apply} disabled={loading}>Apply{dirty ? " •" : ""}</button>
        <button type="button" className="rpt-clear" onClick={reset}>Reset</button>
        <ReportExportButtons onPdf={() => exportAs("pdf")} onExcel={() => exportAs("excel")} onPrint={() => exportAs("print")} busy={busy} disabled={!data || empty} />
      </div>
    </div>
    <section className="data-container po-container">
      <div className="data-table-area po-grid">
        {multiple ? <table className="po-table">
          <thead><tr><th>S.No</th><th>Party Name</th><th>Voucher Date</th><th>Due Date</th><th>Voucher No</th><th className="num">Due Amount</th><th className="num">Paid</th><th className="num">Pending</th><th className="num">Overdue Days</th></tr></thead>
          <tbody>{shownRows.map((row, index) => <tr key={`${row.kind}-${row.record_id}`} className="po-row" {...rowDetail(go, row.kind === "installment" ? "installment" : "voucher", row.kind === "installment" ? row.record_id : row.voucher_no)}>
            <td>{(page - 1) * PAGE_SIZE + index + 1}</td><td>{row.party_name}</td><td>{dateLabel(row.voucher_date)}</td><td>{dateLabel(row.due_date)}</td><td className="mono">{row.voucher_no}</td>
            <td className="num">{money(row.due_amount)}</td><td className="num">{money(row.paid)}</td><td className="num">{money(row.pending)}</td>
            <td className="num">{row.overdue_days > 0 ? `${row.overdue_days} ${row.overdue_days === 1 ? "Day" : "Days"}` : "—"}</td></tr>)}</tbody>
        </table> : <table className="po-table po-ledger">
          <thead><tr><th>S.No</th><th>Voucher Date</th><th>Due Date</th><th>Party Name</th><th>Particulars</th><th>Voucher No</th><th className="num">DR</th><th className="num">CR</th><th className="num">Balance</th></tr></thead>
          <tbody>{lines.map((item, index) => <Fragment key={index}>
            {item.kind === "opening" && <tr className="po-band"><td colSpan="8"><b>{item.party}</b> — Opening Balance</td><td className="num">{item.balance}</td></tr>}
            {item.kind === "row" && <tr className="po-row" {...rowDetail(go, item.row.open?.kind || "voucher", item.row.open?.id ?? item.row.voucher_no)}>
              <td>{item.serial}</td><td>{dateLabel(item.row.voucher_date)}</td><td>{dateLabel(item.row.due_date) || "—"}</td><td>{item.party}</td><td>{item.row.particulars}</td><td className="mono">{item.row.voucher_no}</td>
              <td className="num">{Number(item.row.debit) ? money(item.row.debit) : ""}</td><td className="num">{Number(item.row.credit) ? money(item.row.credit) : ""}</td><td className="num">{balanceText(item.row.balance, item.row.balance_type)}</td></tr>}
            {item.kind === "subtotal" && <tr className="po-band po-subtotal"><td colSpan="6">{item.party} — Total / Closing Balance</td><td className="num">{money(item.debit)}</td><td className="num">{money(item.credit)}</td><td className="num">{item.balance}</td></tr>}
          </Fragment>)}</tbody>
        </table>}
        {(loading && !data) && <div className="po-empty">Loading…</div>}
        {empty && <div className="po-empty">{multiple ? "No pending dues for the selected filters." : "No ledger postings for the selected party and date."}</div>}
      </div>
      <footer className="data-footer po-footer">
        {data?.view === "multiple" && <div className="po-totals"><span>Total Due <b>{money(data.totals.due)}</b></span><span>Total Paid <b>{money(data.totals.paid)}</b></span><span>Total Pending <b>{money(data.totals.pending)}</b></span>
          <span title="Received on account (Others / Advance); never netted against a due">Unallocated Advance <b>{money(data.totals.unallocated_advance)}</b></span></div>}
        {data?.view === "individual" && <div className="po-totals">
          {single && <span>Opening Balance <b>{balanceText(single.opening, single.opening_type)}</b></span>}
          <span>{single ? "Total DR" : "All parties · Total DR"} <b>{money(data.totals.debit)}</b></span><span>{single ? "Total CR" : "Total CR"} <b>{money(data.totals.credit)}</b></span>
          {single && <span>Closing Balance <b>{balanceText(single.closing, single.closing_type)}</b></span>}
          {!single && <span className="po-note">Opening and closing balances are shown separately for each party.</span>}</div>}
        <div className="po-count">
          <span>{multiple ? `Showing ${total ? (page - 1) * PAGE_SIZE + 1 : 0}-${Math.min(page * PAGE_SIZE, total)} of ${total}` : `${data?.count ?? 0} postings · ${data?.parties?.length ?? 0} ${data?.parties?.length === 1 ? "party" : "parties"}`}</span>
          {multiple && <div><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><b>Page {page} of {pages}</b><button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div>}
        </div>
      </footer>
    </section>
  </div>;
}
