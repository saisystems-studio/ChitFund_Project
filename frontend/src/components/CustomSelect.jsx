import { useState } from "react";

export default function CustomSelect({ value, onChange, options, onAdd, label = "option", maxLength = 100 }) {
  const [adding, setAdding] = useState(false), [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const names = [...new Set([...options, value].filter(item => item && item !== "Other"))];
  const add = async () => {
    const entered = name.trim();
    if (!entered || busy) return;
    setBusy(true); setError("");
    try {
      const existing = names.find(item => item.toLowerCase() === entered.toLowerCase());
      const saved = existing || await onAdd(entered);
      onChange(saved); setAdding(false); setName("");
    } catch (requestError) { setError(requestError.response?.data?.detail || `Unable to add ${label}.`); }
    finally { setBusy(false); }
  };
  return <div className="custom-select"><select aria-label={label} value={adding ? "Other" : value || ""} onChange={event => { setAdding(event.target.value === "Other"); setError(""); if (event.target.value !== "Other") onChange(event.target.value); }}><option value="">Select {label}</option>{names.map(item => <option key={item}>{item}</option>)}<option>Other</option></select>{adding && <div className="custom-select-add"><input autoFocus aria-label={`New ${label}`} maxLength={maxLength} value={name} placeholder={`New ${label}`} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); add(); } }}/><button type="button" aria-label={`Add ${label}`} disabled={busy || !name.trim()} onClick={add}>✓</button></div>}{error && <small role="alert">{error}</small>}</div>;
}
