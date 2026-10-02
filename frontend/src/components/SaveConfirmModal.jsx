import "../styles/save-confirm-modal.css";

export default function SaveConfirmModal({ title, subtitle, onDownload, onPrint, onClose, busy }) {
  return <div className="save-confirm-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="save-confirm-card" role="dialog" aria-modal="true" aria-labelledby="save-confirm-title">
      <button type="button" className="save-confirm-close" aria-label="Close" onClick={onClose}>×</button>
      <span className="save-confirm-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></span>
      <h2 id="save-confirm-title">{title}</h2>
      {subtitle && <p>{subtitle}</p>}
      <div className="save-confirm-actions">
        <button type="button" className="save-confirm-download" disabled={Boolean(busy)} onClick={onDownload}>{busy === "pdf" ? <span className="save-confirm-spinner" aria-hidden="true"/> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M12 12v6m-3-3 3 3 3-3"/></svg>}Download PDF</button>
        <button type="button" className="save-confirm-print" disabled={Boolean(busy)} onClick={onPrint}>{busy === "print" ? <span className="save-confirm-spinner" aria-hidden="true"/> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></svg>}Print</button>
      </div>
    </section>
  </div>;
}
