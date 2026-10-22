// Pure builders: API payload -> the neutral model the shared layout renders and exports.
//
//   model = { title, subtitle, reference, badge, sections: [{ title, items: [{ label, value, type }] }],
//             tables: [{ title, columns: [{ key, label, align, type }], rows: [{ ...cells, _open }], footer }],
//             admin: { kind, id } | null }
//
// `type` is "money" | "date" | "text" | "status" | "balance". `_open` ({ kind, id, extra }) makes a table
// row double-clickable into its own details page. Nothing here recomputes a balance: every amount is
// the value the report / entry screens already store.
const present = value => value !== undefined && value !== null && value !== "" && value !== "0.000";
const item = (label, value, type = "text") => ({ label, value, type });
const keep = items => items.filter(entry => present(entry.value));
const balanceCell = (amount, side) => {
  const value = Math.abs(Number(amount || 0));
  return value ? { amount: value, side: String(side || "DR").toUpperCase() === "CR" ? "Cr" : "Dr" } : { amount: 0, side: "" };
};

const customerItems = customer => customer ? keep([
  item("Customer Name", customer.name), item("Customer Code", customer.code), item("Mobile", customer.phone), item("Address", customer.address),
]) : [];

export function voucherModel(data) {
  const postings = data.postings || [];
  const allocations = data.allocations || [];
  const sections = [
    { title: "Transaction Details", items: keep([
      item("Voucher Type", data.voucher_type), item("Voucher No.", data.voucher_no), item("Date", data.date, "date"),
      item("Amount", data.amount, "money"), item("Payment Mode", data.payment_mode), item("Cash / Bank Account", data.account),
      item("Party / Particulars", data.party), item("Reference / UTR", data.reference), item("Narration", data.narration),
      ...(data.extra || []).map(([label, value]) => item(label, value, label.includes("Date") ? "date" : /Amount|Adjustment|Discount/.test(label) ? "money" : "text")),
    ]) },
  ];
  if (data.customer) sections.push({ title: "Customer Details", items: customerItems(data.customer) });
  if (data.loan) sections.push({ title: "Loan Details", items: keep([item("Loan Number", data.loan.loan_no), item("Loan Type", data.loan.loan_type)]), open: { kind: "loan", id: data.loan.id } });
  const tables = [];
  if (postings.length) tables.push({
    title: "Debit / Credit Postings",
    columns: [{ key: "ledger", label: "Ledger" }, { key: "debit", label: "Debit", align: "right", type: "money" }, { key: "credit", label: "Credit", align: "right", type: "money" }],
    rows: postings.map(row => ({ ledger: row.ledger, debit: Number(row.debit) || "", credit: Number(row.credit) || "" })),
    footer: [{ label: "Total", debit: postings.reduce((sum, row) => sum + Number(row.debit || 0), 0), credit: postings.reduce((sum, row) => sum + Number(row.credit || 0), 0) }],
  });
  if (allocations.length) tables.push({
    title: data.voucher_no?.startsWith("DUE") ? "Collections Applied To This Due" : "Allocated Dues",
    columns: [{ key: "ref", label: allocations[0].due_number ? "Reference" : "Installment" }, { key: "due_date", label: "Due / Date", type: "date" },
      { key: "installment_amount", label: "Due Amount", align: "right", type: "money" }, { key: "allocated", label: "Allocated", align: "right", type: "money" },
      ...(allocations[0].balance !== undefined ? [{ key: "balance", label: "Balance", align: "right", type: "money" }, { key: "status", label: "Status", type: "status" }] : [])],
    rows: allocations.map(row => ({ ref: row.due_number || `#${row.installment_number}`, due_date: row.due_date, installment_amount: row.installment_amount,
      allocated: row.allocated, balance: row.balance, status: row.status })),
  });
  return { title: data.voucher_type || "Voucher", subtitle: data.party || data.customer?.name || "", reference: data.voucher_no, sections, tables, admin: data.edit };
}

export function installmentModel(data) {
  const { due, loan, customer, collections = [] } = data;
  const allocated = collections.reduce((sum, row) => sum + Number(row.allocated || 0), 0);
  return {
    title: "Due Details", subtitle: customer?.name || "", reference: `${loan.loan_no} · Installment #${due.installment_number}`, badge: due.status,
    sections: [
      { title: "Party Information", items: customerItems(customer) },
      { title: "Loan Information", items: keep([item("Loan Number", loan.loan_no), item("Loan Type", loan.loan_type)]), open: { kind: "loan", id: loan.id } },
      { title: "Due & Collection Split-up", items: keep([item("Due Date", due.due_date, "date"), item("Original Due Amount", due.amount, "money"), item("Penalty / Adjustment", due.penalty, "money"),
        item("Allocated Collection", allocated, "money"), item("Remaining Due", due.outstanding, "money"), item("Last Paid On", due.paid_date, "date"), item("Status", due.status, "status")]) },
    ],
    tables: [{
      title: "Related Collection Vouchers",
      columns: [{ key: "voucher_no", label: "Voucher No." }, { key: "date", label: "Date", type: "date" }, { key: "payment_mode", label: "Mode" }, { key: "account", label: "Account" },
        { key: "reference", label: "Reference" }, { key: "allocated", label: "Allocated To This Due", align: "right", type: "money" }, { key: "receipt_amount", label: "Receipt Total", align: "right", type: "money" }],
      rows: collections.map(row => ({ ...row, _open: { kind: "voucher", id: row.voucher_no } })),
      footer: collections.length ? [{ label: "Total Collected", allocated }] : undefined,
    }],
    admin: null,
  };
}

