// Convert legacy display-format drafts at the API boundary, without timezone shifts.
export function toApiDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const display = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = display ? `${display[3]}-${display[1]}-${display[2]}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Dates must use YYYY-MM-DD.");
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new Error("Enter a valid date.");
  }
  return iso;
}

export function calculateChitEndDate(startDate, duration, durationType) {
  const count = Number(duration);
  if (!startDate || !Number.isSafeInteger(count) || count <= 0) return "";
  try {
    const result = new Date(`${toApiDate(startDate)}T00:00:00Z`);
    if (durationType === "DAY") {
      result.setUTCDate(result.getUTCDate() + count);
    } else if (durationType === "MONTH" || durationType === "YEAR") {
      const day = result.getUTCDate();
      result.setUTCDate(1);
      result.setUTCMonth(result.getUTCMonth() + count * (durationType === "YEAR" ? 12 : 1));
      const lastDay = new Date(result.getTime());
      lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
      result.setUTCDate(Math.min(day, lastDay.getUTCDate()));
    } else {
      return "";
    }
    return toApiDate(result.toISOString().slice(0, 10));
  } catch {
    return "";
  }
}

export function chitPreviewPayload(group, startDate, includeSunday, blockedHolidays) {
  return {
    chit_group_id: group.id,
    start_date: toApiDate(startDate || group.start_date),
    duration: group.duration,
    duration_type: group.duration_type,
    collection_day: group.collection_day,
    collection_month: group.collection_month,
    include_sunday: includeSunday,
    blocked_holidays: blockedHolidays.filter(Boolean).map(toApiDate),
  };
}
