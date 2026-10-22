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

export default function ProfitAndLossReport({ api, auth, go }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [report, setReport] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const { profile, refreshProfile } = useCompanyProfile() || {};
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReport(null);
    api.get("/finance/reports/profit-loss/", { ...auth, params: { from: range.from || undefined, to: range.to || undefined } })
      .then(({ data }) => { if (active) { setReport(data); setError(""); } })
      .catch(requestError => { if (active) setError(apiErrorMessage(requestError, "Unable to load Profit & Loss.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to, retry]);
  const expenseNodes = report ? [report.direct_expense, ...report.indirect_expense].filter(Boolean) : [];
  const incomeNodes = report ? [report.direct_income, ...report.indirect_income].filter(Boolean) : [];
  const totalExpense = report ? expenseNodes.reduce((sum, node) => sum + Number(node.debit) - Number(node.credit), 0) : 0;
  const totalIncome = report ? incomeNodes.reduce((sum, node) => sum + Number(node.credit) - Number(node.debit), 0) : 0;
  const netProfit = report ? Number(report.net_profit) : 0;
  const expenseSideTotal = totalExpense + Math.max(netProfit, 0);
  const incomeSideTotal = totalIncome + Math.max(-netProfit, 0);
  const exportPdf = async action => {
    if (busy || !report) return;
    setBusy(action);
    try {
      const company = await (refreshProfile ? refreshProfile().catch(() => profile) : profile);
      await (action === "pdf" ? downloadAccountingReport : printAccountingReport)("pl", report, range.from, range.to, company);
    } catch { setError("Unable to prepare the PDF."); }
    finally { setBusy(null); }
  };
  const exportExcel = async () => {
    if (!report) return;
    const side = (nodes, debitCol) => flattenTree(nodes).map(row => [`${"  ".repeat(row.depth)}${row.is_group ? row.name.toUpperCase() : row.name}`, debitCol ? (Number(row.debit || 0) || "") : "", debitCol ? "" : (Number(row.credit || 0) || "")]);
    const rows = [...side(expenseNodes, true), ["Gross Profit", "", Number(report.gross_profit || 0)], ...side(incomeNodes, false), ["Net Profit / (Loss)", "", Number(report.net_profit || 0)]];
    rows.unshift(...(report.warnings || []).map(message => [message]));
    await downloadReportExcel({
      filename: reportFilename("Profit_And_Loss"), title: "Profit and Loss Account",
      subtitle: range.from || range.to ? `${range.from ? `From ${range.from}` : "From inception"} to ${range.to || "date"}` : "All dates",
      columns: [{ header: "Particulars", width: 36 }, { header: "Expense (Dr)", numeric: true, width: 16 }, { header: "Income (Cr)", numeric: true, width: 16 }],
      rows,
    });
  };
  return <div className="acct-report-page data-page">
    <div className="acct-report-toolbar">
      <div className="acct-report-title"><PageBreadcrumb current="Profit & Loss Account" /></div>
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
      <span>Gross Profit <b>{formatINR(report?.gross_profit)}</b></span>
      <span>Net {netProfit < 0 ? "Loss" : "Profit"} <b className={netProfit < 0 ? "bad" : "good"}>{formatINR(Math.abs(netProfit))}</b></span>
    </div>
    <div className="acct-split data-fill">
      <div className="acct-split-side acct-debit-side">
        <h2>Expenses (Dr)</h2>
        <div className="acct-table-wrap data-container"><div className="data-table-area"><table className="acct-table">
          <thead><tr><th>Particulars</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={2} className="acct-empty">Loading...</td></tr> : error ? <tr><td colSpan={3} role="alert">Report could not be loaded.</td></tr> : <AccountingGroupTable go={go} report="profit-loss" range={range} nodes={expenseNodes} amountColumns="debit"/>}
            {report && netProfit > 0 && <tr className="acct-row-subtotal"><td>To Net Profit (carried down)</td><td className="num">{formatINR(netProfit)}</td></tr>}
          </tbody>
        </table></div>
          {report && <table className="acct-table acct-total-table data-footer"><tbody><tr className="acct-row-total"><td>TOTAL</td><td className="num">{formatINR(expenseSideTotal)}</td></tr></tbody></table>}</div>
      </div>
      <div className="acct-split-side acct-credit-side">
        <h2>Income (Cr)</h2>
        <div className="acct-table-wrap data-container"><div className="data-table-area"><table className="acct-table">
          <thead><tr><th>Particulars</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={2} className="acct-empty">Loading...</td></tr> : error ? <tr><td colSpan={3} role="alert">Report could not be loaded.</td></tr> : <AccountingGroupTable go={go} report="profit-loss" range={range} nodes={incomeNodes} amountColumns="credit"/>}
            {report && netProfit < 0 && <tr className="acct-row-subtotal"><td>By Net Loss (carried down)</td><td className="num">{formatINR(-netProfit)}</td></tr>}
          </tbody>
        </table></div>
          {report && <table className="acct-table acct-total-table data-footer"><tbody><tr className="acct-row-total"><td>TOTAL</td><td className="num">{formatINR(incomeSideTotal)}</td></tr></tbody></table>}</div>
      </div>
    </div>
  </div>;
}
