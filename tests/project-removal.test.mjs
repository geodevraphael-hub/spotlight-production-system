import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {removeProjectInventory,inventoryMembershipBackfill} from '../app/project-removal.mjs';
import {auditedDatabase} from '../app/activity-audit.mjs';
import {centralInventory} from '../app/central-map.mjs';
const admin={id:7,role:'admin'};
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE inventory(id INTEGER PRIMARY KEY,data TEXT);
 CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT);
 CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER,assigned_by INTEGER,assigned_at INTEGER,PRIMARY KEY(inventory_id,project_id));
 CREATE TABLE project_removal_requests(request_id TEXT PRIMARY KEY,user_id INTEGER,payload TEXT,result TEXT,created_at INTEGER);
 CREATE TABLE activity_write_context(id INTEGER PRIMARY KEY,actor_id INTEGER);
 CREATE TABLE users(id INTEGER,name TEXT);
 INSERT INTO users VALUES(7,'Admin');
 CREATE TABLE asset_activity(id INTEGER PRIMARY KEY,project_id INTEGER,asset_id INTEGER,actor_id INTEGER,event TEXT,detail TEXT,created_at INTEGER);
 CREATE TABLE audit(actor_id INTEGER,inventory_id INTEGER,project_id INTEGER);
 CREATE TRIGGER capture AFTER DELETE ON inventory_projects BEGIN INSERT INTO audit SELECT actor_id,OLD.inventory_id,OLD.project_id FROM activity_write_context; END;
 CREATE TABLE flight_schedules(project_id INTEGER,asset_id INTEGER,flight_status TEXT);
 INSERT INTO projects VALUES(10,'Original'),(20,'Other');
 INSERT INTO inventory_projects VALUES(1,10,1,100),(1,20,1,100),(2,10,1,100);
 INSERT INTO flight_schedules VALUES(10,101,'flighted'),(20,101,'flighted');`);
 for(const id of [1,2,3])sql.prepare('INSERT INTO inventory VALUES(?,?)').run(id,JSON.stringify({id:100+id,projectId:10,street:`Board ${id}`,lat:-6,lng:39,photoUrl:'keep',flightStatus:'flighted',attributes:{vendor:'Vendor'}}));
 const raw={prepare(query){let args=[];const p={bind(...v){args=v;return p;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:sql.prepare(query).run(...args)};}};return p;},
 async batch(writes){sql.exec('BEGIN');try{const out=[];for(const w of writes)out.push(await w.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,raw,db:auditedDatabase(raw,admin)};
}
const request=(extra={})=>({ids:[1],projectId:10,confirmed:true,requestId:crypto.randomUUID(),...extra});
const inProject=(sql,project)=>sql.prepare(`SELECT i.id FROM inventory i WHERE EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=?) OR COALESCE(json_extract(i.data,'$.projectId'),1)=? ORDER BY i.id`).all(project,project).map(r=>r.id);
test('source removal preserves central records, all attributes, other links and flight history',async()=>{
 const {db,sql}=setup(),before=JSON.parse(sql.prepare('SELECT data FROM inventory WHERE id=1').get().data);
 const result=await removeProjectInventory(db,admin,request());
 assert.equal(result.removed,1);assert.equal(result.skipped,0);
 assert.deepEqual(inProject(sql,10),[2,3]);assert.deepEqual(inProject(sql,20),[1]);
 const after=JSON.parse(sql.prepare('SELECT data FROM inventory WHERE id=1').get().data);
 assert.deepEqual(after,{...before,projectId:0,originProjectId:10});
 assert.equal(sql.prepare('SELECT count(*) n FROM inventory').get().n,3);
 assert.equal(sql.prepare('SELECT count(*) n FROM flight_schedules').get().n,2);
 assert.deepEqual({...sql.prepare('SELECT * FROM audit').get()},{actor_id:7,inventory_id:1,project_id:10});
});
test('removal from a secondary project does not change the inventory JSON or source membership',async()=>{
 const {db,sql}=setup(),before=sql.prepare('SELECT * FROM inventory').all();
 await removeProjectInventory(db,admin,request({projectId:20}));
 assert.deepEqual(sql.prepare('SELECT * FROM inventory').all(),before);
 assert.deepEqual(inProject(sql,10),[1,2,3]);assert.deepEqual(inProject(sql,20),[]);
});
test('last membership becomes unassigned and legacy backfill cannot restore removed memberships',async()=>{
 const {db,sql}=setup();
 await removeProjectInventory(db,admin,request({ids:[2,3]})); // Includes an implicit legacy membership.
 sql.prepare(inventoryMembershipBackfill).run(Date.now());
 assert.deepEqual(inProject(sql,10),[1]);
 assert.equal(sql.prepare('SELECT count(*) n FROM inventory_projects WHERE inventory_id IN (2,3)').get().n,0);
 const rows=sql.prepare(`SELECT i.id inventory_id,i.data,p.id project_id,p.name project_name FROM inventory i LEFT JOIN projects p ON p.id=COALESCE(json_extract(i.data,'$.projectId'),1) OR EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=p.id)`).all();
 const all=centralInventory(rows,[]);
 assert.equal(all.length,3);assert.equal(all.find(b=>b.id===2).projectName,'Unassigned');
 const audit=sql.prepare("SELECT * FROM asset_activity WHERE asset_id=103").get();
 assert.equal(audit.actor_id,7);assert.equal(audit.event,'Billboard removed from project');
 assert.equal(JSON.parse(audit.detail).before.billboardName,'Board 3');
});
test('source sentinel does not leak legacy flight state into project 1',()=>{
 const result=centralInventory([{inventory_id:1,data:JSON.stringify({id:101,projectId:0,flightStatus:'flighted'}),project_id:1,project_name:'Other'}],[]);
 assert.equal(result[0].memberships[0].flightStatus,'unflighted');
});
test('mixed selection skips boards outside target without changing their records',async()=>{
 const {db,sql}=setup(),before=sql.prepare('SELECT * FROM inventory').all();
 const result=await removeProjectInventory(db,admin,request({ids:[1,2,3],projectId:20}));
 assert.equal(result.removed,1);assert.equal(result.skipped,2);
 assert.deepEqual(sql.prepare('SELECT * FROM inventory').all(),before);
});
test('idempotent retries cannot remove a newly re-assigned membership',async()=>{
 const {db,sql}=setup(),body=request(),first=await removeProjectInventory(db,admin,body);
 sql.exec('INSERT INTO inventory_projects VALUES(1,10,7,200)');
 assert.deepEqual(await removeProjectInventory(db,admin,body),first);
 assert.ok(inProject(sql,10).includes(1));assert.equal(sql.prepare('SELECT count(*) n FROM audit').get().n,1);
 await assert.rejects(removeProjectInventory(db,admin,{...body,projectId:20}),{status:409});
});
test('admin-only and validation failures never write',async()=>{
 const {db,sql}=setup();
 for(const role of ['creator','viewer','planner','field_user'])await assert.rejects(removeProjectInventory(db,{id:2,role},request()),{status:403});
 for(const extra of [{confirmed:false},{ids:[]},{ids:[1,1]},{ids:[1,999]},{projectId:0},{projectId:999},{ids:['1']},{ids:Array.from({length:501},(_,i)=>i+1)}])await assert.rejects(removeProjectInventory(db,admin,request(extra)));
 assert.equal(sql.prepare('SELECT count(*) n FROM project_removal_requests').get().n,0);
});
test('failed deletion rolls back source normalization, links, receipt and audit',async()=>{
 const {db,sql}=setup(),before=sql.prepare('SELECT * FROM inventory').all();
 sql.exec("CREATE TRIGGER fail_remove BEFORE DELETE ON inventory_projects WHEN OLD.inventory_id=2 BEGIN SELECT RAISE(ABORT,'test failure'); END");
 await assert.rejects(removeProjectInventory(db,admin,request({ids:[1,2]})),{status:409});
 assert.deepEqual(sql.prepare('SELECT * FROM inventory').all(),before);
 assert.equal(sql.prepare('SELECT count(*) n FROM inventory_projects').get().n,3);
 assert.equal(sql.prepare('SELECT count(*) n FROM project_removal_requests').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM audit').get().n,0);
});
test('concurrent inventory edits cause atomic conflict rather than overwriting data',async()=>{
 const {sql,raw}=setup();
 const race=auditedDatabase({...raw,async batch(writes){sql.exec("UPDATE inventory SET data=json_set(data,'$.street','New name') WHERE id=1");return raw.batch(writes);}},admin);
 await assert.rejects(removeProjectInventory(race,admin,request()),{status:409});
 assert.deepEqual(inProject(sql,10),[1,2,3]);
 assert.equal(sql.prepare('SELECT count(*) n FROM project_removal_requests').get().n,0);
});
test('removed membership is excluded from project-specific reminder joins',async()=>{
 const {db,sql}=setup();
 await removeProjectInventory(db,admin,request());
 const schedules=sql.prepare(`SELECT fs.project_id FROM flight_schedules fs
 LEFT JOIN inventory i ON CAST(json_extract(i.data,'$.id') AS INTEGER)=fs.asset_id
 LEFT JOIN inventory_projects ip ON ip.inventory_id=i.id AND ip.project_id=fs.project_id
 WHERE i.id IS NULL OR ip.project_id IS NOT NULL OR COALESCE(json_extract(i.data,'$.projectId'),1)=fs.project_id`).all();
 assert.deepEqual(schedules.map(r=>r.project_id),[20]);
});
