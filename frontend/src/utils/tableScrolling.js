// Enhance table containers without altering their rows, controls or layout.
export function enableTableScrolling(root) {
  const prepare = () => {
    const containers = new Set([...root.querySelectorAll("table")].map(table => table.parentElement));
    root.querySelectorAll('[data-scroll-grid]').forEach(node => containers.add(node));
    containers.forEach(node => {
      if (!node || node.matches("table,thead,tbody,tr")) return;
      node.classList.add("scrollable-grid");
      if (!node.hasAttribute("tabindex")) node.tabIndex = 0;
      if (!node.hasAttribute("aria-label")) node.setAttribute("aria-label", "Scrollable table. Use arrow keys, Page Up, Page Down, Home or End.");
    });
  };
  const keydown = event => {
    if (event.defaultPrevented || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    const grid = event.target.closest(".scrollable-grid");
    if (!grid || grid.scrollHeight <= grid.clientHeight) return;
    const positions = { ArrowUp: grid.scrollTop - 40, ArrowDown: grid.scrollTop + 40, PageUp: grid.scrollTop - grid.clientHeight, PageDown: grid.scrollTop + grid.clientHeight, Home: 0, End: grid.scrollHeight };
    if (!(event.key in positions)) return;
    event.preventDefault(); grid.scrollTop = positions[event.key];
  };
  prepare();
  const observer = new MutationObserver(prepare);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("keydown", keydown);
  return () => { observer.disconnect(); root.removeEventListener("keydown", keydown); };
}
