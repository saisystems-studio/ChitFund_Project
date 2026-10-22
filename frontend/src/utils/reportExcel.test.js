import test from 'node:test';
import assert from 'node:assert/strict';
import {createReportWorkbook} from './reportExcel.js';
for(const count of [0,1,40]) test(`styled Excel roundtrip with ${count} transactions`,async()=>{
 const columns=[{header:'DATE'},{header:'PARTICULARS'},{header:'LOAN TYPE'},{header:'VCH NO.'},{header:'DR',numeric:true},{header:'CR',numeric:true}];
 const wb=createReportWorkbook({title:'Customer-wise Report',subtitle:'Customer: Kumar | Loan: CH-0001',columns,rows:Array.from({length:count},()=>['2026-10-08','Collection received','Chit','V001',50,20]),summaryRows:[['Opening Balance','','','',0,0],['Current Total','','','',count*50,count*20],['Closing Balance','','','',count*30,0]]});
 const bytes=await wb.xlsx.writeBuffer();
 const ExcelJS=(await import('exceljs')).default;const read=new ExcelJS.Workbook();await read.xlsx.load(bytes);const s=read.getWorksheet('Report');
 assert.equal(s.getCell('A1').font.size,16);assert.equal(s.getCell('A1').font.color.argb,'FF173B63');assert.equal(s.getCell('F1').master.address,'A1');
 const head=4;assert.equal(s.getCell(`A${head}`).fill.fgColor.argb,'FF173B63');assert.equal(s.getCell(`A${head}`).font.color.argb,'FFFFFFFF');assert.equal(s.views[0].ySplit,head);assert.ok(s.autoFilter);assert.equal(s.pageSetup.fitToWidth,1);
 for(let r=head;r<=head+count+3;r++)for(let c=1;c<=6;c++){const cell=s.getCell(r,c);for(const side of ['top','bottom','left','right'])assert.equal(cell.border[side]?.style,'thin',`${cell.address} ${side}`)}
 if(count){assert.equal(s.getCell('E5').value,50);assert.match(s.getCell('E5').numFmt,/₹/);assert.equal(s.getCell('A5').alignment.horizontal,'center');assert.equal(s.getCell('B5').alignment.horizontal,'left');assert.equal(s.getCell('D5').alignment.horizontal,'center')}
 const close=s.getRow(head+count+3);assert.equal(close.getCell(5).value,count*30);assert.equal(close.getCell(1).fill.fgColor.argb,'FFEAF2FB');assert.equal(close.getCell(1).font.bold,true);assert.equal(close.getCell(4).master.address,`A${head+count+3}`);assert.equal(s.rowCount,head+count+3);
});
test('counts stay numeric without rupee format; financial display strings become numeric without changing DR/CR meaning',()=>{
 const s=createReportWorkbook({title:'QA',columns:[{header:'Members',numeric:true},{header:'Balance'},{header:'Debit',numeric:true}],rows:[[3,'₹1,234.50 CR','₹50.00']]}).getWorksheet('Report');
 assert.equal(s.getCell('A4').value,3);assert.equal(s.getCell('A4').numFmt,'0');assert.equal(s.getCell('B4').value,1234.5);assert.match(s.getCell('B4').numFmt,/CR/);assert.equal(s.getCell('C4').value,50);
});
