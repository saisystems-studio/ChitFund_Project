import styles from "./Sidebar.module.css";

export default function AdminMenu({ user, onProfile, onSettings, onClose }) {
  return <div className={styles.adminMenu} role="menu">
    <div className="admin-menu-identity"><b>{user?.username || "admin"}</b><small>{user?.email || "admin@example.com"}</small></div>
    <button type="button" onClick={onProfile}>› Profile</button>
    <button type="button" onClick={onSettings}>› Settings</button>
    <button type="button" className={styles.menuClose} onClick={onClose}>× Close</button>
  </div>;
}
