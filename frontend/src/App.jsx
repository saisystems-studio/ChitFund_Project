import BankTransferForm from "./pages/bankTransfers/BankTransferForm";
import BankTransferHistory from "./pages/bankTransfers/BankTransferHistory";
import { SessionProvider, useSession } from "./components/SessionContext";
import TransactionList from "./pages/collections/TransactionList";
import LedgerMaster from "./pages/masters/LedgerMaster";
import GroupMaster from "./pages/masters/GroupMaster";
import StaffMaster from "./pages/masters/StaffMaster";
import PaymentEntry from "./pages/collections/PaymentEntry";
import MortgageReport from "./pages/modules/MortgageReport";
import CustomerReportDetail from "./pages/modules/CustomerReportDetail";
import CompletedLoans from "./pages/loans/CompletedLoans";
import GroupWiseReport from "./pages/modules/GroupWiseReport";
import LedgerStatement from "./pages/modules/LedgerStatement";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import axios from "axios";
import Login from "./pages/auth/Login";
import CustomerFormStepper from "./pages/customers/CustomerFormStepper";
import { CustomerEdit } from "./pages/customers/CustomerEdit";
import { KycDocumentsModal, KycDocumentsSection } from "./components/KycDocuments/KycDocuments";
import ChitLoanForm from "./pages/loans/ChitLoanForm";
import { CollectionEntryPage } from "./pages/collections/CollectionEntry";
import CollectionEntry from "./pages/collections/CollectionEntryTabs";
import CollectionDashboard from "./pages/collections/CollectionEntryPage";
import TodayCollectionReport from "./pages/collections/CollectionDashboard";
import ActiveLoans from "./pages/loans/ActiveLoans";
import Sidebar from "./components/Sidebar/Sidebar";
import ChitGroupList from "./pages/masters/chitGroup/ChitGroupList";
import ChitGroupForm from "./pages/masters/chitGroup/ChitGroupForm";
import { DirectListPage, ReportPage } from "./pages/modules/ModulePages";
import AddHoliday from "./pages/holidays/AddHoliday";
import HolidayList from "./pages/holidays/HolidayList";
import CollectionReport from "./pages/modules/CollectionReport";
import WorkInProgress from "./pages/modules/WorkInProgress";
import TrialBalanceReport from "./pages/modules/TrialBalanceReport";
import ProfitAndLossReport from "./pages/modules/ProfitAndLossReport";
import BalanceSheetReport from "./pages/modules/BalanceSheetReport";
import PartyCollectionReport from "./pages/modules/PartyCollectionReport";
import JournalEntry from "./pages/journal/JournalEntry";
import JournalList from "./pages/journal/JournalList";
import LoanTypeSetup from "./pages/masters/LoanTypeSetup";
import MortgageMaster from "./pages/masters/MortgageMaster";
import { CompanyLogo, useCompanyProfile } from "./components/CompanyProfileContext";
import ListExport, { exportFiltersLine } from "./components/ListExport/ListExport";
import "./styles/required-fields.css";
import "./styles/customer-actions.css";
import "./styles/customer-details-drawer.css";
import "./styles/customer-list-task.css";
import "./styles.css";
import "./styles/admin.css";
import "./styles/customer-shell.css";
import "./styles/list-page.css";
import "./styles/dashboard.css";
import "./styles/dashboard-header-alignment.css";
import "./styles/sidebar-toggle.css";
import "./styles/sidebar-collapsed-fix.css";
import "./styles/sidebar-admin-menu.css";
import "./styles/sidebar-flyout.css";
import "./styles/navigation-scroll.css";
import "./styles/table-density.css";
import "./styles/numeric-input.css";
import "./styles/page-header-sidebar.css";
import "./styles/data-page.css";
import ListPageToolbar from "./components/ListPageToolbar";
import { useGroupTree } from "./components/ListFilters/ListFilters";
import useFormKeyboardNavigation from "./hooks/useFormKeyboardNavigation";
import { formatINR } from "./utils/currency";
import confirmDelete from "./utils/confirmDelete";
import { actionToast } from "./utils/actionToast";
import apiErrorMessage from "./utils/apiErrorMessage";
import RowActions from "./components/RowActions";
import PageBreadcrumb from "./components/PageBreadcrumb";
import { initHistoryIndex, pushRoute, setNavigator } from "./utils/navigation";
import ReportDetailPage, { REPORT_DETAIL_CHANGED } from "./pages/reportDetail/ReportDetailPage";
import { parseDetailRoute } from "./pages/reportDetail/reportDetailRoute";
import PendingOutstandingReport from "./pages/modules/PendingOutstandingReport";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api" });
const readSession = () => { try { return JSON.parse(localStorage.getItem("finance_session") || "null"); } catch { localStorage.removeItem("finance_session"); return null; } };
const clearAuth = () => {
  localStorage.removeItem("finance_session");
  localStorage.removeItem("finance_last_activity");
};

export default function App() {
  useEffect(() => {
    const normalizeRoleLabels = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) nodes.push(node);
      nodes.forEach(textNode => {
        if (textNode.parentElement?.closest("script,style")) return;
        const normalized = textNode.nodeValue.replace(/\bBorrowers\b/g, "Debtors").replace(/\bLenders\b/g, "Creditors").replace(/\bBorrower\b/g, "Debtor").replace(/\bLender\b/g, "Creditor");
        if (normalized !== textNode.nodeValue) textNode.nodeValue = normalized;
      });
    };
    normalizeRoleLabels();
    const observer = new MutationObserver(normalizeRoleLabels);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const stopNumberWheelChange = event => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "number" && document.activeElement === target) target.blur();
    };
    const blockNumberShortcuts = event => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "number" && ["e", "E", "+", "-"].includes(event.key)) event.preventDefault();
    };
    document.addEventListener("wheel", stopNumberWheelChange, { passive: true });
    document.addEventListener("keydown", blockNumberShortcuts);
    return () => { document.removeEventListener("wheel", stopNumberWheelChange); document.removeEventListener("keydown", blockNumberShortcuts); };
  }, []);
  const [session, setSession] = useState(readSession);
