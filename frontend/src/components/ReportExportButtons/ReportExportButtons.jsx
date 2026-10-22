import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./ReportExportButtons.module.css";

const ICONS = {
  chevron: <path d="m6 9 6 6 6-6" />,
  pdf: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h1.5a1.5 1.5 0 0 1 0 3H9v3 M9 13v6 M13.5 13H15a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1.5v-6" />,
  excel: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8.5 13l6 6 M14.5 13l-6 6" />,
  print: <path d="M6 9V3h12v6 M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2 M6 14h12v7H6z" />,
};

function Icon({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}

// One compact "Export ▾" button shared by every Reports-module page, opening a small
// menu of PDF / Excel (and Print, where a report already had it) — not two/three
// separate buttons, and not a large dropdown. `busy` is "pdf" | "excel" | "print" | null
// while an export is in flight (closes the menu and disables the trigger).
export default function ReportExportButtons({ onPdf, onExcel, onPrint, busy = null, disabled = false, portal = false, downloadLabels = false }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const root = useRef(null);
  const menuRef = useRef(null);
  useLayoutEffect(() => {
    if (!open || !portal) return;
    const rect = root.current.getBoundingClientRect();
    setPosition({ position: "fixed", top: rect.bottom + 5, right: Math.max(8, window.innerWidth - rect.right), zIndex: 1000 });
  }, [open, portal]);
  useEffect(() => {
    if (!open) return;
    const close = event => { if (!root.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    if (!open || !portal) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [open, portal]);
  useEffect(() => { if (busy) setOpen(false); }, [busy]);
  const choose = action => { setOpen(false); action?.(); };
  const busyLabel = busy === "pdf" ? "Exporting PDF…" : busy === "excel" ? "Exporting Excel…" : busy === "print" ? "Preparing print…" : null;
  const menu = <div ref={menuRef} className={styles.menu} role="menu" style={portal ? position : undefined}>
    <button type="button" role="menuitem" className={styles.item} onClick={() => choose(onPdf)}><Icon name="pdf" /><span>{downloadLabels ? "Download PDF" : "PDF"}</span></button>
    <button type="button" role="menuitem" className={styles.item} onClick={() => choose(onExcel)}><Icon name="excel" /><span>{downloadLabels ? "Download Excel" : "Excel"}</span></button>
    {onPrint && <button type="button" role="menuitem" className={styles.item} onClick={() => choose(onPrint)}><Icon name="print" /><span>Print</span></button>}
  </div>;

  return <div className={styles.root} ref={root}>
    <button type="button" className={styles.trigger} aria-haspopup="menu" aria-expanded={open} disabled={disabled || !!busy} onClick={() => setOpen(value => !value)}>
      <span>{busyLabel || "Export"}</span><Icon name="chevron" />
    </button>
    {open && (portal ? position && createPortal(menu, document.body) : menu)}
  </div>;
}
