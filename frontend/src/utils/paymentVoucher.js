import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { BAND, INK, LINE, MUTED, PAGE, amount, companyFromProfile, header, loadImage, printPdf, signatures, voucherTitle, wordsAndNotes } from "./collectionReceipt";

// Same A4 layout and helpers as the Collection Receipt; PDF and Print share one document.
export const paymentVoucherNo = entry => `PV-${String(entry.id).padStart(6, "0")}`;
const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "";
const MODES = { Cash: "Cash", UPI: "UPI", Cheque: "Cheque", NEFT: "NEFT/IMPS/RTGS" };

// The PDF core fonts have no ₹ glyph, so the browser draws it once and it is placed as an image.
let rupee;
function rupeeGlyph() {
  if (rupee !== undefined) return rupee;
  try {
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d"), size = 96;
    context.font = `600 ${size}px "Segoe UI", Arial, "Noto Sans", sans-serif`;
    const width = Math.ceil(context.measureText("₹").width) + 4;
    canvas.width = width; canvas.height = Math.ceil(size * 1.25);
    context.font = `600 ${size}px "Segoe UI", Arial, "Noto Sans", sans-serif`;
    context.fillStyle = `rgb(${INK.join(",")})`; context.textBaseline = "alphabetic";
    context.fillText("₹", 2, size);
    rupee = { src: canvas.toDataURL("image/png"), ratio: width / canvas.height, baseline: size / canvas.height };
  } catch { rupee = null; }
  return rupee;
}
const money = value => (rupeeGlyph() ? "" : "Rs. ") + amount(value);

function particulars(entry) {
  const ledger = entry.ledger_group || entry.ledger_name || "Payment";
  const mode = entry.payment_mode;
  const details = mode === "UPI" ? [entry.upi_id && `UPI ID ${entry.upi_id}`, entry.transaction_utr && `UTR ${entry.transaction_utr}`]
    : mode === "Cheque" ? [entry.cheque_number && `Cheque No. ${entry.cheque_number}`, entry.cheque_date && `dated ${dateLabel(entry.cheque_date)}`, entry.bank_name]
    : mode === "NEFT" ? [entry.transaction_utr && `Ref ${entry.transaction_utr}`, entry.bank_name] : [];
  const paid = `Paid by ${MODES[mode] || mode}${entry.account_name ? ` from ${entry.account_name}` : ""}`;
  const extra = details.filter(Boolean).join(", ");
  return [{ particulars: `${ledger} — ${paid}${extra ? ` (${extra})` : ""}`, amount: Number(entry.amount || 0) }];
}

function voucherPage(doc, { company, logo, entry }) {
  const { margin, width, height } = PAGE, right = width - margin;
  let y = voucherTitle(doc, "PAYMENT VOUCHER", header(doc, company, logo) + 10);

  // Left: ledger / party. Right: date, voucher and payment details.
  const labelWidth = 26, valueWidth = 95 - labelWidth, top = y;
  let leftY = y + 4;
  for (const [label, value] of [["Ledger/Party", entry.ledger_group || entry.ledger_name], ["Address", entry.address]]) {
    doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...MUTED).text(`${label}:`, margin, leftY);
    doc.setFont("helvetica", "bold").setTextColor(...(value ? INK : MUTED));
    const lines = doc.splitTextToSize(String(value || "—"), valueWidth);
    doc.text(lines, margin + labelWidth, leftY); leftY += 5.5 * lines.length;
  }
  const reference = entry.transaction_utr || entry.cheque_number;
  const meta = [["Date", dateLabel(entry.date)], ["Voucher No", paymentVoucherNo(entry)], ["Payment Mode", MODES[entry.payment_mode] || entry.payment_mode], ["Paid From", entry.account_name || entry.accounts], ["Reference", reference]].filter(([, value]) => value);
  let rightY = top;
  for (const [label, value] of meta) {
    doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...MUTED).text(`${label}:`, right - 62, rightY + 4);
    doc.setFont("helvetica", "bold").setTextColor(...INK);
    const lines = doc.splitTextToSize(String(value), 38);
    doc.text(lines, right, rightY + 4, { align: "right" }); rightY += 5.5 * lines.length;
  }
  y = Math.max(leftY, rightY + 4) + 4;

  const rows = particulars(entry), total = rows.reduce((sum, row) => sum + row.amount, 0);
  const glyph = rupeeGlyph();
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin, bottom: 50 }, theme: "grid",
    head: [["S.No", "Particulars", "Amount"]],
    body: rows.map((row, index) => [String(index + 1), row.particulars, money(row.amount)]),
    foot: [[{ content: "TOTAL", colSpan: 2, styles: { halign: "right" } }, money(total)]],
    styles: { font: "helvetica", fontSize: 9.5, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2.6, valign: "middle", overflow: "linebreak" },
    headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold", halign: "left" },
    footStyles: { fillColor: BAND, textColor: INK, fontStyle: "bold", fontSize: 10.5 },
    columnStyles: { 0: { cellWidth: 15, halign: "center" }, 2: { cellWidth: 40, halign: "right" } },
    didParseCell: data => {
      if (data.section === "head" && data.column.index !== 1) data.cell.styles.halign = data.column.index === 0 ? "center" : "right";
      if (data.section === "foot" && data.column.index === 2) data.cell.styles.halign = "right";
    },
    didDrawCell: data => {
      if (!glyph || data.column.index !== 2 || data.section === "head") return;
      const { cell } = data, text = Array.isArray(cell.text) ? cell.text.join("") : String(cell.text || "");
      if (!text) return;
      doc.setFont("helvetica", cell.styles.fontStyle).setFontSize(cell.styles.fontSize);
      const textWidth = doc.getTextWidth(text), glyphHeight = cell.styles.fontSize * 0.3528 * 1.3, glyphWidth = glyphHeight * glyph.ratio;
      const baseline = cell.y + cell.height / 2 + cell.styles.fontSize * 0.3528 * 0.35;
      doc.addImage(glyph.src, "PNG", cell.x + cell.width - cell.padding("right") - textWidth - glyphWidth - 0.4, baseline - glyphHeight * glyph.baseline, glyphWidth, glyphHeight);
    },
  });
  y = doc.lastAutoTable.finalY + 7;
  if (y > height - 70) { doc.addPage(); y = margin + 5; }
  wordsAndNotes(doc, total, entry.notes, y);
  signatures(doc, company, "Receiver Signature");
}

export async function createPaymentVoucherPdf(entry, profile) {
  const company = companyFromProfile(profile), logo = await loadImage(profile?.logo);
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  doc.setProperties({ title: `Payment Voucher ${paymentVoucherNo(entry)}` });
  voucherPage(doc, { company, logo, entry });
  return doc;
}

export async function downloadPaymentVoucher(entry, profile) { (await createPaymentVoucherPdf(entry, profile)).save(`Payment-Voucher-${paymentVoucherNo(entry)}.pdf`); }

export async function printPaymentVoucher(entry, profile) { printPdf(await createPaymentVoucherPdf(entry, profile), "payment-voucher-print-frame"); }
