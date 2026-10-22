import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import styles from "./SearchableDropdown.module.css";

export default function SearchableDropdown({ options = [], value, onChange, searchKeys = ["label"], placeholder = "Select...", disabled = false, allowClear = true, searchInside = true, portal = false, onEnterNext }) {
  const id = useId();
  const root = useRef(null);
  const panelRef = useRef(null);
  const [position, setPosition] = useState(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = options.find(option => String(option.value ?? option.id) === String(value));
  const label = selected?.label ?? selected?.name ?? selected?.customer_name ?? "";
  const filtered = options.filter(option => searchKeys.some(key => String(option[key] ?? "").toLowerCase().includes(query.toLowerCase())));

  useEffect(() => { const close = event => { if (!root.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  useLayoutEffect(() => {
    if (!open || !portal) return;
    const anchor = () => {
      const rect = root.current.getBoundingClientRect();
      setPosition({ left: rect.left, top: rect.bottom + 4, width: rect.width, maxHeight: Math.min(250, Math.max(60, window.innerHeight - rect.bottom - 12)) });
    };
    const onScroll = event => { if (!panelRef.current?.contains(event.target)) anchor(); };
    anchor();
    window.addEventListener("resize", anchor);
    window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("resize", anchor); window.removeEventListener("scroll", onScroll, true); };
  }, [open, portal]);
  // Options list shows ~10 rows before scrolling; keep the keyboard-active row in view past that.
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" }); }, [open, active, id]);
  const choose = option => { onChange(option.value ?? option.id); setQuery(""); setOpen(false); };
  const onKeyDown = event => {
    if (disabled) return;
    // With the search box inside the list, typing on the closed field opens it and
    // starts the search with that character, so keyboard entry flows keep working.
    if (searchInside && event.currentTarget.getAttribute("role") === "combobox" && event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); setQuery(event.key); setActive(0); setOpen(true); return; }
    if (event.key === "Escape") { if (open) { event.preventDefault(); setOpen(false); } else if (allowClear) { event.preventDefault(); onChange(""); setQuery(""); } return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) { setOpen(true); setActive(event.key === "ArrowDown" ? 0 : Math.max(0, filtered.length - 1)); return; } setActive(index => Math.max(0, Math.min(filtered.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); return; }
    if (event.key === "Enter") { event.preventDefault(); if (!open) { setOpen(true); return; } if (filtered[active]) choose(filtered[active]); onEnterNext?.(); }
  };
  const portalPanel = open && position && <div ref={panelRef} className={styles.portalPanel} style={position}>
    {searchInside && <div className={styles.portalSearch}><input className={styles.input} type="search" aria-label="Search options" placeholder="Search..." autoFocus autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown} /></div>}
    <ul id={`${id}-options`} className={styles.portalOptions} role="listbox">
      {filtered.map((option, index) => <li id={`${id}-option-${index}`} role="option" aria-selected={index === active} className={index === active ? styles.active : ""} key={option.value ?? option.id} onMouseDown={event => { event.preventDefault(); choose(option); }}>{option.label ?? option.name ?? option.customer_name}</li>)}
      {!filtered.length && <li className={styles.empty}>No results found</li>}
    </ul>
  </div>;
  // Browsers key native autofill/suggestion popups off name + saved form
  // history; a unique per-instance name plus autoComplete="off" keeps that
  // native black popup from ever appearing over this styled dropdown
  // (data-lpignore/data-1p-ignore do the same for password-manager extensions).
  return <div className={styles.root} ref={root}><input id={id} name={`${id}-search`} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" data-lpignore="true" data-1p-ignore="true" className={styles.input} role="combobox" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && filtered[active] ? `${id}-option-${active}` : undefined} disabled={disabled} readOnly={searchInside} value={open && !searchInside ? query : label} placeholder={placeholder} onFocus={() => {}} onClick={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }} onKeyDown={onKeyDown} />{searchInside && <svg className={styles.chevron} style={{ right: allowClear && value ? 28 : 10 }} viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>}{allowClear && value && <button type="button" className={styles.clear} onClick={() => { onChange(""); setQuery(""); setOpen(false); }} aria-label="Clear selection">×</button>}{open && !portal && <ul id={`${id}-options`} className={styles.options} role="listbox">{searchInside && <li role="presentation" className={styles.searchRow}><input className={styles.input} type="search" aria-label="Search options" placeholder="Search..." autoFocus autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown} /></li>}{filtered.map((option, index) => <li id={`${id}-option-${index}`} role="option" aria-selected={index === active} className={index === active ? styles.active : ""} key={option.value ?? option.id} onMouseDown={event => { event.preventDefault(); choose(option); }}>{option.label ?? option.name ?? option.customer_name}</li>)}{!filtered.length && <li className={styles.empty}>No results found</li>}</ul>}{portal && portalPanel && createPortal(portalPanel, document.body)}</div>;
}
