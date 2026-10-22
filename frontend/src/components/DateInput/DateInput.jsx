import { useEffect, useRef, useState } from "react";
import { formatLoanDate, parseLoanDate } from "../../utils/loanDateDisplay";
import "./date-input.css";

// DD/MM/YYYY text entry with a calendar picker. `value` / onChange use ISO
// (YYYY-MM-DD, or "" when empty) so callers bind straight to the API field.
export default function DateInput({ value, onChange, required = false, max, label = "date", placeholder = "DD/MM/YYYY", disabled = false }) {
  const [text, setText] = useState(() => formatLoanDate(value));
  const input = useRef(null);
  useEffect(() => { setText(formatLoanDate(value)); input.current?.setCustomValidity(""); }, [value]);
  const change = event => {
    const next = event.target.value.replace(/[^\d/]/g, "").slice(0, 10);
    setText(next);
    const iso = parseLoanDate(next);
    const invalid = iso === null || (iso && max && iso > max);
    event.target.setCustomValidity(iso === null ? "Enter a valid date as DD/MM/YYYY." : invalid ? "Date cannot be in the future." : "");
    if (!invalid) onChange?.(iso);
  };
  return <span className="date-input">
    <input ref={input} type="text" inputMode="numeric" autoComplete="off" placeholder={placeholder} aria-label={label} value={text} onChange={change} required={required} disabled={disabled} />
    <span className="date-input-calendar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/></svg></span>
    {!disabled && <input className="date-input-picker" type="date" tabIndex={-1} aria-label={`Choose ${label}`} max={max} value={value || ""}
      onChange={event => { const iso = event.target.value; setText(formatLoanDate(iso)); input.current?.setCustomValidity(""); onChange?.(iso); }} />}
  </span>;
}
