import { useEffect, useRef, useState } from "react";
import { formatLoanDate, parseLoanDate } from "../../utils/loanDateDisplay";
import "./loan-date-input.css";

export default function LoanDateInput({ value, onChange, readOnly = false }) {
  const [text, setText] = useState(() => formatLoanDate(value));
  const input = useRef(null);
  useEffect(() => { setText(formatLoanDate(value)); input.current?.setCustomValidity(""); }, [value]);
  const change = event => {
    const next = event.target.value;
    setText(next);
    const iso = parseLoanDate(next);
    event.target.setCustomValidity(iso === null ? "Enter a valid date as DD/MM/YYYY." : "");
    if (iso !== null) onChange?.(iso);
  };
  return <div className="loan-date-input">
    <input ref={input} type="text" inputMode="numeric" placeholder="DD/MM/YYYY" value={text} onChange={change} readOnly={readOnly} />
    <span className="loan-date-calendar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/></svg></span>
    {!readOnly && <input className="loan-date-picker" type="date" aria-label="Choose Chit Start Date" value={value || ""} onChange={event => { const iso = event.target.value; setText(formatLoanDate(iso)); input.current?.setCustomValidity(""); onChange?.(iso); }} />}
  </div>;
}
