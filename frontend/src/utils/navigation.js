// Shared in-app navigation history. Every in-app navigation records its depth in
// history.state (appIdx), so the page Back arrow can tell whether a real previous
// in-app page exists: if so it uses the browser history (exact previous page, same as
// the browser Back button); otherwise (direct load / refresh of the first page) it
// opens the Dashboard. The depth survives a page refresh because browsers keep
// history.state across reloads.
const BASE_PATH = "/chitfund";
let navigator = null;

export function setNavigator(fn) { navigator = fn; }

export function historyIndex() {
  try { return Number(window.history.state?.appIdx) || 0; } catch { return 0; }
}

export function pushRoute(path) {
  window.history.pushState({ appIdx: historyIndex() + 1 }, "", `${BASE_PATH}${path}`);
}

// Marks the first entry of a session (direct load) as depth 0 without losing a depth
// already recorded for this entry (refresh).
export function initHistoryIndex() {
  try { if (window.history.state?.appIdx == null) window.history.replaceState({ ...(window.history.state || {}), appIdx: 0 }, ""); } catch { /* ignore */ }
}

export function canGoBack() { return historyIndex() > 0; }

export function goBack(fallback = "/dashboard") {
  if (canGoBack()) window.history.back();
  else if (navigator) navigator(fallback);
  else window.location.assign(`${BASE_PATH}${fallback}`);
}
