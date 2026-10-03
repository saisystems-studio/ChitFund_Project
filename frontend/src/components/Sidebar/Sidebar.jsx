import { useEffect, useState } from "react";
import styles from "./Sidebar.module.css";
import extra from "./SidebarExtra.module.css";
import AdminMenu from "./AdminMenu";
import { CompanyLogo, useCompanyProfile } from "../CompanyProfileContext";
import CompanyProfileForm from "./CompanyProfileForm";

// Keep navigation aligned with the finalized business workflow.
// Masters holds Add/Create pages only (form, no list below it); Master
// List holds the matching List/History pages. Group, Ledger and Staff
// have dedicated "/list" routes so the Add page never shows the records
// table. Mortgage, Holiday and Loan Type are list-first pages with a
// modal Add/Edit, so their Add and List entries legitimately share one
// route -- the modal itself still never shows a list.
//
// Reports is the only group with a second accordion level: one category
// (General/Loan/Accounts) open at a time, nested inside the single open
// top-level group. Existing report routes are reused as-is; Trial Balance /
// Balance Sheet / Profit & Loss have no report built yet, so they route to
// the same WorkInProgress placeholder already used for "Daily Report".
const reportCategories = [
  ["generalReports", "General Reports", [
    ["Today Report", "/today-collection"],
    ["Collection Entry History", "/collection-list"],
    ["Collection History", "/reports/collections/history"],
    ["Payment History", "/payment-list"],
  ]],
  ["loanReports", "Loan Reports", [
    ["Active Loans", "/active-loans"],
    ["Mortgage Report", "/reports/mortgage"],
    ["Customer Wise Report", "/reports/customer-wise"],
  ]],
  ["accountsReports", "Accounts Reports", [
    ["Cash Ledger", "/reports/cash-balance"],
    ["Bank Ledger", "/reports/bank-balance"],
    ["Pending & Outstanding", "/reports/collections/pending"],
    ["Trial Balance Report", "/reports/trial-balance"],
    ["Balance Sheet Report", "/reports/balance-sheet"],
    ["Profit & Loss Report", "/reports/profit-loss"],
  ]],
];
const groups = [
  ["masters", "MASTERS", [
    ["Add Customer", "/customers/new"],
    ["Add Ledger", "/ledgers"],
    ["Add Group", "/groups"],
    ["Add Chit Group", "/chit-groups/new"],
    ["Add Mortgage", "/mortgage-master"],
    ["Add Holiday", "/holiday-master"],
    ["Loan Type", "/loan-types"],
    ["Add Staff", "/staff"],
  ]],
  ["masterList", "MASTER LIST", [
    ["Customer List", "/customers"],
    ["Ledger List", "/ledgers/list"],
    ["Group List", "/groups/list"],
    ["Chit Group List", "/chit-groups"],
    ["Mortgage Rate History", "/mortgage-master"],
    ["Holiday List", "/holiday-master"],
    ["Staff List", "/staff/list"],
  ]],
  ["transactions", "TRANSACTIONS", [["Loan Application", "/loan-application"], ["Collection Entry", "/collection-entry"], ["Payment Entry", "/payment-entry"]]],
  ["reports", "REPORTS", reportCategories.flatMap(([, , links]) => links)],
];

