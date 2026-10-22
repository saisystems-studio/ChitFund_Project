import {useEffect,useState} from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import RowActions from "../../components/RowActions";
import ReportExportButtons from "../../components/ReportExportButtons/ReportExportButtons";
import {useCompanyProfile} from "../../components/CompanyProfileContext";
import {fetchAllPages} from "../../utils/pendingReport";
import {periodRange,PERIOD_OPTIONS} from "../../utils/periodRange";
import {formatINR} from "../../utils/currency";
import {downloadReportPdf,printReportPdf} from "../../utils/reportPdf";
import {downloadReportExcel} from "../../utils/reportExcel";
import apiErrorMessage from "../../utils/apiErrorMessage";
import confirmDelete from "../../utils/confirmDelete";
import BankTransferForm from "./BankTransferForm";
import {ENDPOINT,TRANSACTION_TYPES,typeLabel,modeLabel,filterTransfers} from "./bankTransfer";
import "./bank-transfers.css";
import { rowDetail } from "../reportDetail/reportDetailRoute";
const headers=["Voucher No","Date","Transaction","From","To","Amount","Payment Mode","Notes"];
const AMOUNT=5;
export default function BankTransferHistory({api,auth,go}){
 const {profile}=useCompanyProfile()||{};
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [search,setSearch]=useState(""),[type,setType]=useState(""),[period,setPeriod]=useState("All"),[from,setFrom]=useState(""),[to,setTo]=useState("");
 const [page,setPage]=useState(1),[reload,setReload]=useState(0),[editing,setEditing]=useState(null),[viewing,setViewing]=useState(null),[busy,setBusy]=useState(false),[exportBusy,setExportBusy]=useState(null);
 useEffect(()=>{let active=true;setLoading(true);setError("");fetchAllPages(api,ENDPOINT,auth).then(data=>{if(active)setRows(data);}).catch(e=>{if(active)setError(apiErrorMessage(e,"Unable to load bank transfers."));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reload]);
 useEffect(()=>{setPage(1);},[search,type,period,from,to]);
 const range=periodRange(period,from,to),invalidRange=range.from&&range.to&&range.from>range.to;
 const filtered=invalidRange?[]:filterTransfers(rows,{search,type,...range});
 const pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages),visible=filtered.slice((current-1)*20,current*20);
 const values=row=>[row.voucher_no,row.date,typeLabel(row.transaction_type),row.from_account_name,row.to_account_name,Number(row.amount),modeLabel(row.payment_mode)||"—",row.notes||""];
 const subtitle=[type&&typeLabel(type),period,range.from&&`From ${range.from}`,range.to&&`To ${range.to}`,search&&`Search: ${search}`].filter(Boolean).join(" | ");
 const pdfOptions=()=>({title:"Bank Transactions",profile,filtersLine:subtitle,columns:headers.map((header,index)=>({header,align:index===AMOUNT?"right":"left"})),rows:filtered.map(row=>values(row).map((value,index)=>index===AMOUNT?formatINR(value):value))});
 const output=async kind=>{if(exportBusy)return;setExportBusy(kind);setError("");try{
 if(kind==="excel")await downloadReportExcel({filename:"Bank_Transactions",title:"Bank Transactions",subtitle,columns:headers.map((header,index)=>({header,width:index===3||index===4||index===7?26:18,numeric:index===AMOUNT})),rows:filtered.map(values)});
 else if(kind==="print")await printReportPdf(pdfOptions());else await downloadReportPdf(pdfOptions(),"Bank_Transactions");
 }catch(e){setError(apiErrorMessage(e,"Unable to export transfers."));}finally{setExportBusy(null);}};
 const remove=async row=>{if(busy||!await confirmDelete(`Delete ${row.voucher_no}? Its From (Cr) and To (Dr) postings will be reversed.`))return;setBusy(true);setError("");try{await api.delete(`${ENDPOINT}${row.id}/`,auth);setReload(value=>value+1);}catch(e){setError(apiErrorMessage(e,"Unable to delete the transfer."));}finally{setBusy(false);}};
 return <div className="bt-page bt-history-page">
 <div className="bt-history-toolbar"><PageBreadcrumb current="Bank Transactions History"/>
 <div className="bt-history-controls"><input aria-label="Search bank transfers" placeholder="Search transfers..." value={search} onChange={event=>setSearch(event.target.value)}/>
 <SearchableSelect aria-label="Transaction Type" value={type} onChange={event=>setType(event.target.value)}><option value="">All Transactions</option>{TRANSACTION_TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</SearchableSelect>
 <SearchableSelect aria-label="Period" value={period} onChange={event=>setPeriod(event.target.value)}><option value="All">All Periods</option>{PERIOD_OPTIONS.map(value=><option key={value}>{value}</option>)}</SearchableSelect>
 {period==="Custom Range"&&<><label className="bt-date-filter">From<input aria-label="From Date" type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label className="bt-date-filter">To<input aria-label="To Date" type="date" min={from||undefined} value={to} onChange={event=>setTo(event.target.value)}/></label></>}
 <ReportExportButtons onPdf={()=>output("pdf")} onExcel={()=>output("excel")} onPrint={()=>output("print")} busy={exportBusy} disabled={loading||!filtered.length}/>
 <button type="button" className="bt-button bt-primary" onClick={()=>go("/bank-deposit-transaction")}>+ New Transaction</button></div></div>
 {(error||invalidRange)&&<p role="alert" className="bt-error">{error||"From Date must not be after To Date."}</p>}
 <section className="bt-history-container"><div className="bt-table-scroll" tabIndex={0} role="region" aria-label="Bank transfer history"><table className="bt-history-table"><thead><tr>{headers.map(header=><th key={header}>{header}</th>)}<th>Actions</th></tr></thead><tbody>{visible.map(row=><tr key={row.id} {...rowDetail(go,"voucher",`BT-${String(row.id).padStart(6,"0")}`)}>{values(row).map((value,index)=><td key={index} className={index===AMOUNT?"bt-number":index===7?"bt-notes-cell":""} title={index===7?value:undefined}>{index===AMOUNT?formatINR(value):value}</td>)}<td><RowActions disabled={busy} onView={()=>setViewing(row)} onEdit={()=>setEditing(row.id)} onDelete={()=>remove(row)}/></td></tr>)}</tbody></table>{!visible.length&&<p className="bt-message">{loading?"Loading transactions...":"No transactions found."}</p>}</div>
 <footer className="bt-history-footer"><span>Showing {filtered.length?((current-1)*20+1):0}-{Math.min(current*20,filtered.length)} of {filtered.length} records</span><div><button type="button" className="bt-button" disabled={current===1} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current} of {pages}</span><button type="button" className="bt-button" disabled={current===pages} onClick={()=>setPage(current+1)}>Next</button></div></footer></section>
 {editing!=null&&<div className="bt-modal-backdrop"><div className="bt-edit-modal" role="dialog" aria-modal="true" aria-label="Edit Bank Transaction"><BankTransferForm api={api} auth={auth} id={editing} go={go} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setReload(value=>value+1);}}/></div></div>}
 {viewing&&<div className="bt-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setViewing(null);}}><div className="bt-edit-modal bt-view-modal" role="dialog" aria-modal="true" aria-label="Bank Transaction details"><div className="bt-edit-heading"><h2>{viewing.voucher_no}</h2><button type="button" className="bt-button" onClick={()=>setViewing(null)}>Close</button></div>
 <dl className="bt-view-grid">{headers.map((header,index)=><div key={header}><dt>{header}</dt><dd>{index===AMOUNT?formatINR(values(viewing)[index]):values(viewing)[index]||"—"}</dd></div>)}</dl>
 <div className="bt-preview"><div className="bt-preview-row bt-credit"><span>FROM</span><strong>{viewing.from_account_name}</strong><b>−{formatINR(viewing.amount)} (Cr)</b></div><div className="bt-preview-row bt-debit"><span>TO</span><strong>{viewing.to_account_name}</strong><b>+{formatINR(viewing.amount)} (Dr)</b></div></div>
 </div></div>}
 </div>;
}
