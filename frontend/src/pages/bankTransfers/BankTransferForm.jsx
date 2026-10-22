import {useEffect,useState} from "react";
import PageBreadcrumb from "../../components/PageBreadcrumb";
import SearchableSelect from "../../components/SearchableSelect/SearchableSelect";
import apiErrorMessage from "../../utils/apiErrorMessage";
import {formatINR} from "../../utils/currency";
import CashDenominationModal from "../../components/CashDenominationModal";
import DenominationToggle from "../../components/DenominationToggle";
import { CASH_DENOMINATIONS,ENDPOINT,TRANSACTION_TYPES,accountGroups,blankTransfer,modesFor,validateTransfer } from "./bankTransfer";
import "./bank-transfers.css";
// Fields in order: Voucher No, Transaction, From, To, Amount, Payment Mode, Notes (Date sits in the heading).
export default function BankTransferForm({api,auth,go,id,onClose,onSaved}) {
 const [form,setForm]=useState(blankTransfer),[ledgers,setLedgers]=useState([]),[initial,setInitial]=useState(null);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 // Cash Denomination (same popup as Collection / Payment Entry): offered only for Cash mode, opens
 // only when ticked, entered on screen to count the cash (not stored with the transaction).
 const [denomEnabled,setDenomEnabled]=useState(false),[cashPopupOpen,setCashPopupOpen]=useState(false),[denomQty,setDenomQty]=useState({}),[coinsAmount,setCoinsAmount]=useState("");
 const clearDenomination=()=>{setDenomEnabled(false);setCashPopupOpen(false);setDenomQty({});setCoinsAmount("");};
 const toggleDenomination=checked=>{if(checked){setDenomEnabled(true);setCashPopupOpen(true);}else clearDenomination();};
 const cashRows=CASH_DENOMINATIONS.map(value=>({value,qty:denomQty[value]||"",amount:Number(denomQty[value]||0)*value}));
 const totalCashAmount=cashRows.reduce((sum,row)=>sum+row.amount,0)+Number(coinsAmount||0);
 const isCashMode=form.payment_mode==="Cash";
 // New entry: preview the next Voucher No from the backend (the save assigns the real one).
 const [nextVoucher,setNextVoucher]=useState("");
 const loadNextVoucher=()=>{if(id)return Promise.resolve("");return api.get(`${ENDPOINT}next-voucher/`,auth).then(({data})=>{setNextVoucher(data.voucher_no||"");return data.voucher_no||"";}).catch(()=>{setNextVoucher("");return "";});};
 useEffect(()=>{loadNextVoucher();},[id]);
 useEffect(()=>{if(!isCashMode)clearDenomination();},[isCashMode]);
 useEffect(()=>{let active=true;setLoading(true);
 Promise.all([api.get("/finance/ledgers/",auth),id?api.get(`${ENDPOINT}${id}/`,auth):Promise.resolve({data:blankTransfer()})])
 .then(([accounts,entry])=>{if(active){setLedgers(accounts.data.results??accounts.data);const data={...entry.data,payment_mode:entry.data.payment_mode||"",notes:entry.data.notes||""};setForm(data);setInitial(data);}})
 .catch(e=>{if(active)setError(apiErrorMessage(e,"Unable to load transfer accounts."));}).finally(()=>{if(active)setLoading(false);});
 clearDenomination();
 return()=>{active=false;};},[id]);
 const update=(key,value)=>{setForm(current=>({...current,[key]:value}));setError("");setSuccess("");};
 // A new Transaction keeps only the accounts / mode that still fit it.
 const chooseType=type=>{setForm(current=>{const [source,target]=accountGroups(type),groupOf=value=>ledgers.find(item=>String(item.id)===String(value))?.group;const modes=modesFor(type).map(([value])=>value);
  return {...current,transaction_type:type,from_account:groupOf(current.from_account)===source?current.from_account:"",to_account:groupOf(current.to_account)===target&&String(current.to_account)!==String(current.from_account)?current.to_account:"",payment_mode:modes.includes(current.payment_mode)?current.payment_mode:modes[0]||""};});setError("");setSuccess("");};
 // Reset never brings back a saved voucher on a new entry; editing restores the saved values.
 const reset=()=>{setForm(id?{...initial}:blankTransfer(form.transaction_type));clearDenomination();setError("");setSuccess("");};
 const close=()=>onClose?onClose():go("/bank-deposit-history");
 const submit=async event=>{event.preventDefault();if(saving)return;const message=validateTransfer(form,ledgers);if(message)return setError(message);
 if(isCashMode&&denomEnabled&&Math.round(totalCashAmount*100)!==Math.round(Number(form.amount)*100)){setCashPopupOpen(true);return setError(`Denomination total ${formatINR(totalCashAmount)} must equal the Amount ${formatINR(Number(form.amount))}.`);}
 setSaving(true);setError("");setSuccess("");
 const payload=Object.fromEntries(["transaction_type","date","from_account","to_account","amount","payment_mode","notes"].map(key=>[key,form[key]]));
 try{const {data}=await (id?api.patch(`${ENDPOINT}${id}/`,payload,auth):api.post(ENDPOINT,payload,auth));
 if(onSaved)onSaved(data);else{const previewed=nextVoucher;setSuccess(previewed&&previewed!==data.voucher_no?`Voucher ${previewed} was taken by another entry, so this transaction was saved as ${data.voucher_no}.`:`Bank Transaction saved successfully. Voucher ${data.voucher_no}.`);setForm(blankTransfer(form.transaction_type));clearDenomination();loadNextVoucher();}}
 catch(e){setError(apiErrorMessage(e,"Unable to save this transaction."));loadNextVoucher();}finally{setSaving(false);}};
 const [source,target]=accountGroups(form.transaction_type);
 const account=(key,label,group,exclude)=><label>{label}<span className="bt-required"> *</span><SearchableSelect value={form[key]??""} onChange={event=>update(key,event.target.value)} required><option value="">Select {group==="Cash-in-Hand"?"Cash":"Bank"} Account</option>{ledgers.filter(item=>item.group===group&&String(item.id)!==String(exclude||"")).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</SearchableSelect></label>;
 return <div className="bt-page bt-form-page">
 {!id&&<div className="bt-page-heading"><PageBreadcrumb current="Bank Transactions"/><div className="bt-heading-actions"><label className="bt-heading-date">Date<span className="bt-required"> *</span><input type="date" required value={form.date} onChange={event=>update("date",event.target.value)} aria-label="Transaction Date"/></label><button type="button" className="bt-button" onClick={close}>Transaction History</button></div></div>}
 <form className="bt-form" onSubmit={submit}>
 {id&&<div className="bt-edit-heading"><h2>Edit Bank Transaction</h2><button type="button" className="bt-button" disabled={saving} onClick={close} aria-label="Close">Close</button></div>}
 <fieldset disabled={saving||loading||!initial}>
 {id&&<label className="bt-edit-date">Date<span className="bt-required"> *</span><input type="date" required value={form.date||""} onChange={event=>update("date",event.target.value)}/></label>}
 <div className="bt-form-grid">
 <label>Voucher No<input readOnly className="bt-voucher" value={form.voucher_no||nextVoucher||"Auto-generated on save"} aria-label="Voucher No" title={form.voucher_no?"Saved voucher number":"Next voucher number (confirmed on save)"}/></label>
 <label>Transaction<span className="bt-required"> *</span><select required value={form.transaction_type} onChange={event=>chooseType(event.target.value)}>{TRANSACTION_TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 {account("from_account","From",source,form.to_account)}
 {account("to_account","To",target,form.from_account)}
 <label>Amount<span className="bt-required"> *</span><div className="bt-amount"><span aria-hidden="true">&#8377;</span><input type="number" min="0.01" step="0.01" required inputMode="decimal" placeholder="0.00" value={form.amount} onChange={event=>update("amount",event.target.value)} onBlur={event=>{const value=Number(event.target.value);if(event.target.value!==""&&Number.isFinite(value))update("amount",value.toFixed(2));}}/></div></label>
 <label>Payment Mode<span className="bt-required"> *</span><select required value={form.payment_mode} onChange={event=>update("payment_mode",event.target.value)}><option value="">Select Mode</option>{modesFor(form.transaction_type).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>{isCashMode&&<span className="bt-denomination"><DenominationToggle checked={denomEnabled} onChange={toggleDenomination}/>{denomEnabled&&<button type="button" className="cash-denom-chip" onClick={()=>setCashPopupOpen(true)}>{formatINR(totalCashAmount)} entered · Edit</button>}</span>}</label>
 <label className="bt-notes">Notes<textarea rows={2} maxLength={500} value={form.notes} onChange={event=>update("notes",event.target.value)} placeholder="Optional notes..."/></label>
 </div>
 <div className="bt-form-actions"><button type="button" className="bt-button" onClick={close}>Cancel</button><button type="button" className="bt-button" onClick={reset}>Reset</button><button type="submit" className="bt-button bt-primary">{saving?"Saving...":"Save"}</button></div>
 </fieldset>
 {loading&&<p className="bt-message">Loading accounts...</p>}{error&&<p role="alert" className="bt-error">{error}</p>}{success&&<p role="status" className="bt-success">{success}</p>}
 </form>
 {isCashMode&&denomEnabled&&cashPopupOpen&&<CashDenominationModal rows={cashRows} coinsAmount={coinsAmount} onQtyChange={(value,qty)=>setDenomQty(current=>({...current,[value]:qty}))} onCoinsChange={setCoinsAmount} total={totalCashAmount} onClose={()=>setCashPopupOpen(false)}/>}
 </div>;
}
