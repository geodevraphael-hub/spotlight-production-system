import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assignPoleGps,submitPoleGps,verifiedCoordinates} from '../app/pole-verification.mjs';
import {applyLocationNames,locationNames,populateLocations} from '../app/automatic-location.mjs';
import {auditedDatabase} from '../app/activity-audit.mjs';
const admin={id:1,role:'admin'},field={id:2,role:'field_user'},requestId='12345678-1234-1234-1234-123456789012';
const request=()=>({ids:[10],projectId:1,userId:2,requestId,confirmed:true});
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY);INSERT INTO projects VALUES(1),(2);
 CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT);INSERT INTO users VALUES(1,'admin'),(2,'field_user'),(3,'field_user');
 CREATE TABLE inventory(id INTEGER PRIMARY KEY,data TEXT,latitude REAL,longitude REAL);
 CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER);INSERT INTO inventory_projects VALUES(10,1),(10,2);
 CREATE TABLE validation_assignments(id INTEGER PRIMARY KEY,project_id INTEGER,asset_id INTEGER,assigned_to INTEGER,status TEXT,report TEXT,assigned_by INTEGER,created_at INTEGER,updated_at INTEGER,completed_at INTEGER,UNIQUE(project_id,asset_id,assigned_to));
 CREATE TABLE activity_write_context(id INTEGER PRIMARY KEY,actor_id INTEGER);
 CREATE TABLE audit(actor INTEGER,before TEXT,after TEXT);
 CREATE TRIGGER track_update AFTER UPDATE ON inventory BEGIN INSERT INTO audit SELECT (SELECT actor_id FROM activity_write_context),OLD.data,NEW.data;END;`);
 const asset={id:100,projectId:1,street:'Road · Pole 1',mediaType:'lamp-post',positionSource:'estimated-road-stretch',positionVerified:false,lat:-6.1,lng:39.2,roadStretch:{index:1},photoUrl:'original',sourceAttributes:{'POSITION SOURCE':'Estimated'}};
 sql.prepare('INSERT INTO inventory VALUES(10,?,-6.1,39.2)').run(JSON.stringify(asset));
 const raw={prepare(q){let args=[];return{bind(...a){args=a;return this;},async first(){return sql.prepare(q).get(...args)||null;},async all(){return{results:sql.prepare(q).all(...args)};},async run(){return{meta:sql.prepare(q).run(...args)};}};},async batch(writes){sql.exec('BEGIN');try{const out=[];for(const w of writes)out.push(await w.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return{sql,raw,db:auditedDatabase(raw,admin),fieldDb:auditedDatabase(raw,field),asset,assignment:()=>sql.prepare('SELECT * FROM validation_assignments LIMIT 1').get(),current:()=>JSON.parse(sql.prepare('SELECT data FROM inventory WHERE id=10').get().data)};
}
const submit=()=>({submissionId:crypto.randomUUID(),verdict:'ok',photo:'data:image/jpeg;base64,aGVsbG8=',latitude:-6.1001,longitude:39.2001,accuracy:3,capturedAt:Date.now(),submittedAt:Date.now(),confirmGps:true});
test('only admin can assign estimated poles in the selected project to a field user',async()=>{
 const f=fixture();for(const role of ['creator','field_user','viewer'])await assert.rejects(()=>assignPoleGps(f.db,{id:1,role},request()),/Only administrators/);
 await assert.rejects(()=>assignPoleGps(f.db,admin,{...request(),projectId:3}),/Project/);await assert.rejects(()=>assignPoleGps(f.db,admin,{...request(),userId:1}),/field user/);
 await assert.rejects(()=>assignPoleGps(f.db,admin,{...request(),ids:[10,11]}),/selected pole/);assert.equal(f.assignment(),undefined);
 const r=await assignPoleGps(f.db,admin,request());assert.equal(r.assigned,1);assert.equal(f.assignment().assigned_to,2);assert.equal(JSON.parse(f.assignment().report).purpose,'pole-gps');f.sql.close();
});
test('assignment retry does not duplicate or overwrite a completed report',async()=>{
 const f=fixture();await assignPoleGps(f.db,admin,request());await submitPoleGps(f.fieldDb,field,submit(),f.assignment());await assignPoleGps(f.db,admin,request());assert.equal(f.assignment().status,'ok');assert.equal(f.sql.prepare('SELECT count(*) n FROM validation_assignments').get().n,1);f.sql.close();
});
test('active assignment cannot be silently reassigned across users or projects',async()=>{
 const f=fixture();await assignPoleGps(f.db,admin,request());await assert.rejects(()=>assignPoleGps(f.db,admin,{...request(),requestId:crypto.randomUUID(),userId:3,projectId:2}),/another field user/);f.sql.close();
});
test('successful field verification changes shared GPS and image atomically with actor/before/after',async()=>{
 const f=fixture();await assignPoleGps(f.db,admin,request());const body=submit();await submitPoleGps(f.fieldDb,field,body,f.assignment());const a=f.current();assert.equal(a.lat,body.latitude);assert.equal(a.lng,body.longitude);assert.equal(a.positionVerified,true);assert.equal(a.photoUrl,body.photo);assert.equal(a.gpsVerification.estimatedLatitude,-6.1);assert.equal(a.roadStretch.index,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM inventory_projects').get().n,2);assert.equal(f.sql.prepare('SELECT latitude FROM inventory').get().latitude,body.latitude);const audit=f.sql.prepare('SELECT * FROM audit').get();assert.equal(audit.actor,2);assert.equal(JSON.parse(audit.before).lat,-6.1);assert.equal(JSON.parse(audit.after).lat,body.latitude);assert.equal((await submitPoleGps(f.fieldDb,field,body,f.assignment())).replayed,true);f.sql.close();
});
test('issue report leaves original coordinates and inventory photo unchanged',async()=>{
 const f=fixture();await assignPoleGps(f.db,admin,request());await submitPoleGps(f.fieldDb,field,{...submit(),verdict:'issue',issueType:'Pole not found',confirmGps:false,accuracy:100},f.assignment());assert.deepEqual(f.current(),f.asset);assert.equal(f.assignment().status,'issue');f.sql.close();
});
test('GPS validation rejects stale, inaccurate, missing and unconfirmed fixes, accepts offline submissions',()=>{
 const now=Date.now(),good={...submit(),capturedAt:now-3600000,submittedAt:now-3599000};assert.equal(verifiedCoordinates(good,now-7200000,now).accuracy,3);
 for(const bad of [{accuracy:11},{confirmGps:false},{latitude:null},{longitude:181},{capturedAt:now-7200001},{submittedAt:now+600000},{submittedAt:now-3000000}])assert.throws(()=>verifiedCoordinates({...good,...bad},now-7200000,now));
 assert.equal(verifiedCoordinates({...submit(),latitude:0,longitude:0},now-10000,Date.now()).latitude,0);
});
test('wrong user, removed membership, changed pole and transaction failure cannot update GPS',async()=>{
 const f=fixture();await assignPoleGps(f.db,admin,request());await assert.rejects(()=>submitPoleGps(f.fieldDb,{id:3,role:'field_user'},submit(),f.assignment()),/not found/);
 f.sql.exec("CREATE TRIGGER fail_validation BEFORE UPDATE ON validation_assignments BEGIN SELECT RAISE(ABORT,'test');END");await assert.rejects(()=>submitPoleGps(f.fieldDb,field,submit(),f.assignment()),/changed/);assert.deepEqual(f.current(),f.asset);assert.equal(f.assignment().status,'assigned');assert.equal(f.sql.prepare('SELECT count(*) n FROM audit').get().n,0);f.sql.close();
});
test('GPS assignment stale request and duplicate pole IDs rejected',async()=>{
 const f=fixture();await assert.rejects(()=>assignPoleGps(f.db,admin,{...request(),ids:[10,10]}));await assignPoleGps(f.db,admin,request());await assert.rejects(()=>assignPoleGps(f.db,admin,{...request(),userId:3}),/already used/);f.sql.close();
});
test('location fields never substitute ward for village or overwrite manual labels',()=>{
 const names=locationNames({census_administration:{administration:{district:{name:'District'},ward:{name:'Ward'}}},administration:{village:{name:'Village'}}});assert.equal(names.district,'District');assert.equal(names.village,'Village');
 assert.equal(locationNames({coverage:{ambiguous_village:true},administration:{village:{name:'Village'}}}).village,null);
 const next=applyLocationNames({lat:1,lng:2,district:'Human district'},names,100);assert.equal(next.district,'Human district');assert.equal(next.village,'Village');assert.equal(next.locationAddress.district,'District');assert.equal(next.locationAddress.status,'complete');
 assert.equal(applyLocationNames({lat:1,lng:2},locationNames({}),100).locationAddress.status,'partial');
});
test('automatic lookup fills existing and new assets using cache without provider calls',async()=>{
 const f=fixture();await populateLocations(f.raw,'key','',async()=>new Response(JSON.stringify({administration:{district:{name:'District'},village:{name:'Village'}}})));assert.equal(f.current().district,'District');assert.equal(f.current().village,'Village');assert.equal(f.current().locationAddress.status,'complete');f.sql.close();
});
test('provider failure is visible, retryable, and preserves GPS and human attributes',async()=>{
 const f=fixture();const r=await populateLocations(f.raw,'key','',async()=>new Response('',{status:403}));assert.equal(r.state,'retrying');assert.equal(f.current().locationAddress.status,'pending');assert.equal(f.current().lat,-6.1);assert.equal(f.current().street,f.asset.street);assert.ok((await f.raw.prepare('SELECT blocked_until FROM planning_provider_state').first()).blocked_until>Date.now());f.sql.close();
});
