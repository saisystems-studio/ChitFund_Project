import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import ExcelJS from "exceljs";
import { INK, MUTED, LINE, BAND, header, voucherTitle, loadImage, companyFromProfile, printPdf } from "../../utils/collectionReceipt";
import { reportFilename } from "../../utils/reportFilename";
import { cellText } from "./detailFormat";

// Print / PDF / Excel of the record on screen. They render the same model as the page, so the
// exported figures are exactly the ones displayed. jsPDF's built-in font has no ₹ glyph (same
// reason reportPdf.js swaps it), so PDF text uses "Rs.".
const pdfText = text => String(text ?? "").replace(/₹/g, "Rs. ");
const rowCells = (columns, row) => columns.map(column => cellText(row[column.key], column.type));
const footerCells = (columns, footer) => columns.map((column, index) => footer[column.key] !== undefined ? cellText(footer[column.key], column.type) : index === 0 ? footer.label : "");
const sectionPairs = section => section.items.map(entry => [entry.label, cellText(entry.value, entry.type)]);

export async function createDetailPdf(model, profile) {
  const company = companyFromProfile(profile);
  const logo = await loadImage(profile?.logo);
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight(), margin = 15;
  doc.setProperties({ title: model.title });
  let y = header(doc, company, logo, width, margin) + 8;
  y = voucherTitle(doc, model.title.toUpperCase(), y, width);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  doc.text(pdfText([model.subtitle, model.reference].filter(Boolean).join("   •   ")), width / 2, y, { align: "center" });
  y += 7;
  const common = { margin: { left: margin, right: margin, bottom: 18 }, theme: "grid", styles: { font: "helvetica", fontSize: 8, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2 } };
  const heading = text => { if (y > height - 40) { doc.addPage(); y = margin; } doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK).text(pdfText(text), margin, y); y += 2; };
  for (const section of model.sections) {
    const pairs = sectionPairs(section);
    if (!pairs.length) continue;
    heading(section.title);
    const body = [];
    for (let index = 0; index < pairs.length; index += 2) body.push([...pairs[index], ...(pairs[index + 1] || ["", ""])].map(pdfText));
    autoTable(doc, { ...common, startY: y, body, columnStyles: { 0: { fontStyle: "bold", fillColor: BAND, cellWidth: 35 }, 1: { cellWidth: 52 }, 2: { fontStyle: "bold", fillColor: BAND, cellWidth: 35 }, 3: { cellWidth: 52 } } });
    y = doc.lastAutoTable.finalY + 6;
  }
  for (const table of model.tables) {
    heading(table.title);
    const align = Object.fromEntries(table.columns.map((column, index) => [index, { halign: column.align || "left" }]));
    autoTable(doc, { ...common, startY: y, head: [table.columns.map(column => column.label)], showHead: "everyPage",
      body: table.rows.length ? table.rows.map(row => rowCells(table.columns, row).map(pdfText)) : [[{ content: "No records.", colSpan: table.columns.length, styles: { halign: "center", textColor: MUTED, fontStyle: "italic" } }]],
      foot: table.footer?.map(footer => footerCells(table.columns, footer).map(pdfText)), showFoot: "lastPage",
      headStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold" }, footStyles: { fillColor: false, textColor: INK, fontStyle: "bold" }, columnStyles: align });
    y = doc.lastAutoTable.finalY + 6;
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(...LINE).setLineWidth(0.2).line(margin, height - 12, width - margin, height - 12);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
    doc.text(`Generated ${new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, margin, height - 7);
    doc.text(`Page ${page} of ${pages}`, width - margin, height - 7, { align: "right" });
  }
  return doc;
}

export const detailFilename = model => reportFilename(model.title.replace(/\s+/g, "_"), model.reference, model.subtitle);

export async function downloadDetailPdf(model, profile) { (await createDetailPdf(model, profile)).save(`${detailFilename(model)}.pdf`); }
export async function printDetailPdf(model, profile) { printPdf(await createDetailPdf(model, profile), "report-detail-print-frame"); }

export async function downloadDetailExcel(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CHITUFUND";
  const sheet = workbook.addWorksheet("Details");
  const widest = Math.max(4, ...model.tables.map(table => table.columns.length));
  const bold = row => row.eachCell(cell => { cell.font = { bold: true }; });
  sheet.addRow([model.title]).font = { bold: true, size: 15 };
  sheet.addRow([[model.subtitle, model.reference].filter(Boolean).join("  •  ")]);
  sheet.addRow([]);
  const money = (cell, value) => { cell.value = Number(value); cell.numFmt = '"₹"#,##0.00'; cell.alignment = { horizontal: "right" }; };
  for (const section of model.sections) {
    if (!section.items.length) continue;
    bold(sheet.addRow([section.title]));
    for (const entry of section.items) {
      const row = sheet.addRow([entry.label, cellText(entry.value, entry.type)]);
      row.getCell(1).font = { bold: true };
      if (entry.type === "money") money(row.getCell(2), entry.value);
    }
    sheet.addRow([]);
  }
  for (const table of model.tables) {
    bold(sheet.addRow([table.title]));
    const head = sheet.addRow(table.columns.map(column => column.label));
    head.eachCell(cell => { cell.font = { bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2FB" } }; });
    for (const source of table.rows) {
      const row = sheet.addRow(rowCells(table.columns, source));
      table.columns.forEach((column, index) => { if (column.type === "money" && source[column.key] !== "" && source[column.key] != null) money(row.getCell(index + 1), source[column.key]); });
    }
    for (const footer of table.footer || []) {
      const row = sheet.addRow(footerCells(table.columns, footer));
      bold(row);
      table.columns.forEach((column, index) => { if (column.type === "money" && footer[column.key] !== undefined) money(row.getCell(index + 1), footer[column.key]); });
    }
    sheet.addRow([]);
  }
  for (let column = 1; column <= widest; column++) sheet.getColumn(column).width = column === 1 ? 26 : 20;
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `${detailFilename(model)}.xlsx` });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
