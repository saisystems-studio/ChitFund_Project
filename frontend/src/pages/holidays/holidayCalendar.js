// Shared Holiday Calendar logic for Add Holiday (calendar) and Holiday List (month cards).
// Everything is derived from the saved HolidayMaster records (/finance/holidays/):
//   - GOVERNMENT / LOCAL / WEEKLY_OFF / SPECIAL_LEAVE records are Off days (no collection);
//   - SUNDAY_WORKING marks a Sunday ticked as a Working Day;
//   - a Sunday without a record is Off by default ("Sunday Off").
// Earlier record types are kept: STATE counts as Government, OPTIONAL / CUSTOM as Local.
// Nothing here is hardcoded holiday data.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const HOLIDAY_TYPES = [
  ["GOVERNMENT", "Government Holiday"],
  ["LOCAL", "Local Holiday"],
  ["WEEKLY_OFF", "Weekly Off"],
  ["SPECIAL_LEAVE", "Special Leave"],
];
export const SUNDAY_WORKING = "SUNDAY_WORKING";
export const SUNDAY_OFF = "SUNDAY_OFF"; // virtual: a Sunday with no record

const GROUP = { GOVERNMENT: "GOVERNMENT", STATE: "GOVERNMENT", LOCAL: "LOCAL", OPTIONAL: "LOCAL", CUSTOM: "LOCAL", WEEKLY_OFF: "WEEKLY_OFF", SPECIAL_LEAVE: "SPECIAL_LEAVE", SUNDAY_WORKING, SUNDAY_OFF };
const LABEL = { GOVERNMENT: "Government", LOCAL: "Local", WEEKLY_OFF: "Weekly Off", SPECIAL_LEAVE: "Special Leave", SUNDAY_WORKING: "Sunday Working", SUNDAY_OFF: "Sunday Off" };
export const typeGroup = type => GROUP[String(type || "").toUpperCase()] || "LOCAL";
export const typeLabel = type => LABEL[typeGroup(type)];
export const typeClass = type => `hol-type-${typeGroup(type).toLowerCase().replace(/_/g, "-")}`;

export const isoDate = (year, month, day) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
export const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
export const weekdayOf = iso => new Date(`${iso}T00:00:00`).getDay();
export const isSunday = iso => weekdayOf(iso) === 0;
export const recordsByDate = records => new Map(records.map(record => [record.holiday_date, record]));
export const isOffRecord = record => record && record.is_active !== false && typeGroup(record.holiday_type) !== SUNDAY_WORKING;

// Every Sunday date of a month, in order.
export function sundaysOf(year, month) {
  const result = [];
  for (let day = 1; day <= daysInMonth(year, month); day += 1) if (new Date(year, month, day).getDay() === 0) result.push(isoDate(year, month, day));
  return result;
}

// Sunday selection patterns -> which Sundays of the month are Working (the rest are Off).
export const SUNDAY_PATTERNS = [
  ["ALL_OFF", "All Sundays Off"],
  ["FIRST_THIRD_OFF", "Alternate: 1st & 3rd Sundays Off"],
  ["SECOND_FOURTH_OFF", "Alternate: 2nd & 4th Sundays Off"],
  ["MANUAL", "Manual Selection"],
];
export function workingSundaysFor(pattern, year, month) {
  const sundays = sundaysOf(year, month);
  if (pattern === "FIRST_THIRD_OFF") return sundays.filter((_, index) => index !== 0 && index !== 2);
  if (pattern === "SECOND_FOURTH_OFF") return sundays.filter((_, index) => index !== 1 && index !== 3);
  return [];
}
export function patternOf(year, month, records) {
  const byDate = recordsByDate(records);
  const working = sundaysOf(year, month).filter(day => byDate.get(day)?.holiday_type === SUNDAY_WORKING && byDate.get(day)?.is_active !== false);
  const same = list => list.length === working.length && list.every(day => working.includes(day));
  return SUNDAY_PATTERNS.slice(0, 3).find(([key]) => same(workingSundaysFor(key, year, month)))?.[0] || "MANUAL";
}

