import { useEffect, useState } from "react";
import ListPageToolbar from "../../components/ListPageToolbar";
import { formatINR } from "../../utils/currency";
import apiErrorMessage from "../../utils/apiErrorMessage";
import "./ledger-statement.css";

const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const TITLES = { cash: "Cash Ledger", bank: "Bank Ledger" };
const blank = { from: "", to: "" };

export default function LedgerStatement({ api, auth, kind }) {
  const title = TITLES[kind] || "Ledger";
  const [range, setRange] = useState(blank), [search, setSearch] = useState("");
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get("/finance/reports/ledger/", { ...auth, params: { type: kind, from: range.from || undefined, to: range.to || undefined } })
      .then(({ data }) => { if (active) { setData(data); setError(""); } })
      .catch(requestError => { if (active) setError(apiErrorMessage(requestError, `Unable to load ${title}.`)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, range.from, range.to]);
  const needle = search.trim().toLowerCase();
  const rows = (data?.rows || []).filter(row => !needle || `${row.particulars} ${row.reference} ${row.type}`.toLowerCase().includes(needle));
  return <>
    <ListPageToolbar eyebrow="REPORTS" title={title} search={search} onSearch={setSearch} placeholder="Search particulars or voucher no...">
      <label className="ls-range" title="Filters entries by date"><span>Date Range</span><span><input type="date" aria-label="From date" value={range.from} max={range.to || undefined} onChange={event => setRange(current => ({ ...current, from: event.target.value }))}/><em>to</em><input type="date" aria-label="To date" value={range.to} min={range.from || undefined} onChange={event => setRange(current => ({ ...current, to: event.target.value }))}/></span></label>
    </ListPageToolbar>
    {error && <div role="alert" className="collection-entry-error">{error}</div>}
    <section className="cards ls-summary">
      <div className="card"><span>Opening Balance</span><strong>{formatINR(data?.opening_balance)}</strong><small className={`ls-type ${(data?.opening_balance_type || "DR").toLowerCase()}`}>{data?.opening_balance_type || "DR"}</small></div>
      <div className="card"><span>Total Debit</span><strong>{formatINR(data?.total_debit)}</strong><small>Collection Entries</small></div>
      <div className="card"><span>Total Credit</span><strong>{formatINR(data?.total_credit)}</strong><small>Payment Entries</small></div>
      <div className="card"><span>Closing Balance</span><strong>{formatINR(data?.closing_balance)}</strong><small className={`ls-type ${(data?.closing_balance_type || "DR").toLowerCase()}`}>{data?.closing_balance_type || "DR"}</small></div>
    </section>
    <section className="panel ls-panel"><div className="table-wrap"><table className="ls-table">
      <thead><tr><th>S.No</th><th>Date</th><th>Particulars</th><th>Voucher No</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
      <tbody>
        <tr className="ls-opening-row"><td/><td/><td><strong>Opening Balance</strong></td><td/><td/><td className="num"/><td className="num"/><td className="num"><strong>{formatINR(data?.opening_balance)} <span className={`ls-type ${(data?.opening_balance_type || "DR").toLowerCase()}`}>{data?.opening_balance_type || "DR"}</span></strong></td></tr>
        {rows.map((row, index) => <tr key={`${row.reference}-${index}`}>
          <td>{index + 1}</td>
          <td>{dateLabel(row.date)}</td>
          <td>{row.particulars}</td>
          <td className="mono">{row.reference}</td>
          <td>{row.type}</td>
          <td className="num">{row.debit > 0 ? formatINR(row.debit) : "—"}</td>
          <td className="num">{row.credit > 0 ? formatINR(row.credit) : "—"}</td>
          <td className="num">{formatINR(row.balance)} <span className={`ls-type ${(row.balance_type || "DR").toLowerCase()}`}>{row.balance_type}</span></td>
        </tr>)}
      </tbody>
    </table>{!rows.length && <div className="empty">{loading ? "Loading entries..." : error ? "Entries could not be loaded." : "No transactions found for the selected period."}</div>}</div>
    <footer className="footer paginationFooter"><span>Showing {rows.length} of {data?.rows?.length || 0} entries</span><span>Closing Balance <strong>{formatINR(data?.closing_balance)} {data?.closing_balance_type}</strong></span></footer></section>
  </>;
}
