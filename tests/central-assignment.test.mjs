import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assignCentralInventory} from '../app/central-assignment.mjs';
import {auditedDatabase} from '../app/activity-audit.mjs';
const admin={id:1,role:'admin'};
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE inventory(id INTEGER PRIMARY KEY,data TEXT);
 CREATE TABLE projects(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,project_type TEXT,share_token TEXT UNIQUE,share_code TEXT,share_protected INTEGER DEFAULT 1,created_by INTEGER,created_at INTEGER);
 CREATE TABLE project_users(project_id INTEGER,user_id INTEGER);
 CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER,assigned_by INTEGER,assigned_at INTEGER,PRIMARY KEY(inventory_id,project_id));
 CREATE TABLE central_assignment_requests(request_id TEXT PRIMARY KEY,user_id INTEGER,payload TEXT,result TEXT,created_at INTEGER);
 CREATE TABLE activity_write_context(id INTEGER PRIMARY KEY,actor_id INTEGER);
 CREATE TABLE audit(actor_id INTEGER,inventory_id INTEGER,project_id INTEGER);
 CREATE TRIGGER capture AFTER INSERT ON inventory_projects BEGIN INSERT INTO audit SELECT actor_id,NEW.inventory_id,NEW.project_id FROM activity_write_context; END;
 INSERT INTO projects(id,name,project_type) VALUES(10,'Original','OOH'),(20,'Destination','Campaign');
 INSERT INTO inventory_projects VALUES(1,10,1,100),(2,10,1,100),(1,20,1,100);`);
 for(const id of [1,2,3])sql.prepare('INSERT INTO inventory VALUES(?,?)').run(id,JSON.stringify({id:id+100,projectId:10,street:`Board ${id}`,photoUrl:'keep',flightStatus:'flighted'}));
 const raw={prepare(query){let args=[];const p={bind(...v){args=v;return p;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:sql.prepare(query).run(...args)};}};return p;},
  async batch(writes){sql.exec('BEGIN');try{const results=[];for(const w of writes)results.push(await w.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,raw,db:auditedDatabase(raw,admin)};
}
const request=(extra={})=>({ids:[1,2],targetProjectId:20,confirmed:true,requestId:crypto.randomUUID(),...extra});
test('existing destination adds links, skips existing links and preserves inventory and source memberships',async()=>{
 const {sql,db}=setup(),before=sql.prepare('SELECT * FROM inventory').all(),r=await assignCentralInventory(db,admin,request());
 assert.equal(r.assigned,1);assert.equal(r.alreadyAssigned,1);
 assert.deepEqual(sql.prepare('SELECT * FROM inventory').all(),before);
 assert.equal(sql.prepare('SELECT count(*) n FROM inventory_projects WHERE project_id=10').get().n,2);
 assert.equal(sql.prepare('SELECT count(*) n FROM inventory_projects WHERE project_id=20').get().n,2);
 assert.deepEqual({...sql.prepare('SELECT * FROM audit').get()},{actor_id:1,inventory_id:2,project_id:20});
});
test('new project, creator membership and billboard links save together with protected sharing',async()=>{
 const {sql,db}=setup(),r=await assignCentralInventory(db,admin,request({targetProjectId:undefined,newProjectName:'New campaign',projectType:'Seasonal'}));
 assert.equal(r.created,true);assert.equal(r.assigned,2);assert.equal(r.project.share_protected,1);
 assert.equal(r.project.name,'New campaign');assert.equal(r.project.project_type,'Seasonal');assert.ok(r.project.share_token);
 assert.equal(sql.prepare('SELECT count(*) n FROM inventory_projects WHERE project_id=?').get(r.project.id).n,2);
 assert.equal(sql.prepare('SELECT user_id FROM project_users WHERE project_id=?').get(r.project.id).user_id,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM inventory_projects WHERE project_id=10').get().n,2);
});
test('retry returns original result without duplicate projects, links or audit records',async()=>{
 const {sql,db}=setup(),body=request({targetProjectId:undefined,newProjectName:'Retry campaign'});
 const first=await assignCentralInventory(db,admin,body),second=await assignCentralInventory(db,admin,body);
 assert.deepEqual(first,second);
 assert.equal(sql.prepare('SELECT count(*) n FROM projects').get().n,3);
 assert.equal(sql.prepare('SELECT count(*) n FROM audit').get().n,2);
 await assert.rejects(assignCentralInventory(db,admin,{...body,newProjectName:'Different'}),{status:409});
});
test('viewer, creator, planner and field users cannot use central assignment',async()=>{
 const {sql,db}=setup();
 for(const role of ['creator','viewer','planner','field_user'])await assert.rejects(assignCentralInventory(db,{id:2,role},request()),{status:403});
 assert.equal(sql.prepare('SELECT count(*) n FROM central_assignment_requests').get().n,0);
});
test('missing confirmation, invalid IDs and missing targets never write',async()=>{
 const {sql,db}=setup();
 for(const extra of [{confirmed:false},{ids:[]},{ids:[1,1]},{ids:[1,999]},{targetProjectId:999},{targetProjectId:20,newProjectName:'Both'},{ids:['1']},{ids:Array.from({length:501},(_,i)=>i+1)}])await assert.rejects(assignCentralInventory(db,admin,request(extra)));
 assert.equal(sql.prepare('SELECT count(*) n FROM central_assignment_requests').get().n,0);
});
test('legacy asset ID collisions are rejected rather than mixing tracker records',async()=>{
 const {sql,db}=setup();
 sql.exec("UPDATE inventory SET data=json_set(data,'$.id',101) WHERE id=3");
 await assert.rejects(assignCentralInventory(db,admin,request({ids:[1,3],targetProjectId:undefined,newProjectName:'Conflict'})),{status:409});
 await assert.rejects(assignCentralInventory(db,admin,request({ids:[3]})),{status:409});
 assert.equal(sql.prepare('SELECT count(*) n FROM projects').get().n,2);
});
test('a failed link write rolls back project creation, audit and request receipt',async()=>{
 const {sql,db}=setup();
 sql.exec("CREATE TRIGGER fail_assignment BEFORE INSERT ON inventory_projects WHEN NEW.inventory_id=2 AND NEW.project_id>20 BEGIN SELECT RAISE(ABORT,'test failure'); END");
 await assert.rejects(assignCentralInventory(db,admin,request({targetProjectId:undefined,newProjectName:'Must roll back'})),{status:409});
 assert.equal(sql.prepare('SELECT count(*) n FROM projects').get().n,2);
 assert.equal(sql.prepare('SELECT count(*) n FROM audit').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM central_assignment_requests').get().n,0);
});
test('a concurrent record change fails the whole transaction without partial links',async()=>{
 const {sql,raw}=setup();
 const race=auditedDatabase({...raw,async batch(writes){sql.exec("UPDATE inventory SET data=json_set(data,'$.street','Changed') WHERE id=2");return raw.batch(writes);}},admin);
 await assert.rejects(assignCentralInventory(race,admin,request()),{status:409});
 assert.equal(sql.prepare('SELECT count(*) n FROM inventory_projects WHERE project_id=20').get().n,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM central_assignment_requests').get().n,0);
});
test('already-associated selection is a safe no-op and records accurate counts',async()=>{
 const {db,sql}=setup(),r=await assignCentralInventory(db,admin,request({targetProjectId:10}));
 assert.equal(r.assigned,0);assert.equal(r.alreadyAssigned,2);
 assert.equal(sql.prepare('SELECT count(*) n FROM audit').get().n,0);
});
