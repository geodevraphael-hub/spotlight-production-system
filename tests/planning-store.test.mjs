import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { planningWorkspace, savePlanningWorkspace } from '../app/planning-store.mjs';
import { auditedDatabase } from '../app/activity-audit.mjs';
import { enrichLocation,readLocationEvidence } from '../app/location-evidence.mjs';
import { defaultDecision } from '../app/planning-decision.mjs';

function setup() {
  const sql=new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT,project_type TEXT,share_token TEXT UNIQUE,share_code TEXT,created_by INTEGER,created_at INTEGER);
    CREATE TABLE project_users(project_id INTEGER,user_id INTEGER,PRIMARY KEY(project_id,user_id));
    CREATE TABLE inventory(id INTEGER PRIMARY KEY,data TEXT);
    CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER,assigned_by INTEGER,assigned_at INTEGER,PRIMARY KEY(inventory_id,project_id));
    CREATE TABLE campaign_plans(id INTEGER PRIMARY KEY,project_id INTEGER,user_id INTEGER,name TEXT,data TEXT,note TEXT,updated_at INTEGER);
    CREATE TABLE activity_write_context(id INTEGER PRIMARY KEY,actor_id INTEGER);
    INSERT INTO users VALUES(1,'Admin'),(2,'Creator'),(3,'Other');
    INSERT INTO projects(id,name) VALUES(10,'North'),(20,'South'),(30,'Private');
    INSERT INTO project_users VALUES(10,2),(20,2),(30,3);
    INSERT INTO inventory VALUES(101,'{"id":1,"projectId":10,"street":"North road"}'),(102,'{"id":2,"projectId":20,"street":"South road"}'),(103,'{"id":3,"projectId":30,"street":"Private road"}');
    INSERT INTO inventory_projects VALUES(101,10,1,0),(101,20,1,0),(102,20,1,0),(103,30,1,0);
  `);
  const db={
    prepare(query) {
      let args=[];
      const prepared={
        bind(...values){args=values;return prepared;},
        async all(){return {results:sql.prepare(query).all(...args)};},
        async first(){return sql.prepare(query).get(...args) ?? null;},
        async run(){const result=sql.prepare(query).run(...args);return {meta:{last_row_id:Number(result.lastInsertRowid),changes:Number(result.changes)}};},
      };
      return prepared;
    },
    async batch(writes){sql.exec('BEGIN');try{const results=[];for(const write of writes)results.push(await write.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}},
  };
  return {db,sql};
}
const admin={id:1,role:'admin'}, creator={id:2,role:'creator'};
const body={name:'Campaign',projectId:20,note:'Memo',data:{shortlist:[101,102],costs:{101:{rental:'100',printing:'0'},102:{transport:'20'}}}};

test('planner deduplicates shared inventory and respects project access',async()=>{
  const {db}=setup();
  const all=await planningWorkspace(db,admin), limited=await planningWorkspace(db,creator);
  assert.equal(all.inventory.length,3);
  assert.equal(limited.inventory.length,2);
  assert.deepEqual(limited.inventory[0].projectIds,[10,20]);
  assert.deepEqual(limited.inventory.map(i=>i.id),[101,102]);
  await assert.rejects(planningWorkspace(db,{id:2,role:'viewer'}),{status:403});
  await assert.rejects(planningWorkspace(db,{id:2,role:'field_user'}),{status:403});
});
test('save links selected boards without deleting source membership and keeps explicit zero and blank',async()=>{
  const {db,sql}=setup();
  const result=await savePlanningWorkspace(auditedDatabase(db,creator),creator,{...body,projectId:10});
  assert.equal(result.projectId,10);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM inventory').get().n,3);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM inventory_projects WHERE inventory_id=102').get().n,2);
  const saved=(await planningWorkspace(db,creator)).plans[0];
  assert.equal(saved.data.identity,'inventory-db');
  assert.equal(saved.data.costs[101].printing,'0');
  assert.equal(saved.data.costs[101].transport,'');
});
test('new project, membership, assignments and plan save atomically',async()=>{
  const {db,sql}=setup();
  const result=await savePlanningWorkspace(auditedDatabase(db,creator),creator,{...body,projectId:undefined,newProjectName:'New campaign'});
  assert.equal(sql.prepare('SELECT name FROM projects WHERE id=?').get(result.projectId).name,'New campaign');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM inventory_projects WHERE project_id=?').get(result.projectId).n,2);
  assert.ok(sql.prepare('SELECT 1 FROM project_users WHERE project_id=? AND user_id=2').get(result.projectId));
  sql.exec(`CREATE TRIGGER reject_plan BEFORE INSERT ON campaign_plans BEGIN SELECT RAISE(ABORT,'test failure'); END;`);
  await assert.rejects(savePlanningWorkspace(auditedDatabase(db,creator),creator,{...body,newProjectName:'Must roll back'}));
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM projects WHERE name='Must roll back'").get().n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM activity_write_context').get().n,0);
});
test('forged source, target, plan ownership and invalid prices are rejected without writes',async()=>{
  const {db,sql}=setup();
  await assert.rejects(savePlanningWorkspace(db,creator,{...body,projectId:30}),{status:403});
  await assert.rejects(savePlanningWorkspace(db,creator,{...body,data:{shortlist:[103]}}),{status:400});
  await assert.rejects(savePlanningWorkspace(db,creator,{...body,id:999}),{status:403});
  for (const value of ['-1','NaN','Infinity',' ']) await assert.rejects(savePlanningWorkspace(db,creator,{...body,data:{shortlist:[101],costs:{101:{rental:value}}}}),{status:400});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM campaign_plans').get().n,0);
});
test('saved plan can be reassigned without changing its owner or original memberships',async()=>{
  const {db,sql}=setup();
  const first=await savePlanningWorkspace(db,creator,body);
  await savePlanningWorkspace(db,admin,{...body,id:first.id,projectId:30});
  const plan=sql.prepare('SELECT * FROM campaign_plans').get();
  assert.equal(plan.user_id,2); assert.equal(plan.project_id,30);
  assert.ok(sql.prepare('SELECT 1 FROM inventory_projects WHERE inventory_id=101 AND project_id=10').get());
});
test('legacy plan asset ids are converted to stable inventory identities',async()=>{
  const {db,sql}=setup();
  sql.prepare('INSERT INTO campaign_plans VALUES(1,10,2,?,?,?,0)').run('Old',JSON.stringify({shortlist:[1,999],costs:{1:{rental:'123'}}}),'');
  const plan=(await planningWorkspace(db,creator)).plans[0];
  assert.deepEqual(plan.data.shortlist,[101]);
  assert.equal(plan.data.costs[101].rental,'123');
  assert.equal(plan.data.unresolvedCount,1);
});

test('decision configuration is saved and invalid weights do not create partial records',async()=>{
  const {db,sql}=setup(),decision={...defaultDecision(),budget:'5000'};
  await savePlanningWorkspace(db,creator,{...body,data:{...body.data,decision}});
  assert.deepEqual((await planningWorkspace(db,creator)).plans[0].data.decision,decision);
  await assert.rejects(savePlanningWorkspace(db,creator,{...body,newProjectName:'Reject invalid',data:{...body.data,decision:{...decision,radius:-1}}}),{status:400});
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM projects WHERE name='Reject invalid'").get().n,0);
});
test('location enrichment authorizes inventory before making a provider call',async()=>{
  const {db}=setup();let calls=0;const fetcher=()=>{calls++;throw new Error('Should not call');};
  await assert.rejects(enrichLocation(db,{id:2,role:'viewer'},{id:101,radius:1000},'key',fetcher),{status:403});
  await assert.rejects(enrichLocation(db,creator,{id:103,radius:1000},'key',fetcher),{status:403});
  await assert.rejects(enrichLocation(db,creator,{id:101,radius:1000},'key',fetcher),{status:400});
  assert.equal(calls,0);
});
test('provider denial is safe, does not overwrite inventory, and blocks repeated requests',async()=>{
  const {db,sql}=setup();
  sql.exec(`UPDATE inventory SET data=json_set(data,'$.lat',-6,'$.lng',39)`);
  let calls=0;const fetcher=async()=>{calls++;return new Response('secret provider error',{status:403});};
  await assert.rejects(enrichLocation(db,creator,{id:101,radius:1000},'private-key',fetcher),/denied server access/);
  await assert.rejects(enrichLocation(db,creator,{id:102,radius:1000},'private-key',fetcher),/denied server access/);
  assert.equal(calls,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM inventory').get().n,3);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM planning_location_evidence').get().n,0);
});
test('successful location lookup is cached, coordinate-aware and permission-filtered',async()=>{
  const {db,sql}=setup();
  sql.exec(`UPDATE inventory SET data=json_set(data,'$.lat',-6,'$.lng',39)`);
  let calls=0;const fetcher=async(url,options)=>{
    calls++;assert.equal(new URL(url).origin,'https://locationiq.co.tz');assert.ok(!url.toString().includes('private-key'));
    assert.equal(options.headers['X-API-Key'],'private-key');
    assert.equal(options.redirect,'manual','Workers requires manual redirect rejection');
    return Response.json(url.pathname.endsWith('reverse')?{nearest_landmarks:[]}:{coordinate:{latitude:-6,longitude:39},mode:'radius',population:{status:'estimated',reference_year:2022,estimated_population:42},facilities:{by_category:{commerce_services:2}},buildings:{detections:3}});
  };
  await enrichLocation(db,admin,{id:101,radius:1000},'private-key',fetcher);
  assert.equal((await enrichLocation(db,creator,{id:101,radius:1000},'private-key',fetcher)).cached,true);
  assert.equal(calls,2);
  const read=await readLocationEvidence(db,creator,1000,true);assert.equal(read.evidence[101].metrics.population,42);
  sql.exec(`UPDATE inventory SET data=json_set(data,'$.lng',40) WHERE id=101`);
  assert.equal((await readLocationEvidence(db,creator,1000,true)).evidence[101],undefined);
  await assert.rejects(readLocationEvidence(db,{id:3,role:'viewer'},1000,true),{status:403});
});
test('provider redirects never forward the server key or store evidence',async()=>{
  const {db,sql}=setup();
  sql.exec(`UPDATE inventory SET data=json_set(data,'$.lat',-6,'$.lng',39)`);
  let calls=0;
  const fetcher=async(url,options)=>{
    calls++;assert.equal(options.redirect,'manual');
    return new Response('',{status:302,headers:{Location:'https://other.example/'}});
  };
  await assert.rejects(enrichLocation(db,admin,{id:101,radius:1000},'private-key',fetcher),{status:502});
  assert.equal(calls,1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM planning_location_evidence').get().n,0);
});
test('explicit catchment coverage gap retains census data but never invents radius values',async()=>{
  const {db,sql}=setup();
  sql.exec(`UPDATE inventory SET data=json_set(data,'$.lat',-6,'$.lng',39)`);
  const reverse={census_administration:{administration:{shehia:{boundary_id:1,name:'Coastal',
    demographics:{year:2022,population:100,male:40,female:60,households:20,name_link_needs_verification:0}}}}};
  const fetcher=async url=>url.pathname.endsWith('reverse')?Response.json(reverse):
    Response.json({detail:'The coordinate is outside the official Tanzania coverage.'},{status:422});
  const {evidence}=await enrichLocation(db,admin,{id:101,radius:1000},'key',fetcher);
  assert.equal(evidence.coverageStatus,'administrative-only');
  assert.equal(evidence.demographics.areas[0].population,100);
  assert.equal(evidence.metrics.population,null);assert.equal(evidence.metrics.commerce,null);
  assert.equal(evidence.metrics.transport,null);assert.equal(evidence.metrics.buildings,null);
  assert.match(evidence.notes[0],/unavailable, not zero/);
  assert.equal((await readLocationEvidence(db,admin,1000,true)).evidence[101].coverageStatus,'administrative-only');
});
test('unrecognized 422 does not turn provider errors into partial success',async()=>{
  const {db,sql}=setup();
  sql.exec(`UPDATE inventory SET data=json_set(data,'$.lat',-6,'$.lng',39)`);
  const fetcher=async url=>url.pathname.endsWith('reverse')?Response.json({}):
    Response.json({detail:'Invalid parameters'},{status:422});
  await assert.rejects(enrichLocation(db,admin,{id:101,radius:1000},'key',fetcher),{status:502});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM planning_location_evidence').get().n,0);
});
