import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-";
export const collectionLabel = group => group.collection_date ? dateLabel(group.collection_date) : group.duration_type === "DAY" ? "Daily" : group.duration_type === "YEAR" ? `${group.collection_day || "-"}/${group.collection_month || "-"} each year` : `Day ${group.collection_day || "-"} each month`;

const PAGE = { width: 210, height: 297, margin: 14 };
const INK = [23, 50, 77], MUTED = [100, 116, 139], LINE = [214, 224, 236], BAND = [241, 246, 251];
const amount = value => `INR ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const loadLogo = src => new Promise(resolve => {
  if (!src) return resolve(null);
  const image = new Image();
  image.onload = () => resolve({ src, width: image.naturalWidth, height: image.naturalHeight });
  image.onerror = () => resolve(null);
  image.src = src;
});

// Logo + company name/contact, closed off with a thin divider. Returns the y just below it.
function drawHeader(doc, company, logo) {
  const { margin, width } = PAGE;
  let textX = margin, y = margin;
  if (logo) {
    const h = 14, w = Math.min(28, h * logo.width / logo.height);
    try { doc.addImage(logo.src, logo.src.startsWith("data:image/png") ? "PNG" : "JPEG", margin, y, w, h); textX = margin + w + 5; } catch { /* unreadable logo: fall back to text-only header */ }
  }
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...INK).text(company.company_name || "-", textX, y + 5);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
  let lineY = y + 9.5;
  const contact = [company.phone && `Phone: ${company.phone}`, company.email && `Email: ${company.email}`].filter(Boolean).join("   |   ");
  for (const line of [...doc.splitTextToSize(company.address || "", width - textX - margin), contact].filter(Boolean)) { doc.text(line, textX, lineY); lineY += 3.8; }
  const bottom = Math.max(y + 14, lineY);
  doc.setDrawColor(...INK).setLineWidth(0.5).line(margin, bottom, width - margin, bottom);
  return bottom + 5;
}

// Plain bold section heading with a thin rule beneath — no fill, no box.
function drawSectionHeading(doc, y, title) {
  const { margin, width } = PAGE;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text(title, width / 2, y, { align: "center" });
  doc.setDrawColor(...LINE).setLineWidth(0.3).line(margin, y + 2.5, width - margin, y + 2.5);
  return y + 8;
}

// Compact inline label:value grid, 3 columns per row, no borders or fill.
function drawDetailsGrid(doc, y, rows) {
  const { margin, width } = PAGE;
  const colWidth = (width - margin * 2) / 3, rowHeight = 7;
  rows.forEach((row, r) => row.forEach(([label, value], c) => {
    const cx = margin + colWidth * c, cy = y + rowHeight * r + 4;
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED).text(`${label}:`, cx, cy);
    doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(...INK).text(String(value), cx + doc.getTextWidth(`${label}: `), cy);
  }));
  return y + rowHeight * rows.length + 3;
}

// Thin rule + page number on every page.
function drawFooters(doc) {
  const { margin, width, height } = PAGE, pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(...LINE).setLineWidth(0.2).line(margin, height - 12, width - margin, height - 12);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
    doc.text(`Page ${page} of ${pages}`, width - margin, height - 7, { align: "right" });
  }
}

export async function createChitPdf(group, company = {}) {
  const logo = await loadLogo(company.logo);
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const rows = [...(group.installments || group.template_installments || [])].sort((a, b) => a.installment_number - b.installment_number);

  let y = drawHeader(doc, company, logo);
  y = drawSectionHeading(doc, y, "CHIT GROUP DETAILS");

  const ordinal = value => {
    const day = Number(value);
    if (!day) return "-";
    const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
    return `${day}${suffix}`;
  };
  const collection = group.collection_date ? dateLabel(group.collection_date)
    : group.duration_type === "DAY" ? "Daily"
    : group.duration_type === "YEAR" ? collectionLabel(group) : ordinal(group.collection_day);
  const durationType = { DAY: "Days", MONTH: "Months", YEAR: "Years" }[group.duration_type];
  const chitAmount = group.total_amount == null && group.grand_total == null ? "-" : amount(group.total_amount ?? group.grand_total);

  y = drawDetailsGrid(doc, y, [
    [["Group Code", group.code || "-"], ["Group Name", group.name || "-"], ["Duration", group.duration && durationType ? `${group.duration} ${durationType}` : "-"]],
    [["Chit Amount", chitAmount], ["Start Date", dateLabel(group.start_date)], ["Collection Date", collection]],
  ]);

  autoTable(doc, {
    startY: y, margin: { top: PAGE.margin, left: PAGE.margin, right: PAGE.margin, bottom: 18 },
    head: [["S.No", "Installment Schedule", "Installment Amount"]],
    body: rows.map((row, index) => [row.installment_number || index + 1, row.schedule_value || `Installment ${index + 1}`, amount(row.installment_amount)]),
    showHead: "everyPage", theme: "grid",
    styles: { font: "helvetica", fontSize: 9, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2, valign: "middle" },
    headStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold", halign: "left" },
    columnStyles: { 0: { cellWidth: 18, halign: "center" }, 1: { cellWidth: 104 }, 2: { cellWidth: 60, halign: "right" } },
    didParseCell: data => { if (data.section === "head" && data.column.index !== 1) data.cell.styles.halign = data.column.index === 0 ? "center" : "right"; },
  });

  drawFooters(doc);
  return doc;
}

export async function downloadChitPdf(group, company) {
  (await createChitPdf(group, company)).save(`${String(group.code || "chit-plan").replace(/[^a-z0-9_-]/gi, "_")}.pdf`);
}
