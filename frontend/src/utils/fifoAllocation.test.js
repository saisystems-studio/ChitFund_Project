import test from "node:test";
import assert from "node:assert/strict";
import { allocateFifo, sortPendingDues } from "./fifoAllocation.js";
const balance = r => r.balance;
test("10000 settles four dues and leaves 5000 on the fifth", () => {
 const rows = [3000,3000,2000,1000,6000].map((balance,i)=>({id:i+1,due_date:`2026-0${i+1}-01`,balance})).reverse();
 assert.deepEqual(allocateFifo(rows,10000,balance), {allocations:{1:"3000.00",2:"3000.00",3:"2000.00",4:"1000.00",5:"1000.00"},excess:"0.00"});
});
test("ties use stable ID, remaining balances and integer cents", () => {
 const rows=[{id:20,due_date:"2026-01-01",balance:.2},{id:3,due_date:"2026-01-01",balance:.1},{id:1,due_date:"2025-01-01",balance:0}];
 assert.deepEqual(sortPendingDues(rows,balance).map(r=>r.id),[3,20]);
 assert.deepEqual(allocateFifo(rows,.25,balance),{allocations:{3:"0.10",20:"0.15"},excess:"0.00"});
 assert.equal(allocateFifo(rows,1,balance).excess,"0.70");
 assert.deepEqual(allocateFifo(rows,"",balance).allocations,{});
});
