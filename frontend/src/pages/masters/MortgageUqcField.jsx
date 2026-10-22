import { useEffect, useRef, useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import "./MortgageUqcField.css";

const OTHER = "__OTHER__";
const COMMON_UQCS = ["KGS", "LTR", "NOS", "PCS", "MTR", "BOX", "GMS", "BAG", "BTL", "CAN", "CMS", "DOZ", "DZN", "FTS", "KLR", "MLT", "PAC", "PRS", "QTL", "SET", "SQF", "SQM", "TBS", "TGM", "THD", "TON", "UNT", "YDS"];

export default function MortgageUqcField({ value, options, onChange, onAdd, optional = false }) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const values = [...new Set([...COMMON_UQCS, ...(options || []), value].map(item => String(item || "").trim().toUpperCase()).filter(Boolean))].sort();
  const choices = [...values.map(item => ({ value: item, label: item })), { value: OTHER, label: "Other" }];
  const add = async () => {
    const entered = name.trim().toUpperCase();
    if (!entered || busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await onAdd(entered);
      if (!alive.current) return;
      onChange(String(saved).trim().toUpperCase());
      setAdding(false);
      setName("");
    } catch (requestError) {
      if (!alive.current) return;
      setError(requestError.response?.data?.detail || "Unable to add UQC.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return <div className="mortgage-uqc-field">
    <span>UQC {!optional && <b>*</b>}</span>
    <SearchableDropdown disabled={busy} options={choices} value={adding ? OTHER : String(value || "").trim().toUpperCase()} onChange={selected => {
      setError("");
      if (selected === OTHER) {
        setAdding(true);
        setName("");
        onChange("");
      } else {
        setAdding(false);
        onChange(String(selected || "").toUpperCase());
      }
    }} placeholder="Select UQC" portal searchInside />
    {adding && <div className="mortgage-uqc-add">
      <input autoFocus disabled={busy} aria-label="New UQC code" maxLength={20} value={name} placeholder="New UQC code" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); add(); } }} onChange={event => setName(event.target.value.toUpperCase())} />
      <button type="button" aria-label="Add UQC" disabled={busy || !name.trim()} onClick={add}>{busy ? "…" : "✓ Add"}</button>
    </div>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
