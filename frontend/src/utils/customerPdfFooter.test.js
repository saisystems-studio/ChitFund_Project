import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){return n(s.startsWith('./')&&!s.split('/').at(-1).includes('.')?`${s}.js`:s,c)}});
const {createReportPdf}=await import('./reportPdf.js');
for(const count of [1,27,28,29,60,180]) test(`customer summary stays together at final page bottom: ${count} rows`,async()=>{
 const doc=await createReportPdf({title:'Customer report',profile:{company_name:'QA'},columns:[{header:'Transaction',width:120},{header:'DR',width:30},{header:'CR',width:30}],rows:Array.from({length:count},(_,i)=>[`TX-${i+1}`,'50.00','20.00']),summaryAtBottom:true,summaryRows:['Opening Balance','Current Total','Closing Balance'].map(label=>({cells:[label,'50.00','20.00'],bold:true}))});
 const pages=doc.internal.pages.slice(1).map(p=>p.join('\n'));
 const final=pages.at(-1);
 for(const label of ['Opening Balance','Current Total','Closing Balance']){
  assert.equal(pages.filter(p=>p.includes(`(${label})`)).length,1);
  assert.ok(final.includes(`(${label})`));
  const prefix=final.slice(0,final.indexOf(`(${label})`));
  const coords=[...prefix.matchAll(/([\d.]+) ([\d.]+) Td/g)].at(-1);
  const y=doc.internal.pageSize.getHeight()-Number(coords[2])/doc.internal.scaleFactor;
  assert.ok(y>250&&y<280,`${label} baseline ${y}`);
 }
 assert.ok(final.includes(`(TX-${count})`),'last page must contain last transaction');
 assert.ok(final.indexOf(`(TX-${count})`)<final.indexOf('(Opening Balance)'));
 assert.ok(doc.output().startsWith('%PDF-'));
});
for(const showBalance of [false,true]) test(`actual customer columns retain totals and alignment (balance ${showBalance})`,async()=>{
 const widths=showBalance?[20,42,23,23,23,23,26]:[22,51,25,26,28,28];
 const doc=await createReportPdf({title:'Customer-wise Report',profile:{company_name:'QA Finance'},columns:widths.map((width,i)=>({header:['DATE','PARTICULARS','LOAN TYPE','VCH NO.','DR','CR','BALANCE'][i],width,align:i>=4?'right':'left'})),rows:Array.from({length:100},(_,i)=>['08-10-2026',`TX-${i+1}`,'Chit',String(i+1),'50.00','20.00',...(showBalance?['30.00 Dr']:[])]),summaryAtBottom:true,summaryRows:[{cells:[{content:'Opening Balance :',colSpan:4,styles:{halign:'right'}},'0.00','0.00',...(showBalance?['']:[])]},{cells:[{content:'Current Total :',colSpan:4,styles:{halign:'right'}},'5000.00','2000.00',...(showBalance?['']:[])],dividerAfter:true},{cells:[{content:'Closing Balance :',colSpan:4,styles:{halign:'right'}},'3000.00','',...(showBalance?['']:[])],bold:true}]});
 const table=doc.lastAutoTable;
 assert.equal(table.foot.length,3);
 assert.ok(table.foot[0].cells[0].y>250);
 assert.ok(table.foot.at(-1).cells[0].y+table.foot.at(-1).height<=doc.internal.pageSize.getHeight()-18+0.01);
 for(const row of table.foot){assert.equal(row.cells[4].x,widths.slice(0,4).reduce((a,b)=>a+b,0)+15);assert.equal(row.cells[5].x,widths.slice(0,5).reduce((a,b)=>a+b,0)+15)}
 const final=doc.internal.pages.at(-1).join('\n');for(const text of ['TX-100','5000.00','2000.00','3000.00']) assert.ok(final.includes(`(${text})`));
});
