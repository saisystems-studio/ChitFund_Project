import { useCompanyProfile } from "../../../components/CompanyProfileContext";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ChitGroupForm.module.css";
import "../../../styles/chit-group-form-layout.css";
import "./ChitGroupFormAmount.css";
import "./chit-group-form-footer-fix.css";
import "./chit-group-ui-final.css";
import { formatINRNumber } from "../../../utils/currency";
import { actionToast } from "../../../utils/actionToast";
import { downloadChitPdf } from "../../../utils/chitPdf";
import PageBreadcrumb from "../../../components/PageBreadcrumb";

// Pad valid amounts without rounding values that existing validation should reject.
const formatInstallmentAmount = value => {
  const text = String(value ?? "");
  if (text === "") return "0.00";
  if (!/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return text;
  const [whole, fraction = ""] = text.split(".");
  return `${whole === "-" ? "-0" : whole || "0"}.${fraction.padEnd(2, "0")}`;
};

export default function ChitGroupForm({ api, auth, go, id }) {
  const { profile } = useCompanyProfile();
  const [form, setForm] = useState(() => ({ code: "", name: "", duration: 1, duration_type: "DAY", collection_day: 1, collection_month: 1, total_amount: "", end_date: "" }));
  const [amounts, setAmounts] = useState([]);
  const [savedSchedules, setSavedSchedules] = useState([]);
  const [startDate, setStartDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [totalFocused, setTotalFocused] = useState(false);
  const [focusedAmount, setFocusedAmount] = useState(null);
  const amountRefs = useRef({});
  const original = useRef(null);
  const clearDraft = () => {};

  useEffect(() => {
    if (id) {
      api.get(`/finance/chit-groups/${id}/`, auth).then(({ data }) => {
        original.current = data;
        setForm({ ...data, total_amount: String(data.total_amount ?? data.grand_total ?? ""), end_date: data.end_date || "" });
        setStartDate(data.start_date || "");
        setSavedSchedules((data.template_installments || data.installments || []).map(item => item.schedule_value));
        setAmounts((data.template_installments || data.installments || []).map(item => String(item.installment_amount ?? "0.00")));
      }).catch(() => setError("Unable to load Chit Group."));
    } else {
      api.get("/finance/chit-groups/", { ...auth, params: { page_size: 1000 } }).then(({ data }) => {
        const rows = data.results ?? data;
        const highest = rows.reduce((max, item) => {
          const match = String(item.code || "").trim().toUpperCase().match(/^CHG_(\d+)$/);
          return match ? Math.max(max, Number(match[1])) : max;
        }, 0);
        setForm(value => ({ ...value, code: `CHG_${String(highest + 1).padStart(3, "0")}` }));
      }).catch(() => {});
    }
  }, [id]);

  const count = Math.max(1, Math.min(3650, Number(form.duration) || 1));
  const rows = useMemo(() => Array.from({ length: count }, (_, index) => ({ number: index + 1, schedule: savedSchedules[index] ?? `Installment ${index + 1}`, amount: amounts[index] ?? "" })), [count, amounts, savedSchedules]);
  const toPaise = value => Math.round(Number(String(value ?? "0").replace(/,/g, "")) * 100);
  const targetTotal = Number(form.total_amount || 0);
  const targetTotalPaise = toPaise(targetTotal);
  const formatMoney = formatINRNumber;

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const focusAmount = index => {
    if (index < 0 || index >= rows.length) return;
    amountRefs.current[index]?.focus();
    amountRefs.current[index]?.select();
  };
  // Rows own their inputs; row clicks must never select a shared/active editor.
  const activateAmount = () => {};
  const setActiveAmount = () => {};
  const originalAmount = "";

  const changeDuration = value => {
    const nextCount = Math.max(1, Math.min(3650, Number(value) || 1));
    applyDuration(value, nextCount);
  };

  const applyDuration = (value, nextCount) => {
    set("duration", value);
    setAmounts(current => current.slice(0, nextCount));
  };

  const changeTotal = value => {
    value = String(value).replace(/,/g, "");
    set("total_amount", value);
  };

  const commitAmount = (index, value, move = 0) => {
    setAmounts(current => { const next = [...current]; next[index] = formatInstallmentAmount(value); return next; });
    const target = index + move;
    if (move && target >= 0 && target < rows.length) focusAmount(target);
  };

  useEffect(() => {
    const shortcut = event => {
      if (event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        document.querySelector("form[data-chit-group-form] button[type='submit']")?.click();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    const keepAmountOnWheel = event => {
      if (event.target.matches?.(".chit-form-page .installment-amount-input[type=number]")) {
        event.target.blur();
      }
    };
    document.addEventListener("wheel", keepAmountOnWheel, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", keepAmountOnWheel, true);
  }, []);

  const save = async event => {
    event.preventDefault();
    if (saving) return;
    if (rows.length !== count) { setError(`Installment schedule must contain all ${count} rows.`); return; }
    setSaving(true); setError("");
    try {
      const payload = { ...form, start_date: startDate || null, end_date: form.end_date || null, collection_date: form.collection_date || null, total_amount: targetTotalPaise / 100, duration: count, installments: rows.map(row => ({ installment_number: row.number, schedule_value: row.schedule, installment_amount: row.amount === "" ? 0 : row.amount })) };
      delete payload.grand_total;
      if (id) await api.put(`/finance/chit-groups/${id}/`, payload, auth); else await api.post("/finance/chit-groups/", payload, auth);
      clearDraft();
      actionToast("Chit Group saved successfully");
      go("/chit-groups");
    } catch (requestError) {
      const data = requestError.response?.data;
      console.error("Chit Group save failed", data || requestError);
      actionToast("Chit Group save failed", false);
      const detail = typeof data === "string" ? data : data?.installments || data?.detail || data;
      const message = Array.isArray(detail) ? detail.map(item => typeof item === "string" ? item : Object.values(item || {}).flat().join(" ")).join(" ") : typeof detail === "object" ? Object.entries(detail || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(" ") : value}`).join(" ") : String(detail || "Unable to save Chit Group.");
      setError(message);
    } finally { setSaving(false); }
  };

  const reset = () => {
    if (id) {
      const data = original.current;
      if (!data) return;
      setForm({ ...data, total_amount: String(data.total_amount ?? data.grand_total ?? ""), end_date: data.end_date || "" });
      setStartDate(data.start_date || "");
      setSavedSchedules((data.template_installments || data.installments || []).map(item => item.schedule_value));
      setAmounts((data.template_installments || data.installments || []).map(item => String(item.installment_amount ?? "0.00")));
      setError("");
      return;
    }
    setForm(current => ({ ...current, name: "", duration: 1, duration_type: "DAY", collection_day: 1, collection_month: 1, total_amount: "", end_date: "" }));
    setStartDate(""); setAmounts([]); setSavedSchedules([]); set("collection_date", null); setError("");
  };

  const collectionDateControl = form.duration_type === "YEAR"
    ? <div className={styles.collectionDateGroup}><select value={form.collection_month || 1} onChange={e => set("collection_month", e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2024, i, 1).toLocaleString("en", { month: "short" })}</option>)}</select><select value={form.collection_day || 1} onChange={e => set("collection_day", e.target.value)}>{Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></div>
    : form.duration_type === "MONTH"
      ? <select value={form.collection_day || 1} onChange={e => set("collection_day", e.target.value)}>{Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
      : <input value="Daily" readOnly />;

  return <div className={`${styles.page} chit-form-page`}>
    <header><PageBreadcrumb root="Masters" current={id ? "Edit Chit Group" : "Add Chit Group"} onBack={() => go("/masters")} /><span className={styles.active}>● Active</span></header>
    {error && <div className={styles.error}>{error}</div>}
    <form data-chit-group-form onSubmit={save} className={styles.surface}>
      <section><h2>GROUP INFORMATION</h2><div className={`${styles.grid} ${styles.groupInfoRow}`}>
        <label>Chit Name <span className="required-star">*</span><input required value={form.name || ""} onChange={e => set("name", e.target.value)} /></label>
        <label>No. of Installments <span className="required-star">*</span><input type="number" min="1" max="3650" required value={form.duration} onChange={e => changeDuration(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); focusAmount(0); } }} /></label>
        <label>Chit Amount <span className="required-star">*</span><div className={styles.moneyInput}><span>₹</span><input type="text" inputMode="decimal" required value={totalFocused ? (form.total_amount || "") : (form.total_amount ? formatMoney(form.total_amount) : "")} onFocus={() => setTotalFocused(true)} onChange={e => changeTotal(e.target.value)} onBlur={() => setTotalFocused(false)} /></div></label>
        <label>Duration Type <span className="required-star">*</span><div className={styles.radios}>{[["DAY", "Days"], ["MONTH", "Months"], ["YEAR", "Years"]].map(([value, text]) => <label key={value}><input type="radio" checked={form.duration_type === value} onChange={() => set("duration_type", value)} />{text}</label>)}</div></label>
        <label>Start Date<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
        <label>Collection Date{collectionDateControl}</label>
      </div></section>
      <section className={styles.scheduleSection}><div className={styles.sectionHead}><h2>CHIT PLAN TABLE</h2><button type="button" disabled={!original.current} title={!original.current ? "Save the group before exporting its PDF" : "Export saved group details"} onClick={() => downloadChitPdf(original.current, profile)}>PDF</button></div><div className={styles.tableWrap}><table><thead><tr><th>S.No</th><th>Installment</th><th>Installment Amount</th></tr></thead><tbody>{rows.map(row => { const index = row.number - 1; return <tr key={row.number}><td>{row.number}</td><td>{row.schedule}</td><td className="installment-amount-cell" onClick={() => activateAmount(index)}><input className="installment-amount-input" ref={element => { amountRefs.current[index] = element; }} type="number" min="0" step="0.01" value={focusedAmount === index ? row.amount : formatInstallmentAmount(row.amount)} onFocus={event => { const value = formatInstallmentAmount(event.currentTarget.value); setFocusedAmount(index); setAmounts(current => { const next = [...current]; next[index] = value; return next; }); event.currentTarget.select(); }} onChange={e => setAmounts(current => { const next = [...current]; next[index] = e.target.value; return next; })} onBlur={e => { commitAmount(index, e.target.value); setFocusedAmount(null); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitAmount(index, e.target.value, e.shiftKey ? -1 : 1); } else if (e.key === "Escape") { e.preventDefault(); setAmounts(current => { const next = [...current]; next[index] = originalAmount; return next; }); setActiveAmount(null); } }} /></td></tr>; })}</tbody></table></div></section>
      <div className={styles.actions}><button type="button" onClick={() => go("/chit-groups")}>Cancel</button><button type="button" onClick={reset}>Reset</button><button className={styles.primary} disabled={saving}>{saving ? "Saving..." : "Save Chit Group"}</button></div>
    </form>
  </div>;
}
