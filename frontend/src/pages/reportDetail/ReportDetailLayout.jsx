import { cellText, statusTone } from "./detailFormat";
import { rowDetail } from "./reportDetailRoute";
import "./report-detail.css";

const Icon = ({ name }) => {
  const paths = {
    back: <path d="M19 12H5m7 7-7-7 7-7" />,
    print: <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z" />,
    pdf: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 12v6m-3-3 3 3 3-3" />,
    excel: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8.5 13l6 6M14.5 13l-6 6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    edit: <path d="m4 16-.7 4 4-.7L18.8 7.8a2.1 2.1 0 0 0-3-3L4 16Zm10.5-9.5 3 3" />,
    delete: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  };
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};

function Value({ entry }) {
  if (entry.type === "status") return <span className={`rd-badge rd-${statusTone(entry.value)}`}>{cellText(entry.value, "text")}</span>;
  return <b className={entry.type === "money" || entry.type === "balance" ? "rd-num" : ""}>{cellText(entry.value, entry.type)}</b>;
}

function Cell({ column, row }) {
  const value = row[column.key];
  if (column.type === "status") return value ? <span className={`rd-badge rd-${statusTone(value)}`}>{value}</span> : "—";
  const text = cellText(value, column.type);
  return column.key === "name" && row.indent ? <span style={{ paddingLeft: `${row.indent * 16}px` }}>{text}</span> : text;
}

function DetailTable({ table, go }) {
  const clickable = table.rows.some(row => row._open);
  return <section className="rd-card">
    <h3>{table.title}{clickable && <small>Double-click a row to open it</small>}</h3>
    <div className="rd-table-wrap"><table className="rd-table">
      <thead><tr>{table.columns.map(column => <th key={column.key} className={column.align === "right" ? "rd-num" : ""}>{column.label}</th>)}</tr></thead>
      <tbody>
        {table.rows.map((row, index) => <tr key={index} className={[row._open ? "rd-row-link" : "", row._highlight ? "rd-row-selected" : ""].join(" ").trim()}
          {...(row._open ? rowDetail(go, row._open.kind, row._open.id, row._open.extra) : {})}>
          {table.columns.map(column => <td key={column.key} className={column.align === "right" ? "rd-num" : ""}><Cell column={column} row={row} /></td>)}
        </tr>)}
        {!table.rows.length && <tr><td className="rd-empty-cell" colSpan={table.columns.length}>No records.</td></tr>}
      </tbody>
      {table.footer?.map((footer, index) => <tfoot key={index}><tr>
        {table.columns.map((column, position) => <td key={column.key} className={column.align === "right" ? "rd-num" : ""}>
          {footer[column.key] !== undefined ? cellText(footer[column.key], column.type) : position === 0 ? footer.label : ""}</td>)}
      </tr></tfoot>)}
    </table></div>
  </section>;
}

// Shared full-page "View More" shell: header (Back, title, record reference, Print / PDF /
// Excel / admin Edit-Delete / Close), then scrollable information sections and tables. The
// header and the white container stay fixed to the viewport; only the body scrolls.
export default function ReportDetailLayout({ state, model, onBack, onRetry, onPrint, onPdf, onExcel, onEdit, onDelete, canManage, busy, go, extra }) {
  const ready = state === "ready" && model;
  return <div className="rd-page data-page">
    <header className="rd-header">
      <button type="button" className="rd-back" onClick={onBack} aria-label="Back to report" title="Back"><Icon name="back" /></button>
      <div className="rd-heading">
        <small>View More</small>
        <h1>{ready ? model.title : "Report Details"}{ready && model.badge && <span className={`rd-badge rd-${statusTone(model.badge)}`}>{model.badge}</span>}</h1>
        {ready && <p>{[model.subtitle, model.reference].filter(Boolean).join("  ·  ")}</p>}
      </div>
      <div className="rd-actions">
        <button type="button" disabled={!ready || Boolean(busy)} onClick={onPrint}><Icon name="print" />{busy === "print" ? "Preparing…" : "Print"}</button>
        <button type="button" disabled={!ready || Boolean(busy)} onClick={onPdf}><Icon name="pdf" />{busy === "pdf" ? "Preparing…" : "PDF"}</button>
        <button type="button" disabled={!ready || Boolean(busy)} onClick={onExcel}><Icon name="excel" />{busy === "excel" ? "Preparing…" : "Excel"}</button>
        {ready && canManage && onEdit && <button type="button" className="rd-edit" onClick={onEdit}><Icon name="edit" />Edit</button>}
        {ready && canManage && onDelete && <button type="button" className="rd-delete" onClick={onDelete}><Icon name="delete" />Delete</button>}
        <button type="button" className="rd-close" onClick={onBack}><Icon name="close" />Close</button>
      </div>
    </header>
    <div className="rd-container data-container">
      <div className="rd-body">
        {state === "loading" && <div className="rd-state" role="status" aria-live="polite"><span className="rd-spinner" aria-hidden="true" />Loading details…</div>}
        {state === "error" && <div className="rd-state rd-state-error" role="alert"><strong>Details are unavailable</strong><span>{model}</span>
          <div><button type="button" onClick={onRetry}>Retry</button><button type="button" onClick={onBack}>Back to report</button></div></div>}
        {ready && <>
          <div className="rd-sections">{model.sections.filter(section => section.items.length).map(section => <section className="rd-card" key={section.title}>
            <h3>{section.title}</h3>
            <dl>{section.items.map(entry => <div key={entry.label} className={entry.label === "Address" || entry.label === "Narration" ? "rd-wide" : ""}><dt>{entry.label}</dt><dd><Value entry={entry} /></dd></div>)}</dl>
          </section>)}</div>
          {model.tables.map(table => <DetailTable key={table.title} table={table} go={go} />)}
          {extra}
        </>}
      </div>
    </div>
  </div>;
}
