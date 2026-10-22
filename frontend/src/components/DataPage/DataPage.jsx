// Reusable layout for List / Report / data-grid pages (GLOBAL UI STANDARD, see
// styles/data-page.css): a full-height white container with the table at the top,
// flexible white space, and the pagination / report footer pinned to the bottom.
// New pages should use these wrappers; existing pages apply the same `DATA` classes
// to their own elements so their markup and styling stay unchanged.
export const DATA = {
  page: "data-page",
  fill: "data-fill",
  container: "data-container",
  tableArea: "data-table-area",
  footer: "data-footer",
};

const join = (...names) => names.filter(Boolean).join(" ");

export function DataPage({ as: Tag = "div", className, children, ...props }) {
  return <Tag className={join(DATA.page, className)} {...props}>{children}</Tag>;
}

export function DataContainer({ as: Tag = "section", className, children, ...props }) {
  return <Tag className={join(DATA.container, className)} {...props}>{children}</Tag>;
}

export function DataTableArea({ as: Tag = "div", className, children, ...props }) {
  return <Tag className={join(DATA.tableArea, className)} {...props}>{children}</Tag>;
}

export function DataFooter({ as: Tag = "footer", className, children, ...props }) {
  return <Tag className={join(DATA.footer, className)} {...props}>{children}</Tag>;
}
