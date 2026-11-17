import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setupLocationEvidence} from '../app/location-evidence.mjs';
import {populateLocations} from '../app/automatic-location.mjs';
import {locationProgress} from '../app/location-progress.mjs';
import {auditedDatabase} from '../app/activity-audit.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE inventory(id INTEGER PRIMARY KEY,data TEXT);CREATE TABLE projects(id INTEGER PRIMARY KEY);CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER);CREATE TABLE project_users(project_id INTEGER,user_id INTEGER);CREATE TABLE activity_write_context(id INTEGER PRIMARY KEY,actor_id INTEGER);INSERT INTO projects VALUES(1),(2);INSERT INTO project_users VALUES(1,2);`);
 let writes=0;
 const db={prepare(query){let args=[];const p={bind(...values){args=values;return p;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){writes++;return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};return p;},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const p of statements)out.push(await p.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const add=(id,lat=-6,lng=39,projectId=1)=>sql.prepare('INSERT INTO inventory VALUES(?,?)').run(id,JSON.stringify({id:id+100,lat,lng,street:'Original',owner:'Original vendor',projectId}));
 const read=id=>JSON.parse(sql.prepare('SELECT data FROM inventory WHERE id=?').get(id).data);
 return {db,sql,add,read,writes:()=>writes};
}
const reverse=()=>new Response(JSON.stringify({administration:{region:{name:'Region'},district:{name:'District'},village:{name:'Village'}}}));
test('queue records new coordinates atomically, ignores attribute-only changes, and survives restart',async()=>{
 const f=fixture();await setupLocationEvidence(f.db);f.add(1);
 assert.equal(f.sql.prepare('SELECT status FROM location_enrichment_queue').get().status,'queued');
 f.sql.prepare("UPDATE inventory SET data=json_set(data,'$.owner','Edited') WHERE id=1").run();
 assert.equal(f.sql.prepare('SELECT count(*) n FROM location_enrichment_queue').get().n,1);
 f.sql.prepare("UPDATE inventory SET data=json_set(data,'$.lat',-7) WHERE id=1").run();assert.equal(f.sql.prepare('SELECT lat FROM location_enrichment_queue').get().lat,-7);
 await setupLocationEvidence({...f.db});assert.equal(f.sql.prepare('SELECT lat FROM location_enrichment_queue').get().lat,-7);
 f.sql.exec('DELETE FROM inventory WHERE id=1');assert.equal(f.sql.prepare('SELECT count(*) n FROM location_enrichment_queue').get().n,0);
});
test('identical coordinates reuse a single provider lookup and latest user changes survive',async()=>{
 const f=fixture();await setupLocationEvidence(f.db);f.add(1);f.add(2);let calls=0;
 const result=await populateLocations(f.db,'key','',async()=>{calls++;f.sql.prepare("UPDATE inventory SET data=json_set(data,'$.owner','New vendor') WHERE id=1").run();return reverse();});
 assert.equal(calls,1);assert.equal(result.updated,2);assert.equal(f.read(1).owner,'New vendor');assert.equal(f.read(2).locationAddress.status,'complete');
 assert.equal(f.sql.prepare("SELECT count(*) n FROM location_enrichment_queue WHERE status='complete'").get().n,2);
});
test('provider backoff preserves pending jobs; an overlapping worker never makes another call',async()=>{
 const f=fixture();await setupLocationEvidence(f.db);f.add(1);let release,called=0;
 const gate=new Promise(resolve=>release=resolve);
 const first=populateLocations(f.db,'key','',async()=>{called++;await gate;return new Response('',{status:429});});
 while(!called)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal((await populateLocations(f.db,'key','',reverse)).state,'waiting');release();await first;
 assert.equal(f.sql.prepare('SELECT status FROM location_enrichment_queue').get().status,'retrying');
 assert.ok(f.sql.prepare('SELECT blocked_until FROM planning_provider_state').get().blocked_until>Date.now());
 assert.equal((await populateLocations(f.db,'key','',()=>{throw Error('Must not request');})).state,'waiting');
});
test('coordinate changes while lookup is running cannot be overwritten by old results',async()=>{
 const f=fixture();await setupLocationEvidence(f.db);f.add(1);
 await populateLocations(f.db,'key','',async()=>{f.sql.prepare("UPDATE inventory SET data=json_set(data,'$.lat',-8) WHERE id=1").run();return reverse();});
 assert.equal(f.read(1).lat,-8);assert.equal(f.read(1).locationAddress,undefined);assert.equal(f.sql.prepare('SELECT lat FROM location_enrichment_queue').get().lat,-8);
});
test('location progress returns compact, project-authorized deltas without image payloads',async()=>{
 const f=fixture();await setupLocationEvidence(f.db);f.add(1);f.add(2,-7,40,2);
 await populateLocations(f.db,'key','',reverse,Date.now(),{maxLookups:1});
 const scoped=await locationProgress(f.db,{id:2,role:'viewer'},1,0);
 assert.ok(scoped.updates.every(row=>row.inventoryDbId===1));assert.equal(JSON.stringify(scoped).includes('Original vendor'),false);
 await assert.rejects(locationProgress(f.db,{id:2,role:'viewer'},2,0),{status:403});
 assert.ok((await locationProgress(f.db,{id:2,role:'viewer'},0,0)).updates.every(row=>row.inventoryDbId===1));
});
test('schema initialization is reused across per-request audit wrappers',async()=>{
 const f=fixture();await setupLocationEvidence(auditedDatabase(f.db,{id:1}));const count=f.writes();
 await setupLocationEvidence(auditedDatabase(f.db,{id:2}));assert.equal(f.writes(),count);
});
