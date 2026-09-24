import "./PageBreadcrumb.css";

export default function PageBreadcrumb({ className = "" }) {
  return <div className={`page-breadcrumb ${className}`.trim()}><button type="button" className="breadcrumb-back" onClick={() => window.history.back()} aria-label="Back" title="Back"><svg className="back-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button></div>;
}
