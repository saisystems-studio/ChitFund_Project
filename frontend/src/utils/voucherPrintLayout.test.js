import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Resolve the browser's extensionless import while testing the production files.
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "./collectionReceipt" ? "./collectionReceipt.js" : specifier, context);
} });
const { createReceiptPdf } = await import("./collectionReceipt.js");
const { createPaymentVoucherPdf } = await import("./paymentVoucher.js");
test("browser module entry points use the tested voucher implementations", async () => {
  assert.equal((await import("./collectionReceipt.mjs")).createReceiptPdf, createReceiptPdf);
  assert.equal((await import("./paymentVoucher.mjs")).createPaymentVoucherPdf, createPaymentVoucherPdf);
});
const profile = { company_name: "Sample Finance" };
const receipt = (notes = "Office collection", count = 1) => ({
  customer: { name: "Customer", address: ["Sample address"], phone: "1234567890" },
  sections: [{ voucher_no: "RV-1", date: "28/09/2026", payment_mode: "Cash", notes,
    total: count * 100, rows: Array.from({ length: count }, (_, i) => ({ particulars: `Installment ${i + 1}`, amount: 100 })) }],
});
const payment = notes => ({ id: 1, date: "2026-09-28", ledger_name: "Supplier", account_name: "Cash", amount: 100, payment_mode: "Cash", notes });

function textPositions(doc) {
  return doc.internal.pages.slice(1).flatMap((page, pageIndex) => page.filter(command => command.startsWith("BT")).flatMap(command => {
    const position = command.match(/([-\d.]+) ([-\d.]+) Td/);
    const leading = Number(command.match(/([-\d.]+) TL/)?.[1] || 0);
    let baseline = Number(position[2]);
    return command.split("\n").flatMap(line => {
      if (line === "T*") baseline -= leading;
      return line.endsWith(" Tj") ? [{ text: line, bottom: baseline / doc.internal.scaleFactor, page: pageIndex }] : [];
    });
  }));
}
function checkFooter(doc, label) {
  const positions = textPositions(doc);
  const left = positions.find(item => item.text.includes(label));
  const right = positions.find(item => item.text.includes("Authorized Signatory"));
  assert.ok(left && right, "both signature labels are present");
  assert.equal(left.page, right.page, "both signatures stay together");
  assert.ok(left.bottom >= 30 && right.bottom >= 30, "signature labels need at least 30 mm bottom clearance");
  const signatureLines = doc.internal.pages[left.page + 1].filter(command => {
    const move = command.match(/^[-\d.]+ ([-\d.]+) m$/);
    return move && Math.abs(Number(move[1]) / doc.internal.scaleFactor - left.bottom - 5) < 0.01;
  });
  assert.equal(signatureLines.length, 2, "both signature lines are visible above their labels");
  for (const item of positions) assert.ok(item.bottom >= 30, `text overflows safe bottom area: ${item.text}`);
}
test("receipt and payment signatures remain inside A4 print margins on one page", async () => {
  for (const [doc, label] of [[await createReceiptPdf(receipt(), profile), "Customer Signature"], [await createPaymentVoucherPdf(payment("Office payment"), profile), "Receiver Signature"]]) {
    assert.equal(doc.getNumberOfPages(), 1);
    checkFooter(doc, label);
  }
});
test("wrapped company signature text stays above the signing line", async () => {
  const doc = await createReceiptPdf(receipt("Office collection", 14), { company_name: "Sample Finance and Investment Services Private Limited" });
  checkFooter(doc, "Customer Signature");
  const positions = textPositions(doc), companyStart = positions.findIndex(item => item.text.includes("For Sample"));
  const companyEnd = positions.findIndex(item => item.text.includes("Authorized Signatory"));
  const signature = positions.find(item => item.text.includes("Customer Signature"));
  for (const item of positions.slice(companyStart, companyEnd)) assert.ok(item.bottom > signature.bottom + 5, "company label stays above the signature line");
});
test("long voucher notes and receipt tables cannot overflow the page bottom", async () => {
  const notes = "A complete note that must not be cut off. ".repeat(250) + "END OF NOTES";
  for (const [doc, label] of [[await createReceiptPdf(receipt(notes, 24), profile), "Customer Signature"], [await createPaymentVoucherPdf(payment(notes), profile), "Receiver Signature"]]) {
    checkFooter(doc, label);
    assert.ok(textPositions(doc).some(item => item.text.includes("END OF NOTES")), "notes are preserved without truncation");
  }
});
