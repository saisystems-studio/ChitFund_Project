import { KycDocumentsSection } from "../../components/KycDocuments/KycDocuments";

// Today Report attachments. Loan rows reuse that loan's existing Loan Application KYC
// documents; Receipt and Payment rows own documents scoped to their transaction id. Files are
// only ever fetched through the authenticated api client as in-memory blobs (never a URL).
// A row may name its owner explicitly (`document_kind`, e.g. Today Collection Report's pending
// installments use their loan); otherwise the Today Report transaction type decides.
export const documentsUrl = row => {
  const kind = row.document_kind || (row.transaction_type === "Loan" ? "loan" : row.transaction_type === "Receipt" ? "receipt" : "payment");
  return kind === "loan" ? `/finance/loans/${row.transaction_id}/kyc-documents/` : `/finance/transaction-documents/${kind}/${row.transaction_id}/`;
};

// Attached documents inside a report row's Detail View — read-only: Preview and Download of
// documents already attached from the Entry pages. Reports never add, upload, capture or
// delete attachments. Rows without document access (document_count === null) show a note.
export function RowDocuments({ api, auth, row }) {
  const allowed = row.document_count !== null && row.document_count !== undefined;
  return <section className="tcr-detail-section today-row-documents">
    <h3>Attached Documents</h3>
    {allowed
      ? <KycDocumentsSection api={api} auth={auth} baseUrl={documentsUrl(row)} allowAdd={false} />
      : <p className="tcr-detail-empty">Documents need administrator or entry access.</p>}
  </section>;
}
