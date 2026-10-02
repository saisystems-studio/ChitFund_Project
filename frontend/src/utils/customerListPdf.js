import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

const PAGE = { width: 210, height: 297, margin: 14 };
const INK = [23, 50, 79], MUTED = [100, 116, 139], LINE = [214, 224, 236], BAND = [241, 246, 251];

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

// Plain bold section heading with a thin rule beneath.
function drawSectionHeading(doc, y, title) {
  const { margin, width } = PAGE;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text(title, width / 2, y, { align: "center" });
  doc.setDrawColor(...LINE).setLineWidth(0.3).line(margin, y + 2.5, width - margin, y + 2.5);
  return y + 8;
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

const addressLine = c => {
  const parts = [c.address, c.district, c.state, c.country && c.country.toLowerCase() === "india" ? "" : c.country].filter(Boolean);
  return `${parts.join(", ")}${c.pincode ? `${parts.length ? " - " : ""}${c.pincode}` : ""}`;
};

export async function createCustomerListPdf(customers, company = {}) {
  const logo = await loadLogo(company.logo);
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  let y = drawHeader(doc, company, logo);
  y = drawSectionHeading(doc, y, "CUSTOMER LIST");

  autoTable(doc, {
    startY: y, margin: { top: PAGE.margin, left: PAGE.margin, right: PAGE.margin, bottom: 18 },
    head: [["S.No", "Customer Code", "Customer Name", "Phone Number", "Address", "PAN Number", "Aadhaar Number"]],
    body: customers.map((c, index) => [index + 1, c.customer_code || "-", c.full_name || "-", c.primary_mobile || "-", addressLine(c) || "-", c.pan_number || "-", c.aadhaar_number || "-"]),
    showHead: "everyPage", theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2, valign: "middle", overflow: "linebreak" },
    headStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold", halign: "left" },
    columnStyles: { 0: { cellWidth: 12, halign: "center" }, 1: { cellWidth: 24 }, 2: { cellWidth: 34 }, 3: { cellWidth: 24 }, 4: { cellWidth: 48 }, 5: { cellWidth: 22 }, 6: { cellWidth: 18 } },
    didParseCell: data => { if (data.section === "head" && data.column.index === 0) data.cell.styles.halign = "center"; },
  });

  drawFooters(doc);
  return doc;
}

export async function downloadCustomerListPdf(customers, company) {
  (await createCustomerListPdf(customers, company)).save("customer-list.pdf");
}
