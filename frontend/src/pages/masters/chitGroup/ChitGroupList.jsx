import { useCompanyProfile } from "../../../components/CompanyProfileContext";
import { useEffect, useState } from "react";
import { actionToast } from "../../../utils/actionToast";
import apiErrorMessage from "../../../utils/apiErrorMessage";
import styles from "./ChitGroupList.module.css";
import { formatINR, formatINRNumber } from "../../../utils/currency";
import ListPageToolbar from "../../../components/ListPageToolbar";
import "./chit-group-list-saas.css";
import "./chit-group-list-pagination.css";
import "./chit-group-list-active-style.css";
import "./chit-group-ui-final.css";

import { downloadChitPdf, dateLabel } from "../../../utils/chitPdf";

const money = formatINR;
const durationLabel = value => value === "DAY" ? "Days" : value === "MONTH" ? "Months" : "Years";
const collectionDayLabel = value => {
  const day = Number(String(value || "").slice(0, 10).split("-")[2]);
  if (!day) return "-";
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  return `${day}${suffix}`;
};
const EditIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m4 16-.7 4 4-.7L18.8 7.8a2.1 2.1 0 0 0-3-3L4 16Z"/><path d="m14.5 6.5 3 3"/></svg>;
const TrashIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>;
const PowerIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2v10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/><path d="M7.05 5.8a8 8 0 1 0 9.9 0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg>;

