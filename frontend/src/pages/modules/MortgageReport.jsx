import "../../styles/compact-report-toolbar.css";
import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { formatINR } from "../../utils/currency";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import "./mortgage-report.css";
import "../../styles/report-layout.css";
import { rowDetail } from "../reportDetail/reportDetailRoute";

const pad = value => String(value).padStart(2, "0");
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const dateTimeLabel = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "—"; };
const COLUMNS = [["S.No", "sno"], ["Doc.No"], ["Customer", "text"], ["History"], ["Recorded At", "date"], ["Application Date", "date"], ["Product", "text"], ["Quantity", "num"], ["Unit"], ["Rate", "num"], ["Loan Amount", "num"], ["Interest %", "num"], ["Daily Interest", "num"], ["Updated By", "text"]];

export default function MortgageReport({ api, auth, go }) {
  const [filters, setFilters] = useState({ search: "", from: "", to: "" }), [rows, setRows] = useState([]), [error, setError] = useState("");
  const [exportBusy, setExportBusy] = useState(null);
  const { profile } = useCompanyProfile() || {};
  useEffect(() => {
    let active = true;
    api.get("/finance/reports/mortgage/", { ...auth, params: filters }).then(({ data }) => {
      if (active) { setRows(data.results || []); setError(""); }
    }).catch(() => { if (active) setError("Unable to load Mortgage Report."); });
    return () => { active = false; };
  }, [filters]);
  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const filtersLine = [filters.search && `Search: ${filters.search}`, filters.from && `From ${filters.from}`, filters.to && `To ${filters.to}`].filter(Boolean).join("   •   ");
  const historyLabel = row => row.action === "EXISTING" ? "Existing record" : row.action === "CREATED" ? "Created" : "Updated";
  const handleExportPdf = async (mode = "pdf") => {
    if (exportBusy) return;
    setExportBusy(mode);
    try {
      await (mode === "print" ? printReportPdf : downloadReportPdf)({
        title: "Mortgage Report", filtersLine, orientation: "landscape", profile,
        columns: COLUMNS.map(([label, align]) => ({ header: label, align: align === "num" || align === "sno" ? "right" : "left" })),
        rows: rows.map((row, index) => [
          String(index + 1), row.doc_no, row.customer_name, historyLabel(row), dateTimeLabel(row.recorded_at), dateLabel(row.snapshot.application_date),
          row.snapshot.product_name || "—", row.snapshot.quantity ?? "—", row.snapshot.unit || "—", formatINR(row.snapshot.current_rate),
          formatINR(row.snapshot.loan_amount), row.snapshot.interest_percentage, formatINR(row.snapshot.daily_interest_amount), row.recorded_by || "—",
        ]),
      }, reportFilename("Mortgage_Report"));
    } catch { setError("Unable to prepare the PDF."); }
    finally { setExportBusy(null); }
  };
  const handleExportExcel = async () => {
    if (exportBusy) return;
    setExportBusy("excel");
    try {
      await downloadReportExcel({
        filename: reportFilename("Mortgage_Report"), title: "Mortgage Report", subtitle: filtersLine || undefined,
        columns: [
          { header: "S.No", width: 8 }, { header: "Doc.No", width: 14 }, { header: "Customer", width: 22 }, { header: "History", width: 14 },
          { header: "Recorded At", width: 18 }, { header: "Application Date", width: 16 }, { header: "Product", width: 18 }, { header: "Quantity", numeric: true, width: 10 },
          { header: "Unit", width: 10 }, { header: "Rate", numeric: true, width: 12 }, { header: "Loan Amount", numeric: true, width: 14 },
          { header: "Interest %", numeric: true, width: 10 }, { header: "Daily Interest", numeric: true, width: 14 }, { header: "Updated By", width: 16 },
        ],
        rows: rows.map((row, index) => [
          index + 1, row.doc_no, row.customer_name, historyLabel(row), row.recorded_at || "", row.snapshot.application_date || "",
          row.snapshot.product_name || "", row.snapshot.quantity ?? "", row.snapshot.unit || "", Number(row.snapshot.current_rate || 0),
          Number(row.snapshot.loan_amount || 0), Number(row.snapshot.interest_percentage || 0), Number(row.snapshot.daily_interest_amount || 0), row.recorded_by || "",
        ]),
      });
    } finally { setExportBusy(null); }
  };
  return <div className="mortgage-report-page rl-page data-page compact-report-page">
    <header className="rl-header"><PageBreadcrumb current="Mortgage Report" /><span className="rl-meta">{rows.length} {rows.length === 1 ? "Record" : "Records"}</span>
      
    </header>
    <div className="rl-filters" role="search">
      <label className="rl-field"><span className="rl-label">Search</span><input type="search" aria-label="Search Mortgage Report" value={filters.search} onChange={event => update("search", event.target.value)} placeholder="Search Doc.No or customer..."/></label>
      <label className="rl-field"><span className="rl-label">From Date</span><input type="date" value={filters.from} onChange={event => update("from", event.target.value)}/></label>
      <label className="rl-field"><span className="rl-label">To Date</span><input type="date" value={filters.to} onChange={event => update("to", event.target.value)}/></label>
      <div className="rl-actions">
        <button type="button" className="rl-btn" onClick={() => setFilters({ search: "", from: "", to: "" })} disabled={!filters.search && !filters.from && !filters.to}>Clear Filters</button>
        <ReportExportButtons onPdf={() => handleExportPdf()} onExcel={handleExportExcel} onPrint={() => handleExportPdf("print")} busy={exportBusy} disabled={!rows.length} />
      </div>
    </div>
    <main className="mr-card data-container">
      {error && <div className="mr-error">{error}</div>}
      <div className="mr-scroll data-table-area"><table className="mr-table"><thead><tr>{COLUMNS.map(([label, align]) => <th key={label} className={align}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id} {...rowDetail(go, "loan", row.loan_id)}><td className="sno">{index + 1}</td><td><b>{row.doc_no}</b></td><td className="text" title={row.customer_name}>{row.customer_name}</td><td>{row.action === "EXISTING" ? "Existing record" : row.action === "CREATED" ? "Created" : "Updated"}</td><td className="date">{dateTimeLabel(row.recorded_at)}</td><td className="date">{dateLabel(row.snapshot.application_date)}</td><td className="text" title={row.snapshot.product_name || ""}>{row.snapshot.product_name || "—"}</td><td className="num">{row.snapshot.quantity ?? "—"}</td><td>{row.snapshot.unit || "—"}</td><td className="num">{formatINR(row.snapshot.current_rate)}</td><td className="num">{formatINR(row.snapshot.loan_amount)}</td><td className="num">{row.snapshot.interest_percentage}</td><td className="num">{formatINR(row.snapshot.daily_interest_amount)}</td><td className="text">{row.recorded_by || "—"}</td></tr>)}</tbody></table>{!rows.length && <div className="mr-empty">No mortgage history found.</div>}</div>
    </main>
  </div>;
}
