// Route + double-click helpers for the Report Details ("View More") page.
//
//   /report-detail/<kind>/<id>[/<extra>]
//
// `kind`: voucher (id = voucher / loan number), loan, ledger, group. `extra` is one
// URL-encoded query string (date range, report name...) kept inside the path because the
// app router matches pathnames only. The report page stays mounted underneath (see
// App.jsx), so its filters, search, sorting, pagination and scroll are never lost.
export const DETAIL_ROUTE = /^\/report-detail\/([a-z]+)\/([^/]+)(?:\/([^/]*))?$/;

export function detailPath(kind, id, extra = {}) {
  const query = new URLSearchParams(Object.entries(extra).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
  return `/report-detail/${kind}/${encodeURIComponent(id)}${query ? `/${encodeURIComponent(query)}` : ""}`;
}

export function parseDetailRoute(route) {
  const match = DETAIL_ROUTE.exec(route || "");
  if (!match) return null;
  try { return { kind: match[1], id: decodeURIComponent(match[2]), params: Object.fromEntries(new URLSearchParams(match[3] ? decodeURIComponent(match[3]) : "")) }; }
  catch { return null; }
}

const INTERACTIVE = "button,a,input,select,textarea,label,[role=button]";
let lastOpen = { path: "", at: 0 };

// Props to spread on a report <tr>: only a double-click opens the details page. Clicks on
// buttons / links / inputs inside the row (receipt PDF, expand arrows...) are ignored, and
// the same target is never pushed twice in a row (a repeated gesture, or the page already
// showing it), so one gesture can never stack two identical pages.
export function rowDetail(go, kind, id, extra, enabled = true) {
  if (!enabled || id === undefined || id === null || id === "") return {};
  return {
    onDoubleClick: event => {
      if (event.target.closest?.(INTERACTIVE)) return;
      const path = detailPath(kind, id, extra), now = Date.now();
      if (window.location.pathname.endsWith(path) || (lastOpen.path === path && now - lastOpen.at < 1000)) return;
      lastOpen = { path, at: now };
      window.getSelection?.()?.removeAllRanges();
      go(path);
    },
    title: "Double-click to view more",
  };
}
