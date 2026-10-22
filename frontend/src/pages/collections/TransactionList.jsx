import "../../styles/compact-report-toolbar.css";
import { useEffect, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import ListFilters, { valueOptions } from "../../components/ListFilters/ListFilters";
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
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import "./transaction-list.css";
import "../../styles/report-layout.css";
import { rowDetail } from "../reportDetail/reportDetailRoute";

const lists = {
  loan: { title: "Loan List", entry: "Loan Application", route: "/loan-application", endpoint: "/finance/loans/?status=ALL", headers: ["Date", "Loan No", "Customer", "Loan Type", "Total Amount", "Outstanding", "Resources"] },
  collection: { title: "Collection Entry History", entry: "Collection Entry", route: "/collection-entry", endpoint: "/finance/collection-history/", headers: ["Date", "Receipt No", "Customer", "Loan No", "Amount", "Resources", "Mode"] },
  payment: { title: "Payment History", entry: "Payment Entry", route: "/payment-entry", endpoint: "/finance/payment-entries/", headers: ["Date", "Particulars", "Voucher No", "Resources", "DR Amount", "CR Amount"] },
};
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";

export default function TransactionList({ api, auth, go, kind }) {
  const config = lists[kind];
  const [entries, setEntries] = useState([]), [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null), [reload, setReload] = useState(0);
  const [exportBusy, setExportBusy] = useState(null);
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
  const [statusFilter, setStatusFilter] = useState(""), [groupFilter, setGroupFilter] = useState("");
  useEffect(() => { setSearch(""); setEditing(null); setStatusFilter(""); setGroupFilter(""); }, [kind]);
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
  // Only the filters that apply to each list: Status for loans (loan status) and
  // collections (payment status), Group for payments (ledger group). Options come
  // from the loaded rows; filtering is client-side and never changes the data.
  const statusOf = entry => kind === "loan" ? entry.loan_status : kind === "collection" ? entry.status : null;
  const filters = kind === "payment"
    ? [{ label: "Group", value: groupFilter, onChange: setGroupFilter, options: valueOptions(entries, entry => entry.ledger_group, "All Groups") }]
    : [{ label: "Status", value: statusFilter, onChange: setStatusFilter, options: valueOptions(entries, statusOf, "All Status") }];
  const visible = entries
    .filter(entry => (!statusFilter || String(statusOf(entry) ?? "") === statusFilter) && (!groupFilter || String(entry.ledger_group ?? "") === groupFilter))
    .filter(entry => values(entry).join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const rawValues = entry => kind === "loan"
    ? [entry.application_date || entry.create_date || "", entry.loan_no, entry.customer?.name, entry.loan_type?.name, Number(entry.total_amount || 0), Number(entry.outstanding_amount || 0), entry.done_by_staff_name || ""]
    : kind === "collection"
      ? [entry.collection_date || "", `RV-${String(entry.id).padStart(6, "0")}`, entry.customer_name, entry.loan_no, Number(entry.collected_amount || 0), entry.done_by_staff_name || "", entry.payment_mode]
      : [entry.date || "", entry.ledger_name || entry.ledger_group || "", paymentVoucherNo(entry), entry.done_by_staff_name || "", "", Number(entry.amount || 0)];
  const numericColumns = kind === "collection" ? [4] : [4, 5];
  const filtersLine = search ? `Search: ${search}` : "";
  const handleExportPdf = async (mode = "pdf") => {
    if (exportBusy) return;
    setExportBusy(mode);
    try {
      await (mode === "print" ? printReportPdf : downloadReportPdf)({
        title: config.title, filtersLine, profile,
        columns: [{ header: "S.No", align: "center" }, ...config.headers.map((header, index) => ({ header, align: numericColumns.includes(index) ? "right" : "left" }))],
        rows: visible.map((entry, index) => [String(index + 1), ...values(entry).map(value => value ?? "—")]),
      }, reportFilename(config.title));
    } catch { setError("Unable to prepare the PDF."); }
    finally { setExportBusy(null); }
  };
  const handleExportExcel = async () => {
    if (exportBusy) return;
    setExportBusy("excel");
    try {
      await downloadReportExcel({
        filename: reportFilename(config.title), title: config.title, subtitle: filtersLine || undefined,
        columns: [{ header: "S.No", width: 8 }, ...config.headers.map((header, index) => ({ header, width: 18, numeric: numericColumns.includes(index) }))],
        rows: visible.map((entry, index) => [index + 1, ...rawValues(entry)]),
      });
    } finally { setExportBusy(null); }
  };
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
  const hasActiveFilters = Boolean(search || statusFilter || groupFilter);
  const clearFilters = () => { setSearch(""); setStatusFilter(""); setGroupFilter(""); };
  return <div className={`rl-page transaction-list-page data-page ${kind === "payment" ? "compact-report-page" : ""}`}>
    <div className="rl-header">
      <PageBreadcrumb current={config.title} />
      {kind !== "payment" && <div className="rl-actions">
        <button type="button" className="rl-btn" onClick={clearFilters} disabled={!hasActiveFilters}>Clear Filters</button>
        <ReportExportButtons onPdf={() => handleExportPdf()} onExcel={handleExportExcel} onPrint={() => handleExportPdf("print")} busy={exportBusy} disabled={!visible.length} />
        <button className="primary" onClick={() => go(config.route)}>+ {config.entry}</button>
      </div>}
    </div>
    <div className="rl-filters" role="search">
      <label className="rl-field"><span className="rl-label">Search</span>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}...`} aria-label={`Search ${config.title}`} autoComplete="off" />
      </label>
      {filters.map(filter => <label key={filter.label} className="rl-field"><span className="rl-label">{filter.label}</span><ListFilters filters={[filter]} /></label>)}
      {kind === "payment" && <div className="rl-actions">
        <button type="button" className="rl-btn" onClick={clearFilters} disabled={!hasActiveFilters}>Clear Filters</button>
        <ReportExportButtons onPdf={() => handleExportPdf()} onExcel={handleExportExcel} onPrint={() => handleExportPdf("print")} busy={exportBusy} disabled={!visible.length} />
        <button className="primary" onClick={() => go(config.route)}>+ {config.entry}</button>
      </div>}
    </div>
    {error && <div role="alert" className="collection-entry-error">{error}</div>}
    <section className="panel list-container transaction-list data-container"><div className="table-wrap data-table-area"><table className={kind === "payment" ? "payment-history-table" : undefined}>
      <thead><tr><th>S.No</th>{config.headers.map(header => <th key={header} className={kind === "payment" && header.endsWith("Amount") ? "num" : undefined}>{header}</th>)}<th className="transaction-action-head">Action</th></tr></thead>
      <tbody>{visible.map((entry, index) => { const outputColumn = config.headers.length - 1; return <tr key={entry.id} tabIndex={kind === "loan" ? undefined : 0} {...rowDetail(go, kind === "loan" ? "loan" : "voucher", kind === "loan" ? entry.id : `${kind === "collection" ? "RV" : "PV"}-${String(entry.id).padStart(6, "0")}`)}><td>{index + 1}</td>{values(entry).map((value, column) => <td key={column} className={[kind === "collection" && column === outputColumn ? "transaction-output-cell" : "", kind === "payment" && column >= 4 ? "num" : ""].filter(Boolean).join(" ") || undefined}>{value ?? "—"}
        {kind === "collection" && column === outputColumn && <span className="transaction-output-actions"><button disabled={Boolean(busy)} onClick={() => output(entry, "pdf")}>PDF</button><button disabled={Boolean(busy)} onClick={() => output(entry, "print")}>Print</button></span>}
      </td>)}<td className="transaction-row-action-cell">{kind === "loan" ? <RowActions onEdit={() => go(`/loan-application/${entry.id}/edit`)} onDelete={() => removeLoan(entry)}/> : kind === "payment" ? <RowActions onPdf={() => output(entry, "pdf")} onPrint={() => output(entry, "print")} disabled={Boolean(busy)} onEdit={() => { if (!busy) setEditing(entry.id); }} onDelete={() => remove(entry)}/> : <RowActions onEdit={() => { if (!busy) setEditing(entry.id); }} onDelete={() => remove(entry)}/>}</td></tr>; })}</tbody>
    </table>{!visible.length && <div className="empty">{loading ? "Loading entries..." : error ? "Entries could not be loaded." : "No entries found."}</div>}</div>
    <footer className="footer paginationFooter data-footer"><span>Showing {visible.length} of {entries.length}</span></footer></section>
    {editing != null && <TransactionEditModal api={api} auth={auth} kind={kind} id={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload(value => value + 1); actionToast("Entry updated successfully."); }}/ >}
  </div>;
}
