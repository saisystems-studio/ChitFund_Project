import { useEffect, useState } from "react";
import { formatINR } from "../../utils/currency";
import { useSession } from "../../components/SessionContext";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import TransactionEditModal, { transactionEndpoint } from "./TransactionEditModal";
import { RowDocuments } from "./TodayReportDocuments";
import "./today-collection-detail.css";

// Read-only details of one Today Collection Report row (one schedule installment): customer,
// loan, collection summary and the saved collections allocated to it. Admins can Edit or
// Delete a selected collection through the existing collection editor API, which reverses
// the receipt's allocations and refreshes installment/loan balances atomically; the customer
// and the loan are never touched. The parent re-fetches the report after a change.
const money = formatINR;
const dateLabel = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const text = value => value === null || value === undefined || value === "" ? "—" : value;

export function StatusBadge({ status }) {
  const tone = status === "Completed" ? "completed" : status === "Partial" ? "partial" : "pending";
  return <span className={`tcr-status tcr-status-${tone}`}>{status || "Pending"}</span>;
}

export default function TodayCollectionDetail({ api, auth, row, onClose, onChanged }) {
  const { isAdmin } = useSession();
  const history = row.collections || [];
  const [selectedId, setSelectedId] = useState(() => row.collection?.collection_id ?? null);
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false);
  // Keep the selection valid when the row is refreshed after an edit/delete.
  useEffect(() => { if (!history.some(item => item.collection_id === selectedId)) setSelectedId(row.collection?.collection_id ?? null); }, [row]);
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !editing && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, busy, onClose]);
  const selected = history.find(item => item.collection_id === selectedId) || null;
  const latest = row.collection;

  const remove = async () => {
    if (!selected || busy) return;
    if (!await confirmDelete(`Delete collection ${selected.voucher_no} of ${money(selected.receipt_amount)}? Its installment balances will be recalculated. The customer and loan are not deleted.`)) return;
    setBusy(true);
    try {
      await api.delete(transactionEndpoint("collection", selected.collection_id), auth);
      actionToast("Collection deleted successfully.");
      onChanged();
    } catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to delete this collection."), false); }
    finally { setBusy(false); }
  };

  const section = (title, items) => <section className="tcr-detail-section">
    <h3>{title}</h3>
    <dl>{items.map(([label, value, className]) => <div key={label} className={className || ""}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>;

  return <>
    <div className="tcr-detail-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
      <section className="tcr-detail" role="dialog" aria-modal="true" aria-labelledby="tcr-detail-title">
        <header>
          <div><h2 id="tcr-detail-title">{row.particulars}</h2><small>{row.loan_no} · Installment #{row.installment_number}</small></div>
          <StatusBadge status={row.status} />
          <button type="button" className="tcr-detail-close" aria-label="Close" title="Close" onClick={onClose} disabled={busy}>×</button>
        </header>
        <div className="tcr-detail-body">
          {section("Customer Details", [
            ["Customer Name", text(row.customer)], ["Customer Code", text(row.customer_code)],
            ["Contact Number", text(row.customer_phone)], ["Address", text(row.customer_address), "wide"],
          ])}
          {section("Loan Details", [
            ["Loan Number", text(row.loan_no)], ["Loan Type", text(row.loan_type)], ["Plan Name", text(row.plan_name)],
            ["Loan Start Date", dateLabel(row.loan_start_date)], ["Installment / Due Date", `#${row.installment_number} · ${dateLabel(row.date)}`], ["Due Amount", money(row.due_amount)],
          ])}
          {section("Collection Details", [
            ["Voucher Number", text(latest?.voucher_no)], ["Collection Date", latest ? dateLabel(latest.date) : "—"],
            ["Due Amount", money(row.due_amount)], ["Total Received Amount", money(row.received_amount)],
            ["Remaining Balance", money(row.balance_amount)], ["Payment Status", <StatusBadge status={row.status} />],
            ["Payment Mode", text(latest?.payment_mode)], ["Cash / Bank Account", text(latest?.account)],
            ["Ledger", text(latest?.ledger)], ["Notes", text(latest?.notes), "wide"],
          ])}
          <section className="tcr-detail-section">
            <h3>Collection History</h3>
            {history.length ? <div className="tcr-history-wrap"><table className="tcr-history">
              <thead><tr>{isAdmin && <th aria-label="Select" />}<th>Voucher No.</th><th>Date</th><th>Mode</th><th>Account</th><th className="num">Allocated</th><th className="num">Receipt Total</th></tr></thead>
              <tbody>{history.map(item => <tr key={item.collection_id} className={item.collection_id === selectedId ? "selected" : ""} onClick={() => setSelectedId(item.collection_id)}>
                {isAdmin && <td><input type="radio" name="tcr-collection" aria-label={`Select ${item.voucher_no}`} checked={item.collection_id === selectedId} onChange={() => setSelectedId(item.collection_id)} /></td>}
                <td>{item.voucher_no}</td><td>{dateLabel(item.date)}</td><td>{text(item.payment_mode)}</td><td>{text(item.account)}</td>
                <td className="num">{money(item.amount)}</td><td className="num">{money(item.receipt_amount)}</td>
              </tr>)}</tbody>
            </table></div> : <p className="tcr-detail-empty">No collections recorded for this due yet.</p>}
            {isAdmin && history.length > 1 && <p className="tcr-detail-hint">Select a collection to Edit or Delete it.</p>}
          </section>
          <RowDocuments api={api} auth={auth} row={row} />
        </div>
        <footer>
          {isAdmin && selected && <>
            <button type="button" className="tcr-btn" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="tcr-btn tcr-btn-danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete"}</button>
          </>}
          <button type="button" className="tcr-btn tcr-btn-primary" disabled={busy} onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
    {editing && selected && <TransactionEditModal api={api} auth={auth} kind="collection" id={selected.collection_id}
      onClose={() => setEditing(false)}
      onSaved={() => { setEditing(false); actionToast("Collection updated successfully."); onChanged(); }} />}
  </>;
}
