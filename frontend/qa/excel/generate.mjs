import {mkdirSync,readFileSync} from 'node:fs';
import {downloadReportExcel} from '../../src/utils/reportExcel.js';
const fixture=JSON.parse(readFileSync('qa/customer-export/fixture.json','utf8'));
const section=fixture.selected.results[0],columns=['DATE','PARTICULARS','LOAN TYPE','VCH NO.','DR','CR','BALANCE'].map((header,i)=>({header,numeric:i>=4}));
let running=Number(section.opening_balance||0);
const real=section.rows.map(row=>{running+=Number(row.debit||0)-Number(row.credit||0);return[row.date,row.particulars,row.loan_type,row.voucher_no,Number(row.debit)||'',Number(row.credit)||'',`${Math.abs(running)} ${running<0?'CR':'DR'}`]});
mkdirSync('../docs/excel-qa',{recursive:true});
for(const [name,rows] of [['customer-empty',[]],['customer-one',real.slice(0,1)],['customer-multiple',real],['customer-many',Array.from({length:40},(_,i)=>real[i%real.length])]]){
 const dr=rows.reduce((s,r)=>s+Number(r[4]||0),0),cr=rows.reduce((s,r)=>s+Number(r[5]||0),0);
 await downloadReportExcel({filename:`../docs/excel-qa/${name}`,title:'Customer-wise Report',subtitle:'Customer: Kumar | Loan: CH-0001 | Period: All',columns,rows,summaryRows:[['Opening Balance','','','',0,'',''],['Current Total','','','',dr,cr,''],['Closing Balance','','','',dr>=cr?`${dr-cr} DR`:'',cr>dr?`${cr-dr} CR`:'','']]});
 console.log(name,rows.length,dr,cr);
}
for(const title of ['Trial Balance','Profit and Loss','Balance Sheet','Ledger Statement','Collection Report','Mortgage Report','Group-wise Report'])await downloadReportExcel({filename:`../docs/excel-qa/${title.replaceAll(' ','-')}`,title,columns:[{header:'Particulars'},{header:'Debit',numeric:true},{header:'Credit',numeric:true}],rows:[['QA transaction',50,20]],summaryRows:[['TOTAL',50,20]]});
