import "../styles/list-toolbar.css";
import PageBreadcrumb from "./PageBreadcrumb";
import ListFilters from "./ListFilters/ListFilters";

export default function ListPageToolbar({ eyebrow = "MASTERS", title, root, rootPath, current, onBack, search, onSearch, placeholder = "Search...", filters = [], action, children }) {
  const breadcrumbRoot = root || ({ MASTERS: "Masters", CUSTOMERS: "Customers", REPORTS: "Reports", TRANSACTIONS: "Transactions", LOANS: "Transactions" }[eyebrow] || "Masters");
  return <div className="list-toolbar-row"><div className="list-toolbar-title"><PageBreadcrumb current={current || title} onBack={onBack} /></div><div className="list-toolbar-controls"><input value={search ?? ""} onChange={event => onSearch?.(event.target.value)} placeholder={placeholder} aria-label={`Search ${title}`} /><ListFilters filters={filters} />{children}{action}</div></div>;
}
