import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardInventory} from '../app/dashboard-data.mjs';
const now=Date.parse('2026-10-20T09:00:00+03:00');
test('flight chart partitions billboards exactly and uses EAT calendar days for expiry',()=>{
 const boards=Array.from({length:6},(_,i)=>({id:i+1,inventoryDbId:100+i,projectId:1,street:`Board ${i}`,faces:2,mediaType:'large-format'}));
 const schedules=[
  {asset_id:1,flight_status:'flighted',end_at:Date.parse('2026-10-19T12:00:00+03:00')},
  {asset_id:2,flight_status:'flighted',end_at:Date.parse('2026-10-20T00:00:00+03:00')},
  {asset_id:3,flight_status:'flighted',end_at:Date.parse('2026-10-23T12:00:00+03:00')},
  {asset_id:4,flight_status:'deflighted'},
  {asset_id:6,flight_status:'flighted',end_at:null},
  {asset_id:999,flight_status:'flighted',end_at:1},
 ];
 const d=dashboardInventory(boards,schedules,1,now);
 assert.equal(d.total,6);assert.equal(d.faces,12);assert.deepEqual(d.states,{flighted:3,overdue:1,deflighted:1,unflighted:1});
 assert.equal(Object.values(d.states).reduce((a,b)=>a+b,0),d.total);
 assert.equal(d.dueToday,1);assert.equal(d.dueSoon,1);assert.equal(d.missingExpiry,1);
 assert.deepEqual(d.expiry.map(b=>b.remaining),[-1,0,3]);
});
test('shared billboards use this project schedule and lamp-post faces are not replaced by poles',()=>{
 const d=dashboardInventory([{id:1,projectId:1,flightStatus:'flighted',faces:8,lampPosts:4,mediaType:'lamp-post'},{id:2,projectId:0,flightStatus:'flighted',faces:'bad',mediaType:'unknown'}],[],2,now);
 assert.equal(d.states.unflighted,2);assert.equal(d.faces,8);assert.equal(d.types.find(t=>t.id==='lamp-post').faces,8);
 assert.equal(d.types.find(t=>t.id==='other').boards,1);
});
test('empty inventory has zero counts without fabricated chart segments',()=>{
 const d=dashboardInventory([],[],1,now);
 assert.equal(d.total,0);assert.equal(d.faces,0);assert.deepEqual(d.expiry,[]);
 assert.equal(d.types.reduce((a,t)=>a+t.boards,0),0);
});
test('installation counts are explicit, and production/transit exclude flighted assets',()=>{
 const d=dashboardInventory([
  {id:1,projectId:1,faces:8,lampPosts:4,sourceAttributes:{INSTALLATION:'4'},bookingStatus:'booked'},
  {id:2,projectId:1,faces:2,installations:0},
  {id:3,projectId:1,faces:1},
 ],[{asset_id:1,stage:'printing',flight_status:'unflighted'},{asset_id:2,stage:'transport',flight_status:'unflighted'},{asset_id:3,stage:'printing',flight_status:'flighted'}],1,now);
 assert.equal(d.installations,4);assert.equal(d.missingInstallations,1);assert.equal(d.faces,11);
 assert.equal(d.inProduction,1);assert.equal(d.inTransit,1);assert.equal(d.booked,1);
});
