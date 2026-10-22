import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import axios from 'axios';
axios.defaults.adapter=async config=>({data:{company_name:'QA Finance'},status:200,statusText:'OK',headers:{},config});
const {default:Loan}=await import('../../src/pages/loans/ChitLoanForm.jsx');
const {KycDocumentsSection}=await import('../../src/components/KycDocuments/KycDocuments.jsx');
const {CompanyProfileProvider}=await import('../../src/components/CompanyProfileContext.jsx');
const saved=[];
const api={get:async url=>({data:url.includes('/customers/99/kyc-documents/')?(url.includes('/file/')?saved.find(d=>url.includes('/'+d.id+'/file/')).file:saved):url.includes('loan-types')?[{id:1,name:'Chit'},{id:2,name:'Interest'},{id:3,name:'Mortgage'}]:url.includes('application-date')?{application_date:'2026-10-08'}:[]}),post:async(url,body)=>{if(url!=='/customers/99/kyc-documents/')throw Error('Only isolated mock document saving is allowed');const file=body.get('file'),doc={id:saved.length+1,document_type:body.get('document_type'),document_type_display:'Aadhaar Card',original_file_name:file.name,file_type:file.type,file};saved.push(doc);return {data:doc}}};
function Harness(){const[pending,setPending]=useState([]);return <CompanyProfileProvider><div style={{padding:12}}><h3>Customer shared KYC</h3><KycDocumentsSection api={api} auth={{}} pendingDocuments={pending} onPendingChange={setPending}/><section id="saved-qa"><h3>Saved document QA</h3><KycDocumentsSection api={api} auth={{}} customerId={99}/></section><Loan api={api} auth={{}} go={()=>{}}/></div></CompanyProfileProvider>}
createRoot(document.getElementById('root')).render(<Harness/>);
