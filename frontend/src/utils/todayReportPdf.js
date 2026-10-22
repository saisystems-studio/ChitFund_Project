import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { PAGE, INK, MUTED, LINE, BAND, header, loadImage, companyFromProfile, printPdf } from "./collectionReceipt";

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

// Shared by Today Report and Today Collection Report; `title` and the optional Yesterday Pending KPI
// let each page print under its own name. Defaults keep the original Today Collection Report output.
export async function createTodayReportPdf(rows, summary, selectedLabel, profile, { title = "Today Collection History", yesterdayPending = false } = {}) {
  const company = companyFromProfile(profile);
  const logo = await loadImage(profile?.logo);
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  doc.setProperties({ title });
  const { margin, width } = PAGE;
  let y = header(doc, company, logo) + 8;
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...INK).text(title.toUpperCase(), width / 2, y, { align: "center" });
  y += 5;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED).text(selectedLabel || "", width / 2, y, { align: "center" });
  y += 7;

  const kpis = [["Today Due", summary.today_due], ["Today Collected", summary.today_collected], ["Today Remaining", summary.today_remaining], ...(yesterdayPending ? [["Yesterday Pending", summary.yesterday_pending]] : []), ["Total Overdue", summary.total_overdue]];
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin },
    body: [kpis.map(([label]) => label), kpis.map(([, value]) => money(value))],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2.4, halign: "center" },
    didParseCell: data => { if (data.row.index === 0) { data.cell.styles.fontStyle = "bold"; data.cell.styles.fillColor = BAND; } },
  });
  y = doc.lastAutoTable.finalY + 6;

  autoTable(doc, {
    startY: y, margin: { top: margin, left: margin, right: margin, bottom: 18 },
    head: [["S.No", "Customer", "Loan / Plan", "Due Date", "Due Amount", "Paid", "Balance", "Status", "Due Days"]],
    body: rows.length ? rows.map((row, index) => [
      index + 1,
      `${row.customer_name || "-"}${row.customer_code ? `\n${row.customer_code}` : ""}`,
      `${row.loan_name || "-"}${row.loan_no ? `\n${row.loan_no}` : ""}`,
      row.due_date || "-",
      money(row.due_amount),
      money(row.total_paid),
      money(row.balance),
      `${row.payment_status || "-"}${row.is_overdue ? ` (${row.days_overdue}d overdue)` : ""}`,
      row.due_days ?? 0,
    ]) : [[{ content: "No collections due for the selected filters.", colSpan: 9, styles: { halign: "center", textColor: MUTED, fontStyle: "italic" } }]],
    showHead: "everyPage", theme: "grid",
    styles: { font: "helvetica", fontSize: 8, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2, valign: "middle", overflow: "linebreak" },
    headStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold", halign: "left" },
    columnStyles: { 0: { cellWidth: 10, halign: "center" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 8: { halign: "right" } },
  });

  drawFooters(doc);
  return doc;
}

const fileName = title => `${title.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`;

export async function downloadTodayReport(rows, summary, selectedLabel, profile, options = {}) {
  (await createTodayReportPdf(rows, summary, selectedLabel, profile, options)).save(fileName(options.title || "Today Collection History"));
}

export async function printTodayReport(rows, summary, selectedLabel, profile, options = {}) {
  printPdf(await createTodayReportPdf(rows, summary, selectedLabel, profile, options), "today-report-print-frame");
}
