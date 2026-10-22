// Enhance table containers without altering their rows, controls or layout.
export function enableTableScrolling(root) {
  const prepare = () => {
    // Components with their own bounded scroll area must keep their height contract.
    const tables = [...root.querySelectorAll("table:not([data-own-scroll])")];
    // Column count drives the minimum readable table width on compact screens
    // (see "Data tables below 1024px" in styles/responsive-layout.css).
    tables.forEach(table => {
      const rows = [...(table.tHead?.rows || []), table.tBodies[0]?.rows[0]].filter(Boolean);
      const cols = Math.max(0, ...rows.map(row => [...row.cells].reduce((sum, cell) => sum + (cell.colSpan || 1), 0)));
      if (cols && table.style.getPropertyValue("--table-cols") !== String(cols)) table.style.setProperty("--table-cols", cols);
    });
    const containers = new Set(tables.map(table => table.parentElement));
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
