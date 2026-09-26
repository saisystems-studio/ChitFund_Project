import { useEffect, useState } from "react";
import styles from "./Sidebar.module.css";
import extra from "./SidebarExtra.module.css";
import AdminMenu from "./AdminMenu";
import { CompanyLogo, useCompanyProfile } from "../CompanyProfileContext";
import CompanyProfileForm from "./CompanyProfileForm";

// Keep navigation aligned with the finalized business workflow.
const groups = [
  ["masters", "MASTERS", [
    ["Ledger List", "/ledgers"],
    ["Add Ledger", "/ledgers"],
    ["Customer List", "/customers"],
    ["Add Customer", "/customers/new"],
    ["Chit Group List", "/chit-groups"],
    ["Add Chit Group", "/chit-groups/new"],
    ["Mortgage Product List", "/mortgage-master"],
    ["Add Mortgage Product", "/mortgage-master"],
    ["Mortgage Rate History", "/mortgage-rate-history"],
    ["Holiday List", "/holiday-master"],
    ["Add Holiday", "/holiday-master"],
    ["Loan Type List", "/loan-types"],
    ["Add Loan Type", "/loan-types"],
  ]],
  ["transactions", "TRANSACTIONS", [["Loan Applications", "/loan-application"], ["Collection Entry", "/collection-entry"], ["Payment Entry", "/payment-entry"]]],
  ["reports", "REPORTS", [["Today Report", "/today-collection"], ["Active Loan", "/active-loans"], ["Customer-wise Report", "/reports/customer-wise"], ["Mortgage Report", "/reports/mortgage"], ["Cash Ledger", "/reports/cash-balance"], ["Bank Ledger", "/reports/bank-balance"], ["Pending & Outstanding", "/reports/collections/pending"], ["Collection History", "/reports/collections/history"]]],
];

