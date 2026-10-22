const toISO = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const PERIOD_OPTIONS = ["Today", "This Week", "This Month", "Last Month", "This Year", "Custom Range"];

// Fuller period list (adds All / Last Week / Last Year / Custom Date) for report
// toolbars that want the complete set rather than the legacy PERIOD_OPTIONS above.
export const FULL_PERIOD_OPTIONS = ["All", "Today", "This Week", "Last Week", "This Month", "Last Month", "This Year", "Last Year", "Custom Date"];

// Returns { from, to } ISO date strings for a named period, or the caller's own
// custom From/To when period is "Custom Range"/"Custom Date" (or unrecognised, e.g. "All").
export function periodRange(period, customFrom = "", customTo = "") {
  const today = new Date();
  const start = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  switch (period) {
    case "Today": {
      const day = start(today);
      return { from: toISO(day), to: toISO(day) };
    }
    case "This Week": {
      const day = start(today);
      const monday = new Date(day);
      monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: toISO(monday), to: toISO(sunday) };
    }
    case "Last Week": {
      const day = start(today);
      const thisMonday = new Date(day);
      thisMonday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
      const monday = new Date(thisMonday);
      monday.setDate(thisMonday.getDate() - 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: toISO(monday), to: toISO(sunday) };
    }
    case "This Month": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: toISO(first), to: toISO(last) };
    }
    case "Last Month": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: toISO(first), to: toISO(last) };
    }
    case "This Year": {
      const first = new Date(today.getFullYear(), 0, 1);
      const last = new Date(today.getFullYear(), 11, 31);
      return { from: toISO(first), to: toISO(last) };
    }
    case "Last Year": {
      const first = new Date(today.getFullYear() - 1, 0, 1);
      const last = new Date(today.getFullYear() - 1, 11, 31);
      return { from: toISO(first), to: toISO(last) };
    }
    default:
      return { from: customFrom || "", to: customTo || "" };
  }
}
