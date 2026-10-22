import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../components/SessionContext";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import apiErrorMessage from "../../utils/apiErrorMessage";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";
import { goBack } from "../../utils/navigation";
import TransactionEditModal, { transactionEndpoint } from "../collections/TransactionEditModal";
import { PartyCollectionEditModal } from "../collections/PartyCollection";
import { RowDocuments } from "../collections/TodayReportDocuments";
import BankTransferForm from "../bankTransfers/BankTransferForm";
import { ENDPOINT as BANK_TRANSFER_ENDPOINT } from "../bankTransfers/bankTransfer";
import "../bankTransfers/bank-transfers.css";
import "../collections/today-collection-detail.css";
import ReportDetailLayout from "./ReportDetailLayout";
import { downloadDetailExcel, downloadDetailPdf, printDetailPdf } from "./detailExport";
import { findNode, groupModel, installmentModel, ledgerModel, loanModel, voucherModel } from "./detailModels";

export const REPORT_DETAIL_CHANGED = "report-detail:changed";
const deleteUrl = admin => admin.kind === "loan" ? `/finance/loans/${admin.id}/` : admin.kind === "transfer" ? `${BANK_TRANSFER_ENDPOINT}${admin.id}/`
  : admin.kind === "party" ? `/finance/party-collections/${admin.id}/` : transactionEndpoint(admin.kind, admin.id);
const REPORTS = { "trial-balance": "Trial Balance", "profit-loss": "Profit & Loss", "balance-sheet": "Balance Sheet" };

// One request per record: repeated mounts (StrictMode, quick re-opens) share the in-flight call.
const inflight = new Map();
const once = (key, run) => {
  if (!inflight.has(key)) inflight.set(key, run().finally(() => inflight.delete(key)));
  return inflight.get(key);
};

// Resolves a route to a model. Each kind talks to the endpoint that already owns that data.
async function fetchModel({ api, auth, kind, id, params }) {
  const range = { from: params.from || undefined, to: params.to || undefined };
  if (kind === "voucher" || kind === "loan" || kind === "installment") {
    const query = kind === "loan" ? { kind: "loan", id, installment: params.installment } : kind === "installment" ? { kind: "installment", id } : { kind: "voucher", ref: id };
    const { data } = await api.get("/finance/reports/detail/", { ...auth, params: query });
    return { model: data.kind === "loan" ? loanModel(data) : data.kind === "installment" ? installmentModel(data) : voucherModel(data), documents: data.documents };
  }
  if (kind === "ledger") {
    const ledgerId = id.replace(/^ledger-/, "");
    const [statement, ledger] = await Promise.all([
      api.get("/finance/reports/ledger/", { ...auth, params: { type: "ledger", ledger: ledgerId, ...range } }),
      api.get(`/finance/ledgers/${ledgerId}/`, auth).catch(() => ({ data: null })),
    ]);
    return { model: ledgerModel({ statement: statement.data, ledger: ledger.data, params }) };
  }
  if (kind === "group") {
    const report = REPORTS[params.report] ? params.report : "trial-balance";
    const { data } = await api.get(`/finance/reports/${report}/`, { ...auth, params: range });
    const node = findNode(data, id);
    if (!node) throw new Error("This group is no longer part of the report.");
    return { model: groupModel({ node, reportLabel: REPORTS[report], params: { ...params, report } }) };
  }
  throw new Error("Unknown report record.");
}

export default function ReportDetailPage({ api, auth, go, kind, id, params }) {
  const { isAdmin } = useSession();
  const { profile } = useCompanyProfile() || {};
  const [result, setResult] = useState({ state: "loading" });
  const [busy, setBusy] = useState(null), [editing, setEditing] = useState(false), [reload, setReload] = useState(0);
  const signature = JSON.stringify([kind, id, params]);

  useEffect(() => {
    let active = true;
    setResult({ state: "loading" });
    once(`${signature}:${reload}`, () => fetchModel({ api, auth, kind, id, params }))
      .then(({ model, documents }) => { if (active) setResult({ state: "ready", model, documents }); })
      .catch(error => { if (active) setResult({ state: "error", message: error.response ? apiErrorMessage(error, "Unable to load these details.") : error.message || "Unable to load these details." }); });
    return () => { active = false; };
  }, [signature, reload]);

  const model = result.state === "ready" ? result.model : null, documents = result.state === "ready" ? result.documents : null;
  const admin = isAdmin ? model?.admin : null;
  const back = useCallback(() => goBack("/dashboard"), []);
  const run = useCallback(async (mode, action) => {
    if (busy || !model) return;
    setBusy(mode);
    try { await action(model, profile); } catch { actionToast("Unable to prepare the file.", false); } finally { setBusy(null); }
  }, [busy, model, profile]);

  // The report underneath was opened before this change, so it is rebuilt from fresh data.
  const changed = () => { window.dispatchEvent(new Event(REPORT_DETAIL_CHANGED)); };
  const remove = async () => {
    if (!admin || busy) return;
    const label = model.reference || model.title;
    if (!await confirmDelete(`Delete ${label}? Balances will be recalculated by the existing delete rules.`)) return;
    setBusy("delete");
    try {
      await api.delete(deleteUrl(admin), auth);
      actionToast("Deleted successfully.");
      changed();
      back();
    } catch (error) { actionToast(apiErrorMessage(error, "Unable to delete this record."), false); setBusy(null); }
  };
  const edit = admin && (admin.kind === "loan" ? () => go(`/loan-application/${admin.id}/edit`) : () => setEditing(true));

  return <>
    <ReportDetailLayout state={result.state} model={result.state === "error" ? result.message : model} go={go} busy={busy} canManage={Boolean(admin)}
      onBack={back} onRetry={() => setReload(value => value + 1)}
      onPrint={() => run("print", printDetailPdf)} onPdf={() => run("pdf", downloadDetailPdf)} onExcel={() => run("excel", downloadDetailExcel)}
      onEdit={edit} onDelete={admin ? remove : undefined}
      extra={documents?.kind && <RowDocuments api={api} auth={auth} row={{ document_kind: documents.kind, transaction_id: documents.id, document_count: documents.allowed ? 0 : null }} />} />
    {editing && admin && (() => {
      const onSaved = () => { setEditing(false); actionToast("Updated successfully."); changed(); setReload(value => value + 1); };
      const onClose = () => setEditing(false);
      return admin.kind === "transfer"
        ? <div className="bt-modal-backdrop"><div className="bt-edit-modal" role="dialog" aria-modal="true" aria-label="Edit Bank Transaction"><BankTransferForm api={api} auth={auth} go={go} id={admin.id} onClose={onClose} onSaved={onSaved} /></div></div>
        : admin.kind === "party" ? <PartyCollectionEditModal api={api} auth={auth} id={admin.id} onClose={onClose} onSaved={onSaved} />
        : <TransactionEditModal api={api} auth={auth} kind={admin.kind} id={admin.id} onClose={onClose} onSaved={onSaved} />;
    })()}
  </>;
}
