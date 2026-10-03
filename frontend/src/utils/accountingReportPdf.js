import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { PAGE, INK, MUTED, LINE, BAND, header, voucherTitle, loadImage, companyFromProfile, printPdf } from "./collectionReceipt";
import { flattenTree } from "./accountingReportExport";

const money = value => Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function drawFooters(doc) {
  const { margin, width, height } = PAGE, pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(...LINE).setLineWidth(0.2).line(margin, height - 12, width - margin, height - 12);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
    doc.text(`Page ${page} of ${pages}`, width - margin, height - 7, { align: "right" });
  }
}

function periodLine(doc, from, to, y) {
  const { width } = PAGE;
  const label = from || to ? `${from ? `From ${from}` : "From inception"} to ${to || "date"}` : "All dates";
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED).text(label, width / 2, y, { align: "center" });
  return y + 7;
}

function groupTable(doc, y, title, nodes) {
  const { margin, width } = PAGE;
  const rows = flattenTree(nodes);
  if (!rows.length) return y;
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK).text(title, margin, y);
  y += 3;
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin, bottom: 18 },
    head: [["Particulars", "Debit", "Credit"]],
    body: rows.map(row => [`${"  ".repeat(row.depth)}${row.is_group ? row.name.toUpperCase() : row.name}`, row.debit ? money(row.debit) : "", row.credit ? money(row.credit) : ""]),
    showHead: "everyPage", theme: "grid",
    styles: { font: "helvetica", fontSize: 8, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2 },
    headStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right", cellWidth: 32 }, 2: { halign: "right", cellWidth: 32 } },
    didParseCell: data => { if (data.section === "body" && rows[data.row.index]?.is_group) data.cell.styles.fontStyle = "bold"; },
  });
  return doc.lastAutoTable.finalY + 7;
}

async function reportDoc(title, from, to, profile) {
  const company = companyFromProfile(profile);
  const logo = await loadImage(profile?.logo);
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  doc.setProperties({ title });
  let y = header(doc, company, logo) + 8;
  y = voucherTitle(doc, title.toUpperCase(), y);
  y = periodLine(doc, from, to, y);
  return { doc, y };
}

export async function createTrialBalancePdf(report, from, to, profile) {
  const { doc, y } = await reportDoc("Trial Balance", from, to, profile);
  let cursor = groupTable(doc, y, "Ledger Balances", report.groups);
  autoTable(doc, {
    startY: cursor, margin: { left: PAGE.margin, right: PAGE.margin },
    body: [["TOTAL", money(report.total_debit), money(report.total_credit)]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, fontStyle: "bold", textColor: INK, lineColor: INK, lineWidth: 0.3, cellPadding: 2.4 },
    columnStyles: { 1: { halign: "right", cellWidth: 32 }, 2: { halign: "right", cellWidth: 32 } },
  });
  drawFooters(doc);
  return doc;
}

export async function createProfitAndLossPdf(report, from, to, profile) {
  const { doc, y } = await reportDoc("Profit & Loss Account", from, to, profile);
  let cursor = groupTable(doc, y, "Expenses", [report.direct_expense, ...report.indirect_expense].filter(Boolean));
  cursor = groupTable(doc, cursor, "Income", [report.direct_income, ...report.indirect_income].filter(Boolean));
  autoTable(doc, {
    startY: cursor, margin: { left: PAGE.margin, right: PAGE.margin },
    body: [["Gross Profit", money(report.gross_profit)], ["Net Profit / (Loss)", money(report.net_profit)]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, fontStyle: "bold", textColor: INK, lineColor: INK, lineWidth: 0.3, cellPadding: 2.4 },
    columnStyles: { 1: { halign: "right", cellWidth: 40 } },
  });
  drawFooters(doc);
  return doc;
}

export async function createBalanceSheetPdf(report, from, to, profile) {
  const { doc, y } = await reportDoc("Balance Sheet", from, to, profile);
  let cursor = groupTable(doc, y, "Liabilities", report.liabilities);
  cursor = groupTable(doc, cursor, "Assets", report.assets);
  const plug = [];
  if (report.net_profit) plug.push([report.net_profit >= 0 ? "Net Profit (added to Liabilities)" : "Net Loss (added to Assets)", money(Math.abs(report.net_profit))]);
  if (report.suspense) plug.push(["Suspense Account (Unclassified)", money(Math.abs(report.suspense))]);
  if (plug.length) autoTable(doc, { startY: cursor, margin: { left: PAGE.margin, right: PAGE.margin }, body: plug, theme: "plain", styles: { font: "helvetica", fontSize: 8, fontStyle: "italic", textColor: MUTED, cellPadding: 1.5 }, columnStyles: { 1: { halign: "right" } } });
  cursor = (plug.length ? doc.lastAutoTable.finalY : cursor) + 4;
  autoTable(doc, {
    startY: cursor, margin: { left: PAGE.margin, right: PAGE.margin },
    body: [["TOTAL", money(report.total_liabilities), money(report.total_assets)]],
    head: [["", "Liabilities", "Assets"]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, fontStyle: "bold", textColor: INK, lineColor: INK, lineWidth: 0.3, cellPadding: 2.4 },
    columnStyles: { 1: { halign: "right", cellWidth: 36 }, 2: { halign: "right", cellWidth: 36 } },
  });
  drawFooters(doc);
  return doc;
}

const fileName = title => `${title.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`;

export async function downloadAccountingReport(kind, report, from, to, profile) {
  const build = { trial: createTrialBalancePdf, pl: createProfitAndLossPdf, bs: createBalanceSheetPdf }[kind];
  const title = { trial: "Trial Balance", pl: "Profit and Loss", bs: "Balance Sheet" }[kind];
  (await build(report, from, to, profile)).save(fileName(title));
}

export async function printAccountingReport(kind, report, from, to, profile) {
  const build = { trial: createTrialBalancePdf, pl: createProfitAndLossPdf, bs: createBalanceSheetPdf }[kind];
  printPdf(await build(report, from, to, profile), "accounting-report-print-frame");
}
