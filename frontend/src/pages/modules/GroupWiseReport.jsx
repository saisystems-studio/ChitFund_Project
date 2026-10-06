import { Fragment, useEffect, useMemo, useState } from "react";
import { formatINR } from "../../utils/currency";
import "./group-wise-detail.css";
import "./report-common.css";
import SearchableDropdown from "../../components/SearchableDropdown/SearchableDropdown";
import CustomerDropdown from "../../components/CustomerDropdown/CustomerDropdown";
import { periodRange, PERIOD_OPTIONS } from "../../utils/periodRange";

const money = formatINR;
const num = value => Number(value || 0);
const typeKey = value => String(value || "").toLowerCase();
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function Icon({ name }) {
  const paths = {
    back: <path d="M19 12H5m7 7-7-7 7-7" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

const blankFilters = { group: "", customer: "", loan: "", status: "ALL", period: "", from: "", to: "" };

export default function GroupWiseReport({ api, auth, go }) {
  const [filters, setFilters] = useState(blankFilters);
  const [chitLoans, setChitLoans] = useState([]), [groups, setGroups] = useState([]), [detail, setDetail] = useState({ results: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [openGroupId, setOpenGroupId] = useState(null);
  const [expandedLoans, setExpandedLoans] = useState(() => new Set());
  const toggleLoan = id => setExpandedLoans(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.get("/finance/loans/", { ...auth, params: { page_size: 10000, loan_type: "Chit" } }),
      api.get("/finance/chit-groups/", { ...auth, params: { page_size: 1000 } }),
      api.get("/finance/reports/group-wise-detail/", { ...auth, params: { customer: "ALL" } }),
    ]).then(([loansRes, groupsRes, detailRes]) => {
      if (!active) return;
      setChitLoans((loansRes.data.results ?? loansRes.data ?? []).filter(row => (row.loan_type?.name || "").toLowerCase() === "chit"));
      setGroups(groupsRes.data.results ?? groupsRes.data ?? []);
      setDetail(detailRes.data || { results: [] });
      setError("");
    }).catch(() => { if (active) setError("Unable to load group-wise report data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const hasActiveFilters = filters.group || filters.customer || filters.loan || filters.status !== "ALL" || filters.period;
  const clearFilters = () => setFilters(blankFilters);

  const groupOptions = useMemo(() => groups.map(item => ({ value: item.id, label: `${item.name} (${item.code})`, name: item.name, code: item.code })), [groups]);
  const groupCodeById = useMemo(() => Object.fromEntries(groups.map(item => [item.id, item.code])), [groups]);
  const range = useMemo(() => periodRange(filters.period, filters.from, filters.to), [filters.period, filters.from, filters.to]);

  const loanOptions = useMemo(() => {
    const scoped = filters.customer ? chitLoans.filter(row => String(row.customer?.id) === String(filters.customer)) : chitLoans;
    return scoped.map(row => ({ value: row.id, label: `${row.doc_no} — ${row.customer?.name || "—"}`, doc_no: row.doc_no, customer_name: row.customer?.name || "" }));
  }, [chitLoans, filters.customer]);
  useEffect(() => {
    if (!filters.loan) return;
    if (!loanOptions.some(option => String(option.value) === String(filters.loan))) update("loan", "");
  }, [loanOptions, filters.loan]);

  const filteredChitLoans = useMemo(() => chitLoans.filter(row => {
    if (filters.group && String(row.plan?.id) !== String(filters.group)) return false;
    if (filters.customer && String(row.customer?.id) !== String(filters.customer)) return false;
    if (filters.loan && String(row.id) !== String(filters.loan)) return false;
    if (filters.status !== "ALL" && (row.status || "").toLowerCase() !== filters.status.toLowerCase()) return false;
    if (range.from && (!row.start_date || row.start_date < range.from)) return false;
    if (range.to && (!row.start_date || row.start_date > range.to)) return false;
    return true;
  }), [chitLoans, filters, range]);

  const groupCards = useMemo(() => {
    const byGroup = new Map();
    for (const loan of filteredChitLoans) {
      const groupInfo = loan.plan;
      if (!groupInfo) continue;
      const entry = byGroup.get(groupInfo.id) || { group: groupInfo, members: new Set(), loans: 0, total: 0, collected: 0, pending: 0 };
      entry.members.add(loan.customer?.id);
      entry.loans += 1;
      entry.total += num(loan.total_amount);
      entry.collected += num(loan.collected_amount);
      entry.pending += num(loan.outstanding_amount);
      byGroup.set(groupInfo.id, entry);
    }
    return [...byGroup.values()].map(entry => ({ ...entry, members: entry.members.size }))
      .sort((a, b) => a.group.name.localeCompare(b.group.name));
  }, [filteredChitLoans]);

  // Only this group's own loans for its filtered member customers — never a customer's
  // unrelated Interest/Mortgage loans or a Chit loan from a different group.
  const customersForGroup = groupId => {
    const code = groupCodeById[groupId];
    const groupLoans = filteredChitLoans.filter(loan => String(loan.plan?.id) === String(groupId));
    const memberIds = new Set(groupLoans.map(loan => loan.customer?.id));
    const allowedLoanIds = new Set(groupLoans.map(loan => loan.id));
    return (detail.results || [])
      .filter(row => memberIds.has(row.customer.id))
      .map(row => ({ ...row, loans: row.loans.filter(loan => loan.chit?.group_code === code && allowedLoanIds.has(loan.id)) }))
      .filter(row => row.loans.length > 0)
      .sort((a, b) => a.customer.name.localeCompare(b.customer.name));
  };

  return <div className="cwr-page rpt-page">
    <div className="rpt-header-row">
      <nav className="cwr-breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="cwr-back" aria-label="Back" onClick={() => go("/dashboard")}><Icon name="back" /></button>
        <span>Reports</span><Icon name="chevron" /><strong>Group-wise Report</strong>
      </nav>
      <div className="rpt-toolbar">
        {loading && <span className="rpt-loading">Updating…</span>}
        {error && <span className="rpt-error" role="alert">{error}</span>}
        <label className="rpt-field rpt-field-group">Group<SearchableDropdown options={groupOptions} searchKeys={["name", "code"]} value={filters.group} onChange={value => update("group", value)} placeholder="All Groups" /></label>
        <label className="rpt-field rpt-field-customer">Customer<CustomerDropdown api={api} auth={auth} value={filters.customer} onChange={value => update("customer", value)} /></label>
        <label className="rpt-field rpt-field-loan">Loan Number<SearchableDropdown options={loanOptions} searchKeys={["doc_no", "customer_name"]} value={filters.loan} onChange={value => update("loan", value)} placeholder="All Loan Numbers" /></label>
        <label className="rpt-field rpt-field-status">Status
          <select value={filters.status} onChange={event => update("status", event.target.value)}>
            <option value="ALL">All</option><option>Active</option><option>Completed</option>
          </select>
        </label>
        <label className="rpt-field rpt-field-period">Period
          <select value={filters.period} onChange={event => update("period", event.target.value)}>
            {PERIOD_OPTIONS.slice(0, -1).map(option => <option key={option}>{option}</option>)}
            <option value="">All Time</option>
            <option>{PERIOD_OPTIONS.at(-1)}</option>
          </select>
        </label>
        {filters.period === "Custom Range" && <>
          <label className="rpt-field rpt-field-date">From<input type="date" value={filters.from} max={filters.to || undefined} onChange={event => update("from", event.target.value)} /></label>
          <label className="rpt-field rpt-field-date">To<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => update("to", event.target.value)} /></label>
        </>}
        {hasActiveFilters && <button type="button" className="rpt-clear" onClick={clearFilters}>Clear Filters</button>}
      </div>
    </div>
    <div className={loading ? "cwr-body is-loading" : "cwr-body"}>
      {!groupCards.length && !loading ? <div className="cwr-card cwr-empty">No groups match the selected filters.</div>
        : groupCards.map(card => <GroupBlock key={card.group.id} card={card} open={openGroupId === card.group.id}
            onToggle={() => setOpenGroupId(current => current === card.group.id ? null : card.group.id)}
            customers={openGroupId === card.group.id ? customersForGroup(card.group.id) : []}
            expandedLoans={expandedLoans} toggleLoan={toggleLoan} go={go} />)}
    </div>
  </div>;
}

function GroupBlock({ card, open, onToggle, customers, expandedLoans, toggleLoan, go }) {
  const panelId = `cwr-group-${card.group.id}`;
  return <section className={`cwr-card cwr-group ${open ? "open" : ""}`}>
    <button type="button" className="cwr-group-head" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
      <div><h2>{card.group.name}</h2><span>Members: {card.members} · Loans: {card.loans}</span></div>
      <dl>
        <div><dt>Total</dt><dd>{money(card.total)}</dd></div>
        <div><dt>Collected</dt><dd className="collected">{money(card.collected)}</dd></div>
        <div><dt>Pending</dt><dd className="pending">{money(card.pending)}</dd></div>
      </dl>
      <span className="cwr-group-arrow" aria-hidden="true"><Icon name="down" /></span>
    </button>
    <div className="cwr-group-panel" id={panelId} role="region" aria-label={`${card.group.name} customers`}>
      <div className="cwr-group-panel-inner">
        {open && customers.map(row => <GroupCustomerBlock key={row.customer.id} row={row} expandedLoans={expandedLoans} toggleLoan={toggleLoan} go={go} />)}
        {open && !customers.length && <p className="cwr-empty">No customers match the selected filters in this group.</p>}
      </div>
    </div>
  </section>;
}

function GroupCustomerBlock({ row, expandedLoans, toggleLoan, go }) {
  const collected = row.loans.reduce((sum, loan) => sum + num(loan.total_paid), 0);
  const pending = row.loans.reduce((sum, loan) => sum + num(loan.remaining), 0);
  const count = row.loans.length;
  return <div className="cwr-group-customer">
    <div className="cwr-group-customer-head">
      <div>
        <h3><button type="button" className="cwr-customer-name-link" onClick={() => go(`/reports/customer/${row.customer.id}`)}>{row.customer.name}</button> <em>· {count} {count === 1 ? "Loan" : "Loans"}</em></h3>
        <span>{[row.customer.code, row.customer.phone].filter(Boolean).join(" · ")}</span>
      </div>
      <dl><div><dt>Collected</dt><dd className="collected">{money(collected)}</dd></div><div><dt>Pending</dt><dd className="pending">{money(pending)}</dd></div></dl>
    </div>
    <LoanTable loans={row.loans} expanded={expandedLoans} toggle={toggleLoan} />
  </div>;
}

function Status({ value }) { return <span className={`cwr-status ${typeKey(value)}`}>{value}</span>; }

const CHIT_COLUMNS = [["Doc No"], ["Chit Group"], ["Chit Amount", "num"], ["Start Date"], ["End Date"], ["Collection Date"], ["Total Inst.", "inst"], ["Paid Inst.", "inst"], ["Pending Inst.", "inst"], ["Total Paid", "num"], ["Remaining", "num"], ["Status"]];

function chitCells(loan) {
  const doc = <b className="cwr-doc">{loan.doc_no}</b>;
  return [doc, loan.chit?.group_name || "—", money(loan.chit?.chit_amount ?? loan.loan_amount), dateLabel(loan.start_date), dateLabel(loan.end_date), dateLabel(loan.collection_date), loan.total_installments, loan.paid_installments, loan.pending_installments, money(loan.total_paid), money(loan.remaining), <Status value={loan.status} />];
}

function LoanTable({ loans, expanded, toggle }) {
  return <div className="cwr-type chit">
    <div className="cwr-table-wrap"><table className="cwr-table">
      <thead><tr>{CHIT_COLUMNS.map(([label, align]) => <th key={label} className={align}>{label}</th>)}<th aria-label="Schedule details" /></tr></thead>
      <tbody>{loans.map(loan => { const open = expanded.has(loan.id); return <Fragment key={loan.id}>
        <tr className={open ? "open" : ""}>{chitCells(loan).map((value, index) => <td key={index} className={CHIT_COLUMNS[index][1]}>{value}</td>)}
          <td className="cwr-expand-cell"><button type="button" aria-expanded={open} onClick={() => toggle(loan.id)}>Schedule<Icon name="down" /></button></td></tr>
        {open && <tr className="cwr-detail-row"><td colSpan={CHIT_COLUMNS.length + 1}><SchedulePreview loan={loan} /></td></tr>}
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
    {loan.payments?.length > 0 && <>
      <p className="cwr-detail-summary" style={{ marginTop: 10 }}><b>{loan.payments.length} Payments</b><span className="paid">Paid {money(loan.total_paid)}</span></p>
      <table className="cwr-mini"><thead><tr><th>S.No</th><th>Payment Date</th><th>Inst. No</th><th className="num">Amount</th><th>Mode</th><th>Reference</th></tr></thead>
        <tbody>{loan.payments.map((row, index) => <tr key={index} className="is-paid"><td>{index + 1}</td><td>{dateLabel(row.date)}</td><td>{row.installment_number}</td><td className="num">{money(row.amount)}</td><td>{row.payment_mode || "—"}</td><td>{row.reference_no || "—"}</td></tr>)}</tbody></table>
    </>}
  </div>;
}
