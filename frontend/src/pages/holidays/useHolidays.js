import { useCallback, useEffect, useState } from "react";
import apiErrorMessage from "../../utils/apiErrorMessage";
import { actionToast } from "../../utils/actionToast";
import { SUNDAY_WORKING, recordsByDate } from "./holidayCalendar";

// Holiday records through the existing /finance/holidays/ API (one record per date).
// Saving a date that already has a record updates that record instead of duplicating it.
export default function useHolidays(api, auth) {
  const [records, setRecords] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    return api.get("/finance/holidays/", auth)
      .then(({ data }) => setRecords(data.results ?? data ?? []))
      .catch(() => actionToast("Unable to load holidays.", false))
      .finally(() => setLoading(false));
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const run = async (work, success, failure) => {
    if (busy) return false;
    setBusy(true);
    try { await work(); if (success) actionToast(success); await load(); return true; }
    catch (error) { actionToast(apiErrorMessage(error, failure), false); return false; }
    finally { setBusy(false); }
  };

  // { holiday_date, holiday_name, holiday_type }
  const save = values => run(async () => {
    const existing = recordsByDate(records).get(values.holiday_date);
    const payload = { holiday_date: values.holiday_date, holiday_name: String(values.holiday_name || "").trim(), holiday_type: values.holiday_type, description: String(values.holiday_name || "").trim(), is_active: true };
    if (existing) await api.patch(`/finance/holidays/${existing.id}/`, payload, auth);
    else await api.post("/finance/holidays/", payload, auth);
  }, "Holiday saved successfully.", "Unable to save the holiday.");

  const remove = record => run(() => api.delete(`/finance/holidays/${record.id}/`, auth), "Holiday removed successfully.", "Unable to remove the holiday.");

  // Tick a Sunday as Working (creates a SUNDAY_WORKING record) or untick it back to Off.
  const setSundayWorking = (date, working, { quiet = false } = {}) => run(async () => {
    const existing = recordsByDate(records).get(date);
    if (working && !existing) await api.post("/finance/holidays/", { holiday_date: date, holiday_name: "Sunday Working", holiday_type: SUNDAY_WORKING, description: "", is_active: true }, auth);
    else if (!working && existing?.holiday_type === SUNDAY_WORKING) await api.delete(`/finance/holidays/${existing.id}/`, auth);
  }, quiet ? null : working ? "Sunday marked as Working Day." : "Sunday marked as Off.", "Unable to update the Sunday.");

  // Apply a set of Working Sundays to the given Sundays in one go (Sunday selection dropdown).
  const applySundays = (sundays, workingDates) => run(async () => {
    const byDate = recordsByDate(records), working = new Set(workingDates);
    for (const date of sundays) {
      const existing = byDate.get(date);
      if (existing && existing.holiday_type !== SUNDAY_WORKING) continue; // a saved holiday keeps that Sunday Off
      if (working.has(date) && !existing) await api.post("/finance/holidays/", { holiday_date: date, holiday_name: "Sunday Working", holiday_type: SUNDAY_WORKING, description: "", is_active: true }, auth);
      if (!working.has(date) && existing) await api.delete(`/finance/holidays/${existing.id}/`, auth);
    }
  }, "Sunday selection applied.", "Unable to apply the Sunday selection.");

  return { records, loading, busy, load, save, remove, setSundayWorking, applySundays };
}
