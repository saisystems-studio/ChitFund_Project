import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { INK, MUTED, LINE, BAND, header, voucherTitle, loadImage, companyFromProfile, printPdf } from "./collectionReceipt";

// jsPDF's standard "helvetica" font has no glyph for ₹ (outside WinAnsiEncoding) —
// rendering it garbles both the symbol and the digits beside it. Every report builds
// its cell strings with formatINR (which includes ₹) for the on-screen table and
// Excel, where it renders correctly, so the swap happens only here, right before the
// text reaches jsPDF.
const sanitizeCell = cell => {
  if (typeof cell === "string") return cell.replace(/₹/g, "Rs. ");
  if (cell && typeof cell === "object" && typeof cell.content === "string") return { ...cell, content: cell.content.replace(/₹/g, "Rs. ") };
  return cell;
};
const sanitizeRows = rows => rows.map(row => row.map(sanitizeCell));

// One generic, reusable report PDF shared by every Reports-module page — a company
// masthead, title, optional applied-filters line, a repeating-header data table, an
// optional Tally-style summary block (sharing the same column layout as the table so
// its Dr/Cr values line up), and page numbers on every page.
//
// columns: [{ header, align: "left"|"right"|"center", width }]  (width in mm, optional)
// rows: array of arrays of already-formatted display strings, same order as columns
// summaryRows: optional array of { cells, bold, dividerAfter } — `cells` is an autoTable
//   body row (same column count as `columns`, using {content, colSpan} for the merged
//   label cell) so the Dr/Cr summary values land under the table's own Dr/Cr columns.
export async function createReportPdf({
  title, filtersLine, columns, rows, summaryRows, orientation = "portrait", profile, summaryAtBottom = false,
}) {
  const company = companyFromProfile(profile);
  const logo = await loadImage(profile?.logo);
  const doc = new jsPDF({ format: "a4", unit: "mm", orientation });
  const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight(), margin = 15;
  doc.setProperties({ title });

  let y = header(doc, company, logo, width, margin) + 8;
  y = voucherTitle(doc, title.toUpperCase(), y, width);
  if (filtersLine) {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED).text(filtersLine, width / 2, y, { align: "center" });
    y += 7;
  }
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED)
    .text(`Generated ${new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, width - margin, y, { align: "right" });
  y += 5;

  const columnStyles = Object.fromEntries(columns.map((col, index) => [index, { halign: col.align || "left", ...(col.width ? { cellWidth: col.width } : {}) }]));
  const bottomSummary = summaryAtBottom && summaryRows?.length;
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin, bottom: 18 },
    head: [columns.map(col => col.header)],
    body: rows.length ? sanitizeRows(rows) : [[{ content: "No records for the selected filters.", colSpan: columns.length, styles: { halign: "center", textColor: MUTED, fontStyle: "italic" } }]],
    showHead: "everyPage", theme: "grid",
    styles: { font: "helvetica", fontSize: 8, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2 },
    headStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold" },
    columnStyles,
    ...(bottomSummary ? {
      foot: summaryRows.map(row => row.cells.map(sanitizeCell)),
      showFoot: "lastPage",
      footStyles: { fillColor: false, textColor: INK, fontStyle: "normal", fontSize: 9, cellPadding: 1.8, lineWidth: 0 },
      didParseCell: data => {
        if (data.section === "foot" && summaryRows[data.row.index]?.bold) data.cell.styles.fontStyle = "bold";
      },
      willDrawCell: data => {
        if (data.section === "foot" && data.row.index === 0 && data.column.index === 0) {
          const footerY = height - 18 - data.table.getFootHeight(data.table.columns);
          data.cursor.y = footerY;
          data.cell.y = footerY;
        }
      },
      didDrawCell: data => {
        if (data.section === "foot" && data.column.index === 0 && summaryRows[data.row.index]?.dividerAfter) {
          const lineY = data.cell.y + data.cell.height;
          doc.setDrawColor(...LINE).setLineWidth(0.2).line(margin, lineY, width - margin, lineY);
        }
      },
    } : {}),
  });
  let cursor = doc.lastAutoTable.finalY + 4;

  if (summaryRows?.length && !bottomSummary) {
    const dividerYs = [];
    autoTable(doc, {
      startY: cursor, margin: { left: margin, right: margin },
      body: summaryRows.map(row => row.cells.map(sanitizeCell)),
      theme: "plain",
      styles: { font: "helvetica", fontSize: 9, textColor: INK, cellPadding: 1.8 },
      columnStyles,
      didParseCell: data => { if (summaryRows[data.row.index]?.bold) data.cell.styles.fontStyle = "bold"; },
      didDrawCell: data => {
        if (data.column.index === 0 && summaryRows[data.row.index]?.dividerAfter) dividerYs.push(data.cell.y + data.cell.height);
      },
    });
    dividerYs.forEach(lineY => doc.setDrawColor(...LINE).setLineWidth(0.2).line(margin, lineY, width - margin, lineY));
    cursor = doc.lastAutoTable.finalY;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(...LINE).setLineWidth(0.2).line(margin, height - 12, width - margin, height - 12);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
    doc.text(`Page ${page} of ${pages}`, width - margin, height - 7, { align: "right" });
  }
  return doc;
}

export async function downloadReportPdf(options, filename) {
  (await createReportPdf(options)).save(`${filename}.pdf`);
}

export async function printReportPdf(options) {
  printPdf(await createReportPdf(options), "generic-report-print-frame");
}
