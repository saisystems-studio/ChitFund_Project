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

// Compact masthead: logo top-left, company name centred at top, one address/phone line directly beneath it.
export function header(doc, company, logo) {
  const { margin, width } = PAGE;
  const y = margin;
  if (logo) {
    const h = 14, w = Math.min(28, h * logo.width / logo.height);
    try { doc.addImage(logo.src, logo.src.startsWith("data:image/png") ? "PNG" : "JPEG", margin, y, w, h); } catch { /* unreadable logo: show text only */ }
  }
  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(15).text(company.name, width / 2, y + 6, { align: "center" });
  const contact = [company.address, company.phone].filter(Boolean).join("  |  ");
  if (contact) {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
    const [line] = doc.splitTextToSize(contact, width - 2 * margin - 10);
    doc.text(line, width / 2, y + 12, { align: "center" });
  }
  const bottom = y + 16;
  doc.setDrawColor(...INK).setLineWidth(0.5).line(margin, bottom, width - margin, bottom);
  return bottom;
}

// Left-aligned "Label : Value" stack used for the party/customer block on both voucher types.
export function partyBlock(doc, x, y, rows, valueWidth = 78) {
  let cursorY = y;
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED).text(`${label} :`, x, cursorY);
    doc.setFont("helvetica", "bold").setTextColor(...(value ? INK : MUTED));
    const lines = doc.splitTextToSize(String(value || "—"), valueWidth);
    doc.text(lines, x + 22, cursorY);
    cursorY += 5 * lines.length;
  }
  return cursorY;
}

// Right-aligned "Label : Value" stack used for the date/voucher/mode block on both voucher types.
export function metaBlock(doc, right, y, rows) {
  let cursorY = y;
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED).text(`${label} :`, right - 62, cursorY);
    doc.setFont("helvetica", "bold").setTextColor(...INK);
    const lines = doc.splitTextToSize(String(value), 38);
    doc.text(lines, right, cursorY, { align: "right" });
    cursorY += 5 * lines.length;
  }
  return cursorY;
}

function receiptPage(doc, { company, logo, customer, section }) {
  const { margin, width, height } = PAGE, right = width - margin;
  let y = voucherTitle(doc, "RECEIPT VOUCHER", header(doc, company, logo) + 8);

  // Left: customer. Right: date, voucher and payment details. Both as compact "Label : Value" rows.
  const top = y;
  const leftY = partyBlock(doc, margin, y, [["Name", customer.name], ["Address", (customer.address || []).join(", ")], ["Phone", customer.phone]]);
  const meta = [["Date", section.date], ["Voucher No", section.voucher_no], ["Payment Mode", section.payment_mode], ["Reference", section.reference_no]].filter(([, value]) => value);
  const rightY = metaBlock(doc, right, top, meta);
  y = Math.max(leftY, rightY) + 4;

  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin, bottom: height - signatureLayout(doc, company).top + 8 }, theme: "grid",
    head: [["S.No", "Particulars", "Amount (INR)"]],
    body: section.rows.map((row, index) => [String(index + 1), row.particulars, amount(row.amount)]),
    foot: [[{ content: "Total Amount", colSpan: 2, styles: { halign: "right" } }, amount(section.total)]],
    styles: { font: "helvetica", fontSize: 9, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2.2, valign: "middle" },
    headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold", halign: "left" },
    footStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold", fontSize: 10 },
    columnStyles: { 0: { cellWidth: 15, halign: "center" }, 2: { cellWidth: 38, halign: "right" } },
    didParseCell: data => {
      if (data.section === "head" && data.column.index !== 1) data.cell.styles.halign = data.column.index === 0 ? "center" : "right";
      if (data.section === "foot" && data.column.index === 2) data.cell.styles.halign = "right";
    },
  });
  y = doc.lastAutoTable.finalY + 6;
  wordsAndNotes(doc, section.total, section.notes, y, signatureLayout(doc, company).top - 8);
  signatures(doc, company, "Customer Signature");
}

// Shared by receipt and payment vouchers: centred title (letter spacing included), returns the next y.
export function voucherTitle(doc, title, y) {
  const { width } = PAGE, spacing = 1;
  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(15);
  const titleWidth = doc.getTextWidth(title) + spacing * (title.length - 1);
  doc.text(title, (width - titleWidth) / 2, y, { charSpace: spacing });
  doc.setLineWidth(0.3).line((width - titleWidth) / 2, y + 2, (width + titleWidth) / 2, y + 2);
  return y + 9;
}

export function wordsAndNotes(doc, total, notesText, y, bottom = PAGE.height - 63) {
  const { margin, width } = PAGE;
  doc.setFont("helvetica", "normal").setFontSize(9.5);
  const words = doc.splitTextToSize(amountInWords(total), width - 2 * margin - 33);
  const notes = doc.splitTextToSize(notesText || "—", width - 2 * margin - 33);
  const nextPage = () => { doc.addPage(); y = margin + 5; };
  // Keep the normal footer together; unusually long notes continue intact on
  // another page instead of painting over the signatures or the bottom margin.
  if (y + 4.8 * (words.length + notes.length) + 3.5 > bottom) nextPage();
  const block = (label, lines, color) => {
    let offset = 0;
    while (offset < lines.length) {
      if (y + 4.8 > bottom) nextPage();
      const count = Math.max(1, Math.floor((bottom - y) / 4.8));
      const chunk = lines.slice(offset, offset + count);
      doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(...INK).text(label, margin, y);
      doc.setFont("helvetica", "normal").setTextColor(...color).text(chunk, margin + 33, y);
      y += 4.8 * chunk.length;
      offset += chunk.length;
      if (offset < lines.length) nextPage();
    }
  };
  block("Amount in Words:", words, INK);
  y += 3.5;
  block("Notes:", notes, notesText ? INK : MUTED);
  return y;
}

export function signatureLayout(doc, company) {
  const signY = PAGE.height - PAGE.margin - 22;
  doc.setFont("helvetica", "bold").setFontSize(9);
  const companyLines = doc.splitTextToSize(`For ${company.name}`, 60);
  const companyY = signY - 14 - (companyLines.length - 1) * doc.getLineHeight() / doc.internal.scaleFactor;
  return { signY, companyLines, companyY, top: companyY - 4 };
}

// Signatures sit at the foot of the page, kept clear of the printable-area edge so
// no printer/print-preview margin can clip the lines or labels.
export function signatures(doc, company, leftLabel) {
  const { margin, width } = PAGE, right = width - margin;
  const { signY, companyLines, companyY } = signatureLayout(doc, company);
  doc.setDrawColor(...MUTED).setLineWidth(0.3).line(margin, signY, margin + 60, signY).line(right - 60, signY, right, signY);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK).text(leftLabel, margin, signY + 5);
  doc.setFont("helvetica", "bold").text(companyLines, right, companyY, { align: "right" });
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
