import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-";

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

// Same principal/interest split shown live in the Interest Loan Schedule Preview table.
export function buildInterestScheduleRows(rows, principal) {
  const total = Number(principal || 0);
  return rows.map((row, index) => {
    const principalPart = index === rows.length - 1 ? total - (total / (rows.length || 1)) * index : total / (rows.length || 1);
    const interestPart = Number(row.amount || 0) - principalPart;
    const paidPrincipal = principalPart * (index + 1);
    const balance = Math.max(0, total - paidPrincipal);
    return { number: row.installment_number ?? index + 1, date: row.due_date, principal: principalPart, interest: interestPart, amount: Number(row.amount || 0), balance };
  });
}

export async function createInterestSchedulePdf(loan, company = {}) {
  const logo = await loadLogo(company.logo);
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const rows = buildInterestScheduleRows(loan.rows || [], loan.principal);

  let y = drawHeader(doc, company, logo);
  y = drawSectionHeading(doc, y, "INTEREST LOAN SCHEDULE");

  y = drawDetailsGrid(doc, y, [
    [["Customer Name", loan.customerName || "-"], ["Plan Type", loan.planType || "-"], ["Principal Amount", amount(loan.principal)]],
    [["Interest %", `${loan.interestPercentage || 0}%`], ["Start Date", dateLabel(loan.startDate)], ["End Date", dateLabel(loan.endDate)]],
    [["Duration", loan.durationLabel || "-"]],
  ]);

  autoTable(doc, {
    startY: y, margin: { top: PAGE.margin, left: PAGE.margin, right: PAGE.margin, bottom: 18 },
    head: [["S.No", "Installment Date", "Principal", "Interest", "Installment Amount", "Balance"]],
    body: rows.map((row, index) => [index + 1, dateLabel(row.date), amount(row.principal), amount(row.interest), amount(row.amount), amount(row.balance)]),
    showHead: "everyPage", theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2, valign: "middle" },
    headStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold", halign: "left" },
    columnStyles: { 0: { cellWidth: 14, halign: "center" }, 1: { cellWidth: 28 }, 2: { cellWidth: 33, halign: "right" }, 3: { cellWidth: 33, halign: "right" }, 4: { cellWidth: 37, halign: "right" }, 5: { cellWidth: 37, halign: "right" } },
    didParseCell: data => { if (data.section === "head" && data.column.index !== 1) data.cell.styles.halign = data.column.index === 0 ? "center" : "right"; },
  });

  drawFooters(doc);
  return doc;
}

export async function downloadInterestSchedulePdf(loan, company) {
  const name = String(loan.customerName || "interest-loan").replace(/[^a-z0-9_-]/gi, "_");
  (await createInterestSchedulePdf(loan, company)).save(`Interest-Schedule-${name}.pdf`);
}
