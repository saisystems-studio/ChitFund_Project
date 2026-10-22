import SearchableDropdown from "../SearchableDropdown/SearchableDropdown";
import { useEffect, useRef, useState } from "react";
import styles from "./KycDocuments.module.css";
import { CameraSession, cameraError } from "./cameraSession";
import { newUploadToken } from "./pendingDocuments";
import DocumentPreviewModal from "./DocumentPreviewModal";
import confirmDelete from "../../utils/confirmDelete";
import { actionToast } from "../../utils/actionToast";

const DOCUMENT_TYPES = [
  ["AADHAAR", "Aadhaar Card"], ["PAN", "PAN Card"], ["RATION", "Ration Card"], ["VOTER_ID", "Voter ID"],
  ["DRIVING_LICENCE", "Driving Licence"], ["PASSPORT", "Passport"], ["BANK_PASSBOOK", "Bank Passbook"],
];
const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function validateFile(file) {
  if (!file) return "Choose a file or capture a photo first.";
  const extension = `.${(file.name.split(".").pop() || "").toLowerCase()}`;
  if (!ACCEPTED_EXTENSIONS.includes(extension) || (file.type && !ACCEPTED_MIME.includes(file.type))) return "Only JPG, PNG, WEBP or PDF files are allowed.";
  if (file.size > MAX_FILE_SIZE) return "File is too large — the maximum size is 5 MB.";
  return "";
}

