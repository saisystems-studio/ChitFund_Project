import "../styles/list-toolbar.css";
import PageBreadcrumb from "./PageBreadcrumb";

export default function ListPageToolbar({ eyebrow = "MASTERS", title, root, rootPath, current, onBack, search, onSearch, placeholder = "Search...", filters = [], action, children }) {
  const breadcrumbRoot = root || ({ MASTERS: "Masters", CUSTOMERS: "Customers", REPORTS: "Reports", TRANSACTIONS: "Transactions", LOANS: "Transactions" }[eyebrow] || "Masters");
  return <div className="list-toolbar-row"><div className="list-toolbar-title"><PageBreadcrumb root={breadcrumbRoot} rootPath={rootPath} current={current || title} onBack={onBack} /></div><div className="list-toolbar-controls"><input value={search ?? ""} onChange={event => onSearch?.(event.target.value)} placeholder={placeholder} aria-label={`Search ${title}`} />{filters.map(filter => <select key={filter.label} value={filter.value} onChange={event => filter.onChange?.(event.target.value)} aria-label={filter.label}>{filter.options.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}</select>)}{children}{action}</div></div>;
}