// One row per date (never duplicated), strictly ascending: saved records of the month plus a
// "Sunday Off" row for every Sunday that has no record.
export function monthEntries(year, month, records) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const byDate = new Map();
  records.filter(record => String(record.holiday_date).startsWith(prefix)).forEach(record => { if (!byDate.has(record.holiday_date)) byDate.set(record.holiday_date, record); });
  sundaysOf(year, month).forEach(day => { if (!byDate.has(day)) byDate.set(day, null); });
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, record]) => ({
    date, record, day: WEEKDAYS[weekdayOf(date)], dayNumber: date.slice(8, 10),
    type: record ? typeGroup(record.holiday_type) : SUNDAY_OFF,
    name: record ? record.holiday_name : "Weekly Off",
    inactive: record ? record.is_active === false : false,
  }));
}

// Monthly totals, computed from the month itself and its saved active records.
export function monthSummary(year, month, records) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const active = records.filter(record => String(record.holiday_date).startsWith(prefix) && record.is_active !== false);
  let saturdays = 0;
  for (let day = 1; day <= daysInMonth(year, month); day += 1) if (new Date(year, month, day).getDay() === 6) saturdays += 1;
  const sundays = sundaysOf(year, month);
  const workingSet = new Set(active.filter(record => record.holiday_type === SUNDAY_WORKING && isSunday(record.holiday_date)).map(record => record.holiday_date));
  const count = group => active.filter(record => typeGroup(record.holiday_type) === group).length;
  return {
    totalSundays: sundays.length,
    sundayWorking: workingSet.size,
    sundayOff: sundays.length - workingSet.size,
    totalSaturdays: saturdays,
    totalWeekends: saturdays + sundays.length,
    government: count("GOVERNMENT"),
    local: count("LOCAL"),
    weeklyOff: count("WEEKLY_OFF"),
    specialLeave: count("SPECIAL_LEAVE"),
    uniqueHolidays: monthEntries(year, month, records).filter(entry => !entry.inactive && entry.type !== SUNDAY_WORKING).length,
  };
}

export const SUMMARY_FIELDS = [
  ["totalSundays", "Total Sundays"], ["sundayWorking", "Sunday Working"], ["sundayOff", "Sunday Off"], ["totalWeekends", "Total Weekends"],
  ["government", "Government Holidays"], ["local", "Local Holidays"], ["uniqueHolidays", "Total Holidays"],
];

// Type filter on the list: matches the row's group (Sunday Off / Working included).
export const LIST_TYPE_FILTERS = [["", "All Types"], ["GOVERNMENT", "Government"], ["LOCAL", "Local"], ["WEEKLY_OFF", "Weekly Off"], ["SPECIAL_LEAVE", "Special Leave"], [SUNDAY_WORKING, "Sunday Working"], [SUNDAY_OFF, "Sunday Off"]];

// Month-wise export rows (PDF / Excel / Print): a month heading, the month's dated rows in
// ascending order, then the month's totals.
export function exportSections(year, months, records, typeFilter = "") {
  return months.map(month => {
    const rows = monthEntries(year, month, records).filter(entry => !typeFilter || entry.type === typeFilter);
    const summary = monthSummary(year, month, records);
    const totals = SUMMARY_FIELDS.map(([key, label]) => `${label}: ${summary[key]}`).join("   ");
    return { title: `${MONTHS[month]} ${year}`, rows: rows.map(entry => [entry.dayNumber, entry.day, `${entry.name}${entry.inactive ? " (Inactive)" : ""}`, typeLabel(entry.type)]), totals };
  });
}

// Holiday List totals come from saved active Off records, never virtual Sundays.
// Filters apply consistently to the displayed columns, totals and exports.
export function holidayListSections(year, records, monthFilter = "", typeFilter = "") {
  const months = monthFilter === "" ? MONTHS.map((_, index) => index) : [Number(monthFilter)];
  return months.map(month => {
    const entries = monthEntries(year, month, records).filter(entry => entry.record && (!typeFilter || entry.type === typeFilter));
    return { month, title: `${MONTHS[month]} ${year}`, entries,
      total: entries.filter(entry => !entry.inactive && entry.type !== SUNDAY_WORKING).length };
  });
}
