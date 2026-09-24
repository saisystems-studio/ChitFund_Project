import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-";
export const collectionLabel = group => group.collection_date ? dateLabel(group.collection_date) : group.duration_type === "DAY" ? "Daily" : group.duration_type === "YEAR" ? `${group.collection_day || "-"}/${group.collection_month || "-"} each year` : `Day ${group.collection_day || "-"} each month`;

export function createChitPdf(group) {
  const doc = new jsPDF({ format: "a4" });
  const rows = [...(group.installments || group.template_installments || [])].sort((a, b) => a.installment_number - b.installment_number);
  const amount = value => `INR ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  doc.setFontSize(16);
  doc.text("Chit Group Details", 14, 18);
  autoTable(doc, {
    startY: 25, theme: "plain", margin: 14, styles: { fontSize: 10, cellPadding: 2 },
    body: [["Group Code", group.code || "-", "Group Name", group.name || "-"],
      ["Duration Type", { DAY: "Days", MONTH: "Months", YEAR: "Years" }[group.duration_type] || "-", "Duration", String(group.duration || "-")],
      ["Start Date", dateLabel(group.start_date), "End Date", dateLabel(group.end_date)],
      ["Collection Date", collectionLabel(group), "Chit Amount", amount(group.total_amount ?? group.grand_total)],
      ["Status", group.is_active === false ? "Inactive" : "Active", "", ""]],
    columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 60 }, 2: { cellWidth: 32 }, 3: { cellWidth: 60 } },
  });
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8, margin: { top: 18, right: 14, bottom: 18, left: 14 },
    head: [["S.No", "Installment Schedule", "Installment Amount"]],
    body: rows.map((row, index) => [row.installment_number || index + 1, row.schedule_value || `Installment ${index + 1}`, amount(row.installment_amount)]),
    showFoot: "lastPage", theme: "grid", styles: { fontSize: 10, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [45, 65, 85] }, footStyles: { fillColor: [235, 239, 243], textColor: 20 },
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 104 }, 2: { cellWidth: 60, halign: "right" } },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(9); doc.text(`Page ${page} of ${pages}`, 196, 289, { align: "right" });
  }
  return doc;
}

export function downloadChitPdf(group) {
  createChitPdf(group).save(`${String(group.code || "chit-plan").replace(/[^a-z0-9_-]/gi, "_")}.pdf`);
}
