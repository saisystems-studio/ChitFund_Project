import { useEffect, useState } from "react";
import ListPageToolbar from "../../components/ListPageToolbar";
import RowActions from "../../components/RowActions";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import confirmDelete from "../../utils/confirmDelete";
import { formatINR } from "../../utils/currency";
import { goBack } from "../../utils/navigation";
import JournalEntry from "./JournalEntry";
import { ENDPOINT, isCompound, sideSummary } from "./journal";
import "./journal.css";
import { rowDetail } from "../reportDetail/reportDetailRoute";

const PAGE_SIZE = 20;
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const dateTimeLabel = value => value ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// Journal List: searchable (voucher no / ledger), date-filtered and paginated on the server.
export default function JournalList({ api, auth, go }) {
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [page, setPage] = useState(1), [data, setData] = useState({ count: 0, results: [] }), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [reload, setReload] = useState(0), [viewing, setViewing] = useState(null), [editing, setEditing] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(1); }, [query, from, to]);
  const invalidRange = from && to && from > to;
  useEffect(() => {
    if (invalidRange) { setData({ count: 0, results: [] }); setLoading(false); return undefined; }
    let active = true;
    setLoading(true);
    api.get(ENDPOINT, { ...auth, params: { page, page_size: PAGE_SIZE, search: query || undefined, from: from || undefined, to: to || undefined } })
      .then(({ data }) => { if (active) { setData({ count: data.count ?? (data.results ?? data).length, results: data.results ?? data }); setError(""); } })
      .catch(requestError => { if (!active) return; if (requestError.response?.status === 404 && page > 1) setPage(1); else { setData({ count: 0, results: [] }); setError(apiErrorMessage(requestError, "Unable to load journals.")); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, query, from, to, reload]);

  const pages = Math.max(1, Math.ceil(data.count / PAGE_SIZE)), current = Math.min(page, pages);
  const first = data.count ? (current - 1) * PAGE_SIZE + 1 : 0, last = Math.min(current * PAGE_SIZE, data.count);
  const remove = async voucher => {
    if (busy || !await confirmDelete(`Delete ${voucher.voucher_no}? Its ledger postings will be reversed.`)) return;
    setBusy(true);
    try { await api.delete(`${ENDPOINT}${voucher.id}/`, auth); actionToast(`Journal ${voucher.voucher_no} deleted successfully.`); setViewing(null); setReload(value => value + 1); }
    catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to delete the journal."), false); }
    finally { setBusy(false); }
  };
  const pageNumbers = Array.from({ length: pages }, (_, index) => index + 1).filter(number => number === 1 || number === pages || Math.abs(number - current) <= 2);

  return <div className="jv-list-page data-page">
    <ListPageToolbar title="Journal List" onBack={() => goBack("/dashboard")} search={search} onSearch={setSearch} placeholder="Search voucher no or ledger..."
      action={<button type="button" className="jv-new" onClick={() => go("/journal-entry")}>+ Add Journal</button>}>
      <label className="jv-date-filter">From<input type="date" aria-label="From Date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)}/></label>
      <label className="jv-date-filter">To<input type="date" aria-label="To Date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)}/></label>
    </ListPageToolbar>
    {(error || invalidRange) && <p className="collection-entry-error" role="alert">{error || "From Date cannot be after To Date."}</p>}
    <section className="jv-list-card data-container">
      <div className="data-table-area jv-list-table-wrap">
        <table className="jv-list-table">
          <colgroup><col style={{ width: "6%" }}/><col style={{ width: "11%" }}/><col style={{ width: "12%" }}/><col style={{ width: "24%" }}/><col style={{ width: "24%" }}/><col style={{ width: "13%" }}/><col style={{ width: "10%" }}/></colgroup>
          <thead><tr><th>S.No</th><th>Date</th><th>Voucher No</th><th>Ledger (Cr)</th><th>Ledger (Dr)</th><th className="num">Amount</th><th>Actions</th></tr></thead>
          <tbody>
            {data.results.map((voucher, index) => <tr key={voucher.id} {...rowDetail(go, "voucher", voucher.voucher_no)}>
              <td>{first + index}</td><td>{dateLabel(voucher.date)}</td><td>{voucher.voucher_no}</td>
              <td title={sideSummary(voucher, "CR")}>{sideSummary(voucher, "CR")}</td>
              <td title={sideSummary(voucher, "DR")}>{sideSummary(voucher, "DR")}{isCompound(voucher) && <button type="button" className="jv-view-more" onClick={() => setViewing(voucher)}>View More</button>}</td>
              <td className="num">{formatINR(voucher.total)}</td>
              <td><RowActions onView={() => setViewing(voucher)} onEdit={() => setEditing(voucher.id)} onDelete={() => remove(voucher)} disabled={busy}/></td>
            </tr>)}
            {!data.results.length && <tr className="jv-empty"><td colSpan={7}>{loading ? "Loading journals…" : error ? <>Journals could not be loaded. <button type="button" className="jv-view-more" onClick={() => setReload(value => value + 1)}>Retry</button></> : query || from || to ? "No journals match the selected filters." : "No journals recorded yet."}</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="jv-pager data-footer">
        <span>Showing {first} to {last} of {data.count} entries</span>
        <div>
          <button type="button" disabled={current === 1 || loading} onClick={() => setPage(current - 1)}>Previous</button>
          {pageNumbers.map((number, index) => <span key={number} className="jv-page-group">{index > 0 && number - pageNumbers[index - 1] > 1 && <span className="jv-ellipsis">…</span>}<button type="button" className={number === current ? "active" : ""} disabled={loading} onClick={() => setPage(number)}>{number}</button></span>)}
          <button type="button" disabled={current === pages || loading} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      </footer>
    </section>
    {viewing && <JournalView api={api} auth={auth} voucher={viewing} busy={busy} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing.id); setViewing(null); }} onDelete={() => remove(viewing)}/>}
    {editing != null && <div className="jv-modal-backdrop"><div className="jv-modal jv-modal-wide" role="dialog" aria-modal="true" aria-label="Edit Journal">
      <JournalEntry api={api} auth={auth} go={go} id={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload(value => value + 1); }}/>
    </div></div>}
  </div>;
}

