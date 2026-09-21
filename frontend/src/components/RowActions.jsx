function ActionIcon({ name }) {
  const paths = {
    view: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/></>,
    edit: <><path d="m4 16-.7 4 4-.7L18.8 7.8a2.1 2.1 0 0 0-3-3L4 16Z"/><path d="m14.5 6.5 3 3"/></>,
    delete: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function RowActions({ onView, onEdit, onDelete, className = "" }) {
  return <div className={`action-group ${className}`.trim()}>
    {onView && <Tooltip label="View"><button type="button" className="action-view" aria-label="View" onClick={event => { event.stopPropagation(); onView(event); }}><ActionIcon name="view" /></button></Tooltip>}
    {onEdit && <Tooltip label="Edit"><button type="button" className="action-edit" aria-label="Edit" onClick={event => { event.stopPropagation(); onEdit(event); }}><ActionIcon name="edit" /></button></Tooltip>}
    {onDelete && <Tooltip label="Delete"><button type="button" className="action-delete" aria-label="Delete" onClick={event => { event.stopPropagation(); onDelete(event); }}><ActionIcon name="delete" /></button></Tooltip>}
  </div>;
}
import Tooltip from "./Tooltip";
