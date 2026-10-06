import { useEffect, useMemo, useState } from "react";
import { formatINR } from "../../utils/currency";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import "./report-common.css";

const money = formatINR;
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const EMPTY_SECTION = { customer: null, openingSigned: 0, transactionRows: [] };

function Icon({ name }) {
  const paths = { back: <path d="M19 12H5m7 7-7-7 7-7" />, chevron: <path d="m9 6 6 6-6 6" /> };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

// Debit = positive, Credit = negative; display is always a non-negative amount + Dr/Cr suffix.
function balanceLabel(value) {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return money(0);
  return rounded > 0 ? `${money(rounded)} Dr` : `${money(Math.abs(rounded))} Cr`;
}
function signedOf(row) {
  if (!row) return 0;
  return Number(row.debit) > 0 ? Number(row.debit) : -Number(row.credit || 0);
}

export default function CustomerReportDetail({ api, auth, go, id }) {
  const [customers, setCustomers] = useState([]);
  const [loans, setLoans] = useState([]);
  const [customer, setCustomer] = useState(id || "");
  const [loanId, setLoanId] = useState("");
  const [section, setSection] = useState(EMPTY_SECTION);
  const [loading, setLoading] = useState(true), [ledgerLoading, setLedgerLoading] = useState(false), [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.get("/customers/", { ...auth, params: { page_size: 5000 } }),
      api.get("/finance/loans/", { ...auth, params: { page_size: 10000 } }),
    ]).then(([customersRes, loansRes]) => {
      if (!active) return;
      setCustomers(customersRes.data.results ?? customersRes.data ?? []);
      setLoans(loansRes.data.results ?? loansRes.data ?? []);
      setError("");
    }).catch(() => { if (active) setError("Unable to load report data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!customer) { setSection(EMPTY_SECTION); return; }
    let active = true;
    setLedgerLoading(true);
    const request = loanId
      ? Promise.all([
          api.get("/finance/reports/customer-wise/", { ...auth, params: { customer } }),
          api.get("/finance/reports/customer-wise/", { ...auth, params: { customer, loan_id: loanId } }),
        ]).then(([openingRes, loanRes]) => {
          const openingResult = (openingRes.data.results || [])[0];
          const loanResult = (loanRes.data.results || [])[0];
          const openingRow = openingResult ? openingResult.rows.find(row => row.is_opening) : null;
          return loanResult ? { customer: loanResult.customer, openingSigned: signedOf(openingRow), transactionRows: loanResult.rows } : EMPTY_SECTION;
        })
      : api.get("/finance/reports/customer-wise/", { ...auth, params: { customer } }).then(({ data }) => {
          const result = (data.results || [])[0];
          if (!result) return EMPTY_SECTION;
          const openingRow = result.rows.find(row => row.is_opening);
          return { customer: result.customer, openingSigned: signedOf(openingRow), transactionRows: result.rows.filter(row => !row.is_opening) };
        });
    request.then(value => { if (active) { setSection(value); setError(""); } })
      .catch(() => { if (active) setError("Unable to load the customer's statement."); })
      .finally(() => { if (active) setLedgerLoading(false); });
    return () => { active = false; };
  }, [api, customer, loanId]);

  const customerOptions = useMemo(() => customers.map(item => ({
    value: item.id, label: `${item.full_name} — ${item.primary_mobile}`, full_name: item.full_name, primary_mobile: item.primary_mobile,
  })), [customers]);

  const loanOptions = useMemo(() => {
    if (!customer) return [];
    return loans.filter(row => String(row.customer?.id) === String(customer)).map(row => {
      const type = row.loan_type?.name || "Loan";
      const plan = row.plan?.name || "";
      const label = type.toLowerCase() === "chit" && plan ? `${row.doc_no} • ${type} • ${plan}` : `${row.doc_no} • ${type}`;
      return { value: row.id, label, doc_no: row.doc_no, plan_name: plan, loan_type: type };
    });
  }, [loans, customer]);

  const selectedLoanDocNo = useMemo(() => loans.find(row => String(row.id) === String(loanId))?.doc_no, [loans, loanId]);
  const selectedCustomerObj = useMemo(() => customers.find(row => String(row.id) === String(customer)), [customers, customer]);

  return <div className="rpt-page">
    <div className="rpt-header-row">
      <nav className="rpt-breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="rpt-back" aria-label="Back" onClick={() => go("/dashboard")}><Icon name="back" /></button>
        <span>Reports</span><Icon name="chevron" /><strong>Customer-wise Report</strong>
        {selectedCustomerObj && <><Icon name="chevron" /><strong>{selectedCustomerObj.full_name}</strong></>}
      </nav>
      <div className="rpt-toolbar">
        {(loading || ledgerLoading) && <span className="rpt-loading">Updating…</span>}
        {error && <span className="rpt-error" role="alert">{error}</span>}
        <label className="rpt-field rpt-field-customer" style={{ width: 230 }}>Customer
          <div className={`rpt-dropdown-wrap ${customer ? "has-value" : ""}`}>
            <SearchableDropdown options={customerOptions} searchKeys={["full_name", "primary_mobile"]} value={customer} onChange={setCustomer} placeholder="Select Customer" />
          </div>
        </label>
        <label className="rpt-field rpt-field-loan" style={{ width: 230 }}>Loan Number
          <div className={`rpt-dropdown-wrap ${loanId ? "has-value" : ""}`}>
            <SearchableDropdown options={loanOptions} searchKeys={["doc_no", "plan_name", "loan_type"]} value={loanId} onChange={setLoanId} placeholder="Select Loan Number" disabled={!customer} />
          </div>
        </label>
      </div>
    </div>

    <CustomerLedgerSection section={section} loanLabel={customer && loanId ? selectedLoanDocNo : null} />
  </div>;
}

function CustomerLedgerSection({ section, loanLabel }) {
  const { customer, openingSigned, transactionRows } = section;
  let running = openingSigned;
  const rows = transactionRows.map(row => { running += Number(row.debit || 0) - Number(row.credit || 0); return { ...row, balance: running }; });
  const debitTotal = transactionRows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const creditTotal = transactionRows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  const closingSigned = openingSigned + debitTotal - creditTotal;

  return <div className="rpt-card rpt-table-card rpt-ledger-card">
    {customer && <p className="rpt-ledger-customer-head">
      <strong>{customer.name?.toUpperCase()}</strong> · {customer.code} · {customer.phone}{loanLabel ? ` · ${loanLabel}` : ""}
    </p>}
    <div className="rpt-table-wrap"><table className="rpt-table">
      <thead><tr><th>Date</th><th>Particulars</th><th>Vch No</th><th className="num">Dr</th><th className="num">Cr</th><th className="num">Balance</th></tr></thead>
      <tbody>
        {rows.map((row, index) => <tr key={index} className={row.particulars === "Receipt" ? "rpt-receipt-row" : ""}>
          <td>{dateLabel(row.date)}</td><td>{row.particulars}</td><td>{row.voucher_no || "—"}</td>
          <td className="num">{Number(row.debit) > 0 ? money(row.debit) : ""}</td>
          <td className="num">{Number(row.credit) > 0 ? money(row.credit) : ""}</td>
          <td className="num">{balanceLabel(row.balance)}</td>
        </tr>)}
      </tbody>
    </table></div>
    <div className="rpt-ledger-footer">
      <div><small>Opening Balance</small><strong>{balanceLabel(openingSigned)}</strong></div>
      <div><small>Transactions</small><strong>Dr {money(debitTotal)} &nbsp; Cr {money(creditTotal)}</strong></div>
      <div><small>Closing Balance</small><strong>{balanceLabel(closingSigned)}</strong></div>
    </div>
  </div>;
}
