import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

// PDF and Print both use this one document, so their data and layout are always identical.
export const PAGE = { width: 210, height: 297, margin: 15 };
export const INK = [23, 50, 77], MUTED = [93, 113, 135], LINE = [205, 220, 235], BAND = [236, 244, 251];
export const amount = value => Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const belowHundred = n => n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
const belowThousand = n => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", n % 100 ? belowHundred(n % 100) : ""].filter(Boolean).join(" ");
function integerWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  for (const [size, name] of [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]]) {
    if (n >= size) { const count = Math.floor(n / size); parts.push(`${size === 10000000 ? integerWords(count) : belowHundred(count)} ${name}`); n %= size; }
  }
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}
// Indian numbering: 148484.50 -> "INR One Lakh Forty Eight Thousand Four Hundred Eighty Four and Fifty Paise Only"
export function amountInWords(value) {
  const paiseTotal = Math.round(Number(value || 0) * 100), rupees = Math.floor(paiseTotal / 100), paise = paiseTotal % 100;
  return `INR ${integerWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}

export const loadImage = src => new Promise(resolve => {
  if (!src) return resolve(null);
  const image = new Image();
  image.onload = () => resolve({ src, width: image.naturalWidth, height: image.naturalHeight });
  image.onerror = () => resolve(null);
  image.src = src;
});

export function header(doc, company, logo) {
  const { margin, width } = PAGE;
  let textX = margin, y = margin;
  if (logo) {
    const h = 20, w = Math.min(40, h * logo.width / logo.height);
    try { doc.addImage(logo.src, logo.src.startsWith("data:image/png") ? "PNG" : "JPEG", margin, y, w, h); textX = margin + w + 6; } catch { /* unreadable logo: show text only */ }
  }
  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(17).text(company.name, textX, y + 7);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  let lineY = y + 13;
  const contact = [company.phone && `Phone: ${company.phone}`, company.email && `Email: ${company.email}`].filter(Boolean).join("   |   ");
  for (const line of [...doc.splitTextToSize(company.address || "", width - textX - margin), contact].filter(Boolean)) { doc.text(line, textX, lineY); lineY += 4.5; }
  const bottom = Math.max(y + 22, lineY);
  doc.setDrawColor(...INK).setLineWidth(0.6).line(margin, bottom, width - margin, bottom);
  return bottom;
}

function receiptPage(doc, { company, logo, customer, section }) {
  const { margin, width, height } = PAGE, right = width - margin;
  let y = voucherTitle(doc, "RECEIPT VOUCHER", header(doc, company, logo) + 10);

  // Left: customer. Right: date, voucher and payment details.
  const top = y;
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED).text("RECEIVED FROM", margin, y);
  doc.setFont("helvetica", "bold").setFontSize(11.5).setTextColor(...INK).text(customer.name || "—", margin, y + 6);
  doc.setFont("helvetica", "normal").setFontSize(9.5);
  let leftY = y + 11.5;
  for (const line of (customer.address || []).flatMap(item => doc.splitTextToSize(item, 95))) { doc.text(line, margin, leftY); leftY += 4.8; }
  if (customer.phone) { doc.text(`Phone: ${customer.phone}`, margin, leftY); leftY += 4.8; }
  const meta = [["Date", section.date], ["Voucher No", section.voucher_no], ["Payment Mode", section.payment_mode], ["Reference", section.reference_no]].filter(([, value]) => value);
  let rightY = top;
  for (const [label, value] of meta) {
    doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...MUTED).text(`${label}:`, right - 62, rightY + 4);
    doc.setFont("helvetica", "bold").setTextColor(...INK);
    const lines = doc.splitTextToSize(String(value), 38);
    doc.text(lines, right, rightY + 4, { align: "right" }); rightY += 5.5 * lines.length;
  }
  y = Math.max(leftY, rightY + 4) + 5;

  doc.setFillColor(...BAND).rect(margin, y, width - 2 * margin, 8, "F");
  doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...INK).text(`LOAN DETAILS - ${section.loan_type}`, margin + 3, y + 5.5);
  y += 11;

  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin, bottom: 50 }, theme: "grid",
    head: [["S.No", "Particulars", "Amount (INR)"]],
    body: section.rows.map((row, index) => [String(index + 1), row.particulars, amount(row.amount)]),
    foot: [[{ content: "Total Amount", colSpan: 2, styles: { halign: "right" } }, amount(section.total)]],
    styles: { font: "helvetica", fontSize: 9.5, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2.6, valign: "middle" },
    headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold", halign: "left" },
    footStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold", fontSize: 10.5 },
    columnStyles: { 0: { cellWidth: 15, halign: "center" }, 2: { cellWidth: 38, halign: "right" } },
    didParseCell: data => {
      if (data.section === "head" && data.column.index !== 1) data.cell.styles.halign = data.column.index === 0 ? "center" : "right";
      if (data.section === "foot" && data.column.index === 2) data.cell.styles.halign = "right";
    },
  });
  y = doc.lastAutoTable.finalY + 7;
  if (y > height - 70) { doc.addPage(); y = margin + 5; }

  wordsAndNotes(doc, section.total, section.notes, y);
  signatures(doc, company, "Customer Signature");
}

// Shared by receipt and payment vouchers: centred title (letter spacing included), returns the next y.
export function voucherTitle(doc, title, y) {
  const { width } = PAGE, spacing = 1;
  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(15);
  const titleWidth = doc.getTextWidth(title) + spacing * (title.length - 1);
  doc.text(title, (width - titleWidth) / 2, y, { charSpace: spacing });
  doc.setLineWidth(0.3).line((width - titleWidth) / 2, y + 2, (width + titleWidth) / 2, y + 2);
  return y + 12;
}

export function wordsAndNotes(doc, total, notesText, y) {
  const { margin, width } = PAGE;
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK).text("Amount in Words:", margin, y);
  doc.setFont("helvetica", "normal");
  const words = doc.splitTextToSize(amountInWords(total), width - 2 * margin - 33);
  doc.text(words, margin + 33, y); y += 5 * words.length + 4;
  doc.setFont("helvetica", "bold").text("Notes:", margin, y);
  doc.setFont("helvetica", "normal").setTextColor(...(notesText ? INK : MUTED));
  const notes = doc.splitTextToSize(notesText || "—", width - 2 * margin - 33);
  doc.text(notes, margin + 33, y);
  return y + 5 * notes.length;
}

// Signatures sit at the foot of the page.
export function signatures(doc, company, leftLabel) {
  const { margin, width, height } = PAGE, right = width - margin, signY = height - 28;
  doc.setDrawColor(...MUTED).setLineWidth(0.3).line(margin, signY, margin + 60, signY).line(right - 60, signY, right, signY);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...INK).text(leftLabel, margin, signY + 5);
  doc.setFont("helvetica", "bold").text(doc.splitTextToSize(`For ${company.name}`, 60), right, signY - 16, { align: "right" });
  doc.setFont("helvetica", "normal").text("Authorized Signatory", right, signY + 5, { align: "right" });
}

export const companyFromProfile = profile => ({ name: profile?.company_name || "Finance Collection", address: profile?.address || "", phone: profile?.phone || "", email: profile?.email || "" });

// Prints the given PDF document itself, so Print always matches the downloaded PDF.
export function printPdf(doc, frameClass = "receipt-print-frame") {
  const url = doc.output("bloburl");
  document.querySelector(`iframe.${frameClass}`)?.remove();
  const frame = Object.assign(document.createElement("iframe"), { className: frameClass, src: url, title: "Print preview" });
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, "_blank"); } };
  document.body.appendChild(frame);
}

// One page per loan type, so Chit, Interest and Mortgage are never mixed.
export async function createReceiptPdf(receipt, profile) {
  const company = companyFromProfile(profile);
  const logo = await loadImage(profile?.logo);
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  doc.setProperties({ title: `Receipt ${receipt.sections.map(section => section.voucher_no).join(", ")}` });
  receipt.sections.forEach((section, index) => { if (index) doc.addPage(); receiptPage(doc, { company, logo, customer: receipt.customer, section }); });
  return doc;
}

const fileName = receipt => `Receipt-${receipt.sections.map(section => section.voucher_no).join("_").replace(/[^a-z0-9_-]/gi, "_")}.pdf`;

export async function downloadReceipt(receipt, profile) { (await createReceiptPdf(receipt, profile)).save(fileName(receipt)); }

export async function printReceipt(receipt, profile) { printPdf(await createReceiptPdf(receipt, profile)); }
