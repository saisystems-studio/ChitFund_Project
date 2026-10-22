# Customer-wise dropdown positioning verification

Changed application files: frontend/src/components/SearchableDropdown/SearchableDropdown.jsx, SearchableDropdown.module.css, frontend/src/pages/modules/CustomerReportDetail.jsx. QA: frontend/qa/customer-export/dropdown.mjs and harness.jsx.

The report dropdowns opt into fixed, body-portaled panels anchored directly below their fields. Search is a separate non-scrolling header inside the panel; only the list scrolls. Panel height is capped at 250px, width matches the trigger, and scroll/resize re-anchor it. Outside-click handling recognizes portal content. Existing non-portal callers are unchanged. Filter logic, APIs and totals are unchanged.

Chrome passed for both fields at 1440/800/390px: closed panels have no search inputs; opening anchors correctly; panel width and maximum height match requirements; options pass hit-testing above the table; a 42-customer fixture verifies internal scrolling without moving search; search filters immediately; selection, clear and outside-click close correctly. Existing report regression passed both selection orders, customer/loan switching, stale-response rejection, navigation reset, period/Show Balance, PDF and numeric XLSX downloads, matching DR50/CR20/closing30, and no console exceptions. 41 frontend tests and production build passed (existing bundle-size warning).

Artifacts: docs/customer-export-qa-CrNeFf. No data writes, pushes or deployment.
