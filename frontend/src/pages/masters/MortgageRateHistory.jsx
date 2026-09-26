import { useEffect, useState } from "react";
import ListPageToolbar from "../../components/ListPageToolbar";
import { formatINR } from "../../utils/currency";
import "./MortgageMaster.css";

const dateLabel = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-";

export default function MortgageRateHistory({ api, auth }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api.get("/finance/mortgages/rate-history/", { ...auth, params: { search } })
      .then(({ data }) => { setItems(data); setError(""); })
      .catch(() => setError("Unable to load Mortgage Rate History."));
  }, [search]);
  return <div className="mortgage-master-page">
    <ListPageToolbar eyebrow="MASTER SUMMARY" root="Master Summary" title="Mortgage Rate History" search={search} onSearch={setSearch} placeholder="Search product name..." />
    {error && <div className="error mortgage-error">{error}</div>}
    <section className="panel list-container mortgage-master-surface">
      <div className="table-wrap"><table><thead><tr><th>S.No</th><th>Product Name</th><th>Date</th><th>Rate</th></tr></thead><tbody>{items.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td><strong>{row.product_name}</strong></td><td>{dateLabel(row.date)}</td><td>{formatINR(row.rate)}</td></tr>)}</tbody></table>{!items.length && <div className="empty">No rate history found.</div>}</div>
      <footer className="footer paginationFooter"><span>Showing {items.length ? `1-${items.length}` : 0} of {items.length}</span></footer>
    </section>
  </div>;
}