function LegacySidebar({ route, go, user, onLogout, theme, onToggleTheme, onUserUpdate }) {
  const activeGroup = groups.find(([, , links]) => links.some(([, path]) => route === path || route.startsWith(`${path}/`)))?.[0];
  const [expanded, setExpanded] = useState(() => ({ masters: activeGroup === "masters", loans: activeGroup === "loans", transactions: activeGroup === "transactions", reports: activeGroup === "reports" }));
  useEffect(() => { if (activeGroup) setExpanded({ masters: activeGroup === "masters", customers: activeGroup === "customers", transactions: activeGroup === "transactions", reports: activeGroup === "reports" }); }, [activeGroup]);
  const [popup, setPopup] = useState(null);
  useEffect(() => { const close = event => { if (event.key === "Escape") setPopup(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);
  return <aside className={styles.sidebar}><div className={styles.brand}><span>FC</span><div><strong>Finance Collection</strong><small>Management workspace</small></div></div><nav className={styles.sidebarMenu} aria-label="Main navigation"><a className={`${styles.direct} ${route === "/dashboard" ? styles.active : ""}`} onClick={() => go("/dashboard")}>Dashboard</a>{groups.map(([key, label, links]) => <div className={styles.group} key={key}><button className={styles.groupButton} onClick={() => setExpanded(value => ({ ...value, [key]: !value[key] }))}><span>{label}</span><span className={`${styles.chevron} ${expanded[key] ? styles.open : ""}`}>›</span></button>{expanded[key] && <div className={styles.submenu}>{links.map(([name, path]) => <a key={path} className={route === path || route.startsWith(`${path}/`) ? styles.active : ""} onClick={() => go(path)}>{name}</a>)}</div>}{key === "masters" && <a className={`${styles.directCustomer} ${route.startsWith("/customers") ? styles.active : ""}`} onClick={() => go("/customers")}>Customers</a>}</div>)}</nav><div className={styles.footer}><div className={styles.adminLine}><div className={styles.adminHover}><button type="button" className={styles.adminIdentity} onClick={() => setPopup("menu")} aria-label="Open admin menu"><span className={styles.avatar}>A</span></button><span className={styles.adminTooltip}><b>{user?.username || "admin"}</b><small>{user?.is_admin ? "Administrator" : "User"}</small></span></div><button type="button" className={styles.signOut} onClick={onLogout}>Sign Out</button></div></div>{popup === "menu" && <AdminMenu onProfile={() => setPopup("profile")} onSettings={() => setPopup("settings")} onClose={() => setPopup(null)}/>} {popup === "profile" && <ProfilePopup user={user} onClose={() => setPopup(null)} onChangePassword={() => setPopup("password")} onUserUpdate={onUserUpdate}/>} {popup === "settings" && <SettingsPopup theme={theme} onToggleTheme={onToggleTheme} onClose={() => setPopup(null)}/>} {popup === "password" && <ChangePasswordPopup onClose={() => setPopup(null)}/>}</aside>;
}

const sidebarIcons = { dashboard: "⌂", masters: "▣", masterList: "☰", loans: "◈", transactions: "₹", reports: "▥" };
export default function Sidebar({ route, go, user, token, onLogout, theme, onToggleTheme, onUserUpdate, collapsed, onToggleCollapse, mobile = false, mobileOpen = false, onMobileClose }) {
  const { profile } = useCompanyProfile();
  // A few Master List entries (Mortgage Rate History, Holiday List, Loan
  // Type) intentionally share one route with their Masters counterpart
  // (e.g. "/mortgage-master" is both "Add Mortgage" and "Mortgage Rate
  // History"), so route alone can't always say which group a click came
  // from -- groups.find() would always pick "masters" first. `lastClicked`
  // remembers which group the most recent sidebar click actually belonged
  // to, and wins whenever it still matches the current route; a fresh page
  // load has no click yet, so it correctly falls back to route-matching.
  const groupForRoute = r => groups.find(([key, , links]) => links.some(([, path]) => r === path || r.startsWith(`${path}/`)))?.[0];
  const activeGroup = groupForRoute(route);
  const [lastClicked, setLastClicked] = useState(null);
  const groupMatchesRoute = (key, r) => groups.find(([groupKey]) => groupKey === key)?.[2]?.some(([, path]) => r === path || r.startsWith(`${path}/`));
  const resolvedGroup = lastClicked && groupMatchesRoute(lastClicked, route) ? lastClicked : activeGroup;
  // Strict accordion: exactly one of the four groups is expanded at a time.
  // Re-derived from `route` (not `resolvedGroup`) so every navigation --
  // even between two links inside the same group -- recomputes this,
  // instead of only firing when the active *group* identity changes (which
  // would skip same-group moves).
  const [expanded, setExpanded] = useState(() => ({ masters: resolvedGroup === "masters", masterList: resolvedGroup === "masterList", transactions: resolvedGroup === "transactions", reports: resolvedGroup === "reports" }));
  // Same strict-accordion rule, one level deeper, only inside Reports: the
  // active category (if any) is derived from the route; otherwise none of
  // the 3 categories is expanded until the user picks one.
  const activeReportCategory = reportCategories.find(([, , links]) => links.some(([, path]) => route === path || route.startsWith(`${path}/`)))?.[0] || null;
  const [expandedCategory, setExpandedCategory] = useState(() => activeReportCategory);
  const toggleCategory = key => setExpandedCategory(current => current === key ? null : key);
  const [popup, setPopup] = useState(null);
  const [flyout, setFlyout] = useState(null);
  useEffect(() => { setExpanded({ masters: resolvedGroup === "masters", masterList: resolvedGroup === "masterList", transactions: resolvedGroup === "transactions", reports: resolvedGroup === "reports" }); setExpandedCategory(activeReportCategory); }, [route, lastClicked]);
  useEffect(() => { const close = event => { if (event.key === "Escape") { setPopup(null); setFlyout(null); } }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);
  useEffect(() => { if (popup !== "menu") return undefined; const closeOutside = event => { if (!event.target.closest?.('[class*="adminMenu"]') && !event.target.closest?.('[class*="adminIdentity"]')) setPopup(null); }; document.addEventListener("pointerdown", closeOutside); return () => document.removeEventListener("pointerdown", closeOutside); }, [popup]);
  useEffect(() => { if (!flyout) return undefined; const closeOutside = event => { if (!event.target.closest?.('[class*="flyout"]') && !event.target.closest?.('[class*="groupButton"]')) setFlyout(null); }; document.addEventListener("pointerdown", closeOutside); return () => document.removeEventListener("pointerdown", closeOutside); }, [flyout]);
  useEffect(() => {
    const menuSelector = `.${styles.sidebarMenu}`;
    const menu = () => document.querySelector(menuSelector);
    const handleKeyboardScroll = event => {
      const area = menu();
      if (!area || (!area.matches(":hover") && !area.contains(document.activeElement))) return;
      const active = document.activeElement;
      if (active?.tagName === "SELECT" || active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || active?.getAttribute("role") === "listbox" || active?.getAttribute("role") === "combobox") return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault(); event.stopPropagation();
      area.scrollBy({ top: event.key === "ArrowDown" ? 60 : -60, behavior: "smooth" });
    };
    window.addEventListener("keydown", handleKeyboardScroll, true);
    return () => window.removeEventListener("keydown", handleKeyboardScroll, true);
  }, []);
  useEffect(() => {
    const menu = document.querySelector(`.${styles.sidebarMenu}`);
    const active = menu?.querySelector(`.${styles.active}`);
    active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [route, expanded]);
  const toggleGroup = (key, event) => { if (collapsed) { const rect = event.currentTarget.getBoundingClientRect(); setFlyout(current => current?.key === key ? null : { key, top: Math.max(16, Math.min(rect.top, window.innerHeight - 220)) }); } else setExpanded(value => ({ masters: key === "masters" ? !value.masters : false, masterList: key === "masterList" ? !value.masterList : false, transactions: key === "transactions" ? !value.transactions : false, reports: key === "reports" ? !value.reports : false })); };
  const navigate = (path, groupKey) => { setFlyout(null); setLastClicked(groupKey || null); go(path); onMobileClose?.(); };
  return <>{mobile && mobileOpen && <button type="button" className="mobile-sidebar-backdrop" aria-label="Close menu" onClick={onMobileClose}/>}<aside className={`${styles.sidebar} ${collapsed ? extra.collapsed : ""} ${mobile ? styles.mobileSidebar : ""} ${mobile && mobileOpen ? styles.mobileOpen : ""}`}><button type="button" className={styles.brand} onClick={() => navigate("/dashboard")} title="Dashboard"><span><CompanyLogo /></span>{!collapsed && <div><strong title={profile.company_name || "Finance Collection"}>{profile.company_name || "Finance Collection"}</strong><small>Management workspace</small></div>}</button><nav className={styles.sidebarMenu} aria-label="Main navigation"><a title="Dashboard" className={`${styles.direct} ${route === "/dashboard" ? styles.active : ""}`} onClick={() => navigate("/dashboard")}><span className={extra.navIcon}>{sidebarIcons.dashboard}</span>{!collapsed && <span>Dashboard</span>}</a>{groups.map(([key, label, links]) => <GroupSection key={key} groupKey={key} label={label} links={links} collapsed={collapsed} isExpanded={expanded[key]} isFlyoutActive={flyout?.key === key} onToggle={event => toggleGroup(key, event)} route={route} navigate={navigate} expandedCategory={expandedCategory} onToggleCategory={toggleCategory} icon={sidebarIcons[key]}/>)}</nav><div className={styles.footer}><div className={styles.adminLine}><div className={styles.adminHover}><button type="button" className={styles.adminIdentity} onClick={() => { setFlyout(null); setPopup("menu"); }} aria-label="Open admin menu"><span className={styles.avatar}>A</span>{!collapsed && <span className={extra.adminText}><b>{user?.username || "admin"}</b><small>{user?.is_admin ? "Administrator" : "User"}</small></span>}</button>{collapsed && <span className={extra.collapsedTooltip}>Profile</span>}</div>{collapsed ? <button type="button" className={styles.signOut} onClick={onLogout} title="Sign Out">↪</button> : <button type="button" className={styles.signOut} onClick={onLogout}>Sign Out</button>}</div></div>{flyout && <SidebarFlyout label={groups.find(([key]) => key === flyout.key)?.[1]} links={groups.find(([key]) => key === flyout.key)?.[2] || []} top={flyout.top} route={route} onNavigate={path => navigate(path, flyout.key)}/>} {popup === "menu" && <AdminMenu user={user} onProfile={() => setPopup("profile")} onSettings={() => setPopup("settings")} onClose={() => setPopup(null)}/>} {popup === "profile" && <ProfilePopup user={user} onClose={() => setPopup(null)} onChangePassword={() => setPopup("password")}/>} {popup === "settings" && <SettingsPopup user={user} token={token} theme={theme} onToggleTheme={onToggleTheme} onClose={() => setPopup(null)}/>} {popup === "password" && <ChangePasswordPopup onClose={() => setPopup(null)}/>}</aside></>;
}

function GroupSection({ groupKey, label, links, collapsed, isExpanded, isFlyoutActive, onToggle, route, navigate, expandedCategory, onToggleCategory, icon }) {
  const isActiveLink = path => route === path || route.startsWith(`${path}/`);
  return <div className={styles.group}>
    <button type="button" title={collapsed ? label : undefined} aria-haspopup={links.length ? "menu" : undefined} aria-expanded={collapsed ? isFlyoutActive : isExpanded} className={styles.groupButton} onClick={onToggle}>
      <span className={extra.navIcon}>{icon}</span>
      {!collapsed && <span>{label}</span>}
      {!collapsed && <span className={`${styles.chevron} ${isExpanded ? styles.open : ""}`}>›</span>}
    </button>
    {!collapsed && isExpanded && (groupKey === "reports"
      ? <div className={styles.submenu}>{reportCategories.map(([categoryKey, categoryLabel, categoryLinks]) => <div className={styles.subGroup} key={categoryKey}>
          <button type="button" className={styles.subGroupButton} aria-expanded={expandedCategory === categoryKey} onClick={() => onToggleCategory(categoryKey)}>
            <span>{categoryLabel}</span>
            <span className={`${styles.chevron} ${expandedCategory === categoryKey ? styles.open : ""}`}>›</span>
          </button>
          {expandedCategory === categoryKey && <div className={styles.nestedSubmenu}>{categoryLinks.map(([name, path]) => <a key={`${path}-${name}`} className={isActiveLink(path) ? styles.active : ""} onClick={() => navigate(path, groupKey)}>{name}</a>)}</div>}
        </div>)}</div>
      : <div className={styles.submenu}>{links.map(([name, path]) => <a key={`${path}-${name}`} className={isActiveLink(path) ? styles.active : ""} onClick={() => navigate(path, groupKey)}>{name}</a>)}</div>)}
  </div>;
}

function SidebarFlyout({ label, links, top, route, onNavigate }) {
  const [focus, setFocus] = useState(0);
  const choose = index => { setFocus(index); onNavigate(links[index][1]); };
  const keyboard = event => { if (event.key === "ArrowDown") { event.preventDefault(); setFocus(index => (index + 1) % links.length); } if (event.key === "ArrowUp") { event.preventDefault(); setFocus(index => (index - 1 + links.length) % links.length); } if (event.key === "Enter") { event.preventDefault(); choose(focus); } };
  return <div className={`${styles.flyout} sidebar-flyout`} style={{ position: "fixed", left: "86px", top, width: "214px", zIndex: 100 }} role="menu" onKeyDown={keyboard}><strong>{label}</strong><div>{links.map(([name, path], index) => <button type="button" role="menuitem" tabIndex={index === focus ? 0 : -1} key={`${path}-${name}`} className={route === path || route.startsWith(`${path}/`) ? styles.flyoutActive : ""} onClick={() => choose(index)}>{name}</button>)}</div></div>;
}

function ProfilePopup({ user, onClose, onChangePassword, onUserUpdate }) { const [email, setEmail] = useState(user?.email || "admin@example.com"); const [saved, setSaved] = useState(false); const save = event => { event.preventDefault(); onUserUpdate?.({ ...user, email }); setSaved(true); setTimeout(onClose, 600); }; return <div className={styles.popup}><div className={styles.popupHeader}><b>Profile</b><button type="button" onClick={onClose}>×</button></div><form onSubmit={save}><label>Username<input value={user?.username || "admin"} readOnly /></label><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} /></label><button type="button" className={styles.passwordLink} onClick={onChangePassword}>Change Password</button>{saved && <small className={styles.success}>Profile saved</small>}<div className={styles.popupActions}><button type="button" onClick={onClose}>Cancel</button><button className={styles.saveButton}>Save</button></div></form></div>; }
function SettingsPopup({ theme, onToggleTheme, onClose, user, token }) { return <div className={`${styles.popup} ${styles.settingsPopup}`}><div className={styles.popupHeader}><b>Settings</b><button type="button" onClick={onClose}>×</button></div><CompanyProfileForm user={user} token={token} /><div className={styles.appearance}><span>Appearance</span><div><span>☀ Light</span><button type="button" className={`${styles.themeToggle} ${theme === "dark" ? styles.darkToggle : ""}`} onClick={onToggleTheme} aria-label="Toggle theme"><i/></button><span>Dark ☾</span></div></div><div className={styles.popupActions}><button type="button" onClick={onClose}>Close</button></div></div>; }
function ChangePasswordPopup({ onClose }) { const [message, setMessage] = useState(""); const submit = event => { event.preventDefault(); setMessage("Password update requires the configured account service."); }; return <div className={styles.popup}><div className={styles.popupHeader}><b>Change Password</b><button type="button" onClick={onClose}>×</button></div><form onSubmit={submit}><label>Current Password <span className="required-star">*</span><input type="password" required /></label><label>New Password <span className="required-star">*</span><input type="password" required /></label><label>Confirm Password <span className="required-star">*</span><input type="password" required /></label>{message && <small className={styles.success}>{message}</small>}<div className={styles.popupActions}><button type="button" onClick={onClose}>Cancel</button><button className={styles.saveButton}>Update Password</button></div></form></div>; }