const logout = () => { clearAuth(); window.history.replaceState({}, "", "/chitfund/login"); setSession(null); };
const login = data => { localStorage.setItem("finance_session", JSON.stringify(data)); localStorage.setItem("finance_last_activity", String(Date.now())); window.history.replaceState({}, "", "/chitfund/dashboard"); setSession(data); };
  useEffect(() => {
if (!session?.token) { if (window.location.pathname !== "/chitfund/login") window.history.replaceState({}, "", "/chitfund/login"); return; }
    let active = true;
    api.get("/auth/me/", { headers: { Authorization: `Token ${session.token}` } }).catch(() => active && logout());
    return () => { active = false; };
  }, [session?.token]);
  if (!session) return <Login onLogin={login} />;
  return <Shell session={session} onLogout={logout} />;
}
function Shell({session,onLogout}) {
  useFormKeyboardNavigation();
  const [theme, setTheme] = useState(() => localStorage.getItem("finance_theme") || "light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("finance_sidebar_collapsed") === "true");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Shell layout: desktop (>=1024) keeps the user-controlled sidebar; tablet (768-1023)
  // shows the icon rail and opens the full menu as an overlay drawer; mobile (<768)
  // hides the sidebar behind a hamburger top bar.
  const layoutFor = () => window.matchMedia("(max-width: 767px)").matches ? "mobile" : window.matchMedia("(max-width: 1023px)").matches ? "tablet" : "desktop";
  const [layout, setLayout] = useState(layoutFor);
  const isMobile = layout === "mobile";
  const isCompact = layout !== "desktop";
  useEffect(() => {
    const timeout = 60 * 60 * 1000;
    let timer;
    const expire = () => onLogout();
    const schedule = () => {
      const last = Number(localStorage.getItem("finance_last_activity")) || Date.now();
      const remaining = timeout - (Date.now() - last);
      if (remaining <= 0) expire(); else { clearTimeout(timer); timer = window.setTimeout(expire, remaining); }
    };
    const activity = () => { localStorage.setItem("finance_last_activity", String(Date.now())); schedule(); };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    if (!localStorage.getItem("finance_last_activity")) localStorage.setItem("finance_last_activity", String(Date.now()));
    schedule(); events.forEach(event => window.addEventListener(event, activity, { passive: true }));
    return () => { clearTimeout(timer); events.forEach(event => window.removeEventListener(event, activity)); };
  }, [onLogout]);
  useEffect(() => { const queries = ["(max-width: 767px)", "(max-width: 1023px)"].map(q => window.matchMedia(q)); const update = () => setLayout(layoutFor()); update(); queries.forEach(q => q.addEventListener?.("change", update)); return () => queries.forEach(q => q.removeEventListener?.("change", update)); }, []);
  useEffect(() => { setMobileMenuOpen(false); }, [layout]);
  useEffect(() => { if (!mobileMenuOpen) return undefined; const close = event => { if (event.key === "Escape") setMobileMenuOpen(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [mobileMenuOpen]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("finance_theme", theme); }, [theme]);
  useEffect(() => {
    const interceptor = api.interceptors.response.use(response => response, error => {
      if (error.response?.status === 401) onLogout();
      else if (error.response?.status === 403) actionToast(apiErrorMessage(error, "You don't have permission to do that."), false);
      return Promise.reject(error);
    });
    return () => api.interceptors.response.eject(interceptor);
  }, [onLogout]);
  useEffect(() => { const normalizeDeleteLabels = () => document.querySelectorAll('[title="Delete"],[aria-label="Delete"]').forEach(button => { if (button.title === "Deactivate") button.title = "Delete"; if (button.getAttribute("aria-label") === "Deactivate") button.setAttribute("aria-label", "Delete"); }); normalizeDeleteLabels(); const observer = new MutationObserver(normalizeDeleteLabels); observer.observe(document.body, { childList: true, subtree: true }); return () => observer.disconnect(); }, []);

const BASE_PATH = "/chitfund";

const getRoute = () => {
  const pathname = window.location.pathname;
  const route = pathname.startsWith(BASE_PATH)
    ? pathname.slice(BASE_PATH.length)
    : pathname;

  return route || "/dashboard";
};

const [route, setRoute] = useState(getRoute);
// The report a details page was opened from stays mounted (hidden) so its filters, search, sorting, pagination and scroll are exactly as left.
const lastReport = useRef(null), mainRef = useRef(null), savedScroll = useRef(0);
useEffect(() => { const stale = () => { lastReport.current = null; }; window.addEventListener(REPORT_DETAIL_CHANGED, stale); return () => window.removeEventListener(REPORT_DETAIL_CHANGED, stale); }, []);

const go = p => {
  if (mainRef.current && !parseDetailRoute(window.location.pathname.replace(BASE_PATH, ""))) savedScroll.current = mainRef.current.scrollTop;
  pushRoute(p);
  setRoute(p);
};
setNavigator(go);

useEffect(() => {
  initHistoryIndex();
  const fn = () => setRoute(getRoute());
  window.addEventListener("popstate", fn);
  return () => window.removeEventListener("popstate", fn);
}, []);
  const auth = { headers:{ Authorization:`Token ${session.token}` } };
  const customerId=route.match(/^\/customers\/([^/]+)(?:\/edit)?$/)?.[1];
  const loanEditId = route.match(/^\/loan-application\/(\d+)\/edit$/)?.[1];
  const chitGroupEditId = route.match(/^\/chit-groups\/(\d+)\/edit$/)?.[1];
  const customerReportId = route.match(/^\/reports\/customer\/(\d+)$/)?.[1];
  const reportView = route === "/reports/collections/outstanding" || route === "/outstanding-report" ? "outstanding" : route === "/reports/collections/history" || route === "/collection-history" ? "history" : "pending";
  const page = route === "/bank-deposit-transaction" ? <BankTransferForm api={api} auth={auth} go={go}/> : route === "/bank-deposit-history" ? <BankTransferHistory api={api} auth={auth} go={go}/> : ["/loan-list", "/collection-list", "/payment-list"].includes(route) ? <TransactionList key={route} api={api} auth={auth} go={go} kind={route.slice(1).replace("-list", "")}/> : route === "/ledgers/list" ? <LedgerMaster api={api} auth={auth} go={go} view="list"/> : route === "/ledgers" ? <LedgerMaster api={api} auth={auth} go={go}/> : route === "/groups/list" ? <GroupMaster api={api} auth={auth} go={go} view="list"/> : route === "/groups" ? <GroupMaster api={api} auth={auth} go={go}/> : route === "/staff/list" ? <StaffMaster api={api} auth={auth} go={go} view="list"/> : route === "/staff" ? <StaffMaster api={api} auth={auth} go={go}/> : route === "/payment-entry" ? <PaymentEntry api={api} auth={auth} go={go}/> : route === "/reports/mortgage" ? <MortgageReport api={api} auth={auth} go={go}/> : route === "/reports/customer" ? <CustomerReportDetail key="all" api={api} auth={auth} go={go}/> : customerReportId ? <CustomerReportDetail key={customerReportId} api={api} auth={auth} go={go} id={customerReportId}/> : route === "/reports/completed-loans" ? <CompletedLoans api={api} auth={auth} go={go}/> : route === "/reports/group-wise" ? <GroupWiseReport api={api} auth={auth} go={go}/> : route === "/masters" ? <MastersRoot go={go}/> : route === "/loan-types" ? <><DashboardModern api={api} auth={auth} go={go}/><LoanTypeSetup api={api} auth={auth} go={go}/></> : route === "/mortgage-master" || route === "/mortgage-master/new" ? <MortgageMaster key={route} api={api} auth={auth} go={go} openAdd={route === "/mortgage-master/new"}/> : route === "/dashboard" ? <DashboardModern api={api} auth={auth} go={go}/> : route === "/reports/daily" ? <WorkInProgress title="Daily Report" go={go}/> : route === "/reports/trial-balance" ? <TrialBalanceReport api={api} auth={auth} go={go}/> : route === "/reports/balance-sheet" ? <BalanceSheetReport api={api} auth={auth} go={go}/> : route === "/reports/profit-loss" ? <ProfitAndLossReport api={api} auth={auth} go={go}/> : route === "/journal-entry" ? <JournalEntry key="new-journal" api={api} auth={auth} go={go}/> : route === "/journal-list" ? <JournalList api={api} auth={auth} go={go}/> : route === "/reports/ledger-statement" ? <LedgerStatement key="ledger" api={api} auth={auth} go={go} kind="ledger"/> : route === "/reports/party-collection" ? <PartyCollectionReport api={api} auth={auth} go={go}/> : route === "/reports/cash-balance" ? <LedgerStatement api={api} auth={auth} go={go} kind="cash"/> : route === "/reports/bank-balance" ? <LedgerStatement api={api} auth={auth} go={go} kind="bank"/> : route === "/customers/new" ? <CustomerForm api={api} auth={auth} go={go}/> : loanEditId ? <ChitLoanForm key={loanEditId} api={api} auth={auth} go={go} id={loanEditId}/> : route === "/loan-application" ? <ChitLoanForm key="new-loan" api={api} auth={auth} go={go}/> : route === "/chit-groups" ? <ChitGroupList api={api} auth={auth} go={go}/> : route === "/chit-groups/new" || chitGroupEditId ? <ChitGroupForm key={chitGroupEditId || "new-group"} api={api} auth={auth} go={go} id={chitGroupEditId}/> : route === "/collection-types" ? <DirectListPage api={api} auth={auth} go={go} kind="collectionTypes"/> : route === "/holiday-master" ? <AddHoliday api={api} auth={auth} go={go}/> : route === "/holiday-list" ? <HolidayList api={api} auth={auth} go={go}/> : route === "/active-loans" ? <ActiveLoans api={api} auth={auth} go={go}/> : route === "/today-collection" ? <CollectionDashboard api={api} auth={auth} go={go}/> : route === "/reports/collections/pending" || route === "/pending-collection" ? <PendingOutstandingReport api={api} auth={auth} go={go}/> : route === "/reports/today-collection" ? <TodayCollectionReport api={api} auth={auth} go={go}/> :route === "/collection-entry" ? <CollectionEntry api={api} auth={auth} go={go}/> : route === "/collection-report" || route === "/pending-collection" || route === "/outstanding-report" || route === "/collection-history" || route.startsWith("/reports/collections/") ? <CollectionReport api={api} auth={auth} go={go} initialView={reportView}/> : route.endsWith("/edit")&&customerId ? <CustomerEdit api={api} auth={auth} go={go} id={customerId}/> : customerId ? <CustomersEnhanced api={api} auth={auth} go={go} openId={customerId}/> : route.startsWith("/customers") ? <CustomersEnhanced api={api} auth={auth} go={go}/> : <DashboardModern api={api} auth={auth} go={go}/>;
  const detailRoute = parseDetailRoute(route);
  if (!detailRoute) lastReport.current = page;
  const detailOpen = Boolean(detailRoute);
  useLayoutEffect(() => { const main = mainRef.current; if (!main) return; if (detailOpen) { main.scrollTop = 0; } else { main.scrollTop = savedScroll.current; } }, [detailOpen]);
  const updateUser = user => { const next = { ...session, user }; localStorage.setItem("finance_session", JSON.stringify(next)); };
  const toggleSidebar = () => setSidebarCollapsed(value => { const next = !value; localStorage.setItem("finance_sidebar_collapsed", String(next)); return next; });
  const railCollapsed = isCompact ? !mobileMenuOpen : sidebarCollapsed;
  return <SessionProvider user={session.user}><div className={`app-shell layout-${layout} ${railCollapsed ? "sidebar-collapsed" : ""} ${isCompact && mobileMenuOpen ? "mobile-sidebar-open" : ""}`}><Sidebar route={route} go={go} user={session.user} token={session.token} onLogout={onLogout} theme={theme} onToggleTheme={() => setTheme(value => value === "dark" ? "light" : "dark")} onUserUpdate={updateUser} collapsed={railCollapsed} onToggleCollapse={toggleSidebar} mobile={isCompact} mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} onMobileOpen={() => setMobileMenuOpen(true)}/><main ref={mainRef} className={`main-content ${route === "/collection-entry" ? "collection-page-scroll" : ""} ${detailOpen ? "rd-detail-open" : ""}`.trim()}>{isMobile && <MobileTopBar open={mobileMenuOpen} onMenu={() => setMobileMenuOpen(true)} onHome={() => go("/dashboard")}/>}{detailRoute ? lastReport.current : page}{detailRoute && <ReportDetailPage key={route} api={api} auth={auth} go={go} kind={detailRoute.kind} id={detailRoute.id} params={detailRoute.params}/>}</main></div></SessionProvider>;
}
function MobileTopBar({ open, onMenu, onHome }) {
  const { profile } = useCompanyProfile();
  return <div className="mobile-topbar"><button type="button" className="mobile-topbar-menu" onClick={onMenu} aria-label="Open menu" aria-expanded={open}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><button type="button" className="mobile-topbar-brand" onClick={onHome}><span className="mobile-topbar-logo"><CompanyLogo /></span><strong>{profile.company_name || "Finance Collection"}</strong></button></div>;
}
function Header({eyebrow="OPERATIONS",title,children}) { return <header><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><div className="header-actions">{children}</div></header>; }
const asRows = data => data?.results ?? data ?? [];
const amount = value => Number(value || 0);
const money = formatINR;
const isoDate = date => { const value = new Date(date); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; };
const dashboardGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning, Admin";
  if (hour >= 12 && hour < 17) return "Good afternoon, Admin";
  if (hour >= 17) return "Good evening, Admin";
  return "Good night, Admin";
};
const dueValue = row => amount(row.principal_due) + amount(row.normal_interest_due) + amount(row.compound_interest_due) + amount(row.penalty_due);

function DashboardModern({ api, auth, go }) {
  const today = isoDate(new Date());
  const [period, setPeriod] = useState("week");
  const [data, setData] = useState({ customers: [], loans: [], schedules: [], payments: [] });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.allSettled([
      api.get("/customers/", { ...auth, params: { page_size: 1000 } }),
      api.get("/finance/loans/", { ...auth, params: { page_size: 1000 } }),
      api.get("/finance/due-schedules/", { ...auth, params: { page_size: 1000 } }),
      api.get("/finance/payments/", { ...auth, params: { page_size: 1000 } }),
    ]).then(results => {
      if (!active) return;
      const names = ["customers", "loans", "schedules", "payments"];
      setData(results.reduce((all, result, index) => ({ ...all, [names[index]]: result.status === "fulfilled" ? asRows(result.value.data) : [] }), {}));
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const activeLoans = data.loans.filter(item => item.status === "ACTIVE");
  const todayPayments = data.payments.filter(item => item.payment_date === today && item.status !== "VOID");
  const todaySchedules = data.schedules.filter(item => item.due_date === today && item.status !== "PAID");
  const expectedToday = todaySchedules.reduce((sum, row) => sum + dueValue(row), 0);
  const collectedToday = todayPayments.reduce((sum, row) => sum + amount(row.amount), 0);
  const pendingToday = Math.max(0, expectedToday - collectedToday);
  const overdue = data.schedules.filter(item => item.due_date < today && item.status !== "PAID");
  const upcoming = data.schedules.filter(item => item.due_date > today && item.due_date <= isoDate(new Date(Date.now() + 7 * 86400000)) && item.status !== "PAID");
  const rate = expectedToday ? Math.min(100, Math.round(collectedToday / expectedToday * 100)) : 0;
  const recent = [...data.payments].sort((a, b) => `${b.payment_date}${b.created_at || ""}`.localeCompare(`${a.payment_date}${a.created_at || ""}`)).slice(0, 5);
  const periodDays = period === "year" ? 12 : period === "month" ? 30 : 7;
  const labels = period === "year" ? Array.from({ length: 12 }, (_, i) => new Date(new Date().getFullYear(), i, 1).toLocaleString("en-IN", { month: "short" })) : Array.from({ length: periodDays }, (_, i) => { const d = new Date(Date.now() - (periodDays - 1 - i) * 86400000); return d.toLocaleString("en-IN", { weekday: "short" }); });
  const trend = labels.map((label, index) => { const target = new Date(); if (period === "year") target.setMonth(index, 1); else target.setDate(target.getDate() - (periodDays - 1 - index)); const key = isoDate(target); return { label, collected: data.payments.filter(item => item.payment_date === key).reduce((sum, item) => sum + amount(item.amount), 0), expected: data.schedules.filter(item => item.due_date === key).reduce((sum, item) => sum + dueValue(item), 0) }; });
  const maxTrend = Math.max(1, ...trend.flatMap(item => [item.collected, item.expected]));
  const customerRoles = ["LENDER", "BORROWER", "BOTH"].map(role => ({ role, count: data.customers.filter(item => item.role === role).length }));
  const customersById = new Map(data.customers.map(item => [item.id, item.full_name]));
  const loansById = new Map(data.loans.map(item => [item.id, item.number]));
  const countAndAmount = rows => `${rows.length} ${rows.length === 1 ? "collection" : "collections"} · ${money(rows.reduce((sum, row) => sum + dueValue(row), 0))}`;
  return <div className="dashboard-page"><header className="dashboard-header"><div className="dashboard-header-left"><PageBreadcrumb current="Dashboard" /></div><div className="dashboard-header-right"><strong className="dashboard-greeting">{dashboardGreeting()}</strong><span className="dashboard-subtitle">Here's today's finance collection overview.</span><span>{new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div></header>
    <section className="dashboard-kpis"><Kpi label="Total Customers" value={loading ? "—" : data.customers.length} detail="Active customer records" tone="blue"/><Kpi label="Active Loans" value={loading ? "—" : activeLoans.length} detail={`${money(activeLoans.reduce((sum, item) => sum + amount(item.approved_principal), 0))} principal`} tone="navy"/><Kpi label="Today's Collection" value={money(collectedToday)} detail={`${todayPayments.length} collections recorded`} tone="green"/><Kpi label="Pending Amount" value={money(pendingToday)} detail={`${todaySchedules.length} collections due today`} tone="orange"/></section>
    <section className="dashboard-overview"><div className="dashboard-chart-card"><div className="dashboard-section-head"><div><p className="eyebrow">COLLECTION OVERVIEW</p><h2>Expected vs collected</h2></div><select value={period} onChange={event => setPeriod(event.target.value)}><option value="week">This Week</option><option value="month">This Month</option><option value="year">This Year</option></select></div><div className="chart-legend"><span><i className="legend-expected"/>Expected</span><span><i className="legend-collected"/>Collected</span></div><div className="trend-chart">{trend.map(item => <div className="trend-column" key={item.label}><div className="trend-bars"><span className="trend-expected" style={{ height: `${Math.max(3, item.expected / maxTrend * 100)}%` }} title={`Expected ${money(item.expected)}`}/><span className="trend-collected" style={{ height: `${Math.max(3, item.collected / maxTrend * 100)}%` }} title={`Collected ${money(item.collected)}`}/></div><small>{item.label}</small></div>)}</div>{!data.schedules.length && !data.payments.length && <p className="chart-empty">No collection activity for this period</p>}</div><div className="dashboard-summary"><p className="eyebrow">TODAY'S SUMMARY</p><h2>Collection health</h2><SummaryLine label="Expected" value={money(expectedToday)}/><SummaryLine label="Collected" value={money(collectedToday)}/><SummaryLine label="Pending" value={money(pendingToday)}/><div className="rate-row"><span>Collection Rate</span><strong>{rate}%</strong></div><div className="progress"><span style={{ width: `${rate}%` }}/></div><button className="text-action" onClick={() => go("/collection-entry")}>Record Collection →</button></div></section>
    <section className="dashboard-section"><div className="dashboard-section-title"><p className="eyebrow">ATTENTION REQUIRED</p></div><div className="attention-grid"><Attention title="Overdue Collections" value={countAndAmount(overdue)} action="View Pending →" tone="danger" onClick={() => go("/pending-collection")}/><Attention title="Due Today" value={`${todaySchedules.length} collections · ${money(expectedToday)} expected`} action="Record Collection →" tone="warning" onClick={() => go("/collection-entry")}/><Attention title="Upcoming" value={`${upcoming.length} collections · ${money(upcoming.reduce((sum, row) => sum + dueValue(row), 0))} expected`} action="View Schedule →" tone="blue" onClick={() => go("/active-loans")}/></div></section>
    <section className="dashboard-recent"><div className="dashboard-section-head"><div><p className="eyebrow">RECENT COLLECTIONS</p><h2>Latest payments</h2></div><button className="text-action" onClick={() => go("/collection-history")}>View All Collections →</button></div><div className="dashboard-table-wrap"><table><thead><tr><th>S.No</th><th>Customer</th><th>Loan No</th><th>Collection Date</th><th>Amount</th><th>Collection Type</th><th>Status</th></tr></thead><tbody>{recent.map((item, index) => <tr key={item.id}><td>{String(index + 1).padStart(2, "0")}</td><td>{customersById.get(item.party) || item.party || "—"}</td><td>{loansById.get(item.loan) || item.loan || "—"}</td><td>{item.payment_date || "—"}</td><td>{money(item.amount)}</td><td>{item.mode || "—"}</td><td><span className="dashboard-status">{item.status || "Posted"}</span></td></tr>)}</tbody></table>{!recent.length && <div className="dashboard-empty">No collections recorded yet.</div>}</div></section>
    <section className="dashboard-breakdown"><div><p className="eyebrow">CUSTOMER BREAKDOWN</p><h2>Portfolio mix</h2></div>{customerRoles.map(item => <span key={item.role}><b>{item.count}</b>{item.role.charAt(0) + item.role.slice(1).toLowerCase()}s</span>)}</section>
  </div>;
}
function Kpi({ label, value, detail, tone }) { return <article className={`dashboard-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function SummaryLine({ label, value }) { return <div className="summary-line"><span>{label}</span><strong>{value}</strong></div>; }
function Attention({ title, value, action, tone, onClick }) { return <article className={`attention-card ${tone}`}><span className="attention-dot"/><div><h3>{title}</h3><p>{value}</p></div><button onClick={onClick}>{action}</button></article>; }

function Dashboard({api,auth,go}) { const [stats,setStats]=useState({}); useEffect(()=>{api.get("/customers/dashboard/",auth).then(r=>setStats(r.data)).catch(()=>{});},[]); return <><Header eyebrow="OPERATIONS / OVERVIEW" title="Dashboard"><button className="primary" onClick={()=>go("/customers/new")}>+ Add customer</button></Header><section className="cards"><Card label="Total customers" value={stats.total_customers??0}/><Card label="Lenders" value={stats.lenders??0}/><Card label="Borrowers" value={stats.borrowers??0}/><Card label="Both roles" value={stats.both_roles??0}/></section><section className="panel welcome"><p className="eyebrow">PORTFOLIO CONTROL</p><h2>Good morning. Your finance workspace is ready.</h2><p>Use the sidebar to manage customers, loans, collections, reports and finance operations. Dashboard contains summaries only.</p><div className="quick-actions"><button onClick={()=>go("/customers")}>View customers</button><button onClick={()=>go("/active-loans")}>View loans</button><button onClick={()=>go("/collection-entry")}>Record collection</button></div></section></>; }
function Customers({api,auth,go}) { const [items,setItems]=useState([]),[search,setSearch]=useState(""); const load=()=>api.get("/customers/",{...auth,params:{search,ordering:"full_name"}}).then(r=>setItems(r.data.results??r.data)); useEffect(()=>{load()},[search]); return <><Header eyebrow="CUSTOMERS" title="Customer List"><button className="primary" onClick={()=>go("/customers/new")}>+ Add customer</button></Header><section className="panel"><div className="panel-head"><div><p className="eyebrow">CUSTOMER MASTER</p><h2>All customers</h2></div><input className="search" placeholder="Search by name, code or phone" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="table-wrap"><table><thead><tr><th>Code</th><th>Customer</th><th>Phone</th><th>Type</th><th>Status</th><th/></tr></thead><tbody>{items.map(c=><tr key={c.id}><td className="mono">{c.customer_code}</td><td><strong>{c.full_name}</strong><small>{c.email||"No email"}</small></td><td>{c.primary_mobile}</td><td><span className={`badge ${c.role.toLowerCase()}`}>{c.role_display||c.role}</span></td><td><span className="status"><i/> {c.is_active?"Active":"Inactive"}</span></td><td><button className="link-btn" onClick={()=>go(`/customers/${c.id}`)}>View</button></td></tr>)}</tbody></table>{!items.length&&<div className="empty">No customers found.</div>}</div></section></>; }
function CustomersEnhanced({api,auth,go}) { const [items,setItems]=useState([]),[search,setSearch]=useState(""),[toast,setToast]=useState(""); const load=()=>api.get("/customers/",{...auth,params:{search,ordering:"full_name"}}).then(r=>setItems(r.data.results??r.data)); useEffect(()=>{load()},[search]); const deactivate=async id=>{if(!window.confirm("Deactivate this customer?"))return;try{await api.delete(`/customers/${id}/`,auth);setToast("Customer deactivated successfully.");load();setTimeout(()=>setToast(""),500)}catch{setToast("Unable to deactivate customer.")}};return <><ListPageToolbar eyebrow="CUSTOMERS" title="Customer List" search={search} onSearch={setSearch} placeholder="Search customer..." action={<button className="primary" onClick={()=>go("/customers/new")}>+ Add Customer</button>}/>{toast&&<div className="toast">{toast}</div>}<section className="panel list-container"><div className="table-wrap"><table><thead><tr><th>S.No</th><th>Customer Code</th><th>Customer</th><th>Phone</th><th>Type</th><th>Status</th><th aria-label="row actions"/></tr></thead><tbody>{items.map((c,i)=><tr className="customer-row" tabIndex="0" key={c.id}><td>{i+1}</td><td className="mono">{c.customer_code}</td><td><strong>{c.full_name}</strong><small>{c.email||"No email"}</small></td><td>{c.primary_mobile}</td><td><span className={`badge ${c.role.toLowerCase()}`}>{c.role_display||c.role}</span></td><td><span className="status"><i/> {c.is_active?"Active":"Inactive"}</span></td><td><div className="row-actions"><button title="View" onClick={()=>go(`/customers/${c.id}`)}>◉</button><button title="Edit" onClick={()=>go(`/customers/${c.id}/edit`)}>✎</button><button title="Delete" onClick={()=>deactivate(c.id)}>⌫</button></div></td></tr>)}</tbody></table>{!items.length&&<div className="empty">No customers found.</div>}</div></section></> }
function CustomerForm({api,auth,go}) { return <CustomerFormStepper api={api} auth={auth} go={go}/>; }
function LoanSection({form,set}) { return <section className="panel"><div className="section-title"><span>02</span><div><p className="eyebrow">BORROWER ACCOUNT</p><h2>Loan Information</h2></div></div><div className="form-grid">{[["quoted_amount","Quoted / Requested Amount *"],["approved_amount","Approved Loan Amount"],["loan_type","Loan Type *","select",true],["flat_rate","Flat Interest Rate *"],["compound_rate","Compound Interest Rate"],["grace_days","Grace Period Days"],["start_date","Loan Start Date","date"],["collection_start_date","Collection Start Date","date"],["total_cycles","Number of Collection Cycles"],["penalty_type","Penalty Type"],["penalty_value","Penalty Value"]].map(([k,l,t,req])=><Field key={k} label={l} type={t||"number"} value={form[k]} required={req} onChange={e=>set(k,e.target.value)} />)}</div><div className="dynamic"><p className="eyebrow">{form.loan_type.toUpperCase()} SCHEDULE</p><div className="form-grid">{form.loan_type==="Weekly"&&<Field label="Weekly Due Day *" type="select" value={form.weekly_day||"Wednesday"} onChange={e=>set("weekly_day",e.target.value)}/>} {form.loan_type==="Monthly"&&<><Field label="Monthly Due Date *"/><Field label="End-of-Month Rule *" type="select"/></>} {form.loan_type==="Annual"&&<><Field label="Annual Due Month *" type="select"/><Field label="Annual Collection Type" type="select"/></>} {(["Daily","100 Days"].includes(form.loan_type))&&<><Field label="Daily Collection Amount"/><label className="check"><input type="checkbox"/> Skip Sundays</label><label className="check"><input type="checkbox"/> Skip Holidays</label></>}</div></div></section>; }
function Field({label,type="text",options,...props}) { const required=label.endsWith(" *"); const baseLabel=required?label.slice(0,-2):label; const star=required?<> <span className="required-star">*</span></>:null; if(type==="textarea")return <label className="wide">{baseLabel}{star}<textarea {...props}/></label>; if(type==="select"){const values=options|| (baseLabel.includes("Loan Type")?loanTypes:baseLabel.includes("Due Day")?["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]:baseLabel.includes("Rule")?["Last Calendar Day","Previous Working Day","Next Working Day"]:baseLabel.includes("Collection Type")?["Interest Only","Principal + Interest","Full Settlement at Maturity"]:[]); return <label>{baseLabel}{star}<select {...props}><option value="">Select</option>{values.map(x=><option key={x} value={x}>{x}</option>)}</select></label>;} if(type==="status")return <label className="check"><input type="checkbox" {...props}/> Active</label>; return <label>{baseLabel}{star}<input type={type} {...props} readOnly={baseLabel.startsWith("Customer Code")}/></label>; }
function Loans({api,auth}) { const [items,setItems]=useState([]); useEffect(()=>{api.get("/finance/loans/",auth).then(r=>setItems(r.data.results??r.data)).catch(()=>{})},[]); return <><Header eyebrow="LOANS" title="Loan List"/><section className="panel"><div className="table-wrap"><table><thead><tr><th>Loan</th><th>Borrower</th><th>Principal</th><th>Frequency</th><th>Status</th></tr></thead><tbody>{items.map(x=><tr key={x.id}><td className="mono">{x.number}</td><td>{x.borrower}</td><td>{money(x.approved_principal)}</td><td>{x.collection_frequency}</td><td>{x.status}</td></tr>)}</tbody></table>{!items.length&&<div className="empty">No loans found.</div>}</div></section></>; }
function ModulePage({title}) { return <><Header eyebrow="FINANCE MODULE" title={title}/><section className="panel empty-state"><h2>{title}</h2><p>Use this module to manage records, filters and finance operations.</p><button className="primary">Create new</button></section></>; }
function Card({label,value}){return <div className="card"><span>{label}</span><strong>{value}</strong><small>Current records</small></div>}
function MastersRoot({go}){return <div className="page masters-root-page"><PageBreadcrumb current="Masters" /><header><p>Manage the setup records used across the application.</p></header><section className="cards"><button className="card" onClick={()=>go("/groups")}><span>Group</span><strong>Group setup</strong><small>Manage the account group hierarchy</small></button><button className="card" onClick={()=>go("/ledgers")}><span>Ledger</span><strong>Ledger setup</strong><small>Manage ledgers and opening balances</small></button><button className="card" onClick={()=>go("/customers/new")}><span>Add Customer</span><strong>Customer setup</strong><small>Create a customer record</small></button><button className="card" onClick={()=>go("/chit-groups")}><span>Chit Group</span><strong>Chit group setup</strong><small>Manage groups and schedules</small></button><button className="card" onClick={()=>go("/mortgage-master")}><span>Mortgage Master</span><strong>Mortgage products</strong><small>Manage product rates</small></button><button className="card" onClick={()=>go("/holiday-master")}><span>Holiday Master</span><strong>Holiday calendar</strong><small>Manage collection holidays</small></button><button className="card" onClick={()=>go("/loan-types")}><span>Loan Type</span><strong>Loan type setup</strong><small>Configure loan periods</small></button><button className="card" onClick={()=>go("/staff")}><span>Add Staff</span><strong>Staff setup</strong><small>Manage staff records</small></button></section></div>}

CustomersEnhanced = function CustomersEnhancedMobile({api,auth,go}) {
  const [items,setItems]=useState([]),[search,setSearch]=useState(""),[toast,setToast]=useState(""),[expanded,setExpanded]=useState(null);
  const load=()=>api.get("/customers/",{...auth,params:{search,ordering:"full_name"}}).then(r=>setItems(r.data.results??r.data));
  useEffect(()=>{load()},[search]);
  const deactivate=async id=>{if(!await confirmDelete("Are you sure you want to delete the record?"))return;try{await api.delete(`/customers/${id}/`,auth);setToast("🤑 Record deleted successfully.");load();setTimeout(()=>setToast(""),500)}catch{setToast("😓 Unable to delete this record.");setTimeout(()=>setToast(""),500)}};
  const details=c=>[["Customer Code",c.customer_code],["Email",c.email],["WhatsApp",c.whatsapp_number||c.whatsapp||c.primary_mobile],["Customer Type",c.role_display||c.role],["Price Type",c.price_type_display||c.price_type],["District",c.district],["State",c.state],["Country",c.country],["Pincode",c.pincode],["GST Customer",c.is_gst_customer==null?"—":c.is_gst_customer?"Yes":"No"],["GST No",c.gst_number]];
  return <><ListPageToolbar eyebrow="CUSTOMERS" title="Customer List" search={search} onSearch={setSearch} placeholder="Search customer..." action={<button className="primary" onClick={()=>go("/customers/new")}>+ Add Customer</button>}/>{toast&&<div className="toast">{toast}</div>}<section className="panel list-container"><div className="table-wrap"><table><thead><tr><th>S.No</th><th>Customer Code</th><th>Customer</th><th>Phone</th><th>Type</th><th>Status</th><th aria-label="row actions"/></tr></thead><tbody>{items.map((c,i)=><tr className="customer-row" tabIndex="0" key={c.id}><td>{i+1}</td><td className="mono">{c.customer_code}</td><td><strong>{c.full_name}</strong><small>{c.email||"No email"}</small></td><td>{c.primary_mobile}</td><td><span className={`badge ${(c.role||"").toLowerCase()}`}>{c.role_display||c.role}</span></td><td><span className="status"><i/> {c.is_active?"Active":"Inactive"}</span></td><td><div className="row-actions"><button title="View" onClick={()=>go(`/customers/${c.id}`)}>◉</button><button title="Edit" onClick={()=>go(`/customers/${c.id}/edit`)}>✎</button><button title="Delete" onClick={()=>deactivate(c.id)}>⌫</button></div></td></tr>)}</tbody></table>{!items.length&&<div className="empty">No customers found.</div>}</div><div className="customer-mobile-cards">{items.map((c,i)=>{const open=expanded===c.id;return <article className="customer-mobile-card" key={`mobile-${c.id}`}><div className="customer-mobile-main"><b>{i+1}</b><strong>{c.full_name||"—"}</strong><span className="customer-mobile-status">{c.is_active?"Active":"Inactive"}</span></div><div className="customer-mobile-phone"><small>Phone</small><b>{c.primary_mobile||"—"}</b></div>{open&&<div className="customer-mobile-details">{details(c).map(([label,value])=><div key={label}><small>{label}</small><b>{value||"—"}</b></div>)}</div>}<div className="customer-mobile-actions"><button onClick={()=>setExpanded(open?null:c.id)}>{open?"View Less ▲":"View More ▼"}</button><button aria-label="Edit" onClick={()=>go(`/customers/${c.id}/edit`)}>✎</button><button aria-label="Delete" onClick={()=>deactivate(c.id)}>⌫</button></div></article>})}</div></section></>;
};

CustomersEnhanced = function CustomersEnhancedDrawer({api,auth,go}) {
  const [items,setItems]=useState([]),[search,setSearch]=useState(""),[toast,setToast]=useState(""),[selectedCustomer,setSelectedCustomer]=useState(null);
  const load=()=>api.get("/customers/",{...auth,params:{search,ordering:"full_name"}}).then(r=>setItems(r.data.results??r.data));
  useEffect(()=>{load()},[search]);
  const value=(item,fallback="—")=>item===null||item===undefined||item===""?fallback:item;
  const field=(label,item)=>[label,value(item)];
  const sections=c=>[
    ["Personal Information",[field("Customer Name",c.full_name),field("Customer Code",c.customer_code),field("DOB",c.date_of_birth||c.dob),field("Gender",c.gender),field("Occupation",c.occupation),field("Monthly Income",c.monthly_income),field("Customer Type",c.role_display||c.role)]],
    ["Contact Information",[field("Phone Number",c.primary_mobile),field("Alternative Number",c.alternative_mobile||c.secondary_mobile),field("WhatsApp Number",c.whatsapp_number||c.whatsapp),field("Email",c.email)]],
    ["Address",[field("Address",c.address),field("District",c.district),field("State",c.state),field("Country",c.country),field("Pincode",c.pincode)]],
    ["Identity Details",[field("Aadhar Number",c.aadhaar_number||c.aadhar_number),field("PAN Number",c.pan_number)]]
  ];
  const deactivate=async id=>{if(!await confirmDelete("Are you sure you want to delete the record?"))return;try{await api.delete(`/customers/${id}/`,auth);setToast("Record deleted successfully.");load();setTimeout(()=>setToast(""),500)}catch{setToast("Unable to delete this record.");setTimeout(()=>setToast(""),500)}};
  const closeDrawer=()=>setSelectedCustomer(null);
  useEffect(()=>{if(!selectedCustomer)return;const onKeyDown=event=>event.key==="Escape"&&closeDrawer();document.addEventListener("keydown",onKeyDown);return()=>document.removeEventListener("keydown",onKeyDown)},[selectedCustomer]);
  return <><ListPageToolbar eyebrow="CUSTOMERS" title="Customer List" search={search} onSearch={setSearch} placeholder="Search customer..." action={<button className="primary" onClick={()=>go("/customers/new")}>+ Add Customer</button>}/>{toast&&<div className="toast">{toast}</div>}<section className="panel list-container"><div className="table-wrap"><table><thead><tr><th>S.No</th><th>Customer Code</th><th>Customer</th><th>Phone</th><th>Type</th><th>Status</th><th aria-label="row actions"/></tr></thead><tbody>{items.map((c,i)=><tr className="customer-row" tabIndex="0" key={c.id}><td>{i+1}</td><td className="mono">{c.customer_code}</td><td><strong>{c.full_name}</strong><small>{c.email||"No email"}</small></td><td>{c.primary_mobile}</td><td><span className={`badge ${(c.role||"").toLowerCase()}`}>{c.role_display||c.role}</span></td><td><span className="status"><i/> {c.is_active?"Active":"Inactive"}</span></td><td><div className="row-actions"><button title="View Customer" aria-label="View Customer" onClick={()=>setSelectedCustomer(c)}>◉</button><button title="Edit" onClick={()=>go(`/customers/${c.id}/edit`)}>✎</button><button title="Delete" onClick={()=>deactivate(c.id)}>⌫</button></div></td></tr>)}</tbody></table>{!items.length&&<div className="empty">No customers found.</div>}</div><div className="customer-mobile-cards">{items.map((c,i)=><article className="customer-mobile-card" key={`mobile-${c.id}`}><div className="customer-mobile-main"><b>{i+1}</b><strong>{c.full_name||"—"}</strong><span className="customer-mobile-status">{c.is_active?"Active":"Inactive"}</span></div><div className="customer-mobile-phone"><small>Phone</small><b>{c.primary_mobile||"—"}</b></div><div className="customer-mobile-actions"><button onClick={()=>setSelectedCustomer(c)}>View More ▼</button><button aria-label="Edit" onClick={()=>go(`/customers/${c.id}/edit`)}>✎</button><button aria-label="Delete" onClick={()=>deactivate(c.id)}>⌫</button></div></article>)}</div></section>{selectedCustomer&&<CustomerDetailsDrawer customer={selectedCustomer} value={value} sections={sections} onClose={closeDrawer} onEdit={()=>go(`/customers/${selectedCustomer.id}/edit`)}/>}</>;
};

// `/customers/:id` (openId) shows this list with that customer's View More drawer open.
CustomersEnhanced = function CustomerList({api,auth,go,openId}) {
  const { isAdmin } = useSession();
  const [items,setItems]=useState([]),[search,setSearch]=useState(""),[selectedCustomer,setSelectedCustomer]=useState(null),[kycCustomer,setKycCustomer]=useState(null);
  // Group filter (customer's accounting group, incl. its sub-groups); client-side only.
  const [groupFilter,setGroupFilter]=useState("");const customerGroups=useGroupTree(api,auth,{rootNames:["Sundry Debtors","Sundry Creditors"]});const shown=items.filter(c=>customerGroups.isWithin(c.group,groupFilter));
  const load=()=>api.get("/customers/",{...auth,params:{search,ordering:"full_name"}}).then(r=>setItems(r.data.results??r.data));
  useEffect(()=>{load()},[search]);
  const deactivate=async id=>{if(!await confirmDelete("Are you sure you want to delete the record?"))return;try{await api.delete(`/customers/${id}/`,auth);if(selectedCustomer?.id===id)setSelectedCustomer(null);actionToast("Customer deleted successfully.");load()}catch(requestError){actionToast(apiErrorMessage(requestError,"Unable to delete customer."),false)}};
  const address=c=>{const parts=[c.address,c.district,c.state,c.country?.toLowerCase()==="india"?"":c.country].filter(Boolean);return `${parts.join(", ")}${c.pincode?(parts.length?" - ":"")+c.pincode:""}`};
  const open=c=>setSelectedCustomer(c);
  const closeDetails=()=>{setSelectedCustomer(null);if(openId)go("/customers")};
  useEffect(()=>{if(!openId)return;let active=true;api.get(`/customers/${openId}/`,auth).then(r=>{if(active)setSelectedCustomer(r.data)}).catch(()=>{if(active){actionToast("Customer could not be loaded.",false);go("/customers")}});return()=>{active=false}},[openId]);
  useEffect(()=>{if(!selectedCustomer)return;const onKeyDown=event=>event.key==="Escape"&&closeDetails();document.addEventListener("keydown",onKeyDown);return()=>document.removeEventListener("keydown",onKeyDown)},[selectedCustomer]);
  const onRowKey=(event,c)=>{if((event.key==="Enter"||event.key===" ")&&!event.target.closest("button")){event.preventDefault();open(c)}};
  return <><ListPageToolbar eyebrow="CUSTOMERS" title="Customer List" search={search} onSearch={setSearch} placeholder="Search customer..." filters={[{label:"Group",value:groupFilter,onChange:setGroupFilter,options:customerGroups.options}]} action={<><ListExport title="Customer List" rows={shown} filtersLine={exportFiltersLine([["Search",search],["Group",customerGroups.options.find(o=>o.value===groupFilter&&o.value)?.label?.replace(/^(— )+/,"")]])} columns={[{header:"Customer Code",value:c=>c.customer_code},{header:"Customer Name",value:c=>c.full_name},{header:"Phone Number",value:c=>c.primary_mobile},{header:"Address",value:c=>address(c)},{header:"Aadhaar Number",value:c=>c.aadhaar_number}]}/><button className="primary" onClick={()=>go("/customers/new")}>+ Add Customer</button></>}/><section className="panel list-container customer-list-surface data-container"><div className="table-wrap data-table-area"><table><thead><tr><th>Customer Code</th><th>Customer Name</th><th>Phone Number</th><th>Address</th><th>Aadhaar Number</th><th>Action</th></tr></thead><tbody>{shown.map((c,i)=><tr className="customer-row" tabIndex="0" key={c.id} onClick={()=>open(c)} onKeyDown={event=>onRowKey(event,c)}><td className="mono customer-code-cell">{c.customer_code}</td><td><strong>{c.full_name}</strong></td><td>{c.primary_mobile}</td><td className="customer-address-cell">{address(c)||"—"}</td><td>{c.aadhaar_number||"—"}</td><td><div className="row-actions">{isAdmin&&<button title="Edit" aria-label="Edit" onClick={event=>{event.stopPropagation();go(`/customers/${c.id}/edit`)}}>&#9998;</button>}<button title="KYC Documents" aria-label="KYC Documents" onClick={event=>{event.stopPropagation();setKycCustomer(c)}}>&#128196;</button>{isAdmin&&<button title="Delete" aria-label="Delete" onClick={event=>{event.stopPropagation();deactivate(c.id)}}>&#9003;</button>}</div></td></tr>)}</tbody></table>{!shown.length&&<div className="empty">No customers found.</div>}</div><div className="customer-mobile-cards">{shown.map((c,i)=><article className="customer-mobile-card" key={`mobile-${c.id}`} onClick={()=>open(c)}><div className="customer-mobile-main"><b>{i+1}</b><strong>{c.full_name||"—"}</strong><span className="customer-mobile-status">{c.is_active?"Active":"Inactive"}</span></div><div className="customer-mobile-phone"><small>Phone</small><b>{c.primary_mobile||"—"}</b></div><div className="customer-mobile-actions"><button type="button" className="customer-mobile-view" onClick={event=>{event.stopPropagation();open(c)}} aria-label={`View more details of ${c.full_name||"customer"}`}><span>View More</span>{mobileIcon.chevron}</button>{isAdmin&&<button type="button" className="customer-mobile-icon edit" onClick={event=>{event.stopPropagation();go(`/customers/${c.id}/edit`)}} aria-label="Edit" title="Edit">{mobileIcon.edit}</button>}<button type="button" className="customer-mobile-icon kyc" onClick={event=>{event.stopPropagation();setKycCustomer(c)}} aria-label="KYC Documents" title="KYC Documents">{mobileIcon.kyc}</button>{isAdmin&&<button type="button" className="customer-mobile-icon delete" onClick={event=>{event.stopPropagation();deactivate(c.id)}} aria-label="Delete" title="Delete">{mobileIcon.delete}</button>}</div></article>)}</div><footer className="footer paginationFooter data-footer"><span>Showing {shown.length?`1-${shown.length}`:0} of {shown.length}</span><div>Previous&nbsp;&nbsp; 1 &nbsp;&nbsp; Next</div></footer></section>{selectedCustomer&&<CustomerDetailsDrawer api={api} auth={auth} customer={selectedCustomer} value={customerValue} sections={customerSections} onClose={closeDetails} onEdit={()=>go(`/customers/${selectedCustomer.id}/edit`)}/>}{kycCustomer&&<KycDocumentsModal api={api} auth={auth} customer={kycCustomer} onClose={()=>setKycCustomer(null)}/>}</>;
};
// Inline SVG icons for the Customer List mobile cards (no emoji/font dependency).
const mobileSvg=path=><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
const mobileIcon={chevron:mobileSvg(<path d="m6 9 6 6 6-6"/>),edit:mobileSvg(<><path d="m4 16-.7 4 4-.7L18.8 7.8a2.1 2.1 0 0 0-3-3L4 16Z"/><path d="m14.5 6.5 3 3"/></>),kyc:mobileSvg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></>),delete:mobileSvg(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>)};
const customerValue=(item,fallback="—")=>item===null||item===undefined||item===""?fallback:item;
const customerDateLabel=value=>value?String(value).slice(0,10).split("-").reverse().join("/"):null;
const customerAge=dob=>{if(!dob)return null;const birth=new Date(dob),now=new Date();let age=now.getFullYear()-birth.getFullYear();const monthDiff=now.getMonth()-birth.getMonth();if(monthDiff<0||(monthDiff===0&&now.getDate()<birth.getDate()))age--;return age;};
const customerDobAge=c=>{const date=customerDateLabel(c.dob);if(!date)return null;const age=customerAge(c.dob);return age!=null?`${date} (${age} yrs)`:date;};
const customerAddressLine=c=>{const main=[c.address,c.district,c.state].filter(Boolean).join(", ");const withPin=c.pincode?`${main}${main?" - ":""}${c.pincode}`:main;const withCountry=c.country?`${withPin}${withPin?", ":""}${c.country}`:withPin;return withCountry||null;};
const customerSections=c=>{const field=(label,item)=>[label,customerValue(item)];return [
  ["Customer Information",[field("DOB / Age",customerDobAge(c)),field("Gender",c.gender),field("Phone Number",c.primary_mobile),field("Alternative Number",c.alternate_mobile),field("WhatsApp Number",c.whatsapp_number),field("Email",c.email),field("Aadhaar Number",c.aadhaar_number),field("PAN Number",c.pan_number)]],
]};

function CustomerDetailsDrawer({api,auth,customer,value,sections,onClose,onEdit}) {
  const { isAdmin } = useSession();
  const initials=(customer.full_name||"?").trim().split(/\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase();
  return <div className="customer-drawer-layer" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><aside className="customer-details-drawer" role="dialog" aria-modal="true" aria-labelledby="customer-details-title"><header className="customer-drawer-header"><div><h2 id="customer-details-title">Customer Details</h2></div><button type="button" className="customer-drawer-close" onClick={onClose} aria-label="Close" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header><div className="customer-drawer-identity"><span className="customer-avatar">{initials}</span><div><strong>{value(customer.full_name)}</strong><small>{value(customer.customer_code)} · {value(customer.primary_mobile)}</small></div></div><div className="customer-drawer-body">{sections(customer).map(([title,fields])=><section className="customer-detail-section" key={title}><h3>{title}</h3><div className="customer-details-grid">{fields.map(([label,item])=><div className="customer-detail-item" key={label}><small>{label}</small><strong>{item}</strong></div>)}</div><p className="customer-address-line"><strong>Address:</strong> {value(customerAddressLine(customer))}</p></section>)}{api&&auth&&<section className="customer-detail-section"><h3>KYC Documents</h3><KycDocumentsSection api={api} auth={auth} customerId={customer.id} allowAdd={false}/></section>}</div>{isAdmin&&<footer className="customer-drawer-footer"><button type="button" className="primary customer-drawer-edit" onClick={onEdit}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.7 4 4-.7L18.8 7.8a2.1 2.1 0 0 0-3-3L4 16Zm10.5-9.5 3 3"/></svg>Edit Customer</button></footer>}</aside></div>;
}
