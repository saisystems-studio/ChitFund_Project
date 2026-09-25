import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { formatINR } from "../../utils/currency";
import "./mortgage-report.css";

const pad = value => String(value).padStart(2, "0");
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const dateTimeLabel = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "—"; };
const COLUMNS = [["S.No", "sno"], ["Doc.No"], ["Customer", "text"], ["History"], ["Recorded At", "date"], ["Application Date", "date"], ["Product", "text"], ["Quantity", "num"], ["Unit"], ["Rate", "num"], ["Loan Amount", "num"], ["Interest %", "num"], ["Daily Interest", "num"], ["Updated By", "text"]];

export default function MortgageReport({ api, auth, go }) {
  const [filters, setFilters] = useState({ search: "", from: "", to: "" }), [rows, setRows] = useState([]), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.get("/finance/reports/mortgage/", { ...auth, params: filters }).then(({ data }) => {
      if (active) { setRows(data.results || []); setError(""); }
    }).catch(() => { if (active) setError("Unable to load Mortgage Report."); });
    return () => { active = false; };
  }, [filters]);
  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  return <div className="mortgage-report-page">
    <header className="mr-header"><PageBreadcrumb root="Reports" current="Mortgage Report" onBack={() => go("/dashboard")}/><h1>Mortgage Report</h1><span className="mr-count">{rows.length} {rows.length === 1 ? "Record" : "Records"}</span></header>
    <main className="mr-card">
      <div className="mr-filters">
        <label className="mr-search">Search<input aria-label="Search Mortgage Report" value={filters.search} onChange={event => update("search", event.target.value)} placeholder="Search Doc.No or customer..."/></label>
        <label>From Date<input type="date" value={filters.from} onChange={event => update("from", event.target.value)}/></label>
        <label>To Date<input type="date" value={filters.to} onChange={event => update("to", event.target.value)}/></label>
        <button type="button" className="mr-reset" onClick={() => setFilters({ search: "", from: "", to: "" })}>Reset</button>
      </div>
      {error && <div className="mr-error">{error}</div>}
      <div className="mr-scroll"><table className="mr-table"><thead><tr>{COLUMNS.map(([label, align]) => <th key={label} className={align}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td className="sno">{index + 1}</td><td><b>{row.doc_no}</b></td><td className="text" title={row.customer_name}>{row.customer_name}</td><td>{row.action === "EXISTING" ? "Existing record" : row.action === "CREATED" ? "Created" : "Updated"}</td><td className="date">{dateTimeLabel(row.recorded_at)}</td><td className="date">{dateLabel(row.snapshot.application_date)}</td><td className="text" title={row.snapshot.product_name || ""}>{row.snapshot.product_name || "—"}</td><td className="num">{row.snapshot.quantity ?? "—"}</td><td>{row.snapshot.unit || "—"}</td><td className="num">{formatINR(row.snapshot.current_rate)}</td><td className="num">{formatINR(row.snapshot.loan_amount)}</td><td className="num">{row.snapshot.interest_percentage}</td><td className="num">{formatINR(row.snapshot.daily_interest_amount)}</td><td className="text">{row.recorded_by || "—"}</td></tr>)}</tbody></table>{!rows.length && <div className="mr-empty">No mortgage history found.</div>}</div>
    </main>
  </div>;
}