// Every Dr/Cr posting of one voucher, plus its audit trail.
function JournalView({ api, auth, voucher, busy, onClose, onEdit, onDelete }) {
  const [audit, setAudit] = useState(null);
  useEffect(() => { api.get(`${ENDPOINT}${voucher.id}/audit/`, auth).then(({ data }) => setAudit(data)).catch(() => setAudit([])); }, [voucher.id]);
  useEffect(() => { const close = event => event.key === "Escape" && !busy && onClose(); document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [busy, onClose]);
  const lines = [...voucher.lines].sort((a, b) => (a.side === b.side ? a.row - b.row : a.side === "DR" ? -1 : 1));
  return <div className="jv-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section className="jv-modal" role="dialog" aria-modal="true" aria-label={`Journal ${voucher.voucher_no}`}>
      <div className="jv-modal-heading"><h2>Journal Voucher · {voucher.voucher_no}</h2><button type="button" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="jv-view-body">
        <p className="jv-view-meta"><span>Date <b>{dateLabel(voucher.date)}</b></span>{voucher.created_by && <span>Created by <b>{voucher.created_by}</b></span>}</p>
        <table className="jv-view-table">
          <thead><tr><th>Ledger</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{lines.map(line => <tr key={`${line.row}-${line.side}`}><td>{line.ledger_name}</td><td className="num">{line.side === "DR" ? formatINR(line.amount) : "—"}</td><td className="num">{line.side === "CR" ? formatINR(line.amount) : "—"}</td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td className="num">{formatINR(voucher.total)}</td><td className="num">{formatINR(voucher.total)}</td></tr></tfoot>
        </table>
        {voucher.narration && <p className="jv-view-narration"><span>Notes</span>{voucher.narration}</p>}
        <div className="jv-audit"><strong>History</strong>
          {audit === null ? <span className="jv-audit-empty">Loading…</span> : !audit.length ? <span className="jv-audit-empty">No history recorded.</span>
            : <ul>{audit.map((entry, index) => <li key={index}><b>{entry.action}</b> by {entry.changed_by || "—"} · {dateTimeLabel(entry.changed_at)}</li>)}</ul>}
        </div>
      </div>
      <footer className="collection-entry-actions jv-actions">
        <button type="button" onClick={onClose}>Close</button>
        <RowActions onEdit={onEdit} onDelete={onDelete} disabled={busy}/>
      </footer>
    </section>
  </div>;
}
