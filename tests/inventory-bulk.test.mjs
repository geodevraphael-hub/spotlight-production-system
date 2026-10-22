import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {bulkInventoryEdit,normalizeBulkChanges,applyBulkChanges} from '../app/inventory-bulk.mjs';
import {auditedDatabase} from '../app/activity-audit.mjs';
const admin={id:1,role:'admin'},creator={id:2,role:'creator'};
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE inventory(id INTEGER PRIMARY KEY,data TEXT);
 CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER);
 CREATE TABLE project_users(project_id INTEGER,user_id INTEGER);
 CREATE TABLE activity_write_context(id INTEGER PRIMARY KEY,actor_id INTEGER);
 CREATE TABLE audit(actor_id INTEGER,before TEXT,after TEXT);
 CREATE TRIGGER capture AFTER UPDATE ON inventory BEGIN INSERT INTO audit SELECT actor_id,OLD.data,NEW.data FROM activity_write_context; END;
 INSERT INTO project_users VALUES(10,2),(20,3);
 INSERT INTO inventory_projects VALUES(1,10),(1,20),(2,10),(3,20);`);
 for(const id of [1,2,3])sql.prepare('INSERT INTO inventory VALUES(?,?)').run(id,JSON.stringify({id:id+100,projectId:id===3?20:10,street:`Board ${id}`,owner:'Old',width:4,height:8,faces:1,lat:-6,lng:39,photoUrl:'data:keep-this',flightStatus:'flighted',sourceAttributes:{VENDOR:'Old','WIDTH (M)':'4','HEIGHT (M)':'8',FACES:'1','TOTAL SQ.M':'32',Latitude:'-6'}}));
 const db={
  prepare(query){
   let args=[];const p={bind(...v){args=v;return p;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:sql.prepare(query).run(...args)};}};return p;
  },
  async batch(writes){sql.exec('BEGIN');try{const results=[];for(const w of writes)results.push(await w.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}},
 };
 return {sql,db:auditedDatabase(db,creator),raw:db,read:id=>JSON.parse(sql.prepare('SELECT data FROM inventory WHERE id=?').get(id).data)};
}
const request={projectId:10,ids:[1,2],changes:{owner:'New vendor',width:'6'}};
async function commit(db,user,body=request){
 const preview=await bulkInventoryEdit(db,user,body);
 return bulkInventoryEdit(db,user,{...body,confirmed:true,versions:Object.fromEntries(preview.rows.map(r=>[r.id,r.version]))},true);
}
test('preview is read-only, includes before/after values and shared-record warning',async()=>{
 const {db,sql,read}=setup(),preview=await bulkInventoryEdit(db,creator,request);
 assert.equal(preview.changedCount,2);assert.equal(preview.sharedCount,1);
 assert.deepEqual(preview.rows[0].changes.find(c=>c.key==='owner'),{key:'owner',label:'Vendor',before:'Old',after:'New vendor'});
 assert.equal(read(1).owner,'Old');assert.equal(sql.prepare('SELECT COUNT(*) n FROM audit').get().n,0);
});
test('confirmed save updates only chosen attributes and synchronizes source columns; audit captures actor and both values',async()=>{
 const {db,sql,read}=setup(),result=await commit(db,creator);
 assert.equal(result.changedCount,2);assert.equal(read(1).owner,'New vendor');
 assert.equal(read(1).areaSqm,48);assert.equal(read(1).sourceAttributes.VENDOR,'New vendor');
 assert.equal(read(1).sourceAttributes['WIDTH (M)'],'6');assert.equal(read(1).sourceAttributes['TOTAL SQ.M'],'48');
 assert.equal(read(1).lat,-6);assert.equal(read(1).photoUrl,'data:keep-this');assert.equal(read(1).flightStatus,'flighted');assert.equal(read(3).owner,'Old');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM inventory_projects').get().n,4);
 const audit=sql.prepare('SELECT * FROM audit').all();assert.equal(audit.length,2);
 assert.equal(audit[0].actor_id,2);assert.equal(JSON.parse(audit[0].before).owner,'Old');assert.equal(JSON.parse(audit[0].after).owner,'New vendor');
});
test('no-op commits do not rewrite records or create duplicate history',async()=>{
 const {db,sql}=setup();await commit(db,creator);
 const result=await commit(db,creator);assert.equal(result.changedCount,0);assert.equal(result.unchangedCount,2);assert.equal(sql.prepare('SELECT COUNT(*) n FROM audit').get().n,2);
});
test('role, project and per-record permissions reject forged selections without partial updates',async()=>{
 const {db,read}=setup();
 for(const role of ['viewer','planner','field_user'])await assert.rejects(bulkInventoryEdit(db,{id:2,role},request),{status:403});
 await assert.rejects(bulkInventoryEdit(db,creator,{...request,ids:[1,3]}),{status:403});
 await assert.rejects(bulkInventoryEdit(db,creator,{...request,projectId:20,ids:[1]}),{status:403});
 assert.equal(read(1).owner,'Old');
 assert.equal((await bulkInventoryEdit(db,admin,{...request,projectId:20,ids:[1,3]})).selectedCount,2);
});
test('missing confirmation or versions never writes and stale preview is rejected',async()=>{
 const {db,sql,read}=setup(),preview=await bulkInventoryEdit(db,creator,request),versions=Object.fromEntries(preview.rows.map(r=>[r.id,r.version]));
 await assert.rejects(bulkInventoryEdit(db,creator,{...request,versions},true),{status:400});
 await assert.rejects(bulkInventoryEdit(db,creator,{...request,confirmed:true},true),{status:409});
 sql.prepare("UPDATE inventory SET data=json_set(data,'$.faces',2) WHERE id=2").run();
 await assert.rejects(bulkInventoryEdit(db,creator,{...request,confirmed:true,versions},true),{status:409});assert.equal(read(1).owner,'Old');
});
test('race during transaction guard rolls back all records and audit entries',async()=>{
 const {raw,sql,read}=setup();
 const guarded=auditedDatabase({...raw,async batch(writes){sql.prepare("UPDATE inventory SET data=json_set(data,'$.faces',2) WHERE id=2").run();return raw.batch(writes);}},creator);
 await assert.rejects(commit(guarded,creator),{status:409});assert.equal(read(1).owner,'Old');assert.equal(read(2).owner,'Old');assert.equal(sql.prepare('SELECT COUNT(*) n FROM audit').get().n,0);
});
test('database write error rolls back earlier updates and their activity entries',async()=>{
 const {db,sql,read}=setup();
 sql.exec("CREATE TRIGGER fail_write BEFORE UPDATE ON inventory WHEN NEW.id=2 BEGIN SELECT RAISE(ABORT,'test failure'); END");
 await assert.rejects(commit(db,creator),{status:409});assert.equal(read(1).owner,'Old');assert.equal(sql.prepare('SELECT COUNT(*) n FROM audit').get().n,0);
});
test('field allowlist, numeric bounds, distinct IDs, and blank semantics are enforced',async()=>{
 for(const changes of [{lat:0},{flightStatus:'flighted'},{sourceAttributes:{}},{id:1},{faces:0},{faces:1.5},{width:''},{width:-2},{owner:null},{status:'available'},{street:' '},{rentalPrice:Infinity}]){
  assert.throws(()=>normalizeBulkChanges(changes));
 }
 assert.deepEqual(normalizeBulkChanges({owner:'',rentalPrice:'0'}),{owner:'',rentalPrice:0});
 const {db}=setup();
 for(const ids of [[1,1],[0],[999],[],Array.from({length:501},(_,i)=>i+1)])await assert.rejects(bulkInventoryEdit(db,creator,{...request,ids}));
});
test('uploaded attributes receive canonical fields when the imported file only has fallback names',()=>{
 const item={street:'Road',width:2,height:3,sourceAttributes:{'ROAD/STREET':'Road',DISTRICT:'North',REGION:'Zone',Size:'2x3'}};
 const after=applyBulkChanges(item,normalizeBulkChanges({street:'New place',district:'South',width:5}));
 assert.equal(after.sourceAttributes['SPECIFIC LOCATION'],'New place');assert.equal(after.sourceAttributes.DISTRICT,'South');assert.equal(after.sourceAttributes.REGION,'Zone');assert.equal(after.sourceAttributes.Size,'5 × 3 m');
});
