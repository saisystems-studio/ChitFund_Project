import { formatINR } from "../../utils/currency";

function Icon({ name }) {
  const paths = {
    product: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5"/></>,
    group: <><path d="M4 5h6l2 2h8v12H4V5Z"/></>,
    tag: <><path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7.5" cy="7.5" r="1"/></>,
    unit: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
    rate: <path d="M6 4h12M6 8h12M8 4c8 0 8 9 0 9H6l10 8"/>,
    calendar: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/></>,
    scale: <><path d="M12 3v18M7 7h10M4 7l3 6a3 3 0 0 0 6 0L10 7M14 7l3 6a3 3 0 0 0 6 0l-3-6"/></>,
    edit: <><path d="m4 16-.7 4 4-.7L18.8 7.8a2.1 2.1 0 0 0-3-3L4 16Z"/><path d="m14.5 6.5 3 3"/></>,
    close: <path d="m5 5 14 14M19 5 5 19"/>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Detail({ label, icon, value }) {
  return <div className="mortgage-view-field"><span className="mortgage-edit-prefix"><Icon name={icon}/></span><div><small>{label}</small><strong>{value ?? "-"}</strong></div></div>;
}

const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-";

export default function MortgageViewModal({ item, onClose, onEdit }) {
  const history = item.rate_history || [];
  return <div className="mortgage-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="mortgage-edit-modal" role="dialog" aria-modal="true" aria-labelledby="mortgage-view-title">
      <header className="mortgage-edit-heading">
        <span className="mortgage-edit-badge"><Icon name="product"/></span>
        <div><h2 id="mortgage-view-title">{item.product_name}</h2><p>Mortgage product details and rate history</p></div>
        <button type="button" className="mortgage-edit-close" aria-label="Close" onClick={onClose}><Icon name="close"/></button>
      </header>
      <div className="mortgage-edit-body">
        <div className="mortgage-edit-fields mortgage-view-fields">
          <Detail label="Product Group" icon="group" value={item.product_group || "-"}/>
          <Detail label="Product Name" icon="tag" value={item.product_name}/>
          <Detail label="Unit" icon="unit" value={item.unit}/>
          <Detail label="Quantity" icon="scale" value={item.quantity ?? "-"}/>
          <Detail label="Current Rate" icon="rate" value={formatINR(item.current_rate)}/>
          <Detail label="Date" icon="calendar" value={dateLabel(item.rate_date)}/>
        </div>
        <div className="mortgage-edit-history">
          <div className="mortgage-edit-history-card">
            <div className="mortgage-edit-history-heading"><h3>Rate History</h3><span className="mortgage-edit-count">{history.length} {history.length === 1 ? "entry" : "entries"}</span></div>
            <div className="mortgage-edit-history-table"><table><thead><tr><th>Date</th><th>Rate</th></tr></thead><tbody>{history.map(row => <tr key={row.date}><td>{dateLabel(row.date)}</td><td>{formatINR(row.rate)}</td></tr>)}</tbody></table>{!history.length && <div className="empty">No rate history recorded.</div>}</div>
          </div>
        </div>
      </div>
      <footer className="mortgage-edit-footer">
        <button type="button" onClick={onClose}><Icon name="close"/>Close</button>
        <button type="button" className="mortgage-edit-save" onClick={onEdit}><Icon name="edit"/>Edit</button>
      </footer>
    </section>
  </div>;
}
