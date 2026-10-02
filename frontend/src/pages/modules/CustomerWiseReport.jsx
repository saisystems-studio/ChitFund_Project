import { Fragment, useEffect, useMemo, useState } from "react";
import { formatINR } from "../../utils/currency";
import "./customer-wise-report.css";

const money = formatINR;
const num = value => Number(value || 0);
const TYPES = ["Chit", "Interest", "Mortgage"];
const typeKey = value => String(value || "").toLowerCase();
const blankFilters = { customer: "ALL", loan_type: "ALL", status: "ALL", from: "", to: "" };
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const percent = value => `${num(value).toLocaleString("en-IN", { maximumFractionDigits: 3 })}%`;

// Indian short-scale labels for chart axes and bar-end values.
const compactINR = value => {
  const amount = num(value), abs = Math.abs(amount);
  if (abs >= 1e7) return `₹${(amount / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })}Cr`;
  if (abs >= 1e5) return `₹${(amount / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })}L`;
  if (abs >= 1e3) return `₹${(amount / 1e3).toLocaleString("en-IN", { maximumFractionDigits: 1 })}K`;
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const niceMax = value => {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map(step => step * power).find(step => step >= value);
};

function Icon({ name }) {
  const paths = {
    back: <path d="M19 12H5m7 7-7-7 7-7" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    report: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-3" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function CustomerWiseReport({ api, auth, go }) {
  const [filters, setFilters] = useState(blankFilters), [view, setView] = useState("numeric");
  const [customers, setCustomers] = useState([]), [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [expanded, setExpanded] = useState(() => new Set()), [openCustomer, setOpenCustomer] = useState(null), [showSummary, setShowSummary] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get("/finance/reports/customer-wise/", { ...auth, params: filters })
      .then(({ data }) => { if (!active) return; setCustomers(data.customers || []); setResults(data.results || []); setError(""); })
      .catch(requestError => { if (active) setError(requestError.response?.data?.detail || "Unable to load Customer-wise Report."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters]);
  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const toggle = id => setExpanded(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const summary = useMemo(() => {
    const loans = results.flatMap(row => row.loans);
    const count = type => loans.filter(loan => typeKey(loan.loan_type) === type).length;
    return { customers: results.length, loans: loans.length, chit: count("chit"), interest: count("interest"), mortgage: count("mortgage"),
      collected: loans.reduce((sum, loan) => sum + num(loan.total_paid), 0), pending: loans.reduce((sum, loan) => sum + num(loan.remaining), 0) };
  }, [results]);
  const cards = [["Total Customers", summary.customers], ["Total Loans", summary.loans], ["Chit", summary.chit, "chit"], ["Interest", summary.interest, "interest"], ["Mortgage", summary.mortgage, "mortgage"], ["Total Collected", money(summary.collected), "collected"], ["Total Pending", money(summary.pending), "pending"]];
  return <div className="cwr-page">
    <nav className="cwr-breadcrumb" aria-label="Breadcrumb">
      <button type="button" className="cwr-back" aria-label="Back" onClick={() => go("/dashboard")}><Icon name="back" /></button>
      <span>Reports</span><Icon name="chevron" /><strong>Customer-wise Report</strong>
    </nav>
    <section className="cwr-card cwr-head">
      <div className="cwr-head-top">
        <div className="cwr-title"><span className="cwr-title-icon"><Icon name="report" /></span><div><h1>Customer-wise Report</h1><p>All customers and loan types, with schedules and payment history</p></div></div>
        <div className="cwr-head-actions">
          {loading && <span className="cwr-loading">Updating…</span>}
          <div className="cwr-toggle" role="tablist" aria-label="Report view">
            {[["numeric", "Numeric"], ["histogram", "Histogram"]].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? "active" : ""} onClick={() => setView(key)}>{label}</button>)}
          </div>
        </div>
      </div>
      <div className="cwr-filters">
        <label>Customer<select value={filters.customer} onChange={event => update("customer", event.target.value)}><option value="ALL">All Customers</option>{customers.map(item => <option key={item.id} value={item.id}>{item.name}{item.code ? ` (${item.code})` : ""}</option>)}</select></label>
        <label>Loan Type<select value={filters.loan_type} onChange={event => update("loan_type", event.target.value)}><option value="ALL">All</option>{TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
        <label>Status<select value={filters.status} onChange={event => update("status", event.target.value)}><option value="ALL">All</option><option>Active</option><option>Completed</option></select></label>
        <label className="cwr-range" title="Filters loans by start date">Date Range<span><input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={event => update("from", event.target.value)} /><em>to</em><input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={event => update("to", event.target.value)} /></span></label>
        <button type="button" className={`cwr-summary-toggle ${showSummary ? "open" : ""}`} aria-expanded={showSummary} aria-controls="cwr-summary-panel" onClick={() => setShowSummary(value => !value)}>Summary <span aria-hidden="true">{showSummary ? "▴" : "▾"}</span></button>
      </div>
    </section>
    {error && <div className="cwr-error" role="alert">{error}</div>}
    <div id="cwr-summary-panel" className={`cwr-summary-panel ${showSummary ? "open" : ""}`} aria-hidden={!showSummary}><div className="cwr-summary-panel-inner">
      <div className="cwr-summary">{cards.map(([label, value, tone]) => <div key={label} className={`cwr-stat ${tone || ""}`}><small>{tone && <i />}{label}</small><strong>{value}</strong></div>)}</div>
    </div></div>
    <div className={loading ? "cwr-body is-loading" : "cwr-body"}>
      {!results.length && !loading ? <div className="cwr-card cwr-empty">No loans match the selected filters.</div>
        : view === "numeric" ? results.map(row => <CustomerBlock key={row.customer.id} row={row} expanded={expanded} toggle={toggle} open={openCustomer === row.customer.id} onToggle={() => setOpenCustomer(current => current === row.customer.id ? null : row.customer.id)} />)
          : <Histogram results={results} summary={summary} />}
    </div>
  </div>;
}

function Status({ value }) { return <span className={`cwr-status ${typeKey(value)}`}>{value}</span>; }

function CustomerBlock({ row, expanded, toggle, open, onToggle }) {
  const collected = row.loans.reduce((sum, loan) => sum + num(loan.total_paid), 0), pending = row.loans.reduce((sum, loan) => sum + num(loan.remaining), 0);
  const panelId = `cwr-customer-${row.customer.id}`, count = row.loans.length;
  return <section className={`cwr-card cwr-customer ${open ? "open" : ""}`}>
    <button type="button" className="cwr-customer-head" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
      <div><h2>{row.customer.name} <em>· {count} {count === 1 ? "Loan" : "Loans"}</em></h2><span>{[row.customer.code, row.customer.phone].filter(Boolean).join(" · ")}</span></div>
      <dl><div><dt>Collected</dt><dd className="collected">{money(collected)}</dd></div><div><dt>Pending</dt><dd className="pending">{money(pending)}</dd></div></dl>
      <span className="cwr-customer-arrow" aria-hidden="true">{open ? "▲" : "▼"}</span>
    </button>
    <div className="cwr-customer-panel" id={panelId} role="region" aria-label={`${row.customer.name} loans`}>
      <div className="cwr-customer-panel-inner">
        {open && TYPES.map(type => { const loans = row.loans.filter(loan => typeKey(loan.loan_type) === typeKey(type)); return loans.length ? <LoanTable key={type} type={type} loans={loans} expanded={expanded} toggle={toggle} /> : null; })}
      </div>
    </div>
  </section>;
}

const COLUMNS = {
  Chit: [["Doc No"], ["Chit Group"], ["Chit Amount", "num"], ["Start Date"], ["End Date"], ["Collection Date"], ["Total Inst.", "inst"], ["Paid Inst.", "inst"], ["Pending Inst.", "inst"], ["Total Paid", "num"], ["Remaining", "num"], ["Status"]],
  Interest: [["Doc No"], ["Principal", "num"], ["Interest %", "num"], ["Collection Plan"], ["Collection Date"], ["Total Paid", "num"], ["Remaining", "num"], ["Status"]],
  Mortgage: [["Doc No"], ["Mortgage Details"], ["Amount", "num"], ["Market Value", "num"], ["Interest %", "num"], ["Date"], ["Collection Date"], ["Total Paid", "num"], ["Remaining", "num"], ["Status"]],
};

function cells(type, loan) {
  const doc = <b className="cwr-doc">{loan.doc_no}</b>;
  if (type === "Chit") return [doc, loan.chit?.group_name || "—", money(loan.chit?.chit_amount ?? loan.loan_amount), dateLabel(loan.start_date), dateLabel(loan.end_date), dateLabel(loan.collection_date), loan.total_installments, loan.paid_installments, loan.pending_installments, money(loan.total_paid), money(loan.remaining), <Status value={loan.status} />];
  if (type === "Interest") return [doc, money(loan.interest?.principal ?? loan.loan_amount), percent(loan.interest?.interest_percentage), loan.interest?.collection_plan || "—", dateLabel(loan.collection_date), money(loan.total_paid), money(loan.remaining), <Status value={loan.status} />];
  const mortgage = loan.mortgage || {};
  const detail = [mortgage.product_name, mortgage.quantity != null && `${num(mortgage.quantity).toLocaleString("en-IN")} ${mortgage.unit || ""}`.trim()].filter(Boolean).join(" · ") || "—";
  return [doc, detail, money(mortgage.loan_amount ?? loan.loan_amount), money(mortgage.market_value), percent(mortgage.interest_percentage), dateLabel(loan.start_date), dateLabel(loan.collection_date), money(loan.total_paid), money(loan.remaining), <Status value={loan.status} />];
}

function LoanTable({ type, loans, expanded, toggle }) {
  const columns = COLUMNS[type], detailLabel = type === "Chit" ? "Schedule" : "History";
  return <div className={`cwr-type ${typeKey(type)}`}>
    <h3><i />{type} <span>{loans.length} {loans.length === 1 ? "loan" : "loans"}</span></h3>
    <div className="cwr-table-wrap"><table className="cwr-table">
      <thead><tr>{columns.map(([label, align]) => <th key={label} className={align}>{label}</th>)}<th aria-label={`${detailLabel} details`} /></tr></thead>
      <tbody>{loans.map(loan => { const open = expanded.has(loan.id); return <Fragment key={loan.id}>
        <tr className={open ? "open" : ""}>{cells(type, loan).map((value, index) => <td key={index} className={columns[index][1]}>{value}</td>)}
          <td className="cwr-expand-cell"><button type="button" aria-expanded={open} onClick={() => toggle(loan.id)}>{detailLabel}<Icon name="down" /></button></td></tr>
        {open && <tr className="cwr-detail-row"><td colSpan={columns.length + 1}>{type === "Chit" ? <SchedulePreview loan={loan} /> : <PaymentHistory loan={loan} />}</td></tr>}
      </Fragment>; })}</tbody>
    </table></div>
  </div>;
}

function SchedulePreview({ loan }) {
  return <div className="cwr-detail">
    <p className="cwr-detail-summary"><b>{loan.total_installments} Installments</b><span className="paid">{loan.paid_installments} Paid</span><span className="pending">{loan.pending_installments} Pending</span><span>Remaining <b>{money(loan.remaining)}</b></span></p>
    <table className="cwr-mini"><thead><tr><th>S.No</th><th>Schedule Date</th><th className="num">Installment Amount</th><th className="num">Paid Amount</th><th className="num">Balance</th><th>Status</th></tr></thead>
      <tbody>{loan.schedule.map(row => <tr key={row.installment_number} className={row.status === "Paid" ? "is-paid" : "is-pending"}><td>{row.installment_number}</td><td>{dateLabel(row.due_date)}</td><td className="num">{money(row.installment_amount)}</td><td className="num">{money(row.paid_amount)}</td><td className="num">{money(row.balance)}</td><td><Status value={row.status} /></td></tr>)}
        {!loan.schedule.length && <tr><td colSpan="6" className="cwr-mini-empty">No schedule generated.</td></tr>}</tbody></table>
  </div>;
}

function PaymentHistory({ loan }) {
  return <div className="cwr-detail">
    <p className="cwr-detail-summary"><b>{loan.payments.length} Payments</b><span className="paid">Paid {money(loan.total_paid)}</span><span className="pending">Remaining {money(loan.remaining)}</span>{loan.next_due_date && <span>Next due <b>{dateLabel(loan.next_due_date)}</b></span>}</p>
    <table className="cwr-mini"><thead><tr><th>S.No</th><th>Payment Date</th><th>Inst. No</th><th className="num">Amount</th><th>Mode</th><th>Reference</th></tr></thead>
      <tbody>{loan.payments.map((row, index) => <tr key={index} className="is-paid"><td>{index + 1}</td><td>{dateLabel(row.date)}</td><td>{row.installment_number}</td><td className="num">{money(row.amount)}</td><td>{row.payment_mode || "—"}</td><td>{row.reference_no || "—"}</td></tr>)}
        {!loan.payments.length && <tr><td colSpan="6" className="cwr-mini-empty">No payments recorded yet.</td></tr>}</tbody></table>
  </div>;
}

/* ---------- Histogram view ---------- */

function useTooltip() {
  const [tip, setTip] = useState(null);
  const bind = content => ({ onMouseMove: event => setTip({ x: event.clientX, y: event.clientY, content }), onMouseLeave: () => setTip(null), onFocus: event => { const box = event.currentTarget.getBoundingClientRect(); setTip({ x: box.left + box.width / 2, y: box.top, content }); }, onBlur: () => setTip(null), tabIndex: 0 });
  const node = tip && <div className="cwr-tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 250), top: tip.y + 14 }} role="tooltip">{tip.content}</div>;
  return [bind, node];
}

function TipBody({ title, rows }) {
  return <><b>{title}</b>{rows.map(([label, value, tone]) => <span key={label}><i className={tone} />{label}<em>{value}</em></span>)}</>;
}

function Axis({ max, label }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return <div className="cwr-axis-row"><span className="cwr-axis-name">{label}</span><div className="cwr-axis">{ticks.map(tick => <span key={tick} style={{ left: `${tick * 100}%` }}>{compactINR(max * tick)}</span>)}</div><span className="cwr-axis-end" /></div>;
}

function Grid() { return <div className="cwr-grid" aria-hidden="true">{[0.25, 0.5, 0.75, 1].map(tick => <span key={tick} style={{ left: `${tick * 100}%` }} />)}</div>; }

function Legend({ items }) { return <div className="cwr-legend">{items.map(([label, tone]) => <span key={label}><i className={tone} />{label}</span>)}</div>; }

function Histogram({ results, summary }) {
  const [bind, tooltip] = useTooltip();
  const rows = results.map(row => {
    const byType = Object.fromEntries(TYPES.map(type => [typeKey(type), row.loans.filter(loan => typeKey(loan.loan_type) === typeKey(type)).reduce((sum, loan) => sum + num(loan.loan_amount), 0)]));
    return { id: row.customer.id, name: row.customer.name, byType, total: Object.values(byType).reduce((a, b) => a + b, 0),
      collected: row.loans.reduce((sum, loan) => sum + num(loan.total_paid), 0), pending: row.loans.reduce((sum, loan) => sum + num(loan.remaining), 0) };
  });
  const amountRows = [...rows].sort((a, b) => b.total - a.total), amountMax = niceMax(Math.max(0, ...rows.map(row => row.total)));
  const cvpRows = [...rows].sort((a, b) => (b.collected + b.pending) - (a.collected + a.pending)), cvpMax = niceMax(Math.max(0, ...rows.flatMap(row => [row.collected, row.pending])));
  const loans = results.flatMap(row => row.loans);
  const distribution = TYPES.map(type => { const items = loans.filter(loan => typeKey(loan.loan_type) === typeKey(type)); return { type, key: typeKey(type), count: items.length, amount: items.reduce((sum, loan) => sum + num(loan.loan_amount), 0) }; });
  const distTotal = distribution.reduce((sum, item) => sum + item.amount, 0);
  const installments = loans.reduce((all, loan) => ({ paid: all.paid + num(loan.paid_installments), pending: all.pending + num(loan.pending_installments) }), { paid: 0, pending: 0 });
  const payable = summary.collected + summary.pending, rate = payable ? summary.collected / payable * 100 : 0;
  const share = (value, total) => total ? `${(value / total * 100).toFixed(1)}%` : "0%";
  return <div className="cwr-charts">
    <section className="cwr-card cwr-chart wide">
      <header><div><h2>Customer-wise Loan Amount</h2><p>Loan amount per customer, split by loan type</p></div><Legend items={TYPES.map(type => [type, typeKey(type)])} /></header>
      <div className="cwr-bars">
        {amountRows.map(row => <div className="cwr-bar-row" key={row.id} {...bind(<TipBody title={row.name} rows={[...TYPES.filter(type => row.byType[typeKey(type)]).map(type => [type, money(row.byType[typeKey(type)]), typeKey(type)]), ["Total Amount", money(row.total)]]} />)}>
          <span className="cwr-bar-label" title={row.name}>{row.name}</span>
          <div className="cwr-track"><Grid /><div className="cwr-stack" style={{ width: `${row.total / amountMax * 100}%` }}>{TYPES.filter(type => row.byType[typeKey(type)] > 0).map(type => <span key={type} className={typeKey(type)} style={{ flexGrow: row.byType[typeKey(type)] }} />)}</div></div>
          <span className="cwr-bar-value">{compactINR(row.total)}</span>
        </div>)}
        <Axis max={amountMax} label="Loan amount (₹)" />
      </div>
    </section>
    <section className="cwr-card cwr-chart wide">
      <header><div><h2>Customer-wise Collected vs Pending</h2><p>Amount collected and still pending per customer</p></div><Legend items={[["Collected", "collected"], ["Pending", "pending"]]} /></header>
      <div className="cwr-bars grouped">
        {cvpRows.map(row => <div className="cwr-bar-row" key={row.id} {...bind(<TipBody title={row.name} rows={[["Collected", money(row.collected), "collected"], ["Pending", money(row.pending), "pending"], ["Collection", share(row.collected, row.collected + row.pending)]]} />)}>
          <span className="cwr-bar-label" title={row.name}>{row.name}</span>
          <div className="cwr-track"><Grid /><div className="cwr-pair"><span className="collected" style={{ width: `${row.collected / cvpMax * 100}%` }} /><span className="pending" style={{ width: `${row.pending / cvpMax * 100}%` }} /></div></div>
          <span className="cwr-bar-value pair"><em>{compactINR(row.collected)}</em><em>{compactINR(row.pending)}</em></span>
        </div>)}
        <Axis max={cvpMax} label="Amount (₹)" />
      </div>
    </section>
    <section className="cwr-card cwr-chart">
      <header><div><h2>Loan Type Distribution</h2><p>Share of loan amount by type</p></div></header>
      <div className="cwr-split" role="img" aria-label="Loan amount share by type">{distribution.filter(item => item.amount > 0).map(item => <span key={item.key} className={item.key} style={{ flexGrow: item.amount }} {...bind(<TipBody title={item.type} rows={[["Loans", item.count, item.key], ["Amount", money(item.amount)], ["Share", share(item.amount, distTotal)]]} />)} />)}</div>
      <table className="cwr-legend-table"><thead><tr><th>Type</th><th className="num">Loans</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
        <tbody>{distribution.map(item => <tr key={item.key}><td><i className={item.key} />{item.type}</td><td className="num">{item.count}</td><td className="num">{money(item.amount)}</td><td className="num">{share(item.amount, distTotal)}</td></tr>)}</tbody></table>
    </section>
    <section className="cwr-card cwr-chart">
      <header><div><h2>Collection Performance</h2><p>Paid vs pending across the filtered loans</p></div></header>
      <div className="cwr-hero"><strong>{rate.toFixed(1)}%</strong><span>of {money(payable)} collected</span></div>
      <div className="cwr-split" role="img" aria-label="Collected versus pending amount">{[["Collected", summary.collected, "collected"], ["Pending", summary.pending, "pending"]].filter(([, value]) => value > 0).map(([label, value, tone]) => <span key={label} className={tone} style={{ flexGrow: value }} {...bind(<TipBody title={label} rows={[["Amount", money(value), tone], ["Share", share(value, payable)]]} />)} />)}</div>
      <table className="cwr-legend-table"><thead><tr><th /><th className="num">Amount</th><th className="num">Installments</th></tr></thead>
        <tbody><tr><td><i className="collected" />Paid / Collected</td><td className="num">{money(summary.collected)}</td><td className="num">{installments.paid}</td></tr><tr><td><i className="pending" />Pending</td><td className="num">{money(summary.pending)}</td><td className="num">{installments.pending}</td></tr></tbody></table>
    </section>
    {tooltip}
  </div>;
}
