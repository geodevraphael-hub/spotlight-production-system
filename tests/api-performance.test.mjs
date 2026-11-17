import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {installPerformanceIndexes} from '../app/performance-indexes.mjs';
import {assetBookings} from '../app/asset-booking.mjs';
import {compactInventoryData,inventoryImage,restoreInventoryImages} from '../app/inventory-images.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE inventory(id INTEGER PRIMARY KEY,source_id INTEGER,data TEXT,created_at INTEGER);
 CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER,PRIMARY KEY(inventory_id,project_id));
 CREATE TABLE project_users(project_id INTEGER,user_id INTEGER);CREATE TABLE flight_schedules(asset_id INTEGER,flight_status TEXT,start_at INTEGER,project_id INTEGER);
 CREATE TABLE bookings(inventory_id INTEGER,face INTEGER,starts_on TEXT,ends_on TEXT,status TEXT);
 CREATE TABLE field_collections(project_id INTEGER,created_at INTEGER);CREATE TABLE field_photos(collection_id INTEGER);CREATE TABLE campaign_plans(project_id INTEGER,updated_at INTEGER);`);
 const db={prepare(query){let args=[];const p={bind(...values){args=values;return p;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};return p;},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const p of statements)results.push(await p.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};return {db,sql};
}
test('compact inventory is substantially smaller, preserves data and resolves protected photos on demand',async()=>{
 const {db,sql}=fixture(),photo='data:image/jpeg;base64,'+Buffer.alloc(64000,42).toString('base64');
 for(let id=1;id<=100;id++)sql.prepare('INSERT INTO inventory VALUES(?,?,?,?)').run(id,id,JSON.stringify({id,projectId:1,street:'Asset '+id,lat:-6,lng:39,photoUrl:photo}),100);
 const start=performance.now();const raw=sql.prepare('SELECT data FROM inventory').all();const rawBytes=Buffer.byteLength(JSON.stringify(raw));const compact=sql.prepare(`SELECT ${compactInventoryData(1)} AS data FROM inventory i`).all();const bytes=Buffer.byteLength(JSON.stringify(compact));
 assert.ok(bytes<rawBytes*.02);const item=JSON.parse(compact[0].data),original=JSON.parse(raw[0].data);assert.equal(item.street,original.street);
 assert.equal(restoreInventoryImages(item,original,1).photoUrl,photo);
 assert.throws(()=>restoreInventoryImages(item,original,2));
 const response=await inventoryImage(db,{id:1,role:'admin'},new URL(item.photoUrl,'https://spotlight.co.tz').searchParams);
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, max-age=2592000');assert.equal((await response.arrayBuffer()).byteLength,64000);
 console.log(JSON.stringify({benchmark:'100 uploaded-photo assets',rawBytes,compactBytes:bytes,reductionPercent:Number((100*(1-bytes/rawBytes)).toFixed(2)),fixtureElapsedMs:Number((performance.now()-start).toFixed(1))}));
});
test('image endpoint enforces both project membership and account-specific cache identity',async()=>{
 const {db,sql}=fixture();sql.prepare('INSERT INTO inventory VALUES(?,?,?,?)').run(1,1,JSON.stringify({id:1,projectId:1,photoUrl:'data:image/png;base64,YQ=='}),1);
 sql.exec('INSERT INTO project_users VALUES(1,2)');
 const params=new URLSearchParams({id:'1',uid:'2',kind:'photoUrl'});
 assert.equal((await inventoryImage(db,{id:2,role:'viewer'},params)).status,200);
 assert.equal((await inventoryImage(db,{id:3,role:'viewer'},params)).status,404);
 params.set('uid','3');assert.equal((await inventoryImage(db,{id:3,role:'viewer'},params)).status,404);
 params.set('uid','2');sql.exec('DELETE FROM project_users');assert.equal((await inventoryImage(db,{id:2,role:'viewer'},params)).status,404);
});
test('scoped bookings retain global physical availability and indexes avoid full flight scans',async()=>{
 const {db,sql}=fixture();
 for(let id=1;id<=1000;id++){
  sql.prepare('INSERT INTO inventory VALUES(?,?,?,?)').run(id,id,JSON.stringify({id,projectId:id%10+1}),1);
  sql.prepare('INSERT INTO flight_schedules VALUES(?,?,?,?)').run(id,'flighted',0,id%10+1);
 }
 sql.exec("INSERT INTO inventory_projects VALUES(1,1);INSERT INTO bookings VALUES(1,1,'2026-01-01','2027-01-01','reserved')");
 const now=Date.UTC(2026,10,17),before=performance.now();await assetBookings(db,now);const beforeMs=performance.now()-before;
 await installPerformanceIndexes(db);const after=performance.now();const global=await assetBookings(db,now);const afterMs=performance.now()-after;
 const scoped=await assetBookings(db,now,1);assert.equal(scoped.size,101);assert.deepEqual(scoped.get(1),global.get(1));assert.equal(scoped.get(1).bookingActiveFlight,true);assert.equal(scoped.get(1).reservedFaces,1);assert.equal(scoped.has(2),false);
 const plan=sql.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM flight_schedules WHERE asset_id=? AND flight_status IN ('flighted','expired') AND (start_at IS NULL OR start_at<=?)").all(1,now);assert.ok(plan.some(row=>row.detail.includes('idx_flight_asset_state')));
 console.log(JSON.stringify({benchmark:'1000-asset booking lookup',beforeIndexesMs:Number(beforeMs.toFixed(2)),afterIndexesMs:Number(afterMs.toFixed(2))}));
});