function Icon({ name }) {
  const paths = {
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />,
    upload: <path d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
    download: <path d="M12 4v12m0 0 4-4m-4 4-4-4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
    camera: <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />,
    file: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

// PDF by MIME type, or by extension when the browser/server gives no type.
const isPdfFile = (type, name) => String(type || "").toLowerCase().includes("pdf") || /\.pdf$/i.test(String(name || ""));

const documentLabel = doc => doc.document_type === "OTHER" ? (doc.other_document_name || "Other") : doc.document_type_display;

// The compact "KYC Documents" block — used standalone inside Add/Edit Customer, the
// Loan Application form (Phase 9), and read-only (allowAdd=false) inside the
// Customer List's drawer/modal. Documents are never fetched via a public URL:
// View/Download always go through the authenticated axios client (api, with the
// caller's auth header), as an in-memory blob.
//
// `baseUrl` is the entity-scoped endpoint root, e.g. `/customers/5/kyc-documents/`
// or `/finance/loans/12/kyc-documents/` — everything else (dropdown, upload,
// preview, custom-type reuse) is identical regardless of which entity owns the
// documents. `customerId` is kept as a backward-compatible shorthand for the
// customer case so existing callers (Add/Edit Customer) are untouched.
// `allowDelete` (off by default) adds a Delete action to saved documents, for owners whose
// API supports DELETE {root}{id}/ (e.g. Staff). Pending documents can always be removed.
// `idProofRequired` (on by default) shows the red * on ID Proof; Staff turns it off.
export function KycDocumentsSection({ api, auth, customerId, baseUrl, allowAdd = true, allowDelete = false, pendingDocuments = [], onPendingChange, disabled = false, idProofRequired = true }) {
  const root = baseUrl || (customerId ? `/customers/${customerId}/kyc-documents/` : null);
  const kycUrl = documentId => `${root}${documentId ? `${documentId}/file/` : ""}`;
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customTypes, setCustomTypes] = useState([]);
  const [documentType, setDocumentType] = useState("AADHAAR");
  const [otherName, setOtherName] = useState("");
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [camera, setCamera] = useState(false);
  const [preview, setPreview] = useState(null);
  const [localPreview, setLocalPreview] = useState(null);
  const fileInputRef = useRef(null);
  const uploadTokenRef = useRef(null);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview.url); }, [localPreview]);
  useEffect(() => () => { if (preview && !preview.local) URL.revokeObjectURL(preview.url); }, [preview]);

  const load = () => {
    if (!root) { setLoading(false); return; }
    setLoading(true);
    api.get(kycUrl(), auth)
      .then(({ data }) => { setDocuments(data || []); setError(""); })
      .catch(() => setError("Unable to load KYC documents."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [api, root]);
  // Custom "Other" names used before are offered back here — they persist across
  // refreshes because the backend saves them (once) the moment a document using
  // that name is actually attached, never just from typing into the field.
  useEffect(() => { api.get("/customer-document-types/", auth).then(({ data }) => setCustomTypes(data || [])).catch(() => {}); }, [api]);
  const typeOptions = [...DOCUMENT_TYPES, ...customTypes.map(item => [`OTHER:${item.name}`, item.name]), ["OTHER", "Other"]];
  const selectedType = documentType === "OTHER" && customTypes.some(item => item.name === otherName) ? `OTHER:${otherName}` : documentType;

  const chooseType = value => {
    setFileError("");
    if (value.startsWith("OTHER:")) { setDocumentType("OTHER"); setOtherName(value.slice("OTHER:".length)); }
    else { setDocumentType(value); if (value !== "OTHER") setOtherName(""); }
  };

  const pickFile = candidate => {
    uploadTokenRef.current = newUploadToken();
    if (localPreview) { URL.revokeObjectURL(localPreview.url); setLocalPreview(null); }
    const message = validateFile(candidate);
    setFileError(message);
    setFile(message ? null : candidate);
    if (!message && candidate) setLocalPreview({ url: URL.createObjectURL(candidate), isPdf: isPdfFile(candidate.type, candidate.name) });
  };
  const onDrop = event => { event.preventDefault(); setDragOver(false); pickFile(event.dataTransfer.files?.[0]); };
  const onBrowse = event => { pickFile(event.target.files?.[0]); event.target.value = ""; };
  const removeFile = () => { if (localPreview) URL.revokeObjectURL(localPreview.url); setLocalPreview(null); setFile(null); };

  const addDocument = async () => {
    if (saving || disabled) return;
    const message = validateFile(file);
    if (message) { setFileError(message); return; }
    if (documentType === "OTHER" && !otherName.trim()) { setFileError("Enter a document name for 'Other'."); return; }
    if (onPendingChange) {
      onPendingChange([...pendingDocuments, { file, documentType, otherName, uploadToken: uploadTokenRef.current }]);
      removeFile(); setFileError(""); return;
    }
    if (!root) return;
    setSaving(true); setError(""); setFileError("");
    try {
      const body = new FormData();
      body.append("document_type", documentType);
      body.append("upload_token", uploadTokenRef.current);
      if (documentType === "OTHER") body.append("other_document_name", otherName.trim());
      body.append("file", file, file.name);
      const isNewOther = documentType === "OTHER" && !customTypes.some(item => item.name.toLowerCase() === otherName.trim().toLowerCase());
      await api.post(kycUrl(), body, auth);
      removeFile(); setOtherName("");
      load();
      if (isNewOther) api.get("/customer-document-types/", auth).then(({ data }) => setCustomTypes(data || [])).catch(() => {});
    } catch (requestError) {
      const data = requestError.response?.data;
      setError((data && (data.file?.[0] || data.other_document_name?.[0] || data.detail)) || "Unable to attach this document.");
    } finally { setSaving(false); }
  };

  const openPreview = async doc => {
    try {
      const { data } = await api.get(kycUrl(doc.id), { ...auth, responseType: "blob" });
      setPreview({ doc, url: URL.createObjectURL(data), isPdf: isPdfFile(doc.file_type || data?.type, doc.original_file_name) });
    } catch { setError("Unable to open this document."); }
  };
  const closePreview = () => { if (preview && !preview.local) URL.revokeObjectURL(preview.url); setPreview(null); };
  const downloadLocalFile = () => {
    if (!file) return;
    const link = Object.assign(document.createElement("a"), { href: localPreview?.url || "", download: file.name });
    document.body.appendChild(link); link.click(); link.remove();
  };
  const downloadPendingPreview = () => {
    const link = Object.assign(document.createElement("a"), { href: preview.url, download: preview.downloadName });
    document.body.appendChild(link); link.click(); link.remove();
  };

  const deleteDocument = async doc => {
    if (!await confirmDelete(`Delete ${doc.original_file_name || "this document"}?`)) return;
    try { await api.delete(`${root}${doc.id}/`, auth); actionToast("Document deleted successfully."); load(); }
    catch (requestError) { setError(requestError.response?.data?.detail || "Unable to delete this document."); }
  };
  const downloadDocument = async doc => {
    try {
      const { data } = await api.get(`${kycUrl(doc.id)}?download=1`, { ...auth, responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = Object.assign(document.createElement("a"), { href: url, download: doc.original_file_name || "document" });
      document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
    } catch { setError("Unable to download this document."); }
  };

  const pendingTypeLabel = item => item.documentType === "OTHER" ? item.otherName : DOCUMENT_TYPES.find(([value]) => value === item.documentType)?.[1];
  const totalDocuments = pendingDocuments.length + documents.length;

  return <div className={styles.section}>
    {allowAdd && <h3 className={styles.sectionTitle}>KYC / Document Attachments</h3>}
    <div className={allowAdd ? styles.columns : styles.listOnly}>
      {allowAdd && <fieldset disabled={disabled || saving} className={`${styles.form} ${dragOver ? styles.dropzoneActive : ""}`}
        onDragOver={event => { event.preventDefault(); if (!disabled && !saving) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)} onDrop={event => { if (disabled || saving) { event.preventDefault(); return; } onDrop(event); }}>
        <strong className={styles.columnTitle}>Add Document</strong>
        <span className={styles.labelText}>ID Proof {idProofRequired && <span className={styles.required}>*</span>}</span>
        <div className={styles.addRow}>
          <div className={styles.proofSelect}>
            <SearchableDropdown options={typeOptions.map(([value, label]) => ({ value, label }))} value={selectedType} onChange={chooseType} searchInside portal allowClear={false} disabled={disabled || saving || camera} placeholder="Select Document Type" />
          </div>
          <button type="button" className={styles.secondaryBtn} onClick={() => fileInputRef.current?.click()}><Icon name="upload" /> Upload</button>
          <button type="button" className={styles.secondaryBtn} onClick={() => setCamera(true)}><Icon name="camera" /> Camera</button>
        </div>
        {documentType === "OTHER" && <label className={styles.field}><span className={styles.labelText}>Document Name <span className={styles.required}>*</span></span>
          <input disabled={saving || camera} maxLength={100} value={otherName} onChange={event => setOtherName(event.target.value)} placeholder="Enter Document Type" />
        </label>}
        <input className={styles.nativeFile} style={{ display: "none" }} ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" hidden onChange={onBrowse} />
        <small className={styles.accepted} title="WEBP files are also supported">Accepted: JPG, PNG, PDF</small>
        {file && <div className={styles.filePicked}><Icon name="file" /><span>{file.name}</span>
          {localPreview && <button type="button" className={styles.iconBtn} aria-label="Preview selected document" title="Preview" onClick={() => setPreview({ doc: { document_type_display: "Selected File" }, url: localPreview.url, isPdf: localPreview.isPdf, local: true })}><Icon name="eye" /></button>}
          <button type="button" className={styles.iconBtn} aria-label="Remove file" title="Remove" onClick={removeFile}><Icon name="trash" /></button>
        </div>}
        {fileError && <small className={styles.error} role="alert">{fileError}</small>}
        <button type="button" className={styles.addBtn} disabled={saving || !file} onClick={addDocument}>{saving ? "Attaching..." : "+ Add Document"}</button>
        {onPendingChange && <small className={styles.accepted}>Attached documents upload when you save the form.</small>}
      </fieldset>}
      <div className={styles.attached}>
        <div className={styles.listHeading}><strong>Attached Documents</strong><span>{totalDocuments} {totalDocuments === 1 ? "Document" : "Documents"}</span></div>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <ul className={styles.list}>
          {pendingDocuments.map((item, index) => <li key={item.uploadToken || index} className={styles.row}>
            <span className={styles.docIcon}><Icon name="file" /></span>
            <div className={styles.docDetails}><span className={styles.rowType}>{pendingTypeLabel(item)}</span><span className={styles.filename}>{item.file.name}</span></div>
            <span className={styles.rowActions}><button type="button" aria-label={`Preview ${item.file.name}`} title="Preview" onClick={() => setPreview({ doc: { document_type_display: pendingTypeLabel(item) }, url: URL.createObjectURL(item.file), isPdf: isPdfFile(item.file.type, item.file.name), downloadName: item.file.name })}><Icon name="eye" /></button>
              {onPendingChange && !disabled && <button type="button" aria-label={`Remove ${item.file.name}`} title="Remove" onClick={() => onPendingChange(pendingDocuments.filter((_, i) => i !== index))}><Icon name="trash" /></button>}</span>
          </li>)}
          {loading ? <li className={styles.empty}>Loading documents...</li>
            : documents.length ? documents.map(doc => <li key={doc.id} className={styles.row}>
                <span className={styles.docIcon}><Icon name="file" /></span>
                <div className={styles.docDetails}><span className={styles.rowType}>{documentLabel(doc)}</span><span className={styles.filename}>{doc.original_file_name}</span></div>
                <span className={styles.savedStatus}>Saved</span>
                <span className={styles.rowActions}>
                  <button type="button" aria-label={`Preview ${doc.original_file_name}`} title="Preview" onClick={() => openPreview(doc)}><Icon name="eye" /></button>
                  <button type="button" aria-label={`Download ${doc.original_file_name}`} title="Download" onClick={() => downloadDocument(doc)}><Icon name="download" /></button>
                  {allowDelete && !disabled && <button type="button" aria-label={`Delete ${doc.original_file_name}`} title="Delete" onClick={() => deleteDocument(doc)}><Icon name="trash" /></button>}
                </span>
              </li>)
              : !pendingDocuments.length && <li className={styles.empty}>No KYC documents attached yet.</li>}
        </ul>
      </div>
    </div>
    {camera && <WebcamCaptureModal onClose={() => setCamera(false)} onCapture={capturedFile => { pickFile(capturedFile); setCamera(false); }} />}
    {preview && <DocumentPreviewModal title={documentLabel(preview.doc)} fileName={preview.downloadName || preview.doc.original_file_name || (preview.local ? file?.name : "")} url={preview.url} isPdf={preview.isPdf} onClose={closePreview} onDownload={preview.downloadName ? downloadPendingPreview : preview.local ? downloadLocalFile : () => downloadDocument(preview.doc)} />}
  </div>;
}

function WebcamCaptureModal({ onClose, onCapture }) {
  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const capturedRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [captured, setCaptured] = useState(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const session = new CameraSession({ getUserMedia: navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices) });
    sessionRef.current = session;
    session.open(videoRef.current).catch(reason => {
      if (!session.closed) { setError(cameraError(reason)); session.close(); }
    });
    const escape = event => {
      if (event.key === "Escape") { event.stopPropagation(); session.close(); closeRef.current(); }
    };
    document.addEventListener("keydown", escape);
    return () => {
      session.close();
      if (capturedRef.current) URL.revokeObjectURL(capturedRef.current.url);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const capture = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const blob = await sessionRef.current.capture(videoRef.current);
      if (!blob) return;
      const photo = { blob, url: URL.createObjectURL(blob) };
      capturedRef.current = photo;
      setCaptured(photo);
    } catch (reason) { if (!sessionRef.current.closed) setError(cameraError(reason)); }
    finally { if (!sessionRef.current.closed) setBusy(false); }
  };
  const retake = () => { if (captured) URL.revokeObjectURL(captured.url); capturedRef.current = null; setCaptured(null); setError(""); };
  const usePhoto = () => {
    if (!captured) return;
    sessionRef.current.close();
    onCapture(new File([captured.blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }));
  };
  const close = () => { sessionRef.current?.close(); onClose(); };

  return <div className={styles.modalBackdrop} onMouseDown={event => event.target === event.currentTarget && close()}>
    <div className={styles.cameraModal} role="dialog" aria-modal="true" aria-label="Capture document photo">
      <header><strong>Capture Photo</strong><button type="button" onClick={close} aria-label="Close">×</button></header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!ready && !error && <p role="status">Opening camera…</p>}
      <video ref={videoRef} style={{ display: captured || sessionRef.current?.closed ? "none" : "block" }}
        className={styles.cameraPreview} playsInline muted onLoadedData={() => setReady(true)} />
      {captured && <img src={captured.url} alt="Captured document" className={styles.cameraPreview} />}
      <footer>
        <button type="button" className={styles.secondaryBtn} onClick={close}>Cancel</button>
        {!captured && <button type="button" disabled={!ready || busy || sessionRef.current?.closed} className={styles.primaryBtn} onClick={capture}>{busy ? "Capturing…" : "Capture"}</button>}
        {captured && <><button type="button" className={styles.secondaryBtn} onClick={retake}>Retake</button><button type="button" className={styles.primaryBtn} onClick={usePhoto}>Confirm Photo</button></>}
      </footer>
    </div>
  </div>;
}

// Compact modal used by the Customer List's KYC action icon — read-only (View/Download),
// scoped to one customer, never a separate KYC list/master page.
export function KycDocumentsModal({ api, auth, customer, onClose }) {
  useEffect(() => {
    const onKeyDown = event => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className={styles.modalBackdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className={styles.listModal} role="dialog" aria-modal="true" aria-labelledby="kyc-modal-title">
      <header><strong id="kyc-modal-title">KYC Documents — {customer.full_name}</strong><button type="button" onClick={onClose} aria-label="Close">×</button></header>
      <div className={styles.listModalBody}>
        <KycDocumentsSection api={api} auth={auth} customerId={customer.id} allowAdd={false} />
      </div>
    </div>
  </div>;
}
