import { formatINR } from "../../utils/currency";

export const dateText = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";

// Display text of one model cell. Amounts are always "₹1,234.00"; balances carry Dr / Cr.
export function cellText(value, type) {
  if (value === undefined || value === null || value === "") return type === "money" || type === "balance" ? "" : "—";
  if (type === "money") return formatINR(value);
  if (type === "date") return dateText(value);
  if (type === "balance") return value.amount ? `${formatINR(value.amount)} ${value.side}` : formatINR(0);
  return String(value);
}

export const statusTone = value => {
  const text = String(value || "").toLowerCase();
  return /paid|complete|active|closed/.test(text) && !/part|un/.test(text) ? "good" : /part/.test(text) ? "warn" : /pending|overdue|unpaid|due/.test(text) ? "bad" : "info";
};
