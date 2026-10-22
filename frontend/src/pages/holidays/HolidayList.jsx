import { useMemo, useState } from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import { useCompanyProfile } from "../../components/CompanyProfileContext";
import { useSession } from "../../components/SessionContext";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import confirmDelete from "../../utils/confirmDelete";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";
import useHolidays from "./useHolidays";
import {
  HOLIDAY_TYPES, LIST_TYPE_FILTERS, MONTHS, SUNDAY_OFF, SUNDAY_WORKING,
  holidayListSections, typeClass, typeLabel,
} from "./holidayCalendar";
import "./holidays.css";

// Saved months stay open; columns and counts are derived from filtered saved records.
const thisYear = new Date().getFullYear();

export default function HolidayList({ api, auth, go }) {
  const { isAdmin } = useSession();
  const { profile } = useCompanyProfile() || {};
  const { records, loading, busy, load, save, remove, setSundayWorking } = useHolidays(api, auth);
  const [year, setYear] = useState(thisYear), [monthFilter, setMonthFilter] = useState(""), [typeFilter, setTypeFilter] = useState("");
  const [allocation, setAllocation] = useState(null), [allocationBusy, setAllocationBusy] = useState(false), [allocationError, setAllocationError] = useState("");
  const [editing, setEditing] = useState(null), [exportBusy, setExportBusy] = useState(null);
  const years = useMemo(() => {
    const set = new Set([thisYear - 1, thisYear, thisYear + 1, thisYear + 2]);
    records.forEach(record => set.add(Number(String(record.holiday_date).slice(0, 4))));
    return [...set].filter(Boolean).sort((a, b) => a - b);
  }, [records]);
  const monthSections = useMemo(() => holidayListSections(year, records, monthFilter, typeFilter), [year, records, monthFilter, typeFilter]);
  const overallTotal = monthSections.reduce((total, section) => total + section.total, 0);

  const openAllocation = async entry => {
    if (!entry.record || entry.inactive || allocationBusy) return;
    setAllocationError(""); setAllocationBusy(true);
    try {
      const { data } = await api.get(`/finance/holidays/${entry.record.id}/allocations/`, auth);
      setAllocation({ entry, loans: data, loanId: "" });
    } catch { setAllocationError("Unable to load collection dates."); }
    finally { setAllocationBusy(false); }
  };
  const allocate = async event => {
    event.preventDefault();
    if (allocationBusy || !allocation.loanId) return;
    setAllocationBusy(true); setAllocationError("");
    try {
      await api.post(`/finance/holidays/${allocation.entry.record.id}/allocate/`, { loan_id: allocation.loanId }, auth);
      await load(); setAllocation(null);
    } catch (error) { setAllocationError(error.response?.data?.detail || "Unable to allocate this date."); }
    finally { setAllocationBusy(false); }
  };

  const removeAllocation = async item => {
    if (!isAdmin || !await confirmDelete(`Remove the allocation for ${item.loan__loan_no}?`)) return;
    setAllocationBusy(true); setAllocationError("");
    try { await api.delete(`/finance/loan-holiday-settings/${item.id}/`, auth); await load(); }
    catch { setAllocationError("Unable to remove the allocation."); }
    finally { setAllocationBusy(false); }
  };
  const removeEntry = async entry => {
    if (!await confirmDelete(`Delete the holiday on ${entry.date.split("-").reverse().join("/")} (${entry.name})?`)) return;
    remove(entry.record);
  };
  const saveEdit = async event => {
    event.preventDefault();
    if (!editing.name.trim()) return;
    if (await save({ holiday_date: editing.date, holiday_name: editing.name, holiday_type: editing.type })) setEditing(null);
  };

  const filtersLine = [`Year: ${year}`, monthFilter !== "" && `Month: ${MONTHS[Number(monthFilter)]}`, typeFilter && `Type: ${LIST_TYPE_FILTERS.find(([value]) => value === typeFilter)?.[1]}`].filter(Boolean).join("   •   ");
  const exportName = () => reportFilename("Holiday_List", String(year), monthFilter !== "" && MONTHS[Number(monthFilter)], typeFilter && typeLabel(typeFilter));
  const sections = () => monthSections.map(section => ({ title: section.title,
    totals: `Total Holidays: ${section.total}`,
    rows: section.entries.map(entry => [entry.dayNumber, entry.day, `${entry.name}${entry.inactive ? " (Inactive)" : ""}`, typeLabel(entry.type)]),
  }));
  const pdfOptions = () => ({
    title: "Holiday List", filtersLine, profile,
    columns: [{ header: "Date", align: "center", width: 18 }, { header: "Day", align: "center", width: 18 }, { header: "Holiday / Reason", align: "left" }, { header: "Type", align: "left", width: 34 }],
    rows: sections().flatMap(section => [
      [{ content: section.title.toUpperCase(), colSpan: 4, styles: { fontStyle: "bold", fillColor: [234, 242, 251], halign: "left" } }],
      ...(section.rows.length ? section.rows : [[{ content: "No holidays for this month.", colSpan: 4, styles: { fontStyle: "italic", halign: "center" } }]]),
      [{ content: section.totals, colSpan: 4, styles: { fontStyle: "bold", fontSize: 7.5, halign: "left" } }],
    ]),
  });
  const runExport = async (kind, work) => {
    if (exportBusy || loading) return;
    setExportBusy(kind);
    try { await work(); } finally { setExportBusy(null); }
  };
  const exportPdf = () => runExport("pdf", () => downloadReportPdf(pdfOptions(), exportName()));
  const printList = () => runExport("print", () => printReportPdf(pdfOptions()));
  const exportExcel = () => runExport("excel", () => downloadReportExcel({
    filename: exportName(), title: "Holiday List", subtitle: filtersLine,
    columns: [{ header: "Date", width: 10 }, { header: "Day", width: 10 }, { header: "Holiday / Reason", width: 40 }, { header: "Type", width: 18 }],
    rows: sections().flatMap(section => [[section.title.toUpperCase(), "", "", ""], ...section.rows, ["Totals", "", section.totals, ""], ["", "", "", ""]]),
  }));

  return <div className="hol-page hol-list-page">
    <div className="hol-list-header">
      <PageBreadcrumb className="hol-breadcrumb" current="Holiday List" />
      <div className="hol-list-controls">
        <label className="hol-control"><span className="hol-control-label">Year</span>
          <SearchableSelect value={year} onChange={event => setYear(Number(event.target.value))}>{years.map(value => <option key={value} value={value}>{value}</option>)}</SearchableSelect>
        </label>
        <label className="hol-control"><span className="hol-control-label">Month</span>
          <SearchableSelect value={monthFilter} onChange={event => setMonthFilter(event.target.value)}><option value="">All Months</option>{MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}</SearchableSelect>
        </label>
        <label className="hol-control"><span className="hol-control-label">Holiday Type</span>
          <SearchableSelect value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>{LIST_TYPE_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SearchableSelect>
        </label>
        <ReportExportButtons portal downloadLabels onPdf={exportPdf} onExcel={exportExcel} onPrint={printList} busy={exportBusy} disabled={loading} />
        <button type="button" className="hol-btn hol-btn-primary" onClick={() => go("/holiday-master")}>+ Add Holiday</button>
      </div>
    </div>

    <div className="hol-overall-total" role="status">Overall Total Holidays: <strong>{loading ? "..." : overallTotal}</strong></div>
    <div className="hol-month-sections" aria-label={`Holidays ${year}`}>
      {loading && <p className="hol-list-empty">Loading holidays...</p>}
      {!loading && !monthSections.length && <p className="hol-list-empty">No saved holidays match the selected filters.</p>}
      {monthSections.map(({ month, title, entries, total }) => <section className={`hol-month-section hol-palette-${month % 4}`} key={month} aria-labelledby={`hol-month-${month}`}>
        <div className="hol-section-heading">
          <h2 id={`hol-month-${month}`}>{title}</h2>
          <span>Total Holidays: <strong>{loading ? "..." : total}</strong></span>
        </div>
        <div className="hol-horizontal-scroll" tabIndex={0} role="region" aria-label={`${title} dates and holidays`}>
          {loading ? <p className="hol-month-empty">Loading...</p> : !entries.length ? <p className="hol-month-empty">No holidays this month</p> :
          <table className="hol-horizontal-table" aria-label={title}>
            <tbody>
              <tr><th scope="row">Date</th>{entries.map(entry => <td key={entry.date} className={`hol-date-cell ${entry.record?.allocations?.length ? "is-allocated" : ""}`}>
                <button type="button" className="hol-cell-date" title={`${entry.date} - ${entry.day} - Double-click to allocate a scheduled collection`} disabled={entry.inactive || allocationBusy} onDoubleClick={() => openAllocation(entry)} onKeyDown={event => { if (event.key === "Enter") openAllocation(entry); }}>{Number(entry.dayNumber)}</button>
              </td>)}</tr>
              <tr><th scope="row">Holiday</th>{entries.map(entry => <td key={entry.date} className={`${typeClass(entry.type)} ${entry.inactive ? "is-inactive" : ""} ${entry.record?.allocations?.length ? "is-allocated" : ""}`}>
                <span className="hol-cell-name" title={typeLabel(entry.type)}>{entry.name}{entry.inactive && <small> - Inactive</small>}</span>
              {entry.record?.allocations?.length > 0 && <small className="hol-allocation-details">Allocated: {entry.record.allocations.map(item => <span key={item.id}>{item.loan__loan_no}{isAdmin && <button type="button" disabled={allocationBusy} aria-label={`Remove allocation ${item.loan__loan_no}`} onClick={() => removeAllocation(item)}>Remove</button>} </span>)}</small>}
              <span className="hol-cell-actions">
                {entry.type === SUNDAY_OFF && <button type="button" title="Mark as Working Sunday" aria-label={`Mark ${entry.date} as Working Sunday`} disabled={busy} onClick={() => setSundayWorking(entry.date, true)}>✓</button>}
                {entry.type === SUNDAY_WORKING && isAdmin && <button type="button" title="Mark Sunday Off" aria-label={`Mark ${entry.date} as Sunday Off`} disabled={busy} onClick={() => setSundayWorking(entry.date, false)}>↺</button>}
                {entry.record && entry.type !== SUNDAY_WORKING && isAdmin && <>
                  <button type="button" title="Edit" aria-label={`Edit holiday on ${entry.date}`} onClick={() => setEditing({ date: entry.date, name: entry.record.holiday_name, type: entry.record.holiday_type })}>✎</button>
                  <button type="button" title="Delete" aria-label={`Delete holiday on ${entry.date}`} disabled={busy} onClick={() => removeEntry(entry)}>🗑</button>
                </>}
              </span>

              </td>)}</tr>
            </tbody>
          </table>}
        </div>
      </section>)}
    </div>

    {allocationError && <p role="alert" className="error">{allocationError}</p>}
    {allocation && <div className="hol-modal-backdrop"><form className="hol-modal" onSubmit={allocate} role="dialog" aria-modal="true" aria-labelledby="hol-allocation-title">
      <h2 id="hol-allocation-title">Allocate Collection Date ? {allocation.entry.date}</h2>
      <p>{allocation.entry.name}</p>
      {!allocation.loans.length ? <p>No loan has a collection scheduled on this date.</p> : <label className="hol-control">Scheduled loan
        <SearchableSelect value={allocation.loanId} onChange={event => setAllocation(current => ({ ...current, loanId: event.target.value }))}>
          <option value="">Select loan</option>{allocation.loans.map(item => <option key={item.loan_id} value={item.loan_id} disabled={Boolean(item.allocation_id)}>{item.loan_no}{item.allocation_id ? " (Allocated)" : ""}</option>)}
        </SearchableSelect></label>}
      <div className="hol-modal-actions"><button type="button" className="hol-btn" disabled={allocationBusy} onClick={() => setAllocation(null)}>Close</button><button className="hol-btn hol-btn-primary" disabled={allocationBusy || !allocation.loanId}>Allocate</button></div>
    </form></div>}
    {editing && <div className="hol-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setEditing(null)}>
      <form className="hol-modal" onSubmit={saveEdit} role="dialog" aria-modal="true" aria-labelledby="hol-edit-title">
        <h2 id="hol-edit-title">Edit Holiday — {editing.date.split("-").reverse().join("/")}</h2>
        <label className="hol-control">Reason / Description
          <input autoFocus required maxLength={150} value={editing.name} onChange={event => setEditing(current => ({ ...current, name: event.target.value }))} />
        </label>
        <label className="hol-control">Holiday Type
          <select value={editing.type} onChange={event => setEditing(current => ({ ...current, type: event.target.value }))}>
            {HOLIDAY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            {["STATE", "OPTIONAL", "CUSTOM"].includes(editing.type) && <option value={editing.type}>{typeLabel(editing.type)} (existing)</option>}
          </select>
        </label>
        <div className="hol-modal-actions">
          <button type="button" className="hol-btn" onClick={() => setEditing(null)}>Cancel</button>
          <button type="submit" className="hol-btn hol-btn-primary" disabled={busy || !editing.name.trim()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>}
  </div>;
}
