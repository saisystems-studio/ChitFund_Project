import { useEffect, useState } from "react";
import ListPageToolbar from "../../components/ListPageToolbar";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { fetchAllPages } from "../../utils/pendingReport";
import { formatINR } from "../../utils/currency";
import { downloadReceipt, printReceipt } from "../../utils/collectionReceipt";
import { downloadPaymentVoucher, paymentVoucherNo, printPaymentVoucher } from "../../utils/paymentVoucher";
import { actionToast } from "../../utils/actionToast";
import apiErrorMessage from "../../utils/apiErrorMessage";
import RowActions from "../../components/RowActions";
import confirmDelete from "../../utils/confirmDelete";
import TransactionEditModal, { transactionEndpoint } from "./TransactionEditModal";
import "./transaction-list.css";

const lists = {
  loan: { title: "Loan List", entry: "Loan Application", route: "/loan-application", endpoint: "/finance/loans/?status=ALL", headers: ["Date", "Loan No", "Customer", "Loan Type", "Total Amount", "Outstanding", "Salesman"] },
  collection: { title: "Collection Entry History", entry: "Collection Entry", route: "/collection-entry", endpoint: "/finance/collection-history/", headers: ["Date", "Receipt No", "Customer", "Loan No", "Amount", "Salesman", "Mode"] },
  payment: { title: "Payment History", entry: "Payment Entry", route: "/payment-entry", endpoint: "/finance/payment-entries/", headers: ["Date", "Particulars", "Voucher No", "Salesman", "DR Amount", "CR Amount"] },
};
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";

export default function TransactionList({ api, auth, go, kind }) {
  const config = lists[kind];
  const [entries, setEntries] = useState([]), [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null), [reload, setReload] = useState(0);
  const { profile, refreshProfile } = useCompanyProfile() || {};
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setEntries([]);
    fetchAllPages(api, config.endpoint, auth)
      .then(rows => { if (active) setEntries(rows); })
      .catch(requestError => { if (active) setError(apiErrorMessage(requestError, `Unable to load ${config.title.toLowerCase()}.`)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, reload]);
  useEffect(() => { setSearch(""); setEditing(null); }, [kind]);
  const remove = async entry => {
    if (busy || !await confirmDelete(`Delete this ${kind} entry?`)) return;
    setBusy(`delete-${entry.id}`);
    try {
      await api.delete(transactionEndpoint(kind, entry.id), auth);
      setEntries(current => current.filter(item => item.id !== entry.id));
      actionToast(`${kind === "collection" ? "Collection" : "Payment"} entry deleted successfully.`);
    } catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to delete this entry."), false); }
    finally { setBusy(null); }
  };
  const removeLoan = async entry => {
    if (busy || !await confirmDelete(`Delete loan ${entry.loan_no || entry.doc_no || "record"}?`)) return;
    setBusy(`delete-${entry.id}`);
    try {
      await api.delete(`/finance/loans/${entry.id}/`, auth);
      setEntries(current => current.filter(item => item.id !== entry.id));
      actionToast("Loan deleted successfully.");
    } catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to delete loan."), false); }
    finally { setBusy(null); }
  };
  const values = entry => kind === "loan"
    ? [dateLabel(entry.application_date || entry.create_date), entry.loan_no, entry.customer?.name, entry.loan_type?.name, formatINR(entry.total_amount), formatINR(entry.outstanding_amount), entry.done_by_staff_name || "—"]
    : kind === "collection"
      ? [dateLabel(entry.collection_date), `RV-${String(entry.id).padStart(6, "0")}`, entry.customer_name, entry.loan_no, formatINR(entry.collected_amount), entry.done_by_staff_name || "—", entry.payment_mode]
      // Payment Entries always draw down Cash/Bank, so every row posts to CR Amount; DR Amount is reserved for a future debit-type voucher.
      : [dateLabel(entry.date), entry.ledger_name || entry.ledger_group || "—", paymentVoucherNo(entry), entry.done_by_staff_name || "—", "—", formatINR(entry.amount)];
  const visible = entries.filter(entry => values(entry).join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const output = async (entry, action) => {
    if (busy) return;
    setBusy(`${entry.id}-${action}`);
    try {
      const company = await (refreshProfile ? refreshProfile().catch(() => profile) : profile);
      if (kind === "collection") {
        const { data } = await api.get("/finance/collections/receipt/", { ...auth, params: { ids: entry.id } });
        await (action === "pdf" ? downloadReceipt : printReceipt)(data, company);
      } else {
        await (action === "pdf" ? downloadPaymentVoucher : printPaymentVoucher)(entry, company);
      }
    } catch (requestError) { actionToast(apiErrorMessage(requestError, "Unable to prepare the document."), false); }
    finally { setBusy(null); }
  };
  return <>
    <ListPageToolbar eyebrow="REPORTS" title={config.title} search={search} onSearch={setSearch} placeholder={`Search ${config.title.toLowerCase()}...`} action={<button className="primary" onClick={() => go(config.route)}>+ {config.entry}</button>}/>
    {error && <div role="alert" className="collection-entry-error">{error}</div>}
    <section className="panel list-container transaction-list"><div className="table-wrap"><table className={kind === "payment" ? "payment-history-table" : undefined}>
      <thead><tr><th>S.No</th>{config.headers.map(header => <th key={header} className={kind === "payment" && header.endsWith("Amount") ? "num" : undefined}>{header}</th>)}<th className="transaction-action-head">Action</th></tr></thead>
      <tbody>{visible.map((entry, index) => { const outputColumn = config.headers.length - 1; return <tr key={entry.id} tabIndex={kind === "loan" ? undefined : 0}><td>{index + 1}</td>{values(entry).map((value, column) => <td key={column} className={[kind === "collection" && column === outputColumn ? "transaction-output-cell" : "", kind === "payment" && column >= 4 ? "num" : ""].filter(Boolean).join(" ") || undefined}>{value ?? "—"}
        {kind === "collection" && column === outputColumn && <span className="transaction-output-actions"><button disabled={Boolean(busy)} onClick={() => output(entry, "pdf")}>PDF</button><button disabled={Boolean(busy)} onClick={() => output(entry, "print")}>Print</button></span>}
      </td>)}<td className="transaction-row-action-cell">{kind === "loan" ? <RowActions onEdit={() => go(`/loan-application/${entry.id}/edit`)} onDelete={() => removeLoan(entry)}/> : kind === "payment" ? <RowActions onPdf={() => output(entry, "pdf")} onPrint={() => output(entry, "print")} disabled={Boolean(busy)} onEdit={() => { if (!busy) setEditing(entry.id); }} onDelete={() => remove(entry)}/> : <RowActions onEdit={() => { if (!busy) setEditing(entry.id); }} onDelete={() => remove(entry)}/>}</td></tr>; })}</tbody>
    </table>{!visible.length && <div className="empty">{loading ? "Loading entries..." : error ? "Entries could not be loaded." : "No entries found."}</div>}</div>
    <footer className="footer paginationFooter"><span>Showing {visible.length} of {entries.length}</span></footer></section>
    {editing != null && <TransactionEditModal api={api} auth={auth} kind={kind} id={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload(value => value + 1); actionToast("Entry updated successfully."); }}/ >}
  </>;
}
