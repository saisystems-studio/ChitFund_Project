import { useEffect, useId, useRef, useState } from "react";
import styles from "./SearchableDropdown.module.css";

export default function SearchableDropdown({ options = [], value, onChange, searchKeys = ["label"], placeholder = "Search...", disabled = false, allowClear = true, onEnterNext }) {
  const id = useId();
  const root = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = options.find(option => String(option.value ?? option.id) === String(value));
  const label = selected?.label ?? selected?.name ?? selected?.customer_name ?? "";
  const filtered = options.filter(option => searchKeys.some(key => String(option[key] ?? "").toLowerCase().includes(query.toLowerCase())));

  useEffect(() => { const close = event => { if (!root.current?.contains(event.target)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  const choose = option => { onChange(option.value ?? option.id); setQuery(""); setOpen(false); };
  const onKeyDown = event => {
    if (disabled) return;
    if (event.key === "Escape") { if (open) { event.preventDefault(); setOpen(false); } else if (allowClear) { event.preventDefault(); onChange(""); setQuery(""); } return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) { setOpen(true); setActive(event.key === "ArrowDown" ? 0 : Math.max(0, filtered.length - 1)); return; } setActive(index => Math.max(0, Math.min(filtered.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); return; }
    if (event.key === "Enter") { event.preventDefault(); if (!open) { setOpen(true); return; } if (filtered[active]) choose(filtered[active]); onEnterNext?.(); }
  };
  return <div className={styles.root} ref={root}><input id={id} className={styles.input} role="combobox" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && filtered[active] ? `${id}-option-${active}` : undefined} disabled={disabled} value={open ? query : label} placeholder={placeholder} onFocus={() => {}} onClick={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }} onKeyDown={onKeyDown} />{allowClear && value && <button type="button" className={styles.clear} onClick={() => { onChange(""); setQuery(""); setOpen(false); }} aria-label="Clear selection">×</button>}{open && <ul id={`${id}-options`} className={styles.options} role="listbox">{filtered.map((option, index) => <li id={`${id}-option-${index}`} role="option" aria-selected={index === active} className={index === active ? styles.active : ""} key={option.value ?? option.id} onMouseDown={event => { event.preventDefault(); choose(option); }}>{option.label ?? option.name ?? option.customer_name}</li>)}{!filtered.length && <li className={styles.empty}>No matches found</li>}</ul>}</div>;
}
