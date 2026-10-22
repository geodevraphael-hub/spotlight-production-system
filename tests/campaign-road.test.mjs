import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {campaignClock,roadPreview,distance} from '../app/campaign-road.mjs';
import {setupCampaignTools,campaignAccess,saveCampaign,campaignList,saveRoad} from '../app/campaign-store.mjs';
import {auditedDatabase} from '../app/activity-audit.mjs';
const admin={id:1,name:'Test admin',role:'admin'},creator={id:2,name:'Creator',role:'creator'};
const id='12345678-1234-1234-1234-123456789012';
async function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT,created_by INTEGER);INSERT INTO projects VALUES(1,'Campaign project',2),(2,'Other',9);
 CREATE TABLE project_users(project_id INTEGER,user_id INTEGER);
 CREATE TABLE inventory(id INTEGER PRIMARY KEY,source_id INTEGER,data TEXT,latitude REAL,longitude REAL,created_at INTEGER);
 CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER,assigned_by INTEGER,assigned_at INTEGER,PRIMARY KEY(inventory_id,project_id));
 CREATE TABLE activity_write_context(id INTEGER PRIMARY KEY,actor_id INTEGER);
 CREATE TABLE asset_activity(id INTEGER PRIMARY KEY,project_id INTEGER,asset_id INTEGER,actor_id INTEGER,event TEXT,detail TEXT,created_at INTEGER);
 CREATE TABLE flight_schedules(asset_id INTEGER,project_id INTEGER,flight_status TEXT,stage TEXT,start_at INTEGER,end_at INTEGER);
 CREATE TABLE bookings(inventory_id INTEGER,face INTEGER,status TEXT,starts_on TEXT,ends_on TEXT);
 INSERT INTO inventory(id,source_id,data) VALUES(1,101,'{"id":101,"projectId":1,"street":"Airport","mediaType":"lamp-post","faces":2}'),(2,102,'{"id":102,"projectId":2,"street":"Other"}');
 INSERT INTO inventory_projects VALUES(1,1,1,1),(2,2,1,1);`);
 const raw={prepare(q){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(q).get(...args)||null;},async all(){return {results:sql.prepare(q).all(...args)};},async run(){return {meta:sql.prepare(q).run(...args)};}};},async batch(writes){sql.exec('BEGIN');try{const results=[];for(const s of writes)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 await setupCampaignTools(raw);return {sql,raw,db:auditedDatabase(raw,admin)};
}
const campaign=()=>({projectId:1,id,version:0,name:'October launch',subcategory:'Launch',starts_on:'2026-10-20',ends_on:'2026-10-31',assetIds:[1]});
const road=()=>({projectId:1,requestId:id,name:'Airport Road',vendor:'Vendor',area:'Zanzibar',anchors:[{lat:-6.1,lng:39.1},{lat:-6.101,lng:39.1},{lat:-6.101,lng:39.102}],count:8,faces:2,width:1,height:2,confirmed:true});
test('campaign dates use EAT midnight, inclusive duration, upcoming and ended labels',()=>{
 assert.equal(campaignClock('2026-10-20','2026-10-20',Date.parse('2026-10-19T21:00Z')).label,'Ends today');
 assert.equal(campaignClock('2026-10-20','2026-10-20',Date.parse('2026-10-19T20:59Z')).label,'Starts in 1 day');
 const ended=campaignClock('2026-10-20','2026-10-20',Date.parse('2026-10-20T21:00Z'));assert.equal(ended.label,'Ended 1 day ago');assert.equal(ended.duration,1);assert.equal(ended.progress,100);
 assert.throws(()=>campaignClock('2026-02-30','2026-03-01'));assert.throws(()=>campaignClock('2026-03-02','2026-03-01'));
});
test('road generation follows bends and includes endpoints at equal chainage',()=>{
 const r=road(),p=roadPreview(r.anchors,8);assert.equal(p.points.length,8);assert.equal(distance(p.points[0],r.anchors[0]),0);assert.ok(distance(p.points.at(-1),r.anchors.at(-1))<.02);
 for(let i=1;i<p.points.length;i++)assert.ok(Math.abs(p.points[i].chainage-p.points[i-1].chainage-p.spacing)<.11);
 assert.equal(p.points[1].lng,39.1);assert.equal(p.points.at(-2).lat,-6.101);
});
test('road limits reject invalid, duplicated and excessive points/counts',()=>{
 for(const [a,n] of [[[],2],[road().anchors,1],[road().anchors,201],[road().anchors,2.5],[[{lat:91,lng:1},{lat:1,lng:1}],2],[[{lat:1,lng:1},{lat:1,lng:1}],2],[[{lat:1,lng:1},{lat:20,lng:20}],2]])assert.throws(()=>roadPreview(a,n));
});
test('campaigns require scoped access and exclude viewer/field writes',async()=>{
 const {raw,sql}=await fixture();for(const role of ['viewer','field_user','planner'])await assert.rejects(()=>campaignAccess(raw,{id:3,role},1,true));await campaignAccess(raw,creator,1,true);await assert.rejects(()=>campaignAccess(raw,creator,2,true));sql.close();
});
test('campaign create/update are audited, retry-safe and reject stale versions or foreign assets',async()=>{
 const {db,raw,sql}=await fixture();await saveCampaign(db,admin,campaign());await saveCampaign(db,admin,campaign());assert.equal(sql.prepare('SELECT count(*) n FROM asset_activity').get().n,1);
 await assert.rejects(()=>saveCampaign(db,admin,{...campaign(),version:1,assetIds:[2]}));
 await saveCampaign(db,admin,{...campaign(),version:1,name:'Updated launch'});
 await assert.rejects(()=>saveCampaign(db,admin,{...campaign(),version:1,name:'Stale edit'}),/changed elsewhere/);
 const audit=sql.prepare('SELECT * FROM asset_activity ORDER BY id DESC LIMIT 1').get();const detail=JSON.parse(audit.detail);assert.equal(audit.actor_id,1);assert.equal(detail.actor.name,'Test admin');assert.equal(detail.before.campaignName,'October launch');assert.equal(detail.after.campaignName,'Updated launch');
 const list=await campaignList(raw,admin,1);assert.equal(list.campaigns[0].summary.faces,2);assert.equal(list.campaigns[0].summary.total,1);assert.equal(list.assets.length,1);
 sql.exec("DELETE FROM inventory_projects WHERE inventory_id=1;UPDATE inventory SET data=json_set(data,'$.projectId',0) WHERE id=1");const removed=await campaignList(raw,admin,1);assert.equal(removed.campaigns[0].summary.total,0);assert.equal(removed.campaigns[0].missingAssets,1);sql.close();
});
test('road save creates independent estimated inventory, memberships, actor history and no duplicates on retry',async()=>{
 const {db,sql}=await fixture();const result=await saveRoad(db,admin,road());assert.equal(result.count,8);await saveRoad(db,admin,road());assert.equal(sql.prepare('SELECT count(*) n FROM inventory').get().n,10);
 const records=sql.prepare('SELECT * FROM inventory WHERE id>2').all().map(r=>JSON.parse(r.data));assert.equal(new Set(records.map(r=>r.id)).size,8);assert.ok(records.every(r=>r.positionSource==='estimated-road-stretch'&&r.positionVerified===false&&r.flightStatus==='unflighted'&&r.installations===1));assert.equal(sql.prepare('SELECT count(*) n FROM inventory_projects WHERE project_id=1').get().n,9);
 assert.equal(sql.prepare('SELECT actor_id FROM asset_activity').get().actor_id,1);await assert.rejects(()=>saveRoad(db,admin,{...road(),name:'Changed request'}),/already used/);sql.close();
});
test('road failure rolls back every pole, membership and receipt',async()=>{
 const {db,sql}=await fixture();sql.exec("CREATE TRIGGER simulate_failure BEFORE INSERT ON inventory WHEN json_extract(NEW.data,'$.roadStretch.index')=3 BEGIN SELECT RAISE(ABORT,'simulated');END");
 await assert.rejects(()=>saveRoad(db,admin,road()),/No partial/);assert.equal(sql.prepare('SELECT count(*) n FROM inventory').get().n,2);assert.equal(sql.prepare('SELECT count(*) n FROM road_mapping_requests').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM activity_write_context').get().n,0);sql.close();
});
