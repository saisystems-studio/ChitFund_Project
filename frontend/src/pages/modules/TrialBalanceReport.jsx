import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadAccountingReport, printAccountingReport } from "../../utils/accountingReportPdf";
import { flattenTree } from "../../utils/accountingReportExport";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import AccountingGroupTable from "./AccountingGroupTable";
import "./accounting-reports.css";

export default function TrialBalanceReport({ api, auth, go }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [report, setReport] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const { profile, refreshProfile } = useCompanyProfile() || {};
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReport(null);
    api.get("/finance/reports/trial-balance/", { ...auth, params: { from: range.from || undefined, to: range.to || undefined } })
      .then(({ data }) => { if (active) { setReport(data); setError(""); } })
      .catch(requestError => { if (active) setError(apiErrorMessage(requestError, "Unable to load Trial Balance.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to, retry]);
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
  const exportExcel = async () => {
    if (!report) return;
    const rows = flattenTree(report.groups).map(row => [`${"  ".repeat(row.depth)}${row.is_group ? row.name.toUpperCase() : row.name}`, Number(row.debit || 0) || "", Number(row.credit || 0) || ""]);
    rows.push(["TOTAL", Number(report.total_debit || 0), Number(report.total_credit || 0)]);
    rows.unshift(...(report.warnings || []).map(message => [message]));
    await downloadReportExcel({
      filename: reportFilename("Trial_Balance"), title: "Trial Balance",
      subtitle: range.from || range.to ? `${range.from ? `From ${range.from}` : "From inception"} to ${range.to || "date"}` : "All dates",
      columns: [{ header: "Particulars", width: 36 }, { header: "Debit", numeric: true, width: 16 }, { header: "Credit", numeric: true, width: 16 }],
      rows,
    });
  };
  return <div className="acct-report-page data-page">
    <div className="acct-report-toolbar">
      <div className="acct-report-title"><PageBreadcrumb current="Trial Balance" /></div>
      <div className="acct-report-filters">
        <label>From<input type="date" value={range.from} max={range.to || undefined} onChange={event => setRange(current => ({ ...current, from: event.target.value }))}/></label>
        <label>To<input type="date" value={range.to} min={range.from || undefined} onChange={event => setRange(current => ({ ...current, to: event.target.value }))}/></label>
        <button type="button" className="acct-reset" onClick={() => setRange({ from: "", to: "" })}>Reset</button>
        <div className="acct-report-exports">
          <ReportExportButtons onPdf={() => exportPdf("pdf")} onExcel={exportExcel} onPrint={() => exportPdf("print")} busy={busy} disabled={!report || loading || Boolean(error)} />
        </div>
      </div>
    </div>
    {error && <div role="alert" className="collection-entry-error">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {report?.warnings?.map(message => <div key={message} role="status" className="collection-entry-error">{message}</div>)}
    <div className="acct-report-summary">
      <span>Total Debit <b>{formatINR(report?.total_debit)}</b></span>
      <span>Total Credit <b>{formatINR(report?.total_credit)}</b></span>
      <span className={balanced ? "good" : "bad"}>{balanced ? "Balanced" : "Difference " + formatINR(Math.abs(Number(report?.total_debit || 0) - Number(report?.total_credit || 0)))}</span>
    </div>
    <div className="acct-table-wrap data-container"><div className="data-table-area"><table className="acct-table">
      <thead><tr><th>Particulars</th><th className="num">Dr</th><th className="num">Cr</th></tr></thead>
      <tbody>
        {loading ? <tr><td colSpan={3} className="acct-empty">Loading...</td></tr> : error ? <tr><td colSpan={3} role="alert">Report could not be loaded.</td></tr> : <AccountingGroupTable go={go} report="trial-balance" range={range} nodes={report?.groups || []}/>}
      </tbody>
    </table></div>
    {report && <table className="acct-table acct-total-table data-footer"><tbody>
      <tr className="acct-row-total"><td>TOTAL</td><td className="num">{formatINR(report.total_debit)}</td><td className="num">{formatINR(report.total_credit)}</td></tr>
    </tbody></table>}</div>
  </div>;
}
