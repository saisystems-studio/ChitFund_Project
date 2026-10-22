import { useState } from "react";
import ReportExportButtons from "../ReportExportButtons/ReportExportButtons";
import { useCompanyProfile } from "../CompanyProfileContext";
import { downloadReportPdf, printReportPdf } from "../../utils/reportPdf";
import { downloadReportExcel } from "../../utils/reportExcel";
import { reportFilename } from "../../utils/reportFilename";

// Shared "Export ▾" (Excel / PDF / Print) for every Master List page. The page passes the
// rows it is currently showing after search/filters (all pages of them, not just the
// visible page) and the data columns only -- never the Action column -- so every export
// matches what the user filtered. Uses the same Excel/PDF/print builders as Reports.
//
// columns: [{ header, value: row => display value, align?: "left"|"right"|"center", width?: mm (PDF) }]
// filtersLine: optional "Search: x   •   Group: y" line printed under the title.
export default function ListExport({ title, columns, rows, filtersLine = "", disabled = false }) {
  const { profile } = useCompanyProfile() || {};
  const [busy, setBusy] = useState(null);
  const matrix = () => rows.map((row, index) => columns.map(col => {
    const value = col.value(row, index);
    return value === null || value === undefined || value === "" ? "-" : value;
  }));
  const pdfOptions = () => ({
    title, filtersLine, profile,
    orientation: columns.length > 5 ? "landscape" : "portrait",
    columns: columns.map(({ header, align, width }) => ({ header, align, width })),
    rows: matrix().map(row => row.map(String)),
  });
  const filename = () => reportFilename(title);
  const run = async (kind, work) => {
    if (busy) return;
    setBusy(kind);
    try { await work(); } finally { setBusy(null); }
  };
  return <ReportExportButtons portal downloadLabels busy={busy} disabled={disabled}
    onExcel={() => run("excel", () => downloadReportExcel({ filename: filename(), title, subtitle: filtersLine, columns: columns.map(({ header, align, numeric }) => ({ header, align, numeric })), rows: matrix() }))}
    onPdf={() => run("pdf", () => downloadReportPdf(pdfOptions(), filename()))}
    onPrint={() => run("print", () => printReportPdf(pdfOptions()))} />;
}

// "Search: …   •   Group: …" for the export header, skipping empty filters.
export const exportFiltersLine = parts => parts.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "").map(([label, value]) => `${label}: ${value}`).join("   •   ");