export function loanModel(data) {
  const { loan, schedule = [], collections = [], customer } = data;
  const sections = [
    { title: "Customer Details", items: customerItems(customer) },
    { title: "Loan Details", items: keep([
      item("Loan Number", loan.loan_no), item("Loan Type", loan.loan_type), item("Status", loan.status, "status"), item("Application Date", loan.application_date, "date"),
      item("Start Date", loan.start_date, "date"), item("End Date", loan.end_date, "date"), item("Loan Amount", loan.loan_amount, "money"),
      ...loan.extra.map(([label, value]) => item(label, value, /Amount|Value/.test(label) ? "money" : "text")),
    ]) },
    { title: "Pending / Outstanding", items: [
      item("Total Payable", loan.total_amount, "money"), item("Paid", loan.paid_amount, "money"),
      item("Penalty", loan.penalty_amount, "money"), item("Outstanding", loan.outstanding_amount, "money"),
    ] },
  ];
  const tables = [{
    title: "Installment Schedule",
    columns: [{ key: "no", label: "No." }, { key: "due_date", label: "Due Date", type: "date" }, { key: "installment_amount", label: "Installment", align: "right", type: "money" },
      { key: "paid_amount", label: "Paid", align: "right", type: "money" }, { key: "outstanding_amount", label: "Pending", align: "right", type: "money" },
      { key: "paid_date", label: "Paid On", type: "date" }, { key: "status", label: "Status", type: "status" }],
    rows: schedule.map(row => ({ no: row.installment_number, due_date: row.due_date, installment_amount: row.installment_amount, paid_amount: row.paid_amount,
      outstanding_amount: row.outstanding_amount, paid_date: row.paid_date, status: row.status, _highlight: data.highlight === row.id })),
  }, {
    title: "Collection History",
    columns: [{ key: "voucher_no", label: "Voucher No." }, { key: "date", label: "Date", type: "date" }, { key: "payment_mode", label: "Mode" },
      { key: "account", label: "Account" }, { key: "reference", label: "Reference" }, { key: "amount", label: "Amount", align: "right", type: "money" }],
    rows: collections.map(row => ({ ...row, _open: { kind: "voucher", id: row.voucher_no } })),
    footer: collections.length ? [{ label: "Total Collected", amount: collections.reduce((sum, row) => sum + Number(row.amount || 0), 0) }] : undefined,
  }];
  return { title: "Loan Details", subtitle: customer?.name || "", reference: loan.loan_no, badge: loan.status, sections, tables, admin: data.edit };
}

const LEDGER_COLUMNS = [{ key: "date", label: "Date", type: "date" }, { key: "particulars", label: "Particulars" }, { key: "type", label: "Vch Type" },
  { key: "reference", label: "Vch No." }, { key: "debit", label: "Debit", align: "right", type: "money" }, { key: "credit", label: "Credit", align: "right", type: "money" },
  { key: "balance", label: "Balance", align: "right", type: "balance" }];

const rangeText = params => [params.from && `From ${params.from}`, params.to && `To ${params.to}`].filter(Boolean).join("  ·  ") || "All dates";

export function ledgerModel({ statement, ledger, params }) {
  const rows = statement.rows || [];
  return {
    title: "Ledger Details", subtitle: ledger?.name || "", reference: rangeText(params),
    sections: [
      { title: "Ledger Information", items: keep([item("Ledger", ledger?.name), item("Group", ledger?.group_name || ledger?.group),
        item("Opening Balance", balanceCell(statement.opening_balance, statement.opening_balance_type), "balance"),
        item("Total Debit", statement.total_debit, "money"), item("Total Credit", statement.total_credit, "money"),
        item("Closing Balance", balanceCell(statement.closing_balance, statement.closing_balance_type), "balance")]) },
    ],
    tables: [{ title: "Transactions", columns: LEDGER_COLUMNS,
      rows: rows.map(row => ({ date: row.date, particulars: row.particulars, type: row.type, reference: row.reference,
        debit: Number(row.debit) || "", credit: Number(row.credit) || "", balance: balanceCell(row.balance, row.balance_type),
        _open: row.reference ? { kind: "voucher", id: row.reference } : undefined })) }],
  };
}

export function findNode(value, id) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) { for (const entry of value) { const hit = findNode(entry, id); if (hit) return hit; } return null; }
  if (value.id === id && "children" in value) return value;
  for (const key of Object.keys(value)) { const hit = findNode(value[key], id); if (hit) return hit; }
  return null;
}

export function groupModel({ node, reportLabel, params }) {
  const extra = { report: params.report, from: params.from, to: params.to };
  const flat = (list, depth = 0) => list.flatMap(child => [{ ...child, depth }, ...flat(child.children || [], depth + 1)]);
  const children = flat(node.children || []);
  return {
    title: `${reportLabel} · Breakdown`, subtitle: node.name, reference: rangeText(params),
    sections: [{ title: "Group Summary", items: [item("Particulars", node.name), item("Debit", node.debit, "money"), item("Credit", node.credit, "money"), item("Sub-accounts", children.length)] }],
    tables: [{ title: "Accounts In This Group",
      columns: [{ key: "name", label: "Particulars" }, { key: "debit", label: "Debit", align: "right", type: "money" }, { key: "credit", label: "Credit", align: "right", type: "money" }],
      rows: children.map(child => ({ name: child.name, indent: child.depth, debit: Number(child.debit) || "", credit: Number(child.credit) || "",
        _open: { kind: child.is_group ? "group" : "ledger", id: child.id, extra } })),
      footer: [{ label: "Total", debit: Number(node.debit) || 0, credit: Number(node.credit) || 0 }] }],
  };
}
