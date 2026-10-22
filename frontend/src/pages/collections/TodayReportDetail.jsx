import { useEffect, useState } from "react";
import { formatINR } from "../../utils/currency";
import { useSession } from "../../components/SessionContext";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import TransactionEditModal, { transactionEndpoint } from "./TransactionEditModal";
import { RowDocuments } from "./TodayReportDocuments";
import BankTransferForm from "../bankTransfers/BankTransferForm";
import { ENDPOINT as BANK_TRANSFER_ENDPOINT } from "../bankTransfers/bankTransfer";
import "../bankTransfers/bank-transfers.css";
import { PartyCollectionEditModal } from "./PartyCollection";
import "./today-collection-detail.css";

// Detail View of one Today Report row (a Loan application, Collection receipt, Payment or Bank Transaction
// ): its details, its attached documents (view / download / attach) and, for admins,
// Edit / Delete through the same endpoints the Loan, Collection and Payment lists use.
// The parent re-fetches the report after a change; filters and totals are untouched.
const money = formatINR;
const dateLabel = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const text = value => value === null || value === undefined || value === "" ? "—" : value;
const kindOf = row => row.transaction_type === "Loan" ? "loan" : row.transaction_type === "Receipt" ? "collection" : row.transaction_type === "Bank Transaction" ? "transfer" : row.transaction_type === "Collection Entry" ? "party" : "payment";
const KIND_LABELS = { loan: "Loan", collection: "Collection", payment: "Payment", transfer: "Bank Transaction", party: "Party Collection" };

export default function TodayReportDetail({ api, auth, go, row, onClose, onChanged }) {
  const { isAdmin } = useSession();
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false);
  const kind = kindOf(row);
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !editing && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, busy, onClose]);

  const edit = () => { if (kind === "loan") go(`/loan-application/${row.transaction_id}/edit`); else setEditing(true); };
  const remove = async () => {
    if (busy) return;
    const label = kind === "loan" ? `loan ${row.loan_no || ""}`.trim() : kind === "party" ? `party collection ${row.voucher_no}? Its due allocations will be reversed` : kind === "transfer" ? `${row.voucher_no}? Its From (Cr) and To (Dr) postings will be reversed` : `${kind} entry ${row.voucher_no || ""}`.trim();
    if (!await confirmDelete(`Delete ${label}?`)) return;
    setBusy(true);
    try {
      await api.delete(kind === "loan" ? `/finance/loans/${row.transaction_id}/` : kind === "transfer" ? `${BANK_TRANSFER_ENDPOINT}${row.transaction_id}/` : kind === "party" ? `/finance/party-collections/${row.transaction_id}/` : transactionEndpoint(kind, row.transaction_id), auth);
      actionToast(`${KIND_LABELS[kind]} deleted successfully.`);
      onChanged(); onClose();
    } catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to delete this entry."), false); }
    finally { setBusy(false); }
  };

  const items = [
    ["Date", dateLabel(row.date)], ["Transaction Type", text(row.transaction_type)], ["Voucher Number", text(row.voucher_no)],
    ["Loan Type", text(row.loan_type)], ["Loan Number", text(row.loan_no)], ["Amount", money(row.amount)], ["Payment Mode", text(kind === "transfer" || kind === "party" ? row.account_type : row.payment_mode)],
    ["Customer / Particulars", text(row.particulars), "wide"],
  ];

  return <>
    <div className="tcr-detail-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
      <section className="tcr-detail" role="dialog" aria-modal="true" aria-labelledby="today-detail-title">
        <header>
          <div><h2 id="today-detail-title">{row.particulars || row.transaction_type}</h2><small>{[row.transaction_type, row.voucher_no, dateLabel(row.date)].filter(Boolean).join(" · ")}</small></div>
          <button type="button" className="tcr-detail-close" aria-label="Close" title="Close" onClick={onClose} disabled={busy}>×</button>
        </header>
        <div className="tcr-detail-body">
          <section className="tcr-detail-section">
            <h3>{row.transaction_type} Details</h3>
            <dl>{items.map(([label, value, className]) => <div key={label} className={className || ""}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </section>
          <RowDocuments api={api} auth={auth} row={row} />
        </div>
        <footer>
          {isAdmin && <>
            <button type="button" className="tcr-btn" disabled={busy} onClick={edit}>Edit</button>
            <button type="button" className="tcr-btn tcr-btn-danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete"}</button>
          </>}
          <button type="button" className="tcr-btn tcr-btn-primary" disabled={busy} onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
    {editing && kind === "transfer" && <div className="bt-modal-backdrop"><div className="bt-edit-modal" role="dialog" aria-modal="true" aria-label="Edit Bank Transaction">
      <BankTransferForm api={api} auth={auth} go={go} id={row.transaction_id} onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); actionToast("Entry updated successfully."); onChanged(); }} /></div></div>}
    {editing && kind === "party" && <PartyCollectionEditModal api={api} auth={auth} id={row.transaction_id} onClose={() => setEditing(false)}
      onSaved={() => { setEditing(false); actionToast("Entry updated successfully."); onChanged(); }} />}
    {editing && !["loan", "transfer", "party"].includes(kind) && <TransactionEditModal api={api} auth={auth} kind={kind} id={row.transaction_id}
      onClose={() => setEditing(false)}
      onSaved={() => { setEditing(false); actionToast("Entry updated successfully."); onChanged(); }} />}
  </>;
}
