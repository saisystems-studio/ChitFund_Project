import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { formatINR } from "../../utils/currency";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { downloadAccountingReport, printAccountingReport } from "../../utils/accountingReportPdf";
import { downloadCsv, flattenTree } from "../../utils/accountingReportExport";
import AccountingGroupTable from "./AccountingGroupTable";
import "./accounting-reports.css";

export default function ProfitAndLossReport({ api, auth, go }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [report, setReport] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const { profile, refreshProfile } = useCompanyProfile() || {};
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get("/finance/reports/profit-loss/", { ...auth, params: { from: range.from || undefined, to: range.to || undefined } })
      .then(({ data }) => { if (active) { setReport(data); setError(""); } })
      .catch(requestError => { if (active) setError(apiErrorMessage(requestError, "Unable to load Profit & Loss.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);
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
  const exportExcel = () => {
    if (!report) return;
    const side = (nodes, debitCol) => flattenTree(nodes).map(row => [`${"  ".repeat(row.depth)}${row.is_group ? row.name.toUpperCase() : row.name}`, debitCol ? (row.debit || "") : "", debitCol ? "" : (row.credit || "")]);
    const rows = [...side(expenseNodes, true), ["Gross Profit", "", report.gross_profit], ...side(incomeNodes, false), ["Net Profit / (Loss)", "", report.net_profit]];
    downloadCsv(`Profit-and-Loss-${new Date().toISOString().slice(0, 10)}.csv`, ["Particulars", "Expense (Dr)", "Income (Cr)"], rows);
  };
  return <div className="acct-report-page">
    <div className="acct-report-toolbar">
      <div className="acct-report-title"><PageBreadcrumb onBack={() => go("/dashboard")}/><h1>Profit &amp; Loss Account</h1></div>
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
      <span>Gross Profit <b>{formatINR(report?.gross_profit)}</b></span>
      <span>Net {netProfit < 0 ? "Loss" : "Profit"} <b className={netProfit < 0 ? "bad" : "good"}>{formatINR(Math.abs(netProfit))}</b></span>
    </div>
    <div className="acct-split">
      <div className="acct-split-side acct-debit-side">
        <h2>Expenses (Dr)</h2>
        <div className="acct-table-wrap"><table className="acct-table">
          <thead><tr><th>Particulars</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={2} className="acct-empty">Loading...</td></tr> : <AccountingGroupTable nodes={expenseNodes} amountColumns="debit"/>}
            {report && netProfit > 0 && <tr className="acct-row-subtotal"><td>To Net Profit (carried down)</td><td className="num">{formatINR(netProfit)}</td></tr>}
            {report && <tr className="acct-row-total"><td>TOTAL</td><td className="num">{formatINR(expenseSideTotal)}</td></tr>}
          </tbody>
        </table></div>
      </div>
      <div className="acct-split-side acct-credit-side">
        <h2>Income (Cr)</h2>
        <div className="acct-table-wrap"><table className="acct-table">
          <thead><tr><th>Particulars</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={2} className="acct-empty">Loading...</td></tr> : <AccountingGroupTable nodes={incomeNodes} amountColumns="credit"/>}
            {report && netProfit < 0 && <tr className="acct-row-subtotal"><td>By Net Loss (carried down)</td><td className="num">{formatINR(-netProfit)}</td></tr>}
            {report && <tr className="acct-row-total"><td>TOTAL</td><td className="num">{formatINR(incomeSideTotal)}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  </div>;
}
