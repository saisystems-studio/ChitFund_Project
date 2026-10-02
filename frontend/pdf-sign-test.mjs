import { createReceiptPdf } from "./src/utils/collectionReceipt.mjs";
import { createPaymentVoucherPdf } from "./src/utils/paymentVoucher.mjs";
import { writeFileSync } from "fs";

const company = {
  company_name: "Sai Systems Finance Pvt Ltd",
  address: "12, MG Road, T. Nagar, Chennai - 600017",
  phone: "+91 98765 43210",
  logo: null,
};

const receiptShort = {
  customer: { name: "Kumar", phone: "8785647895", address: ["45, Gandhi Street, Anna Nagar", "Chennai, Tamil Nadu - 600040"] },
  sections: [{ loan_type: "CHIT", voucher_no: "RV-000002", date: "28/09/2026", payment_mode: "Cash", reference_no: "", notes: "Collected at office",
    rows: [{ particulars: "Chit — Installment #4", amount: 2500 }], total: 2500 }],
};

// Worst case: many rows + a long note, to exercise the page-break threshold near the bottom.
const manyRows = Array.from({ length: 18 }, (_, i) => ({ particulars: `Chit · CHT-1024 · Receipt Group — Installment #${i + 1} (Due 2026-09-${(i % 28) + 1})`, amount: 2500 }));
const receiptLong = {
  customer: { name: "Kumar", phone: "8785647895", address: ["45, Gandhi Street, Anna Nagar", "Chennai, Tamil Nadu - 600040"] },
  sections: [{ loan_type: "CHIT", voucher_no: "RV-000009", date: "28/09/2026", payment_mode: "Cash", reference_no: "REF12345",
    notes: "This is a deliberately long note to test wrapping and make sure the signature block never overlaps or gets pushed off the bottom of the printable A4 page area under worst-case content length.",
    rows: manyRows, total: manyRows.reduce((s, r) => s + r.amount, 0) }],
};

const paymentEntry = { id: 42, ledger_group: "Sundry Creditors", ledger_name: "ABC Traders", account_name: "HDFC Bank", amount: 12500, payment_mode: "Cheque",
  date: "2026-09-28", cheque_number: "000123", cheque_date: "2026-09-28", bank_name: "HDFC Bank", notes: "Supplier advance" };

writeFileSync("pdf-sign-receipt-short.pdf", Buffer.from((await createReceiptPdf(receiptShort, company)).output("arraybuffer")));
writeFileSync("pdf-sign-receipt-long.pdf", Buffer.from((await createReceiptPdf(receiptLong, company)).output("arraybuffer")));
writeFileSync("pdf-sign-voucher.pdf", Buffer.from((await createPaymentVoucherPdf(paymentEntry, company)).output("arraybuffer")));
console.log("done");
