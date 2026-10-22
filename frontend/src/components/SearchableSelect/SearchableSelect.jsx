import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import styles from "./SearchableSelect.module.css";

// Drop-in replacement for a native <select> whose options come from data
// (customers, ledgers, loan types, groups…). The real <select> stays on screen,
// so each page's existing select styling, value binding and onChange handler are
// untouched; only the browser's native popup is replaced by a list with a search
// box at the top. Options are read from the <select>'s own <option> children each
// time it opens, and choosing one sets the select's value and fires a real
// "change" event — the caller sees exactly the same event.target.value as before.
// Fixed-choice selects (Yes/No, Gender, DR/CR, Payment Mode…) keep using <select>.
const normalize = text => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const PANEL_MAX_HEIGHT = 300;

export default function SearchableSelect({ children, ref, onKeyDown, searchPlaceholder = "Search...", ...props }) {
  const id = useId();
  const selectRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState(null);

  const setRefs = node => {
    selectRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const term = normalize(query);
  const filtered = term ? options.filter(option => normalize(option.label).includes(term)) : options;

  const openPanel = (initialQuery = "") => {
    const select = selectRef.current;
    if (!select || select.disabled) return;
    const items = Array.from(select.options)
      .filter(option => !option.hidden)
      .map(option => ({ index: option.index, value: option.value, label: option.text, disabled: option.disabled || Boolean(option.parentElement?.disabled) }));
    setOptions(items);
    setQuery(initialQuery);
    const selectedIndex = initialQuery ? 0 : items.findIndex(option => option.index === select.selectedIndex);
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) selectRef.current?.focus({ preventScroll: true });
  };
  const choose = option => {
    if (!option || option.disabled) return;
    const select = selectRef.current;
    close();
    if (!select || select.selectedIndex === option.index) return;
    select.selectedIndex = option.index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Suppress the native popup (mouse and touch) and open the searchable list instead.
  // Native, non-passive listeners are needed so preventDefault works on touch.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const select = selectRef.current;
    if (!select) return;
    const toggle = event => {
      if (event.type === "mousedown" && event.button !== 0) return;
      event.preventDefault();
      if (select.disabled) return;
      select.focus({ preventScroll: true });
      if (openRef.current) close(); else openPanel();
    };
    select.addEventListener("mousedown", toggle);
    select.addEventListener("touchend", toggle, { passive: false });
    return () => {
      select.removeEventListener("mousedown", toggle);
      select.removeEventListener("touchend", toggle);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = event => {
      if (!panelRef.current?.contains(event.target) && !selectRef.current?.contains(event.target)) close(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("touchstart", outside); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = () => {
      const select = selectRef.current;
      if (!select) return;
      const rect = select.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const placeAbove = below < 180 && above > below;
      const maxHeight = Math.max(120, Math.min(PANEL_MAX_HEIGHT, placeAbove ? above : below));
      setPosition(placeAbove
        ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + 4 }
        : { left, width, maxHeight, top: rect.bottom + 4 });
    };
    const onScroll = event => { if (!panelRef.current?.contains(event.target)) anchor(); };
    anchor();
    window.addEventListener("resize", anchor);
    window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("resize", anchor); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const step = delta => setActive(current => {
    let next = current;
    for (let i = 0; i < filtered.length; i += 1) {
      next = Math.max(0, Math.min(filtered.length - 1, next + delta));
      if (!filtered[next]?.disabled) return next;
    }
    return current;
  });

  // Closed select: Space / Alt+Down / F4 open the list; typing a letter opens it with
  // that letter already searched. Enter, Tab and plain arrows keep native behaviour so
  // existing keyboard-entry flows are unaffected.
  const onSelectKeyDown = event => {
    onKeyDown?.(event);
    if (event.defaultPrevented || props.disabled) return;
    const printable = event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === " " || event.key === "F4" || (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp"))) {
      event.preventDefault();
      if (open) close(); else openPanel();
    } else if (printable) {
      event.preventDefault();
      openPanel(event.key);
    }
  };

  const onSearchKeyDown = event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); step(event.key === "ArrowDown" ? 1 : -1); }
    else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); choose(filtered[active]); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation?.(); close(); }
    else if (event.key === "Tab") { event.preventDefault(); close(); }
  };

  const panel = open && position && <div ref={panelRef} className={styles.panel} style={position} onMouseDown={event => event.target.tagName !== "INPUT" && event.preventDefault()}>
    <div className={styles.search}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input type="search" autoFocus autoComplete="off" autoCorrect="off" spellCheck="false" data-lpignore="true" data-1p-ignore="true"
        aria-label="Search options" aria-controls={`${id}-list`} aria-activedescendant={filtered[active] ? `${id}-option-${active}` : undefined}
        placeholder={searchPlaceholder} value={query}
        onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onSearchKeyDown} />
    </div>
    <ul id={`${id}-list`} className={styles.list} role="listbox">
      {filtered.map((option, index) => <li key={option.index} id={`${id}-option-${index}`} role="option"
        aria-selected={selectRef.current?.selectedIndex === option.index} aria-disabled={option.disabled || undefined}
        className={[index === active ? styles.active : "", selectRef.current?.selectedIndex === option.index ? styles.selected : "", option.disabled ? styles.disabled : ""].join(" ")}
        onMouseEnter={() => !option.disabled && setActive(index)}
        onClick={() => choose(option)}>{option.label || " "}</li>)}
      {!filtered.length && <li className={styles.empty} role="presentation">No results found</li>}
    </ul>
  </div>;

  return <>
    <select {...props} ref={setRefs} onKeyDown={onSelectKeyDown} aria-haspopup="listbox" aria-expanded={open}>{children}</select>
    {panel && createPortal(panel, document.body)}
  </>;
}
