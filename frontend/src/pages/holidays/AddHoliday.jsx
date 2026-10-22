import { useEffect, useMemo, useRef, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import { useSession } from "../../components/SessionContext";
import confirmDelete from "../../utils/confirmDelete";
import useHolidays from "./useHolidays";
import {
  HOLIDAY_TYPES, MONTHS, SUNDAY_PATTERNS, SUNDAY_WORKING, WEEKDAYS, daysInMonth, isoDate, patternOf,
  recordsByDate, sundaysOf, typeClass, typeLabel, workingSundaysFor, monthSummary, SUMMARY_FIELDS,
} from "./holidayCalendar";
import "./holidays.css";

// Add Holiday: a monthly calendar. Double-click a date (or click its circle) to enter a
// Reason / Description inside that date box and save it as a holiday of the chosen type.
// Sundays are Off by default; tick a Sunday's circle to make it a Working Day. Saved
// holidays can be edited or removed straight from the calendar.
const today = new Date();
const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

export default function AddHoliday({ api, auth, go }) {
  const { isAdmin } = useSession();
  const { records, loading, busy, save, remove, setSundayWorking, applySundays } = useHolidays(api, auth);
  const [year, setYear] = useState(today.getFullYear()), [month, setMonth] = useState(today.getMonth());
  const [defaultType, setDefaultType] = useState("GOVERNMENT");
  const [editor, setEditor] = useState(null); // { date, name, type }
  const [pattern, setPattern] = useState("MANUAL");
  const byDate = useMemo(() => recordsByDate(records), [records]);
  const currentPattern = useMemo(() => patternOf(year, month, records), [year, month, records]);
  useEffect(() => { setPattern(currentPattern); }, [currentPattern, year, month]);
  const summary = monthSummary(year, month, records);

  const step = delta => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear()); setMonth(next.getMonth()); setEditor(null);
  };
  const years = useMemo(() => {
    const set = new Set([today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1, today.getFullYear() + 2, year]);
    records.forEach(record => set.add(Number(String(record.holiday_date).slice(0, 4))));
    return [...set].filter(Boolean).sort((a, b) => a - b);
  }, [records, year]);

  const openEditor = date => {
    const record = byDate.get(date);
    const isHoliday = record && record.holiday_type !== SUNDAY_WORKING;
    setEditor({ date, name: isHoliday ? record.holiday_name : "", type: isHoliday ? record.holiday_type : defaultType });
  };
  const submitEditor = async () => {
    if (!editor || busy) return;
    if (!editor.name.trim()) return;
    if (await save({ holiday_date: editor.date, holiday_name: editor.name, holiday_type: editor.type })) setEditor(null);
  };
  const removeHoliday = async record => {
    if (!await confirmDelete(`Remove the holiday on ${record.holiday_date.split("-").reverse().join("/")} (${record.holiday_name})?`)) return;
    remove(record);
  };
  const applyPattern = async scope => {
    if (pattern === "MANUAL") return;
    const months = scope === "year" ? MONTHS.map((_, index) => index) : [month];
    const sundays = months.flatMap(index => sundaysOf(year, index));
    const working = months.flatMap(index => workingSundaysFor(pattern, year, index));
    await applySundays(sundays, working);
  };

  // Calendar cells: leading blanks so the 1st lands on its weekday (Sunday first).
  const first = new Date(year, month, 1).getDay();
  const cells = [...Array(first).fill(null), ...Array.from({ length: daysInMonth(year, month) }, (_, index) => isoDate(year, month, index + 1))];
  while (cells.length % 7) cells.push(null);

  return <div className="hol-page">
    <div className="hol-head">
      <PageBreadcrumb className="hol-breadcrumb" current="Add Holiday" />
      <button type="button" className="hol-btn" onClick={() => go("/holiday-list")}>Holiday List</button>
    </div>

    <section className="hol-card hol-calendar-card">
      <div className="hol-toolbar">
        <div className="hol-month-nav">
          <button type="button" className="hol-icon-btn" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
          <select aria-label="Month" value={month} onChange={event => { setMonth(Number(event.target.value)); setEditor(null); }}>{MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
          <select aria-label="Year" value={year} onChange={event => { setYear(Number(event.target.value)); setEditor(null); }}>{years.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <button type="button" className="hol-icon-btn" aria-label="Next month" onClick={() => step(1)}>›</button>
          <button type="button" className="hol-link-btn" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setEditor(null); }}>Today</button>
        </div>
        <label className="hol-control">Holiday Type
          <select value={defaultType} onChange={event => setDefaultType(event.target.value)}>{HOLIDAY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        <label className="hol-control">Sunday Selection
          <select value={pattern} onChange={event => setPattern(event.target.value)}>{SUNDAY_PATTERNS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        {pattern !== "MANUAL" && <div className="hol-apply">
          <button type="button" className="hol-btn hol-btn-primary" disabled={busy} onClick={() => applyPattern("month")}>Apply to {MONTHS[month]}</button>
          <button type="button" className="hol-btn" disabled={busy} onClick={() => applyPattern("year")}>Apply to {year}</button>
        </div>}
      </div>

      <div className="hol-legend" aria-label="Legend">
        {[["GOVERNMENT"], ["LOCAL"], ["WEEKLY_OFF"], ["SPECIAL_LEAVE"], [SUNDAY_WORKING], ["SUNDAY_OFF"]].map(([type]) => <span key={type} className={`hol-chip ${typeClass(type)}`}>{typeLabel(type)}</span>)}
        <span className="hol-hint">Double-click a date to add a holiday · Tick a Sunday's circle to make it a Working Day</span>
      </div>

      <div className={`hol-grid ${loading ? "is-loading" : ""}`} role="grid" aria-label={`${MONTHS[month]} ${year}`}>
        {WEEKDAYS.map(day => <div key={day} className={`hol-weekday ${day === "Sun" ? "is-sunday" : ""}`} role="columnheader">{day}</div>)}
        {cells.map((date, index) => {
          if (!date) return <div key={`blank-${index}`} className="hol-day is-blank" aria-hidden="true" />;
          const record = byDate.get(date);
          const sunday = new Date(`${date}T00:00:00`).getDay() === 0;
          const working = sunday && record?.holiday_type === SUNDAY_WORKING && record.is_active !== false;
          const holiday = record && record.holiday_type !== SUNDAY_WORKING ? record : null;
          const editing = editor?.date === date;
          const status = holiday ? typeLabel(holiday.holiday_type) : sunday ? (working ? "Sunday Working" : "Sunday Off") : "";
          const circleTitle = sunday && !holiday ? (working ? "Working Sunday — click to mark Off" : "Sunday Off — tick to mark Working") : holiday ? "Saved holiday — click to edit" : "Add holiday";
          return <div key={date} role="gridcell" aria-label={`${date}${status ? `, ${status}` : ""}`}
            className={["hol-day", sunday ? "is-sunday" : "", holiday ? `has-holiday ${typeClass(holiday.holiday_type)}` : "", working ? "is-working" : "", sunday && !holiday && !working ? "is-sunday-off" : "", date === todayIso ? "is-today" : "", holiday?.is_active === false ? "is-inactive" : "", editing ? "is-editing" : ""].join(" ")}
            onDoubleClick={() => !editing && openEditor(date)}>
            <div className="hol-day-top">
              <span className="hol-day-number">{Number(date.slice(8))}</span>
              <button type="button" className={`hol-circle ${holiday || working ? "is-on" : ""}`} title={circleTitle} aria-label={circleTitle} disabled={busy}
                onClick={event => { event.stopPropagation(); if (sunday && !holiday) setSundayWorking(date, !working); else openEditor(date); }}>
                {(working || holiday) && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>}
              </button>
            </div>
            {editing ? <div className="hol-editor" onDoubleClick={event => event.stopPropagation()}>
              <input autoFocus maxLength={150} placeholder="Reason / Description" value={editor.name}
                onChange={event => setEditor(current => ({ ...current, name: event.target.value }))}
                onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); submitEditor(); } if (event.key === "Escape") setEditor(null); }} />
              <select aria-label="Holiday Type" value={editor.type} onChange={event => setEditor(current => ({ ...current, type: event.target.value }))}>{HOLIDAY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <div className="hol-editor-actions">
                <button type="button" className="hol-save" title="Save" aria-label="Save" disabled={busy || !editor.name.trim()} onClick={submitEditor}>✓</button>
                <button type="button" className="hol-cancel" title="Cancel" aria-label="Cancel" onClick={() => setEditor(null)}>×</button>
              </div>
            </div> : <>
              {holiday && <div className="hol-day-body">
                <span className={`hol-chip ${typeClass(holiday.holiday_type)}`}>{typeLabel(holiday.holiday_type)}{holiday.is_active === false ? " · Inactive" : ""}</span>
                <span className="hol-day-reason" title={holiday.holiday_name}>{holiday.holiday_name}</span>
              </div>}
              {!holiday && sunday && <div className="hol-day-body"><span className={`hol-chip ${working ? "hol-type-sunday-working" : "hol-type-sunday-off"}`}>{working ? "Working" : "Sunday Off"}</span></div>}
              {holiday && isAdmin && <div className="hol-day-actions">
                <button type="button" title="Edit" aria-label="Edit holiday" onClick={() => openEditor(date)}>✎</button>
                <button type="button" title="Remove" aria-label="Remove holiday" disabled={busy} onClick={() => removeHoliday(holiday)}>🗑</button>
              </div>}
            </>}
          </div>;
        })}
      </div>

      <div className="hol-summary hol-summary-inline">
        {SUMMARY_FIELDS.map(([key, label]) => <div key={key}><span>{label}</span><strong>{summary[key]}</strong></div>)}
      </div>
    </section>
  </div>;
}
