import "./LedgerSelect.css";
import SearchableSelect from "../SearchableSelect/SearchableSelect";

// Transaction Ledger field: the existing native ledger <select> plus a compact
// (+) that opens Add Ledger. Backspace/Delete clears the current selection;
// normal dropdown selection works as before.
export default function LedgerSelect({ value, options, onChange, onAdd, placeholder = "Select Ledger", optionLabel = item => `${item.name} - ${item.group}` }) {
  const clearOnKey = event => {
    if ((event.key === "Backspace" || event.key === "Delete") && value) { event.preventDefault(); onChange(""); }
  };
  return <span className="ledger-select-add">
    <SearchableSelect value={value} onChange={event => onChange(event.target.value)} onKeyDown={clearOnKey}>
      <option value="">{placeholder}</option>
      {options.map(item => <option key={item.id} value={item.id}>{optionLabel(item)}</option>)}
    </SearchableSelect>
    {onAdd && <button type="button" className="ledger-add-button" title="Add Ledger" aria-label="Add Ledger" onClick={event => { event.preventDefault(); onAdd(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    </button>}
  </span>;
}
