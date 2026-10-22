import { useEffect, useRef, useState } from "react";
import DocumentPreviewModal from "./DocumentPreviewModal";
import styles from "./KycDocuments.module.css";

// Read-only preview of documents already attached to a customer and to their loans
// (Customer-wise Report). One click on the report's View opens this directly on the
// first attachment; several attachments are browsed with Previous / Next inside the
// same modal. There is deliberately no upload, add, replace, edit or delete action,
// and records/storage are never touched — files are fetched through the existing
// authenticated endpoints as in-memory blobs.
const documentLabel = doc => doc.document_type === "OTHER" ? (doc.other_document_name || "Other") : (doc.document_type_display || doc.document_type || "Document");
const isPdf = doc => (doc.file_type || "").includes("pdf") || /\.pdf$/i.test(doc.original_file_name || "");
const isImage = doc => (doc.file_type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(doc.original_file_name || "");
const rows = data => data?.results ?? data ?? [];

export function attachmentSources(customer, loans) {
  return [
    ...(customer ? [{ key: `customer-${customer.id}`, title: "Customer KYC", baseUrl: `/customers/${customer.id}/kyc-documents/` }] : []),
    ...loans.map(loan => ({ key: `loan-${loan.id}`, title: `Loan ${loan.doc_no || loan.id}`, baseUrl: `/finance/loans/${loan.id}/kyc-documents/` })),
  ];
}

const navButton = { height: 30, minWidth: 30, padding: "0 10px", border: "1px solid #cfdcea", borderRadius: 6, background: "#fff", color: "#174d7c", font: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" };

export default function ReadOnlyAttachmentsModal({ api, auth, title, sources, onClose }) {
  const [items, setItems] = useState(null), [index, setIndex] = useState(0), [error, setError] = useState("");
  const [file, setFile] = useState(null), [fileLoading, setFileLoading] = useState(false);
  const urls = useRef(new Map());

  // Every attachment of the customer and of the relevant loan(s), in one flat list.
  useEffect(() => {
    let active = true;
    Promise.allSettled(sources.map(source => api.get(source.baseUrl, auth))).then(results => {
      if (!active) return;
      if (results.length && results.every(result => result.status === "rejected")) {
        const status = results[0].reason?.response?.status;
        setError(status === 403 ? "Viewing attachments requires administrator or entry access." : "Unable to load attachments.");
      }
      setItems(sources.flatMap((source, i) => results[i].status === "fulfilled" ? rows(results[i].value.data).map(doc => ({ source, doc })) : []));
      setIndex(0);
    });
    return () => { active = false; };
  }, [sources.map(source => source.baseUrl).join("|")]);

  // Load the current attachment's file (cached per document while the modal is open).
  const current = items?.[index];
  useEffect(() => {
    if (!current) { setFile(null); return; }
    const key = `${current.source.baseUrl}${current.doc.id}`;
    if (urls.current.has(key)) { setFile({ key, url: urls.current.get(key) }); return; }
    let active = true;
    setFileLoading(true); setError("");
    api.get(`${current.source.baseUrl}${current.doc.id}/file/`, { ...auth, responseType: "blob" })
      .then(({ data }) => { const url = URL.createObjectURL(data); urls.current.set(key, url); if (active) setFile({ key, url }); })
      .catch(() => { if (active) { setFile(null); setError("Unable to open this attachment."); } })
      .finally(() => { if (active) setFileLoading(false); });
    return () => { active = false; };
  }, [current?.source.baseUrl, current?.doc.id]);
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); }, []);

  const count = items?.length || 0;
  const step = delta => setIndex(value => Math.min(count - 1, Math.max(0, value + delta)));
  useEffect(() => {
    const onKey = event => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, count]);

  const shown = current && file?.key === `${current.source.baseUrl}${current.doc.id}` ? file.url : null;
  if (shown && !error && (isPdf(current.doc) || isImage(current.doc))) return <DocumentPreviewModal
    key={file.key} title={`${documentLabel(current.doc)} ? ${current.source.title}`}
    fileName={current.doc.original_file_name} url={shown} isPdf={isPdf(current.doc)} onClose={onClose}
    onDownload={() => { const link = document.createElement("a"); link.href = shown; link.download = current.doc.original_file_name || "Document"; link.click(); }}
    headerExtra={count > 1 && <><button type="button" style={navButton} disabled={index === 0} onClick={() => step(-1)}>Previous</button><span>{index + 1} / {count}</span><button type="button" style={navButton} disabled={index === count - 1} onClick={() => step(1)}>Next</button></>}
  />;
  return <div className={styles.modalBackdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className={styles.previewModal} role="dialog" aria-modal="true" aria-labelledby="ro-attachments-title" style={{ width: "min(760px,100%)" }}>
      <header>
        <strong id="ro-attachments-title">{current ? `${documentLabel(current.doc)} — ${current.source.title}` : `Attachments — ${title}`}</strong>
        <button type="button" onClick={onClose} aria-label="Close" title="Close">×</button>
      </header>
      <div className={styles.previewBody}>
        {!items && !error && <p className={styles.empty}>Loading attachments…</p>}
        {items && !count && !error && <p className={styles.empty}>No attachments available.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {current && !error && (fileLoading && !shown ? <p className={styles.empty}>Opening…</p>
          : shown && (isPdf(current.doc) ? <iframe title="Attachment preview" src={`${shown}#toolbar=0`} />
            : isImage(current.doc) ? <img src={shown} alt={documentLabel(current.doc)} />
            : <p className={styles.empty}>Preview is not available for this file type.</p>))}
      </div>
      {count > 1 && <footer style={{ justifyContent: "space-between", alignItems: "center" }}>
        <button type="button" style={navButton} disabled={index === 0} onClick={() => step(-1)} aria-label="Previous attachment">‹ Previous</button>
        <span style={{ color: "#4f6a84", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {index + 1} of {count}{current?.doc.original_file_name ? ` · ${current.doc.original_file_name}` : ""}
        </span>
        <button type="button" style={navButton} disabled={index === count - 1} onClick={() => step(1)} aria-label="Next attachment">Next ›</button>
      </footer>}
    </div>
  </div>;
}
