import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assetPriority,installationCount,registrationNumber,validateRegisterFields} from '../app/asset-register.mjs';
import {normalizeBulkChanges,applyBulkChanges} from '../app/inventory-bulk.mjs';
import {assetBookings} from '../app/asset-booking.mjs';
test('registration does not invent official numbers from spreadsheet serials',()=>{
 assert.equal(registrationNumber({sourceAttributes:{SN:'92'}}),'');
 assert.equal(registrationNumber({sourceAttributes:{'Registration Number':'KM-92'}}),'KM-92');
 assert.equal(installationCount({lampPosts:50,faces:100}),null);
 assert.equal(installationCount({sourceAttributes:{INSTALLATION:'4'}}),4);
 assert.equal(installationCount({installations:0}),0);
 assert.equal(installationCount({installations:1.5}),null);
 assert.equal(assetPriority({sourceAttributes:{PRIORITY:'Priority A — Highest visibility'}}),'A');
});
test('register validation rejects invalid explicit values and preserves prices/legacy fields',()=>{
 for(const item of [{priority:'D'},{installations:-1},{installations:1.2},{registrationNumber:123},{mediaGroup:{}}])assert.throws(()=>validateRegisterFields(item));
 const item=validateRegisterFields({priority:'Priority B',installations:'4',registrationNumber:' KM-1 ',transportPrice:100,sourceAttributes:{SN:'9'},bookingStatus:'available'});
 assert.equal(item.priority,'B');assert.equal(item.installations,4);assert.equal(item.registrationNumber,'KM-1');assert.equal(item.transportPrice,100);
 assert.equal(item.sourceAttributes.SN,'9');assert.equal(item.bookingStatus,undefined);
});
test('bulk metadata edits preserve serial numbers and synchronize canonical columns',()=>{
 const item=applyBulkChanges({sourceAttributes:{SN:'2',INSTALLATION:'5'},transportPrice:500},normalizeBulkChanges({priority:'A',registrationNumber:'KM-2',installations:7,mediaGroup:'Static'}));
 assert.equal(item.sourceAttributes.SN,'2');assert.equal(item.sourceAttributes.INSTALLATION,'7');
 assert.equal(item.sourceAttributes['REGISTRATION NUMBER'],'KM-2');assert.equal(item.transportPrice,500);
});
test('booking status is inclusive by EAT date and spans physical asset memberships without exposing campaigns',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE inventory(id INTEGER,data TEXT);CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER);
 CREATE TABLE bookings(inventory_id INTEGER,face INTEGER,status TEXT,starts_on TEXT,ends_on TEXT);
 CREATE TABLE flight_schedules(asset_id INTEGER,project_id INTEGER,flight_status TEXT,start_at INTEGER);
 INSERT INTO inventory VALUES(1,'{"id":101,"projectId":1}'),(2,'{"id":102,"projectId":1}'),(3,'{"id":103,"projectId":1}');
 INSERT INTO inventory_projects VALUES(1,1),(1,2),(2,1),(3,1);
 INSERT INTO bookings VALUES(1,1,'reserved','2026-10-19','2026-10-20'),(1,2,'reserved','2026-10-21','2026-10-23'),(2,1,'cancelled','2026-10-19','2026-10-22');
 INSERT INTO flight_schedules VALUES(103,1,'flighted',1);`);
 const db={prepare(q){let args;return{bind(...a){args=a;return this;},async all(){return{results:sql.prepare(q).all(...args)};}};}};
 const today=await assetBookings(db,Date.parse('2026-10-20T20:59:00Z'));
 assert.equal(today.get(1).bookingStatus,'booked');assert.equal(today.get(1).reservedFaces,1);
 assert.equal(today.get(2).bookingStatus,'available');assert.equal(today.get(3).bookingActiveFlight,true);
 const next=await assetBookings(db,Date.parse('2026-10-20T21:00:00Z'));
 assert.equal(next.get(1).bookingDate,'2026-10-21');assert.equal(next.get(1).reservedFaces,1);
 sql.exec("UPDATE flight_schedules SET flight_status='deflighted'");
 assert.equal((await assetBookings(db)).get(3).bookingStatus,'available');sql.close();
});