function LegacySidebar({ route, go, user, onLogout, theme, onToggleTheme, onUserUpdate }) {
  const activeGroup = groups.find(([, , links]) => links.some(([, path]) => route === path || route.startsWith(`${path}/`)))?.[0];
  const [expanded, setExpanded] = useState(() => ({ masters: activeGroup === "masters", loans: activeGroup === "loans", transactions: activeGroup === "transactions", reports: activeGroup === "reports" }));
  useEffect(() => { if (activeGroup) setExpanded({ masters: activeGroup === "masters", customers: activeGroup === "customers", transactions: activeGroup === "transactions", reports: activeGroup === "reports" }); }, [activeGroup]);
  const [popup, setPopup] = useState(null);
  useEffect(() => { const close = event => { if (event.key === "Escape") setPopup(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);
  return <aside className={styles.sidebar}><div className={styles.brand}><span>FC</span><div><strong>Finance Collection</strong><small>Management workspace</small></div></div><nav className={styles.sidebarMenu} aria-label="Main navigation"><a className={`${styles.direct} ${route === "/dashboard" ? styles.active : ""}`} onClick={() => go("/dashboard")}>Dashboard</a>{groups.map(([key, label, links]) => <div className={styles.group} key={key}><button className={styles.groupButton} onClick={() => setExpanded(value => ({ ...value, [key]: !value[key] }))}><span>{label}</span><span className={`${styles.chevron} ${expanded[key] ? styles.open : ""}`}>›</span></button>{expanded[key] && <div className={styles.submenu}>{links.map(([name, path]) => <a key={path} className={route === path || route.startsWith(`${path}/`) ? styles.active : ""} onClick={() => go(path)}>{name}</a>)}</div>}{key === "masters" && <a className={`${styles.directCustomer} ${route.startsWith("/customers") ? styles.active : ""}`} onClick={() => go("/customers")}>Customers</a>}</div>)}</nav><div className={styles.footer}><div className={styles.adminLine}><div className={styles.adminHover}><button type="button" className={styles.adminIdentity} onClick={() => setPopup("menu")} aria-label="Open admin menu"><span className={styles.avatar}>A</span></button><span className={styles.adminTooltip}><b>{user?.username || "admin"}</b><small>{user?.is_admin ? "Administrator" : "User"}</small></span></div><button type="button" className={styles.signOut} onClick={onLogout}>Sign Out</button></div></div>{popup === "menu" && <AdminMenu onProfile={() => setPopup("profile")} onSettings={() => setPopup("settings")} onClose={() => setPopup(null)}/>} {popup === "profile" && <ProfilePopup user={user} onClose={() => setPopup(null)} onChangePassword={() => setPopup("password")} onUserUpdate={onUserUpdate}/>} {popup === "settings" && <SettingsPopup theme={theme} onToggleTheme={onToggleTheme} onClose={() => setPopup(null)}/>} {popup === "password" && <ChangePasswordPopup onClose={() => setPopup(null)}/>}</aside>;
}

const sidebarIcons = { dashboard: "⌂", masters: "▣", loans: "◈", transactions: "₹", reports: "▥" };
export default function Sidebar({ route, go, user, token, onLogout, theme, onToggleTheme, onUserUpdate, collapsed, onToggleCollapse, mobile = false, mobileOpen = false, onMobileClose }) {
  const { profile } = useCompanyProfile();
  const activeGroup = groups.find(([key, , links]) => links.some(([, path]) => route === path || route.startsWith(`${path}/`)))?.[0];
  const [expanded, setExpanded] = useState(() => ({ masters: activeGroup === "masters", transactions: activeGroup === "transactions", reports: activeGroup === "reports" }));
  const [popup, setPopup] = useState(null);
  const [flyout, setFlyout] = useState(null);
  useEffect(() => { if (activeGroup) setExpanded(value => ({ ...value, [activeGroup]: true })); }, [activeGroup]);
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
  const toggleGroup = (key, event) => { if (collapsed) { const rect = event.currentTarget.getBoundingClientRect(); setFlyout(current => current?.key === key ? null : { key, top: Math.max(16, Math.min(rect.top, window.innerHeight - 220)) }); } else setExpanded(value => ({ masters: key === "masters" ? !value.masters : false, transactions: key === "transactions" ? !value.transactions : false, reports: key === "reports" ? !value.reports : false })); };
  const navigate = path => { setFlyout(null); setExpanded({ masters: false, transactions: false, reports: false }); go(path); onMobileClose?.(); };
  return <>{mobile && mobileOpen && <button type="button" className="mobile-sidebar-backdrop" aria-label="Close menu" onClick={onMobileClose}/>}<aside className={`${styles.sidebar} ${collapsed ? extra.collapsed : ""} ${mobile ? styles.mobileSidebar : ""} ${mobile && mobileOpen ? styles.mobileOpen : ""}`}><button type="button" className={styles.brand} onClick={() => navigate("/dashboard")} title="Dashboard"><span><CompanyLogo /></span>{!collapsed && <div><strong title={profile.company_name || "Finance Collection"}>{profile.company_name || "Finance Collection"}</strong><small>Management workspace</small></div>}</button><nav className={styles.sidebarMenu} aria-label="Main navigation"><a title="Dashboard" className={`${styles.direct} ${route === "/dashboard" ? styles.active : ""}`} onClick={() => navigate("/dashboard")}><span className={extra.navIcon}>{sidebarIcons.dashboard}</span>{!collapsed && <span>Dashboard</span>}</a>{groups.map(([key, label, links]) => <div className={styles.group} key={key}><button type="button" title={collapsed ? label : undefined} aria-haspopup={links.length ? "menu" : undefined} aria-expanded={collapsed ? flyout?.key === key : expanded[key]} className={styles.groupButton} onClick={event => toggleGroup(key, event)}><span className={extra.navIcon}>{sidebarIcons[key]}</span>{!collapsed && <span>{label}</span>}{!collapsed && <span className={`${styles.chevron} ${expanded[key] ? styles.open : ""}`}>›</span>}</button>{!collapsed && expanded[key] && <div className={styles.submenu}>{links.map(([name, path]) => <a key={`${path}-${name}`} className={route === path || route.startsWith(`${path}/`) ? styles.active : ""} onClick={() => navigate(path)}>{name}</a>)}</div>}</div>)}</nav><div className={styles.footer}><div className={styles.adminLine}><div className={styles.adminHover}><button type="button" className={styles.adminIdentity} onClick={() => { setFlyout(null); setPopup("menu"); }} aria-label="Open admin menu"><span className={styles.avatar}>A</span>{!collapsed && <span className={extra.adminText}><b>{user?.username || "admin"}</b><small>{user?.is_admin ? "Administrator" : "User"}</small></span>}</button>{collapsed && <span className={extra.collapsedTooltip}>Profile</span>}</div>{collapsed ? <button type="button" className={styles.signOut} onClick={onLogout} title="Sign Out">↪</button> : <button type="button" className={styles.signOut} onClick={onLogout}>Sign Out</button>}</div></div>{flyout && <SidebarFlyout label={groups.find(([key]) => key === flyout.key)?.[1]} links={groups.find(([key]) => key === flyout.key)?.[2] || []} top={flyout.top} route={route} onNavigate={navigate}/>} {popup === "menu" && <AdminMenu user={user} onProfile={() => setPopup("profile")} onSettings={() => setPopup("settings")} onClose={() => setPopup(null)}/>} {popup === "profile" && <ProfilePopup user={user} onClose={() => setPopup(null)} onChangePassword={() => setPopup("password")}/>} {popup === "settings" && <SettingsPopup user={user} token={token} theme={theme} onToggleTheme={onToggleTheme} onClose={() => setPopup(null)}/>} {popup === "password" && <ChangePasswordPopup onClose={() => setPopup(null)}/>}</aside></>;
}

function SidebarFlyout({ label, links, top, route, onNavigate }) {
  const [focus, setFocus] = useState(0);
  const choose = index => { setFocus(index); onNavigate(links[index][1]); };
  const keyboard = event => { if (event.key === "ArrowDown") { event.preventDefault(); setFocus(index => (index + 1) % links.length); } if (event.key === "ArrowUp") { event.preventDefault(); setFocus(index => (index - 1 + links.length) % links.length); } if (event.key === "Enter") { event.preventDefault(); choose(focus); } };
  return <div className={`${styles.flyout} sidebar-flyout`} style={{ position: "fixed", left: "86px", top, width: "214px", zIndex: 100 }} role="menu" onKeyDown={keyboard}><strong>{label}</strong><div>{links.map(([name, path], index) => <button type="button" role="menuitem" tabIndex={index === focus ? 0 : -1} key={`${path}-${name}`} className={route === path || route.startsWith(`${path}/`) ? styles.flyoutActive : ""} onClick={() => choose(index)}>{name}</button>)}</div></div>;
}

function ProfilePopup({ user, onClose, onChangePassword, onUserUpdate }) { const [email, setEmail] = useState(user?.email || "admin@example.com"); const [saved, setSaved] = useState(false); const save = event => { event.preventDefault(); onUserUpdate?.({ ...user, email }); setSaved(true); setTimeout(onClose, 600); }; return <div className={styles.popup}><div className={styles.popupHeader}><b>Profile</b><button type="button" onClick={onClose}>×</button></div><form onSubmit={save}><label>Username<input value={user?.username || "admin"} readOnly /></label><label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} /></label><button type="button" className={styles.passwordLink} onClick={onChangePassword}>Change Password</button>{saved && <small className={styles.success}>Profile saved</small>}<div className={styles.popupActions}><button type="button" onClick={onClose}>Cancel</button><button className={styles.saveButton}>Save</button></div></form></div>; }
function SettingsPopup({ theme, onToggleTheme, onClose, user, token }) { return <div className={`${styles.popup} ${styles.settingsPopup}`}><div className={styles.popupHeader}><b>Settings</b><button type="button" onClick={onClose}>×</button></div><CompanyProfileForm user={user} token={token} /><div className={styles.appearance}><span>Appearance</span><div><span>☀ Light</span><button type="button" className={`${styles.themeToggle} ${theme === "dark" ? styles.darkToggle : ""}`} onClick={onToggleTheme} aria-label="Toggle theme"><i/></button><span>Dark ☾</span></div></div><div className={styles.popupActions}><button type="button" onClick={onClose}>Close</button></div></div>; }
function ChangePasswordPopup({ onClose }) { const [message, setMessage] = useState(""); const submit = event => { event.preventDefault(); setMessage("Password update requires the configured account service."); }; return <div className={styles.popup}><div className={styles.popupHeader}><b>Change Password</b><button type="button" onClick={onClose}>×</button></div><form onSubmit={submit}><label>Current Password *<input type="password" required /></label><label>New Password *<input type="password" required /></label><label>Confirm Password *<input type="password" required /></label>{message && <small className={styles.success}>{message}</small>}<div className={styles.popupActions}><button type="button" onClick={onClose}>Cancel</button><button className={styles.saveButton}>Update Password</button></div></form></div>; }
