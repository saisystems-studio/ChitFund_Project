import React from "react";
import {createRoot} from "react-dom/client";
import HolidayList from "../../src/pages/holidays/HolidayList";
import {SessionProvider} from "../../src/components/SessionContext";
const records=[...[1,2,7,10,20,21].map((day,index)=>({id:index+1,holiday_date:`2026-10-${String(day).padStart(2,"0")}`,holiday_name:["Sunday","Local Holiday","Sunday","Local Holiday","Pooja Holiday","Pooja Holiday"][index],holiday_type:"LOCAL",is_active:true,allocations:index===0?[{id:1,loan_id:1,loan__loan_no:"CH-001"}]:[]})),{id:7,holiday_date:"2026-11-08",holiday_name:"Diwali",holiday_type:"LOCAL",is_active:true}];
const api={get:async()=>({data:records})};
document.body.style.cssText="margin:0;padding:8px;box-sizing:border-box;font-family:Arial";
createRoot(document.getElementById("root")).render(<SessionProvider user={{is_admin:true}}><HolidayList api={api} auth={{}} go={()=>{}}/></SessionProvider>);
setTimeout(()=>{
 const sections=[...document.querySelectorAll(".hol-month-section")];
 const errors=[];
 if(sections.length!==12)errors.push("Not twelve months");
 if(document.querySelector(".hol-month-toggle"))errors.push("Accordion remains");
 if(!document.querySelector(".hol-overall-total").textContent.includes("7"))errors.push("Overall count wrong");
 if(document.documentElement.scrollWidth>innerWidth)errors.push("Page horizontal overflow");
 for(const table of document.querySelectorAll(".hol-horizontal-table")){
  const rows=table.rows;
  for(let i=1;i<rows[0].cells.length;i++){
   const date=rows[0].cells[i].getBoundingClientRect(),name=rows[1].cells[i].getBoundingClientRect();
   if(Math.abs(date.x-name.x)>1||Math.abs(date.width-name.width)>1)errors.push("Column alignment");
  }
 }
 const result=document.createElement("p");result.id="qa-result";result.textContent=JSON.stringify({width:innerWidth,months:sections.length,overall:document.querySelector(".hol-overall-total").textContent,errors});document.body.prepend(result);
},1000);
