import PageBreadcrumb from "../../components/PageBreadcrumb";
import { useEffect, useState } from "react";
import { formatINR } from "../../utils/currency";
import apiErrorMessage from "../../utils/apiErrorMessage";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import { rowDetail } from "../reportDetail/reportDetailRoute";
import "./report-common.css";
import "./ledger-statement.css";

const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const TITLES = { cash: "Cash Ledger", bank: "Bank Ledger", ledger: "Ledger Statement" };
const blank = { from: "", to: "" };

export default function LedgerStatement({ api, auth, go, kind }) {
  // kind "ledger": one chosen Ledger Master ledger (party, income, expense, ...), every posting included.
  const single = kind === "ledger";
  const [ledgers, setLedgers] = useState([]), [ledgerId, setLedgerId] = useState("");
  useEffect(() => { if (single) api.get("/finance/ledgers/", auth).then(({ data }) => setLedgers([...(data.results ?? data)].sort((a, b) => String(a.name).localeCompare(String(b.name))))).catch(() => {}); }, [single]);
  const ledgerName = ledgers.find(item => String(item.id) === String(ledgerId))?.name || "";
  const title = single && ledgerName ? `Ledger Statement · ${ledgerName}` : TITLES[kind] || "Ledger";
  const [range, setRange] = useState(blank), [search, setSearch] = useState("");
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [exportBusy, setExportBusy] = useState(null);
  const { profile } = useCompanyProfile() || {};
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    if (single && !ledgerId) { setLoading(false); setError(""); return undefined; }
    setLoading(true);
    api.get("/finance/reports/ledger/", { ...auth, params: { type: kind, ledger: single ? ledgerId : undefined, from: range.from || undefined, to: range.to || undefined } })
      .then(({ data }) => { if (active) { setData(data); setError(""); } })
      .catch(requestError => { if (active) setError(apiErrorMessage(requestError, `Unable to load ${title}.`)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, ledgerId, range.from, range.to, retry]);
  const needle = search.trim().toLowerCase();
  const rows = (data?.rows || []).filter(row => !needle || `${row.particulars} ${row.reference} ${row.type}`.toLowerCase().includes(needle));
  const filtersLine = [range.from && `From ${range.from}`, range.to && `To ${range.to}`, search && `Search: ${search}`, ...(data?.warnings || [])].filter(Boolean).join("   •   ");
  // Footer placement follows the Customer-wise Report: a Dr balance sits under DR, a Cr
  // balance under CR. Running balances come from the API (opening + Dr - Cr, in date order).
  const signed = (amount, type) => (String(type || "DR").toUpperCase() === "CR" ? -1 : 1) * Number(amount || 0);
  const split = value => { const rounded = Math.round(value * 100) / 100; if (rounded === 0) return { debit: formatINR(0), credit: "" }; return rounded > 0 ? { debit: `${formatINR(rounded)} Dr`, credit: "" } : { debit: "", credit: `${formatINR(Math.abs(rounded))} Cr` }; };
  const openingSplit = split(signed(data?.opening_balance, data?.opening_balance_type));
  const closingSplit = split(signed(data?.closing_balance, data?.closing_balance_type));
  const balanceText = row => `${formatINR(row.balance)} ${(row.balance_type || "DR") === "CR" ? "Cr" : "Dr"}`;
  const [showBalance, setShowBalance] = useState(false);
  const handleExportPdf = async (mode = "pdf") => {
    if (exportBusy || !data) return;
    setExportBusy(mode);
    try {
      const pad = showBalance ? [""] : [];
      await (mode === "print" ? printReportPdf : downloadReportPdf)({
        title, filtersLine, profile, summaryAtBottom: true,
        columns: [
          { header: "Date" }, { header: "Particulars" }, { header: "Vch Type" }, { header: "Vch No." },
          { header: "Dr", align: "right" }, { header: "Cr", align: "right" }, ...(showBalance ? [{ header: "Balance", align: "right" }] : []),
        ],
        rows: rows.map(row => [
          dateLabel(row.date), row.particulars, row.type, row.reference,
          row.debit > 0 ? formatINR(row.debit) : "", row.credit > 0 ? formatINR(row.credit) : "", ...(showBalance ? [balanceText(row)] : []),
        ]),
        summaryRows: [
          { cells: [{ content: "Opening Balance :", colSpan: 4, styles: { halign: "right" } }, openingSplit.debit, openingSplit.credit, ...pad] },
          { cells: [{ content: "Current Total :", colSpan: 4, styles: { halign: "right" } }, formatINR(data?.total_debit), formatINR(data?.total_credit), ...pad], dividerAfter: true },
          { cells: [{ content: "Closing Balance :", colSpan: 4, styles: { halign: "right" } }, closingSplit.debit, closingSplit.credit, ...pad], bold: true, dividerAfter: true },
        ],
      }, reportFilename(title.replace(/\s+/g, "_")));
    } catch { setError("Unable to prepare the PDF."); }
    finally { setExportBusy(null); }
  };
  const handleExportExcel = async () => {
    if (exportBusy || !data) return;
    setExportBusy("excel");
    try {
      const columns = [
        { header: "Date", width: 14 }, { header: "Particulars", width: 32 }, { header: "Vch Type", width: 16 }, { header: "Vch No.", width: 16 },
        { header: "Dr", numeric: true, width: 14 }, { header: "Cr", numeric: true, width: 14 }, ...(showBalance ? [{ header: "Balance", width: 18 }] : []),
      ];
      const summary = (label, dr, cr) => { const cells = new Array(columns.length).fill(""); cells[0] = label; cells[4] = dr; cells[5] = cr; return cells; };
      await downloadReportExcel({
        filename: reportFilename(title.replace(/\s+/g, "_")), title, subtitle: filtersLine || undefined, columns,
        rows: rows.map(row => [
          row.date || "", row.particulars, row.type, row.reference,
          row.debit > 0 ? Number(row.debit) : "", row.credit > 0 ? Number(row.credit) : "", ...(showBalance ? [balanceText(row)] : []),
        ]),
        summaryRows: [
          summary("Opening Balance", openingSplit.debit, openingSplit.credit),
          summary("Current Total", formatINR(data?.total_debit), formatINR(data?.total_credit)),
          summary("Closing Balance", closingSplit.debit, closingSplit.credit),
        ],
      });
    } finally { setExportBusy(null); }
  };
  // Customer-wise Report layout: DATE | PARTICULARS | VCH TYPE | VCH NO. | DR | CR, with
  // BALANCE revealed by the header arrow; Opening / Current Total / Closing only in the footer.
  const span = showBalance ? 8 : 7;
  return <div className="rpt-page ls-page data-page">
    <div className="rpt-header-row">
      <PageBreadcrumb className="rpt-breadcrumb" current={title} />
      <div className="rpt-toolbar rpt-toolbar-pinned">
        {loading && <span className="rpt-loading">Updating…</span>}
        {data?.warnings?.map(message => <div key={message} role="status" className="collection-entry-error">{message}</div>)}
        {error && <span className="rpt-error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></span>}
        {single && <label className="rpt-field ls-ledger">Ledger
          <SearchableSelect aria-label="Ledger" value={ledgerId} onChange={event => setLedgerId(event.target.value)} searchPlaceholder="Search ledger..."><option value="">Select Ledger</option>{ledgers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SearchableSelect>
        </label>}
        <label className="rpt-field ls-search">Search
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search particulars or voucher no..." />
        </label>
        <label className="rpt-field ls-date" title="Filters entries from this date">From Date
          <input type="date" aria-label="From date" value={range.from} max={range.to || undefined} onChange={event => setRange(current => ({ ...current, from: event.target.value }))}/>
        </label>
        <label className="rpt-field ls-date" title="Filters entries up to this date">To Date
          <input type="date" aria-label="To date" value={range.to} min={range.from || undefined} onChange={event => setRange(current => ({ ...current, to: event.target.value }))}/>
        </label>
        <div className="ls-actions">
          <ReportExportButtons portal onPdf={() => handleExportPdf()} onExcel={handleExportExcel} onPrint={() => handleExportPdf("print")} busy={exportBusy} disabled={!data || loading || Boolean(error)} />
        </div>
      </div>
    </div>

    <div className="rpt-card rpt-table-card rpt-ledger-card data-container">
      <div className="rpt-ledger-rows data-table-area"><div className="rpt-table-wrap">
        <table className="rpt-table ls-table">
          <LedgerColgroup showBalance={showBalance} />
          <thead><tr>
            <th>Date</th><th>Particulars</th><th>Vch Type</th><th>Vch No.</th><th className="num">Dr</th><th className="num">Cr</th>
            {showBalance && <th className="num">Balance</th>}
            <th className="rpt-balance-toggle-th">
              <button type="button" className="rpt-balance-toggle" title={showBalance ? "Hide Balance" : "Show Balance"}
                aria-label={showBalance ? "Hide Balance column" : "Show Balance column"} onClick={() => setShowBalance(value => !value)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={showBalance ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} /></svg>
              </button>
            </th>
          </tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={`${row.reference}-${index}`} {...rowDetail(go, "voucher", row.reference)}>
              <td>{dateLabel(row.date)}</td>
              <td className="ls-particulars">{row.particulars}</td>
              <td>{row.type}</td>
              <td className="mono">{row.reference}</td>
              <td className="num">{row.debit > 0 ? formatINR(row.debit) : ""}</td>
              <td className="num">{row.credit > 0 ? formatINR(row.credit) : ""}</td>
              {showBalance && <td className="num">{balanceText(row)}</td>}
              <td />
            </tr>)}
            {!rows.length && <tr className="rpt-empty-row"><td colSpan={span}>
              <strong>{single && !ledgerId ? "Select a ledger to view its statement." : loading ? "Loading entries..." : error ? "Entries could not be loaded." : "No transactions found for the selected period."}</strong>
            </td></tr>}
          </tbody>
        </table>
      </div></div>
      <div className="rpt-ledger-summary data-footer">
        <table className="rpt-table rpt-ledger-summary-table">
          <LedgerColgroup showBalance={showBalance} />
          <tbody>
            <tr className="rpt-summary-row"><td colSpan={4}>Opening Balance :</td><td className="num">{openingSplit.debit}</td><td className="num">{openingSplit.credit}</td>{showBalance && <td />}<td /></tr>
            <tr className="rpt-summary-row"><td colSpan={4}>Current Total :</td><td className="num">{formatINR(data?.total_debit)}</td><td className="num">{formatINR(data?.total_credit)}</td>{showBalance && <td />}<td /></tr>
            <tr className="rpt-summary-row rpt-summary-row-closing"><td colSpan={4}>Closing Balance :</td><td className="num">{closingSplit.debit}</td><td className="num">{closingSplit.credit}</td>{showBalance && <td />}<td /></tr>
          </tbody>
        </table>
        <p className="ls-count">Showing {rows.length} of {data?.rows?.length || 0} entries</p>
      </div>
    </div>
  </div>;
}

// Date | Particulars | Vch Type | Vch No. | Dr | Cr [| Balance] | toggle — shared by the
// transaction table and the footer table so their columns line up (same widths as the
// Customer-wise Report).
function LedgerColgroup({ showBalance }) {
  const widths = showBalance ? ["10%", "27%", "13%", "11%", "11%", "11%", "13%", "4%"] : ["11%", "34%", "15%", "12%", "12%", "12%", "4%"];
  return <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;
}
