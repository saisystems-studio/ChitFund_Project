import ExcelJS from "exceljs";

const NAVY = "FF173B63", PALE = "FFEAF2FB", WHITE = "FFFFFFFF";
const currencyFormat = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
const border = Object.fromEntries(["top", "bottom", "left", "right"].map(side => [side, { style: "thin", color: { argb: "FFBBCBDC" } }]));
const isMoney = col => col.currency ?? (!/%|percent|quantity|members|loans|days|count/i.test(col.header) && (/\b(dr|cr|debit|credit|amount|balance|total|collected|collection|paid|pending|outstanding|profit|loss|income|expense|principal|interest)\b/i.test(col.header) || (col.numeric && !/members|loans|days|quantity|count|percent|s\.?no/i.test(col.header))));
function excelValue(value, col) {
  if (value === "" || value == null) return { value: "" };
  if (typeof value === "number") return { value, numFmt: isMoney(col) ? currencyFormat : col.numeric ? (/quantity|percent|%/i.test(col.header) ? "0.00" : "0") : undefined };
  if (isMoney(col) && typeof value === "string") {
    const match = value.trim().match(/^(?:₹\s*|Rs\.?\s*)?(-?\d[\d,]*(?:\.\d+)?)\s*(DR|CR)?$/i);
    if (match) return { value: Number(match[1].replace(/,/g, "")), numFmt: match[2] ? `"₹"#,##0.00" ${match[2].toUpperCase()}";[Red]-"₹"#,##0.00" ${match[2].toUpperCase()}"` : currencyFormat };
  }
  return { value };
}
const align = col => col.align || (isMoney(col) || col.numeric ? "right" : /date|loan type|vch|voucher|^type$/i.test(col.header) ? "center" : "left");

// All report callers supply their existing rows and totals; this only styles them.
export function createReportWorkbook({ title, subtitle, columns, rows, summaryRows = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CHITUFUND";
  const sheet = workbook.addWorksheet("Report", { pageSetup: {
    paperSize: 9, orientation: columns.length > 5 ? "landscape" : "portrait",
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  } });
  const lastCol = columns.length;
  sheet.addRow([title]);sheet.mergeCells(1, 1, 1, lastCol);
  sheet.getCell("A1").font = { name: "Calibri", size: 16, bold: true, color: { argb: NAVY } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  sheet.getRow(1).height = 30;
  if (subtitle) {
    sheet.addRow([subtitle]);sheet.mergeCells(2, 1, 2, lastCol);
    sheet.getCell("A2").font = { name: "Calibri", size: 11, color: { argb: NAVY } };
    sheet.getCell("A2").alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(2).height = Math.max(28, Math.ceil(subtitle.length / 110) * 16);
  }
  sheet.addRow([]).height = 8;
  const header = sheet.addRow(columns.map(col => col.header));header.height = 28;
  header.eachCell(cell => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  });
  const widths = columns.map((col, c) => {
    let width = Math.max(col.width || 12, col.header.length + 3);
    for (const row of rows) width = Math.max(width, Math.min(55, String(row[c] ?? "").length + 3));
    for (const row of summaryRows) if (c) width = Math.max(width, String(row[c] ?? "").length + 3);
    return Math.min(55, width);
  });
  sheet.columns.forEach((col, c) => { col.width = widths[c]; });
  function addStyledRow(values, index, summary = false) {
    const row = sheet.addRow(columns.map((col, c) => excelValue(values[c], col).value));
    const closing = summary && /closing balance/i.test(String(values[0]));
    let labelEnd = 1;
    if (summary) { while (labelEnd < lastCol && (values[labelEnd] === "" || values[labelEnd] == null) && !isMoney(columns[labelEnd])) labelEnd++; if (labelEnd > 1) sheet.mergeCells(row.number, 1, row.number, labelEnd); }
    let lines = 1;
    columns.forEach((col, c) => {
      const cell = row.getCell(c + 1), converted = excelValue(values[c], col);
      cell.font = { name: "Calibri", size: 11, bold: summary, color: { argb: NAVY } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: closing ? PALE : index % 2 ? "FFF5F8FC" : WHITE } };
      cell.border = border;
      cell.alignment = { horizontal: summary && c < labelEnd ? "right" : align(col), vertical: "middle", wrapText: true };
      if (converted.numFmt) cell.numFmt = converted.numFmt;
      if (!(summary && c < labelEnd)) lines = Math.max(lines, ...String(converted.value).split('\n').map(line => Math.ceil(line.length / Math.max(8, widths[c] - 2))));
    });
    row.height = Math.max(summary ? 24 : 22, lines * 15 + 6);
  }
  rows.forEach((row, index) => addStyledRow(row, index));
  summaryRows.forEach((row, index) => addStyledRow(row, index, true));
  sheet.views = [{ state: "frozen", ySplit: header.number, activeCell: `A${header.number + 1}`, showGridLines: false }];
  sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number + rows.length, column: lastCol } };
  sheet.pageSetup.printTitlesRow = `${header.number}:${header.number}`;
  sheet.pageSetup.printArea = `A1:${sheet.getCell(sheet.rowCount, lastCol).address}`;
  sheet.headerFooter.oddFooter = "&RPage &P of &N";
  return workbook;
}

export async function downloadReportExcel(options) {
  const workbook = createReportWorkbook(options);
  const filename = `${options.filename}.xlsx`;
  if (typeof document === "undefined") { await workbook.xlsx.writeFile(filename); return; }
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
