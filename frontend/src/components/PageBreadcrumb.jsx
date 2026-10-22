import "./PageBreadcrumb.css";
import { canGoBack, goBack } from "../utils/navigation";

// The one shared page header used across the app: a Back arrow followed by the current
// page name — no breadcrumb trail. Back returns to the actual previous page (browser
// history), or the Dashboard when there is none. `onBack` is only for pages that must
// run their own logic first (e.g. Add Ledger returning to the originating transaction).
export default function PageBreadcrumb({ current, title, onBack, className = "", children }) {
  const name = current || title;
  // On the Dashboard (the fallback target) Back is shown only when there is a real previous page.
  const showBack = onBack || canGoBack() || !/\/dashboard\/?$/.test(window.location.pathname);
  return <div className={`page-breadcrumb ${className}`.trim()}>
    {showBack && <button type="button" className="breadcrumb-back" onClick={() => (onBack ? onBack() : goBack())} aria-label="Back" title="Back">
      <svg className="back-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>}
    {name && <h1 className="page-title">{name}</h1>}
    {children}
  </div>;
}
