import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadAccountingReport, printAccountingReport } from "../../utils/accountingReportPdf";
import { downloadCsv, flattenTree } from "../../utils/accountingReportExport";
import AccountingGroupTable from "./AccountingGroupTable";
import "./accounting-reports.css";

export default function TrialBalanceReport({ api, auth, go }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [report, setReport] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const { profile, refreshProfile } = useCompanyProfile() || {};
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get("/finance/reports/trial-balance/", { ...auth, params: { from: range.from || undefined, to: range.to || undefined } })
      .then(({ data }) => { if (active) { setReport(data); setError(""); } })
      .catch(requestError => { if (active) setError(apiErrorMessage(requestError, "Unable to load Trial Balance.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);
  const balanced = report && Number(report.total_debit) === Number(report.total_credit);
  const exportPdf = async action => {
    if (busy || !report) return;
    setBusy(action);
    try {
      const company = await (refreshProfile ? refreshProfile().catch(() => profile) : profile);
      await (action === "pdf" ? downloadAccountingReport : printAccountingReport)("trial", report, range.from, range.to, company);
    } catch { setError("Unable to prepare the PDF."); }
    finally { setBusy(null); }
  };
  const exportExcel = () => {
    if (!report) return;
    const rows = flattenTree(report.groups).map(row => [`${"  ".repeat(row.depth)}${row.is_group ? row.name.toUpperCase() : row.name}`, row.debit || "", row.credit || ""]);
    rows.push(["TOTAL", report.total_debit, report.total_credit]);
    downloadCsv(`Trial-Balance-${new Date().toISOString().slice(0, 10)}.csv`, ["Particulars", "Debit", "Credit"], rows);
  };
  return <div className="acct-report-page">
    <div className="acct-report-toolbar">
      <div className="acct-report-title"><PageBreadcrumb onBack={() => go("/dashboard")}/><h1>Trial Balance</h1></div>
      <div className="acct-report-filters">
        <label>From<input type="date" value={range.from} max={range.to || undefined} onChange={event => setRange(current => ({ ...current, from: event.target.value }))}/></label>
        <label>To<input type="date" value={range.to} min={range.from || undefined} onChange={event => setRange(current => ({ ...current, to: event.target.value }))}/></label>
        <button type="button" className="acct-reset" onClick={() => setRange({ from: "", to: "" })}>Reset</button>
        <div className="acct-report-exports">
          <button type="button" disabled={!report || busy} onClick={() => exportPdf("pdf")}>{busy === "pdf" ? "..." : "PDF"}</button>
          <button type="button" disabled={!report || busy} onClick={() => exportPdf("print")}>{busy === "print" ? "..." : "Print"}</button>
          <button type="button" disabled={!report} onClick={exportExcel}>Excel</button>
        </div>
      </div>
    </div>
    {error && <div role="alert" className="collection-entry-error">{error}</div>}
    <div className="acct-report-summary">
      <span>Total Debit <b>{formatINR(report?.total_debit)}</b></span>
      <span>Total Credit <b>{formatINR(report?.total_credit)}</b></span>
      <span className={balanced ? "good" : "bad"}>{balanced ? "Balanced" : "Difference " + formatINR(Math.abs(Number(report?.total_debit || 0) - Number(report?.total_credit || 0)))}</span>
    </div>
    <div className="acct-table-wrap"><table className="acct-table">
      <thead><tr><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
      <tbody>
        {loading ? <tr><td colSpan={3} className="acct-empty">Loading...</td></tr> : <AccountingGroupTable nodes={report?.groups || []}/>}
        {report && <tr className="acct-row-total"><td>TOTAL</td><td className="num">{formatINR(report.total_debit)}</td><td className="num">{formatINR(report.total_credit)}</td></tr>}
      </tbody>
    </table></div>
  </div>;
}
