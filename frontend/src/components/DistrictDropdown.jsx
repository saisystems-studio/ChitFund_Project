import { useEffect, useMemo, useRef, useState } from "react";
import indiaLocationMaster from "../data/indiaLocationMaster";
import "./DistrictDropdown.css";

const unique = values => [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b));

export default function DistrictDropdown({ kind = "district", value = "", onChange, onSelect, inputRef, nextRef, error, placeholder }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapperRef = useRef(null);
  const options = useMemo(() => {
    if (kind === "district") return [...new Map(indiaLocationMaster.map(item => [item.name, item])).values()];
    if (kind === "state") return unique(indiaLocationMaster.map(item => item.state)).map(name => ({ name, country: "India" }));
    return unique(indiaLocationMaster.map(item => item.country)).map(name => ({ name }));
  }, [kind]);
  const filtered = useMemo(() => {
    const query = String(value || "").trim().toLowerCase();
    return options.filter(item => !query || item.name.toLowerCase().includes(query)).slice(0, 100);
  }, [options, value]);

  useEffect(() => {
    const close = event => { if (!wrapperRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => setActive(0), [value, kind]);

  const select = item => {
    onChange?.(item.name);
    onSelect?.(item);
    setOpen(false);
    setTimeout(() => nextRef?.current?.focus(), 0);
  };
  const keyDown = event => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(index => filtered.length ? Math.min(index + 1, filtered.length - 1) : 0); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(index => filtered.length ? Math.max(index - 1, 0) : 0); }
    else if (event.key === "Enter" && open && filtered[active]) { event.preventDefault(); select(filtered[active]); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
  };

  return <div className={`district-dropdown ${error ? "has-error" : ""}`} ref={wrapperRef}>
    <input ref={inputRef} value={value} autoComplete="off" placeholder={placeholder || `Search ${kind}...`} onFocus={() => setOpen(true)} onChange={event => { onChange?.(event.target.value); setOpen(true); }} onKeyDown={keyDown} aria-autocomplete="list" aria-expanded={open}/>
    {open && filtered.length > 0 && <div className="district-options" role="listbox">{filtered.map((item, index) => <button type="button" role="option" aria-selected={index === active} className={index === active ? "active" : ""} key={`${kind}-${item.name}`} onMouseDown={event => { event.preventDefault(); select(item); }}><strong>{item.name}</strong><small>{kind === "district" ? `${item.state} · ${item.country}${item.pincode ? ` · ${item.pincode}` : ""}` : kind === "state" ? item.country : "India"}</small></button>)}</div>}
  </div>;
}
