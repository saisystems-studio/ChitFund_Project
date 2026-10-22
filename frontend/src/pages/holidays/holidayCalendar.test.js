import test from "node:test";
import assert from "node:assert/strict";
import { monthEntries, monthSummary } from "./holidayCalendar.js";

test("months and years isolate saved holidays, preserve names and count visible off dates", () => {
  const records = [
    {holiday_date:"2026-10-02", holiday_name:"Local Holiday", holiday_type:"LOCAL", is_active:true},
    {holiday_date:"2026-11-08", holiday_name:"Diwali", holiday_type:"LOCAL", is_active:true},
    {holiday_date:"2025-10-02", holiday_name:"Old Holiday", holiday_type:"LOCAL", is_active:true},
    {holiday_date:"2026-10-04", holiday_name:"Sunday Working", holiday_type:"SUNDAY_WORKING", is_active:true},
  ];
  const october = monthEntries(2026,9,records);
  assert.equal(october.find(entry => entry.date === "2026-10-02").name,"Local Holiday");
  assert.ok(october.every(entry => entry.date.startsWith("2026-10")));
  assert.equal(monthSummary(2026,9,records).uniqueHolidays,4);
  assert.equal(monthEntries(2026,10,records).find(entry => entry.date === "2026-11-08").name,"Diwali");
  assert.equal(new Set(october.map(entry => entry.date)).size,october.length);
});

import { holidayListSections } from "./holidayCalendar.js";
test("list retains all twelve chronological months and counts saved holidays with matching filters", () => {
  const records = [
    {holiday_date:"2026-10-02", holiday_name:"Local", holiday_type:"LOCAL"},
    {holiday_date:"2026-10-20", holiday_name:"Pooja", holiday_type:"GOVERNMENT"},
    {holiday_date:"2026-11-08", holiday_name:"Diwali", holiday_type:"LOCAL"},
    {holiday_date:"2025-10-02", holiday_name:"Old", holiday_type:"LOCAL"},
  ];
  const months=holidayListSections(2026,records);
  assert.equal(months.length,12);
  assert.deepEqual(months.map(section=>section.month),Array.from({length:12},(_,index)=>index));
  assert.equal(months[0].entries.length,0);
  assert.equal(months[0].total,0);
  assert.equal(months[9].total,2);
  assert.equal(months[10].total,1);
  assert.equal(months.reduce((sum,month)=>sum+month.total,0),3);
  const filtered=holidayListSections(2026,records,"9","LOCAL");
  assert.equal(filtered.length,1);
  assert.equal(filtered[0].entries[0].name,"Local");
  assert.equal(filtered[0].total,1);
});

test("reference example counts October six, November one and overall seven",()=>{
  const records=[...[1,2,7,10,20,21].map(day=>({holiday_date:`2026-10-${String(day).padStart(2,"0")}`,holiday_name:"Holiday",holiday_type:"LOCAL"})),{holiday_date:"2026-11-08",holiday_name:"Diwali",holiday_type:"LOCAL"}];
  const sections=holidayListSections(2026,records);
  assert.equal(sections[9].total,6);
  assert.equal(sections[10].total,1);
  assert.equal(sections.reduce((sum,section)=>sum+section.total,0),7);
  assert.deepEqual(sections[9].entries.map(entry=>Number(entry.dayNumber)),[1,2,7,10,20,21]);
});

test("Sunday Working stays visible but contributes zero holidays; inactive and filtered records count correctly",()=>{
 const records=[{holiday_date:"2026-10-04",holiday_name:"Working",holiday_type:"SUNDAY_WORKING"},{holiday_date:"2026-10-20",holiday_name:"Inactive",holiday_type:"LOCAL",is_active:false},{holiday_date:"2026-10-02",holiday_name:"Local",holiday_type:"LOCAL"}];
 const sections=holidayListSections(2026,records);
 assert.equal(sections.length,12);
 assert.equal(sections[9].total,1);
 assert.deepEqual(sections[9].entries.map(entry=>Number(entry.dayNumber)),[2,4,20]);
 assert.equal(holidayListSections(2026,records,"9","SUNDAY_WORKING")[0].total,0);
 assert.equal(holidayListSections(2026,records,"8")[0].entries.length,0);
 assert.equal(holidayListSections(2026,records,"","GOVERNMENT").length,12);
 assert.ok(holidayListSections(2026,records,"","GOVERNMENT").every(section=>section.total===0));
});

test("year with no saved records retains January through December with zero totals",()=>{
 const sections=holidayListSections(2027,[]);
 assert.equal(sections.length,12);
 assert.equal(sections[0].title,"January 2027");
 assert.equal(sections[11].title,"December 2027");
 assert.ok(sections.every(section=>section.entries.length===0&&section.total===0));
});
