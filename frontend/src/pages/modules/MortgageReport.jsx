import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { formatINR } from "../../utils/currency";
import "./collection-report.css";

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
  return <div className="collection-report-page"><div className="report-topbar">
    <div className="report-breadcrumb"><PageBreadcrumb root="Reports" current="Mortgage Report" onBack={() => go("/dashboard")}/><strong>Mortgage Report</strong></div>
    <div className="report-top-actions"><input aria-label="Search Mortgage Report" value={filters.search} onChange={event => update("search", event.target.value)} placeholder="Search Doc.No or customer..."/></div>
  </div><main className="collection-report-container">
    <div className="report-filter-bar"><label>From Date<input type="date" value={filters.from} onChange={event => update("from", event.target.value)}/></label><label>To Date<input type="date" value={filters.to} onChange={event => update("to", event.target.value)}/></label><button className="report-reset" onClick={() => setFilters({ search: "", from: "", to: "" })}>Reset</button></div>
    {error && <div className="report-error">{error}</div>}
    <div className="report-table-wrap"><table className="report-table"><thead><tr>{["S.No", "Doc.No", "Customer", "History", "Recorded At", "Application Date", "Product", "Quantity", "Unit", "Rate", "Loan Amount", "Interest %", "Daily Interest", "Updated By"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.doc_no}</td><td>{row.customer_name}</td><td>{row.action === "EXISTING" ? "Existing record" : row.action === "CREATED" ? "Created" : "Updated"}</td><td>{new Date(row.recorded_at).toLocaleString("en-IN")}</td><td>{row.snapshot.application_date}</td><td>{row.snapshot.product_name || "—"}</td><td>{row.snapshot.quantity ?? "—"}</td><td>{row.snapshot.unit || "—"}</td><td>{formatINR(row.snapshot.current_rate)}</td><td>{formatINR(row.snapshot.loan_amount)}</td><td>{row.snapshot.interest_percentage}</td><td>{formatINR(row.snapshot.daily_interest_amount)}</td><td>{row.recorded_by || "—"}</td></tr>)}</tbody></table>{!rows.length && <div className="report-empty">No mortgage history found.</div>}</div>
  </main></div>;
}
