import { useEffect, useState } from "react";
import styles from "./ChitGroupList.module.css";
import { formatINR } from "../../../utils/currency";
import ListPageToolbar from "../../../components/ListPageToolbar";
import "./chit-group-list-saas.css";
import "./chit-group-list-pagination.css";
import "./chit-group-list-active-style.css";
import "./chit-group-ui-final.css";

const money = formatINR;
const durationLabel = value => value === "DAY" ? "Days" : value === "MONTH" ? "Months" : "Years";

export default function ChitGroupList({ api, auth, go }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [confirmItem, setConfirmItem] = useState(null);
  const [detailPage, setDetailPage] = useState(1);
  const [expandedMobile, setExpandedMobile] = useState(null);
  const [detailTableOpen, setDetailTableOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get("/finance/chit-groups/", { ...auth, params: { search } })
      .then(({ data }) => setItems(data.results ?? data))
      .catch(() => setError("Unable to load Chit Groups."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [search]);

  const viewDetails = async item => {
    setError("");
    try {
      const { data } = await api.get(`/finance/chit-groups/${item.id}/`, auth);
      setSelected(data);
      setDetailPage(1);
      setDetailTableOpen(false);
    } catch {
      setError("Unable to load Chit Group details.");
    }
  };

  const deleteRecord = async () => {
    if (!confirmItem) return;
    try {
      await api.delete(`/finance/chit-groups/${confirmItem.id}/`, auth);
      setConfirmItem(null);
      load();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to delete Chit Group.");
    }
  };

  return <div className={`${styles.page} chit-group-list-page`}>
    <ListPageToolbar eyebrow="MASTERS" title="Chit Groups" search={search} onSearch={setSearch} placeholder="Search chit groups..." action={<button className={styles.primary} onClick={() => go("/chit-groups/new")}>+ Add Chit Group</button>} />
    {error && <div className={styles.error}>{error}</div>}
    <section className={`${styles.surface} list-container`}>
      <div className={styles.tableWrap}><table><thead><tr><th>Code</th><th>Chit Group Name</th><th>Duration</th><th>Duration Type</th><th>Grand Total</th><th>Status</th><th>More</th></tr></thead><tbody>
        {items.map(item => <tr key={item.id}><td className={styles.code}>{item.code}</td><td><strong>{item.name}</strong></td><td>{item.duration}</td><td>{durationLabel(item.duration_type)}</td><td>{money(item.grand_total)}</td><td><span className={styles.status}>{item.is_active ? "Active" : "Inactive"}</span></td><td><div className={styles.actions}>
          <button className={styles.viewAction} title="View Details" aria-label="View Details" onClick={() => viewDetails(item)}>👁</button>
          <button className={styles.editAction} title="Edit" aria-label="Edit" onClick={() => go(`/chit-groups/${item.id}/edit`)}>✎</button>
          <button className={styles.deleteAction} title="Delete" aria-label="Delete" onClick={() => setConfirmItem(item)}>⌫</button>
        </div></td></tr>)}
      </tbody></table>{loading ? <div className={styles.empty}>Loading Chit Groups...</div> : !items.length && <div className={styles.empty}>No Chit Groups found.</div>}</div>
      <div className={styles.mobileCards}>{items.map((item, index) => { const open = expandedMobile === item.id; return <article className={styles.mobileCard} key={item.id}><div className={styles.mobileCardMain}><b>{index + 1}</b><strong>{item.name || "-"}</strong><span className={styles.status}>{item.is_active ? "Active" : "Inactive"}</span></div>{open && <div className={styles.mobileDetails}><span><small>Code</small><b>{item.code || "-"}</b></span><span><small>Duration</small><b>{item.duration ?? "-"} {durationLabel(item.duration_type)}</b></span><span><small>Grand Total</small><b>{money(item.grand_total)}</b></span><span><small>Status</small><b>{item.is_active ? "Active" : "Inactive"}</b></span><span><small>Start Date</small><b>{item.start_date || "-"}</b></span><span><small>End Date</small><b>{item.end_date || "-"}</b></span></div>}<div className={styles.mobileCardActions}><button type="button" onClick={() => setExpandedMobile(open ? null : item.id)}>{open ? "View Less ▲" : "View More ▼"}</button><button type="button" className={styles.editAction} aria-label="Edit" onClick={() => go(`/chit-groups/${item.id}/edit`)}>✎</button><button type="button" className={styles.deleteAction} aria-label="Delete" title="Delete" onClick={() => setConfirmItem(item)}>⌫</button></div></article>; })}</div>
      <footer className={styles.footer}>Showing {items.length ? `1-${items.length}` : 0} of {items.length}<span>Previous&nbsp;&nbsp; 1 &nbsp;&nbsp; Next</span></footer>
    </section>

    {selected && <div className={styles.modalBackdrop} onMouseDown={event => event.target === event.currentTarget && setSelected(null)}><div className={`${styles.detailModal} ${detailTableOpen ? "details-table-open" : ""}`} role="dialog" aria-modal="true">
      <header><h2>Chit Group Details</h2><div className="detail-modal-actions"><button type="button" className="detail-table-toggle" onClick={() => setDetailTableOpen(value => !value)} aria-expanded={detailTableOpen} aria-label={detailTableOpen ? "Show group details" : "Show installment table"}>{detailTableOpen ? "−" : "+"}</button><button className={styles.closeButton} onClick={() => setSelected(null)}>×</button></div></header>
      <div className={styles.detailGrid}><span>Group Code<strong>{selected.code || "-"}</strong></span><span>Group Name<strong>{selected.name || "-"}</strong></span><span>Duration Type<strong>{durationLabel(selected.duration_type)}</strong></span><span>Duration<strong>{selected.duration ?? "-"}</strong></span><span>Grand Total<strong>{money(selected.grand_total)}</strong></span><span>Status<strong>{selected.is_active ? "Active" : "Inactive"}</strong></span><span>Created By<strong>{selected.created_by || "-"}</strong></span><span>Created Date<strong>{selected.create_date ? new Date(selected.create_date).toLocaleDateString("en-IN") : "-"}</strong></span></div>
      {(() => { const allInstallments = [...(selected.installments || selected.template_installments || [])].sort((a, b) => (a.installment_number || a.installment_no || 0) - (b.installment_number || b.installment_no || 0)); const pageSize = 5; const pageCount = Math.max(1, Math.ceil(allInstallments.length / pageSize)); const visible = allInstallments.slice((detailPage - 1) * pageSize, detailPage * pageSize); return <><h3>INSTALLMENT SCHEDULE</h3><div className={styles.detailTable}><table><thead><tr><th>S.No</th><th>Schedule</th><th>Installment Amount</th></tr></thead><tbody>{visible.map((row, index) => <tr key={row.id || index}><td>{row.installment_number || row.installment_no || (detailPage - 1) * pageSize + index + 1}</td><td>{row.schedule_value ?? row.schedule ?? row.template_date ?? "-"}</td><td>{money(row.installment_amount ?? row.amount ?? 0)}</td></tr>)}{!visible.length && <tr><td colSpan="3" className={styles.noInstallments}>No installments found.</td></tr>}</tbody></table></div><div className={styles.detailPagination}><span>Showing {allInstallments.length ? (detailPage - 1) * pageSize + 1 : 0}-{Math.min(detailPage * pageSize, allInstallments.length)} of {allInstallments.length}</span><div><button aria-label="Previous page" disabled={detailPage === 1} onClick={() => setDetailPage(value => value - 1)}>Previous</button>{Array.from({ length: pageCount }, (_, index) => <button className={detailPage === index + 1 ? styles.currentPage : ""} key={index + 1} onClick={() => setDetailPage(index + 1)}>{index + 1}</button>)}<button aria-label="Next page" disabled={detailPage === pageCount} onClick={() => setDetailPage(value => value + 1)}>Next</button></div></div></>; })()}
      <footer><strong>Grand Total: {money(selected.grand_total)}</strong><button className={styles.primary} onClick={() => setSelected(null)}>Close</button></footer>
    </div></div>}

    {confirmItem && <div className={styles.modalBackdrop}><div className={styles.confirmModal} role="dialog" aria-modal="true"><h2>Delete Chit Group?</h2><p>Are you sure you want to delete this record?</p><footer><button onClick={() => setConfirmItem(null)}>Cancel</button><button className={styles.dangerButton} onClick={deleteRecord}>Delete</button></footer></div></div>}
  </div>;
}