export default function ChitGroupList({ api, auth, go }) {
  const { profile } = useCompanyProfile();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [confirmItem, setConfirmItem] = useState(null);
  const [expandedMobile, setExpandedMobile] = useState(null);

  const load = () => {
    setLoading(true);
    api.get("/finance/chit-groups/", { ...auth, params: { search } })
      .then(({ data }) => setItems([...(data.results ?? data)].sort((a, b) => Number(b.is_active !== false) - Number(a.is_active !== false))))
      .catch(() => setError("Unable to load Chit Groups."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [search]);

  const viewDetails = async item => {
    setError("");
    try {
      const { data } = await api.get(`/finance/chit-groups/${item.id}/`, auth);
      setSelected(data);
    } catch {
      setError("Unable to load Chit Group details.");
    }
  };

  const deleteRecord = async () => {
    if (!confirmItem) return;
    try {
      await api.delete(`/finance/chit-groups/${confirmItem.id}/`, auth);
      setConfirmItem(null);
      actionToast("Chit Group deleted successfully.");
      load();
    } catch (requestError) {
      setConfirmItem(null);
      actionToast(apiErrorMessage(requestError, "Unable to delete Chit Group."), false);
    }
  };

  const toggleActive = async item => {
    setError("");
    try {
      await api.patch(`/finance/chit-groups/${item.id}/`, { is_active: !item.is_active }, auth);
      load();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to update Chit Group status.");
    }
  };

  return <div className={`${styles.page} chit-group-list-page`}>
    <ListPageToolbar eyebrow="MASTERS" title="Chit Groups" search={search} onSearch={setSearch} placeholder="Search chit groups..." action={<button className={styles.primary} onClick={() => go("/chit-groups/new")}>+ Add Chit Group</button>} />
    {error && <div className={styles.error}>{error}</div>}
    <section className={`${styles.surface} list-container listContainer`}>
      <div className={`${styles.tableWrap} tableWrapper`}><table><thead><tr><th>Code</th><th>Chit Group Name</th><th>Duration</th><th>Duration Type</th><th>Start Date</th><th>End Date</th><th>Collection Date</th><th>Status</th></tr></thead><tbody>
        {items.map(item => <tr className="clickable-data-row" tabIndex="0" key={item.id} onClick={() => viewDetails(item)} onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button,a,input,select,textarea")) { event.preventDefault(); viewDetails(item); } }}><td className={styles.code}>{item.code}</td><td><strong>{item.name}</strong></td><td>{item.duration}</td><td>{durationLabel(item.duration_type)}</td><td>{dateLabel(item.start_date)}</td><td>{dateLabel(item.end_date)}</td><td>{dateLabel(item.collection_date)}</td><td className={styles.rowActionCell}><span className={styles.status}>{item.is_active ? "Active" : "Inactive"}</span><div className={styles.actions}>
          <button className={styles.editAction} title="Edit" aria-label="Edit" onClick={event => { event.stopPropagation(); go(`/chit-groups/${item.id}/edit`); }}><EditIcon /></button>
          <button className={styles.deleteAction} title="Delete" aria-label="Delete" onClick={event => { event.stopPropagation(); setConfirmItem(item); }}><TrashIcon /></button>
          <button className={styles.toggleAction} title={item.is_active ? "Deactivate" : "Activate"} aria-label={item.is_active ? "Deactivate" : "Activate"} onClick={event => { event.stopPropagation(); toggleActive(item); }}><PowerIcon /></button>
        </div></td></tr>)}
      </tbody></table>{loading ? <div className={styles.empty}>Loading Chit Groups...</div> : !items.length && <div className={styles.empty}>No Chit Groups found.</div>}</div>
      <div className={styles.mobileCards}>{items.map((item, index) => { const open = expandedMobile === item.id; return <article className={styles.mobileCard} key={item.id}><div className={styles.mobileCardMain}><b>{index + 1}</b><strong>{item.name || "-"}</strong><span className={styles.status}>{item.is_active ? "Active" : "Inactive"}</span></div>{open && <div className={styles.mobileDetails}><span><small>Code</small><b>{item.code || "-"}</b></span><span><small>Duration</small><b>{item.duration ?? "-"} {durationLabel(item.duration_type)}</b></span><span><small>Collection Date</small><b>{dateLabel(item.collection_date)}</b></span><span><small>Status</small><b>{item.is_active ? "Active" : "Inactive"}</b></span><span><small>Start Date</small><b>{item.start_date || "-"}</b></span><span><small>End Date</small><b>{item.end_date || "-"}</b></span></div>}<div className={styles.mobileCardActions}><button type="button" onClick={() => setExpandedMobile(open ? null : item.id)}>{open ? "View Less ▲" : "View More ▼"}</button><button type="button" className={styles.editAction} aria-label="Edit" onClick={() => go(`/chit-groups/${item.id}/edit`)}><EditIcon /></button><button type="button" className={styles.deleteAction} aria-label="Delete" title="Delete" onClick={() => setConfirmItem(item)}><TrashIcon /></button><button type="button" className={styles.toggleAction} aria-label={item.is_active ? "Deactivate" : "Activate"} title={item.is_active ? "Deactivate" : "Activate"} onClick={() => toggleActive(item)}><PowerIcon /></button></div></article>; })}</div>
      <div className={`${styles.footer} paginationFooter`}><span>Showing {items.length ? `1-${items.length}` : 0} of {items.length}</span><div>Previous&nbsp;&nbsp; 1 &nbsp;&nbsp; Next</div></div>
    </section>

    {selected && <div className={styles.modalBackdrop} onMouseDown={event => event.target === event.currentTarget && setSelected(null)}><div className={styles.detailModal} role="dialog" aria-modal="true">
      <header><h2>Chit Group Details</h2><div className="detail-modal-actions"><button className={styles.closeButton} onClick={() => setSelected(null)}>×</button></div></header>
      <div className="detailsRow"><div>Group Code : <b>{selected.code || "-"}</b></div><div>Group Name : <b>{selected.name || "-"}</b></div><div>Duration : <b>{selected.duration != null ? `${selected.duration} ${durationLabel(selected.duration_type)}` : "-"}</b></div><div>Chit Amount : <b>{selected.total_amount == null && selected.grand_total == null ? "-" : `INR ${formatINRNumber(selected.total_amount ?? selected.grand_total)}`}</b></div><div>Start Date : <b>{dateLabel(selected.start_date)}</b></div><div>Collection Date : <b>{collectionDayLabel(selected.collection_date)}</b></div></div>
      {(() => { const allInstallments = [...(selected.installments || selected.template_installments || [])].sort((a, b) => (a.installment_number || a.installment_no || 0) - (b.installment_number || b.installment_no || 0)); return <><h3>INSTALLMENT SCHEDULE</h3><div className={styles.detailTable}><table><thead><tr><th>S.No</th><th>Schedule</th><th>Installment Amount</th></tr></thead><tbody>{allInstallments.map((row, index) => <tr key={row.id || index}><td>{row.installment_number || row.installment_no || index + 1}</td><td>{row.schedule_value ?? row.schedule ?? row.template_date ?? "-"}</td><td>{money(row.installment_amount ?? row.amount ?? 0)}</td></tr>)}{!allInstallments.length && <tr><td colSpan="3" className={styles.noInstallments}>No installments found.</td></tr>}</tbody></table></div></>; })()}
      <footer><strong></strong><div><button className={styles.primary} onClick={() => downloadChitPdf(selected, profile)}>PDF</button> <button className={styles.primary} onClick={() => setSelected(null)}>Close</button></div></footer>
    </div></div>}

    {confirmItem && <div className={styles.modalBackdrop}><div className={styles.confirmModal} role="dialog" aria-modal="true"><h2>Delete Chit Group?</h2><p>Are you sure you want to delete this record?</p><footer><button onClick={() => setConfirmItem(null)}>Cancel</button><button className={styles.dangerButton} onClick={deleteRecord}>Delete</button></footer></div></div>}
  </div>;
}


