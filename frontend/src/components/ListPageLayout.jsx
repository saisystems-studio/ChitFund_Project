import "../styles/list-page.css";
import PageBreadcrumb from "./PageBreadcrumb";

export default function ListPageLayout({ eyebrow = "Masters", root, title, subtitle, action, onBack, children, className = "" }) {
  const contextualRoot = root || ({ MASTERS: "Masters", CUSTOMERS: "Customers", REPORTS: "Reports", TRANSACTIONS: "Transactions", LOANS: "Transactions" }[eyebrow] || eyebrow);
  return <div className={`list-page ${className}`}>
    <header className="list-page-header"><div><PageBreadcrumb root={contextualRoot} current={title} onBack={onBack} />{subtitle && <p className="list-page-subtitle">{subtitle}</p>}</div>{action && <div className="list-page-action">{action}</div>}</header>
    {children}
  </div>;
}

export function ListContainer({ children, className = "" }) { return <section className={`list-container ${className}`}>{children}</section>; }
