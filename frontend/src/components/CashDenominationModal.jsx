import { formatINR } from "../utils/currency";
import "../styles/cash-denomination-modal.css";

export default function CashDenominationModal({ rows, coinsAmount, onQtyChange, onCoinsChange, total, onClose }) {
  return <div className="cash-denom-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="cash-denom-modal" role="dialog" aria-modal="true" aria-labelledby="cash-denom-title">
      <header><strong id="cash-denom-title">Cash Denomination</strong><button type="button" onClick={onClose} aria-label="Close">×</button></header>
      <div className="cash-denom-body">
        <table className="cash-denom-table">
          <thead><tr><th>Denomination</th><th>Quantity</th><th>Amount</th></tr></thead>
          <tbody>
            {rows.map(row => <tr key={row.value}><td>₹{row.value}</td><td><input type="number" min="0" step="1" inputMode="numeric" value={row.qty} onChange={event => onQtyChange(row.value, event.target.value)} placeholder="0"/></td><td className="cash-denom-amount">{formatINR(row.amount)}</td></tr>)}
            <tr><td>Coins</td><td className="cash-denom-na">—</td><td><div className="currency-input cash-denom-coins"><span>₹</span><input type="number" min="0" step="0.01" value={coinsAmount} onChange={event => onCoinsChange(event.target.value)} placeholder="0.00"/></div></td></tr>
          </tbody>
        </table>
      </div>
      <footer>
        <div className="cash-denom-total"><span>Total Cash Amount</span><strong>{formatINR(total)}</strong></div>
        <button type="button" className="cash-denom-save" onClick={onClose}>Save</button>
      </footer>
    </section>
  </div>;
}
