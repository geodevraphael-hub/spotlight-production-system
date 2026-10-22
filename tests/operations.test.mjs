import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {validCoordinates,dayKey,bookingOverlap,money,nextDeliveryStatus,inventoryFingerprint} from '../app/operations-rules.mjs';
import {initializeOnce} from '../app/initialize-once.mjs';
import {parseSmsAcknowledgement} from '../app/sms-provider.mjs';
import {operationsData,activityDetails,activityChanges} from '../app/operations-view.mjs';
import {auditedDatabase,installActivityAudit} from '../app/activity-audit.mjs';
import {historyWorkbook} from '../app/history-report.mjs';
import {assignCentralInventory} from '../app/central-assignment.mjs';
import {removeProjectInventory} from '../app/project-removal.mjs';


test('history comparison shows only changed fields with readable nested labels',()=>{
  const before={street:'Airport',faces:1,sourceAttributes:{VENDOR:'Old vendor',REGION:'Zanzibar'},note:'Old note'};
  const after={street:'Airport',faces:2,sourceAttributes:{VENDOR:'New vendor',REGION:'Zanzibar'},note:''};
  const changes=activityChanges(JSON.stringify({before:JSON.stringify(before),after:JSON.stringify(after)}),'Attributes updated');
  assert.deepEqual(changes.rows,[
    {field:'Faces',before:'1',after:'2'},
    {field:'Uploaded attributes / VENDOR',before:'Old vendor',after:'New vendor'},
    {field:'Note',before:'Old note',after:'Not set'},
  ]);
  assert.equal(activityChanges({before,after:before}).rows.length,0);
});

test('legacy flight and validation details preserve only known previous values',()=>{
  const changes=activityChanges({before:'flighted',status:'deflighted',stage:'removed',endAt:Date.parse('2026-10-18T12:00:00Z'),note:''},'Flight schedule updated');
  assert.deepEqual(changes.rows[0],{field:'Flight status',before:'Flighted',after:'Deflighted'});
  assert.deepEqual(changes.rows[1],{field:'Execution stage',before:'Not recorded',after:'Removed'});
  assert.equal(changes.rows[2].after,'18/10/2026, 15:00:00 EAT');
  const validation=activityChanges({before:'issue',status:'ok',report:'{"issueType":"Wrong GPS","photo":"data:image/png;base64,secret"}'},'Validation updated');
  assert.equal(validation.rows[0].before,'Not okay');assert.equal(validation.rows[0].after,'Okay');
  assert.equal(validation.rows[1].field,'Validation report / Main issue');
  assert.equal(validation.rows[2].after,'Attachment recorded');
});

test('history details handle empty, malformed, boolean and added or removed fields',()=>{
  for(const value of [undefined,null,'','null','{}','{broken'])assert.equal(activityChanges(value).rows.length,0);
  assert.equal(activityChanges('Legacy note').message,'Legacy note');
  const rows=activityChanges({before:{active:false,faces:0,removed:'Old'},after:{active:true,faces:1,newField:'New'}}).rows;
  assert.deepEqual(rows[0],{field:'Active',before:'No',after:'Yes'});
  assert.equal(rows[1].before,'0');assert.equal(rows[2].after,'Not recorded');assert.equal(rows[3].before,'Not recorded');
  assert.equal(activityChanges({before:{a:1,b:2},after:{b:2,a:1}}).rows.length,0);
});

test('operations responses cannot cross tabs, projects or filters',()=>{
  const notification={key:'projectId=1&section=notifications',data:{rows:[{subject:'SMS',status:'accepted'}]}};
  assert.deepEqual(operationsData(notification,'projectId=1&section=history').rows,[]);
  const history={key:'projectId=1&section=history',data:{rows:[{detail:'{}'}]}};
  assert.equal(operationsData(history,history.key),history.data);
  assert.deepEqual(operationsData(history,'projectId=2&section=history').rows,[]);
  assert.deepEqual(operationsData(history,'projectId=1&section=history&assetId=100').rows,[]);
  assert.deepEqual(operationsData(null,history.key).rows,[]);
});

test('activity details tolerate missing, malformed and legacy data',()=>{
  for(const value of [undefined,null,'','null'])assert.equal(activityDetails(value),'No change details were recorded.');
  assert.equal(activityDetails('{broken'),'{broken');
  assert.equal(activityDetails('Legacy note'),'Legacy note');
  assert.equal(activityDetails('{"status":"flighted"}'),'{\n  "status": "flighted"\n}');
  assert.equal(activityDetails({status:'okay'}),'{\n  "status": "okay"\n}');
  assert.equal(activityDetails('false'),'false');
});

const database=new DatabaseSync(':memory:');
const routeSource=await readFile(new URL('../app/api/app/route.ts',import.meta.url),'utf8');
for(const match of routeSource.matchAll(/db\.prepare\("(CREATE TABLE IF NOT EXISTS [^"]+)"\)/g))database.exec(match[1]);
const wrapper={prepare(sql){let values=[];return {bind(...parameters){values=parameters;return this;},async run(){const result=database.prepare(sql).run(...values);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};},async first(){return database.prepare(sql).get(...values)||null;},async all(){return {results:database.prepare(sql).all(...values)};}};},async batch(statements){database.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}}};
globalThis.__testEnv={DB:wrapper};
globalThis.__testUser={id:1,name:'Admin',role:'admin'};
const rulesUrl=new URL('../app/operations-rules.mjs',import.meta.url).href;
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const storeSource=(await readFile(new URL('../app/operations-store.ts',import.meta.url),'utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.__testEnv;').replace("'./operations-rules.mjs'",JSON.stringify(rulesUrl)).replace("'./initialize-once.mjs'",JSON.stringify(new URL('../app/initialize-once.mjs',import.meta.url).href));
const auditUrl=new URL('../app/activity-audit.mjs',import.meta.url).href;
const storeUrl=compile(storeSource.replace("'./activity-audit.mjs'",JSON.stringify(auditUrl)));
const store=await import(storeUrl);
await store.setupOperations();
await store.setupOperations();
const apiSource=(await readFile(new URL('../app/api/operations/route.ts',import.meta.url),'utf8')).replace("import { env } from 'cloudflare:workers';",'const env=globalThis.__testEnv;').replace("import { currentUser } from '../app/route';",'const currentUser=async()=>globalThis.__testUser;').replace("'../../operations-store'",JSON.stringify(storeUrl)).replace("'../../operations-rules.mjs'",JSON.stringify(rulesUrl));
const api=await import(compile(apiSource.replace("'../../activity-audit.mjs'",JSON.stringify(auditUrl)).replace("'../../history-report.mjs'",JSON.stringify(new URL('../app/history-report.mjs',import.meta.url).href)).replace("'../../dashboard-data.mjs'",JSON.stringify(new URL('../app/dashboard-data.mjs',import.meta.url).href))));
database.exec(`INSERT INTO projects(id,name,project_type,share_token,created_by,created_at) VALUES(1,'First','OOH','first',1,1),(2,'Second','OOH','second',2,1);INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(1,'Admin','admin@test','test','admin',1),(2,'Creator','creator@test','test','creator',1),(3,'Field','field@test','test','field_user',1);INSERT INTO project_users VALUES(1,1),(2,2);INSERT INTO inventory(id,source_id,data,latitude,longitude,created_at) VALUES(1,100,'{"id":100,"street":"Airport","faces":2,"projectId":1}',-6,39,1);INSERT INTO inventory_projects VALUES(1,1,1,1),(1,2,1,1);`);
const post=body=>api.POST(new Request('http://local/api/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));

test('project membership audit preserves actor, billboard, project and timestamp after unlinking and renaming',async()=>{
 database.exec(`INSERT INTO projects(id,name,project_type,share_token,created_by,created_at) VALUES(80,'Audit target','OOH','audit-target',1,1);
 INSERT INTO inventory(id,source_id,data,latitude,longitude,created_at) VALUES(80,8080,'{"id":8080,"street":"Coastal junction","projectId":1}',-6,39,1);
 INSERT INTO inventory_projects VALUES(80,1,1,1);`);
 const user={id:1,role:'admin'},db=auditedDatabase(wrapper,user);
 const assignment={ids:[80],targetProjectId:80,confirmed:true,requestId:crypto.randomUUID()};
 await assignCentralInventory(db,user,assignment);
 await assignCentralInventory(db,user,assignment);
 const removal={ids:[80],projectId:80,confirmed:true,requestId:crypto.randomUUID()};
 await removeProjectInventory(db,user,removal);await removeProjectInventory(db,user,removal);
 database.exec(`UPDATE inventory SET data=json_set(data,'$.street','New location name') WHERE id=80;
 UPDATE projects SET name='Renamed campaign' WHERE id=80`);
 const response=await api.GET(new Request('http://local/api/operations?section=history&projectId=80&assetId=8080'));
 const data=await response.json(),events=data.rows.filter(r=>/Billboard (assigned|removed)/.test(r.event));
 assert.equal(events.length,2);
 for(const row of events){
  assert.equal(row.actor,'Admin');assert.equal(row.actor_id,1);assert.equal(row.billboard,'Coastal junction');
  assert.equal(row.project_name,'Audit target');assert.ok(row.created_at>Date.now()-60000);
  const changes=activityChanges(row.detail,row.event);
  assert.ok(changes.rows.every(r=>r.before!=='Not recorded'&&r.after!=='Not recorded'));
 }
 assert.equal(activityChanges(events.find(r=>r.event.includes('removed')).detail).rows[0].after,'Removed from this project');
 assert.equal(database.prepare('SELECT count(*) n FROM inventory WHERE id=80').get().n,1);
 assert.equal(database.prepare('SELECT count(*) n FROM inventory_projects WHERE inventory_id=80 AND project_id=1').get().n,1);
});

test('dashboard is project-scoped, read-only and excludes removed memberships',async()=>{
 globalThis.__testUser={id:1,name:'Admin',role:'admin'};
 const before=database.prepare('SELECT count(*) n FROM asset_activity').get().n;
 const response=await api.GET(new Request('http://local/api/operations?section=dashboard&projectId=80'));
 assert.equal(response.status,200);const data=await response.json();
 assert.equal(data.total,0);assert.equal(data.projectId,80);assert.equal(data.trend.length,14);
 assert.ok(data.activity.some(a=>a.event==='Billboard removed from project'));
 assert.equal(database.prepare('SELECT count(*) n FROM asset_activity').get().n,before);
 globalThis.__testUser={id:2,name:'Creator',role:'creator'};
 assert.equal((await api.GET(new Request('http://local/api/operations?section=dashboard&projectId=80'))).status,403);
 assert.equal((await api.GET(new Request('http://local/api/operations?section=dashboard&projectId=2'))).status,200);
 globalThis.__testUser={id:1,name:'Admin',role:'admin'};
});

test('history filters use inclusive EAT dates, user, type, search and project scope',async()=>{
  globalThis.__testUser={id:1,name:'Admin',role:'admin'};
  const marker='History filter fixture';
  const insert=database.prepare('INSERT INTO asset_activity(project_id,asset_id,actor_id,event,detail,created_at) VALUES(?,?,?,?,?,?)');
  const detail=JSON.stringify({schemaVersion:2,actor:{name:'Original user name'},before:{faces:1},after:{faces:2}});
  const start=Date.parse('2026-11-01T21:00:00Z'); // 2 November, 00:00 EAT
  try {
    insert.run(1,100,1,marker,detail,start-1);
    insert.run(1,100,1,marker,detail,start);
    insert.run(1,100,1,marker,detail,start+86400000-1);
    insert.run(1,100,1,marker,detail,start+86400000);
    insert.run(1,100,null,marker,'{}',start);
    insert.run(2,100,2,marker,detail,start);
    const get=query=>api.GET(new Request('http://local/api/operations?section=history&'+new URLSearchParams(query)));
    const filters={projectId:'1',actor:'1',event:marker,from:'2026-11-02',to:'2026-11-02',assetId:'100'};
    const data=await (await get(filters)).json();
    assert.equal(data.total,2);assert.equal(data.pageSize,50);
    assert.ok(data.rows.every(row=>row.actor==='Original user name'&&row.project_id===1&&row.billboard==='Airport'));
    assert.equal((await (await get({...filters,q:'Original user name'})).json()).total,2);
    assert.equal((await (await get({...filters,actor:'system'})).json()).total,1);
    assert.equal((await (await get({...filters,assetId:'987654'})).json()).total,0);
    for(const invalid of [{from:'2026-02-30'},{from:'2026-11-03'},{actor:'1 OR 1=1'},{assetId:'no'}])assert.equal((await get({...filters,...invalid})).status,400);
    const exported=await get({...filters,format:'excel'});assert.equal(exported.status,200);
    const xml=await exported.text();assert.match(xml,/2 activities/);assert.match(xml,/Original user name/);assert.match(xml,/Faces/);assert.match(xml,/2026-11-02T23:59:59/);assert.doesNotMatch(xml,/2026-11-03T/);
    globalThis.__testUser={id:2,name:'Creator',role:'creator'};
    assert.equal((await get({...filters,projectId:'2',actor:'2'})).status,200);
    assert.equal((await get({...filters,projectId:'2',format:'excel'})).status,403);
    assert.equal((await get(filters)).status,403);
    globalThis.__testUser={id:3,role:'field_user'};assert.equal((await get({...filters,format:'excel'})).status,403);
    globalThis.__testUser=null;assert.equal((await get(filters)).status,401);
  } finally {database.prepare('DELETE FROM asset_activity WHERE event=?').run(marker);globalThis.__testUser={id:1,name:'Admin',role:'admin'};}
});

test('history pagination and admin export include more than the old 500 record limit',async()=>{
  const marker='History pagination fixture';
  const insert=database.prepare('INSERT INTO asset_activity(project_id,asset_id,actor_id,event,detail,created_at) VALUES(1,100,1,?,?,?)');
  try {
    for(let i=0;i<505;i++)insert.run(marker,JSON.stringify({schemaVersion:2,before:{faces:0},after:{faces:i+1}}),Date.parse('2026-11-02')+i);
    const base='http://local/api/operations?section=history&projectId=1&event='+encodeURIComponent(marker);
    const page=await (await api.GET(new Request(base+'&page=11'))).json();
    assert.equal(page.total,505);assert.equal(page.page,11);assert.equal(page.rows.length,5);
    const xml=await (await api.GET(new Request(base+'&format=excel&page=11'))).text();
    assert.match(xml,/505 activities/);assert.equal((xml.match(/>Faces</g)||[]).length,505);
    assert.equal((await (await api.GET(new Request(base+'&page=99999'))).json()).page,11);
  } finally {database.prepare('DELETE FROM asset_activity WHERE event=?').run(marker);}
});

test('Excel history escapes text, keeps values as text and never invents legacy data',()=>{
  const xml=historyWorkbook([{id:1,created_at:1,actor:'A & B',event:'Attributes updated',billboard:'<Airport>',detail:JSON.stringify({before:{note:'Old'},after:{note:'=HYPERLINK("https://invalid","bad")\u0000'}})}],{project:'Test',filters:{},exportedBy:'Admin',exportedAt:1});
  assert.match(xml,/A &amp; B/);assert.match(xml,/&lt;Airport&gt;/);assert.match(xml,/ss:Type="String">=HYPERLINK/);assert.doesNotMatch(xml,/ss:Formula|\u0000/);
  assert.match(xml,/FreezePanes/);assert.match(xml,/AutoFilter/);
});

test('GPS ranges, zero coordinates, timezone day, money and delivery ordering',()=>{
  assert.equal(validCoordinates(0,39),true);assert.equal(validCoordinates('',39),false);assert.equal(validCoordinates(91,39),false);assert.equal(validCoordinates(-6,181),false);
  assert.equal(dayKey(Date.parse('2026-10-14T22:00:00Z')),'2026-10-15');assert.equal(money('12.34'),1234);assert.throws(()=>money(-1));
  assert.equal(nextDeliveryStatus('delivered','accepted'),'delivered');assert.equal(nextDeliveryStatus('read','failed'),'read');
  assert.equal(bookingOverlap('2026-10-01','2026-10-15','2026-10-15','2026-10-20'),true);
  assert.equal(inventoryFingerprint({street:' AIRPORT ',lat:-6,lng:39}),inventoryFingerprint({street:'airport',lat:'-6.00000',lng:39}));
});
test('project authorization and viewer restrictions',async()=>{
  globalThis.__testUser={id:2,role:'creator'};
  assert.equal((await api.GET(new Request('http://local/api/operations?projectId=1&section=history'))).status,403);
  globalThis.__testUser={id:1,role:'viewer'};
  assert.equal((await api.GET(new Request('http://local/api/operations?projectId=1&section=notifications'))).status,403);
  globalThis.__testUser={id:1,role:'admin'};
});
test('same physical face cannot be booked across two projects, other faces can',async()=>{
  const booking={action:'book',projectId:1,inventoryId:1,face:1,campaign:'Campaign',startsOn:'2026-10-01',endsOn:'2026-10-15'};
  assert.equal((await post(booking)).status,200);
  assert.equal((await post({...booking,projectId:2,startsOn:'2026-10-15'})).status,409);
  assert.equal((await post({...booking,projectId:2,face:2})).status,200);
  assert.equal((await post({...booking,face:3})).status,400);
  assert.equal((await post({...booking,startsOn:'2026-02-30'})).status,400);
});
test('cost validation and activity history',async()=>{
  assert.equal((await post({action:'record-cost',projectId:1,inventoryId:1,category:'rental',amount:150.25,incurredOn:'2026-10-15'})).status,200);
  assert.equal(database.prepare('SELECT amount_minor FROM actual_costs').get().amount_minor,15025);
  assert.equal((await post({action:'record-cost',projectId:1,inventoryId:1,category:'rental',amount:-1,incurredOn:'2026-10-15'})).status,400);
  assert.ok(database.prepare("SELECT 1 FROM asset_activity WHERE event='Actual cost recorded'").get());
});

test('existing flight schedules also block overlapping face reservations',async()=>{
  database.prepare(`INSERT INTO flight_schedules(project_id,asset_id,stage,flight_status,start_at,end_at,duration_days,reminder_days,note,created_by,created_at,updated_at) VALUES(1,100,'flighted','flighted',?,?,10,3,'',1,1,1)`).run(Date.parse('2026-11-01'),Date.parse('2026-11-10'));
  assert.equal((await post({action:'book',projectId:2,inventoryId:1,face:2,campaign:'Conflict','startsOn':'2026-11-05','endsOn':'2026-11-07'})).status,409);
  assert.equal((await post({action:'book',projectId:2,inventoryId:1,face:2,campaign:'Later','startsOn':'2026-11-11','endsOn':'2026-11-12'})).status,200);
});
test('queue deduplicates, claims once, retries rejected messages and preserves unknown delivery',async()=>{
  const context={projectId:1,eventKey:'test'};
  await store.enqueue('sms','255700000000','Subject',{message:'Test'},context);
  await store.enqueue('sms','255700000000','Subject',{message:'Test'},context);
  assert.equal(database.prepare('SELECT count(*) total FROM notification_jobs').get().total,1);
  await store.deliverJobs(async()=>({sent:false,error:'Rate limited'}));
  assert.equal(database.prepare('SELECT status FROM notification_jobs').get().status,'retry');
  database.exec('UPDATE notification_jobs SET next_attempt_at=0');
  let calls=0;await store.deliverJobs(async()=>{calls++;return {sent:true,providerId:'provider-1'};});
  await store.deliverJobs(async()=>{calls++;return {sent:true};});assert.equal(calls,1);
  await store.enqueue('sms','255700000001','Subject',{message:'Test'},context);
  await store.deliverJobs(async()=>{throw new Error('Lost connection');});
  assert.equal(database.prepare("SELECT status FROM notification_jobs WHERE recipient='255700000001'").get().status,'unknown');
});
test('issue work requires owner evidence and admin approval',async()=>{
  database.exec(`INSERT INTO validation_assignments(id,project_id,asset_id,assigned_to,assigned_by,status,report,created_at,updated_at) VALUES(1,1,100,3,1,'assigned','{}',1,1);UPDATE validation_assignments SET status='issue',report='{"issueType":"Damaged board"}' WHERE id=1;`);
  const issue=database.prepare('SELECT * FROM issue_tasks').get();assert.equal(issue.status,'open');
  globalThis.__testUser={id:3,role:'field_user'};
  const resolution={action:'resolve-issue',id:issue.id,resolution:'Repaired',photo:'data:image/jpeg;base64,dGVzdA=='};
  assert.equal((await post({...resolution,photo:''})).status,400);
  assert.equal((await post(resolution)).status,200);
  assert.equal((await post(resolution)).status,200);
  assert.equal((await post({action:'update-issue',projectId:1,id:issue.id,status:'approved',remark:'Checked'})).status,403);
  globalThis.__testUser={id:1,role:'admin'};
  assert.equal((await post({action:'update-issue',projectId:1,id:issue.id,status:'approved',remark:'Checked'})).status,200);
  assert.equal(database.prepare('SELECT status FROM validation_assignments WHERE id=1').get().status,'ok');
  assert.equal(JSON.parse(database.prepare('SELECT data FROM inventory WHERE id=1').get().data).photoUrl,resolution.photo);
});

test('WhatsApp signed callbacks survive races, duplicates and out-of-order delivery',async()=>{
  const source=(await readFile(new URL('../app/api/whatsapp/webhook/route.ts',import.meta.url),'utf8')).replace('import { env } from "cloudflare:workers";','const env=globalThis.__testEnv;').replace("'../../../operations-store'",JSON.stringify(storeUrl));
  const webhook=await import(compile(source));
  globalThis.__testEnv.WHATSAPP_PHONE_NUMBER_ID='phone-test';
  const body=(id,status,phone='phone-test',recipient='255700000002')=>JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phone},statuses:[{id,status,recipient_id:recipient,timestamp:'1792300000'}]}}]}]});
  const payload=body('receipt-test','delivered');
  assert.equal((await webhook.POST(new Request('http://local/webhook',{method:'POST',body:payload}))).status,503);
  globalThis.__testEnv.WHATSAPP_APP_SECRET='isolated-test-secret';
  assert.equal((await webhook.POST(new Request('http://local/webhook',{method:'POST',body:payload}))).status,401);
  await store.enqueue('whatsapp','255700000002','Test',{}, {projectId:1,eventKey:'receipt-test'});
  database.exec("UPDATE notification_jobs SET provider_id='receipt-test',status='accepted' WHERE event_key='receipt-test'");
  async function receipt(body){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('isolated-test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('hex');return webhook.POST(new Request('http://local/webhook',{method:'POST',body,headers:{'x-hub-signature-256':'sha256='+signature}}));}
  assert.equal((await receipt(payload)).status,200);
  assert.equal(database.prepare("SELECT status FROM notification_jobs WHERE event_key='receipt-test'").get().status,'delivered');
  await receipt(payload.replace('delivered','sent'));
  assert.equal(database.prepare("SELECT status FROM notification_jobs WHERE event_key='receipt-test'").get().status,'delivered');
  await receipt(body('receipt-test','read'));
  await receipt(body('receipt-test','failed'));
  assert.equal(database.prepare("SELECT status FROM notification_jobs WHERE event_key='receipt-test'").get().status,'read');
  await receipt(body('receipt-test','read'));
  assert.equal(database.prepare("SELECT COUNT(*) n FROM whatsapp_receipts WHERE provider_id='receipt-test'").get().n,1);
  assert.equal(database.prepare("SELECT read_at FROM whatsapp_receipts WHERE provider_id='receipt-test'").get().read_at,1792300000000);
  await receipt(body('wrong-account','read','different-phone'));
  assert.equal(database.prepare("SELECT COUNT(*) n FROM whatsapp_receipts WHERE provider_id='wrong-account'").get().n,0);
  assert.equal((await receipt('{not json')).status,400);
  assert.equal((await receipt('{}')).status,400);
  await store.enqueue('whatsapp','255700000002','Early receipt',{}, {projectId:1,eventKey:'early-receipt'});
  await store.deliverJobs(async job=>{
    await receipt(body('early-provider-id','read'));
    return {sent:true,providerId:'early-provider-id'};
  });
  assert.equal(database.prepare("SELECT status FROM notification_jobs WHERE event_key='early-receipt'").get().status,'read');
  // A signed receipt for a different recipient must not update this user's job.
  await store.enqueue('whatsapp','255700000003','Recipient isolation',{}, {projectId:1,eventKey:'isolated-receipt'});
  database.exec("UPDATE notification_jobs SET status='accepted',provider_id='wrong-recipient' WHERE event_key='isolated-receipt'");
  await receipt(body('wrong-recipient','read'));
  assert.equal(database.prepare("SELECT status FROM notification_jobs WHERE event_key='isolated-receipt'").get().status,'accepted');
  await receipt(body('wrong-recipient','failed','phone-test','255700000003'));
  // The inbox retains the first recipient for a provider ID; it cannot be retargeted.
  assert.equal(database.prepare("SELECT status FROM notification_jobs WHERE event_key='isolated-receipt'").get().status,'accepted');
  await store.enqueue('whatsapp','255700000002','Retry check',{}, {projectId:1,eventKey:'retry-receipt'});
  database.exec("UPDATE notification_jobs SET status='accepted',provider_id='retry-provider' WHERE event_key='retry-receipt'");
  await receipt(body('retry-provider','failed'));
  const failed=database.prepare("SELECT id,status FROM notification_jobs WHERE event_key='retry-receipt'").get();
  assert.equal(failed.status,'failed');
  assert.equal((await post({action:'retry-notification',id:failed.id,projectId:1})).status,200);
  await store.reconcileWhatsAppReceipts();
  assert.equal(database.prepare('SELECT status FROM notification_jobs WHERE id=?').get(failed.id).status,'pending');
});

test('initialization shares concurrent work and retries after failure',async()=>{
  let calls=0;
  const initialize=initializeOnce(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));});
  await Promise.all(Array.from({length:20},()=>initialize()));
  await initialize();assert.equal(calls,1);
  let attempts=0;const flaky=initializeOnce(async()=>{if(++attempts===1)throw new Error('temporary');});
  await assert.rejects(flaky);await flaky();await flaky();assert.equal(attempts,2);
});

test('SMS requires matching provider acknowledgement, not merely HTTP 200',()=>{
  const ok=parseSmsAcknowledgement(200,'1817085060,255744149769,Send Successful\r\n','255744149769');
  assert.equal(ok.sent,true);assert.equal(ok.providerId,'1817085060');assert.equal(ok.provider,'mshastra');
  for(const [status,text] of [[200,''],[200,'<html>Maintenance</html>'],[500,'1817085060,255744149769,Send Successful'],[200,'Invalid User'],[200,'1817085060,255700000000,Send Successful']]) {
    assert.equal(parseSmsAcknowledgement(status,text,'255744149769').sent,false);
  }
  assert.equal(parseSmsAcknowledgement(200,'','255744149769').ambiguous,true);
  assert.equal(parseSmsAcknowledgement(200,'Invalid User','255744149769').ambiguous,false);
});

test('WhatsApp backlog and slow requests do not starve SMS/email lanes',async()=>{
  database.exec("UPDATE notification_jobs SET status='failed' WHERE status IN ('pending','retry')");
  for(let i=0;i<15;i++)await store.enqueue('whatsapp',`2557000001${String(i).padStart(2,'0')}`,'Backlog',{}, {eventKey:`backlog-${i}`});
  await store.enqueue('sms','255700000200','New SMS',{}, {eventKey:'independent-sms'});
  await store.enqueue('email','test@example.invalid','New email',{}, {eventKey:'independent-email'});
  let release;const gate=new Promise(resolve=>{release=resolve;});let sms=false,email=false;
  const timer=setTimeout(release,500);
  try {
    await store.deliverJobs(async job=>{
      if(job.channel==='whatsapp') {await gate;assert.ok(sms && email);return {sent:false,permanent:true,error:'Sender not registered'};}
      if(job.channel==='sms')sms=true;if(job.channel==='email')email=true;
      if(sms && email)release();return {sent:true,providerId:`ack-${job.channel}`};
    });
  } finally {clearTimeout(timer);}
  assert.equal(database.prepare("SELECT status FROM notification_jobs WHERE event_key='independent-sms'").get().status,'accepted');
  assert.equal(database.prepare("SELECT count(*) n FROM notification_jobs WHERE event_key LIKE 'backlog-%' AND attempts=0").get().n,5);
  assert.equal(database.prepare("SELECT count(*) n FROM notification_jobs WHERE event_key LIKE 'backlog-%' AND status='failed'").get().n,10);
});

test('receipt reconciliation failure does not block SMS and ambiguous sends are not retried',async()=>{
  database.exec("UPDATE notification_jobs SET status='failed' WHERE status IN ('pending','retry')");
  await store.enqueue('sms','255700000201','Runtime failure',{}, {eventKey:'runtime-failure'});
  const original=wrapper.prepare;
  wrapper.prepare=function(sql){if(sql.includes('FROM whatsapp_receipts r'))throw Error('Receipt store unavailable');return original.call(this,sql);};
  try {await store.deliverJobs(async()=>({sent:false,error:'internal error; reference = diagnostic-only'}));}
  finally {wrapper.prepare=original;}
  assert.equal(database.prepare("SELECT status FROM notification_jobs WHERE event_key='runtime-failure'").get().status,'unknown');
  let sends=0;await store.deliverJobs(async()=>{sends++;return {sent:true};});assert.equal(sends,0);
});

test('delivery view includes historical records without duplicate queued audits or cross-project leaks',async()=>{
  globalThis.__testUser={id:1,role:'admin'};
  const audit=database.prepare(`INSERT INTO notification_audit(project_id,channel,notification_type,recipients,recipient_count,subject,status,provider_id,provider_response,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  audit.run(1,'sms','flighted','255700000300,255700000301',2,'Visibility fixture historical','sent','','{}',100);
  audit.run(1,'sms','flighted','255700000302',1,'Visibility fixture queued duplicate','queued','','{}',101);
  audit.run(0,'email','imported','system@example.invalid',1,'Visibility fixture system','delivered','legacy-provider','{}',102);
  audit.run(2,'email','flighted','creator@example.invalid',1,'Visibility fixture other project','sent','','{}',103);
  await store.enqueue('sms','255700000303','Visibility fixture current',{message:'Sample body'},{projectId:1,eventKey:'visibility-current'});
  const get=async query=>(await api.GET(new Request('http://local/api/operations?section=notifications&'+query))).json();
  let result=await get('projectId=1&q=Visibility%20fixture');
  assert.equal(result.total,2);assert.equal(result.scopeName,'First');
  const historical=result.rows.find(row=>row.source==='history');assert.equal(historical.recipient_count,2);assert.equal(historical.attempts,null);assert.equal(historical.delivered_at,null);
  assert.equal(result.rows.find(row=>row.source==='queue').message_text,'Sample body');
  result=await get('scope=all&q=Visibility%20fixture');assert.equal(result.total,4);assert.ok(result.rows.some(row=>row.project_id===0));
  result=await get('scope=all&q=Visibility%20fixture&source=history&channel=sms&status=sent');assert.equal(result.total,1);
  assert.equal((await get('scope=all&q=%25')).total,0);
  globalThis.__testUser={id:2,role:'creator'};
  assert.equal((await api.GET(new Request('http://local/api/operations?section=notifications&scope=all&projectId=2'))).status,403);
  assert.equal((await get('projectId=2&q=Visibility%20fixture')).total,1);
  assert.equal((await api.GET(new Request('http://local/api/operations?section=notifications&projectId=0'))).status,403);
  globalThis.__testUser={id:1,role:'admin'};
});

test('delivery search and pagination cover records beyond the old 500-row cap',async()=>{
  const audit=database.prepare(`INSERT INTO notification_audit(project_id,channel,notification_type,recipients,recipient_count,subject,status,created_at) VALUES(1,'sms','test','test',1,?,'sent',?)`);
  for(let i=0;i<520;i++)audit.run(`Pagination fixture ${i}`,1000+i);
  const response=await api.GET(new Request('http://local/api/operations?section=notifications&projectId=1&q=Pagination%20fixture&page=11'));
  const result=await response.json();assert.equal(result.total,520);assert.equal(result.rows.length,20);assert.equal(result.pageSize,50);
  assert.equal(result.rows.at(-1).subject,'Pagination fixture 0');
});

test('audit saves complete flight snapshots and the actual editor, not original creator',async()=>{
  const editor=auditedDatabase(wrapper,{id:2});
  await editor.prepare("UPDATE flight_schedules SET start_at=?,end_at=?,duration_days=20,reminder_days=4,note='Extended' WHERE project_id=1 AND asset_id=100").bind(1000,2000).run();
  const entry=database.prepare("SELECT * FROM asset_activity WHERE event='Flight schedule updated' ORDER BY id DESC LIMIT 1").get();
  const detail=JSON.parse(entry.detail);
  assert.equal(entry.actor_id,2);assert.equal(detail.actor.name,'Creator');
  assert.equal(detail.before.durationDays,10);assert.equal(detail.after.durationDays,20);
  assert.equal(detail.before.reminderDays,3);assert.equal(detail.after.reminderDays,4);
  assert.equal(detail.before.note,'');assert.equal(detail.after.note,'Extended');
  assert.ok(Object.hasOwn(detail.before,'startAt'));assert.ok(Object.hasOwn(detail.after,'endAt'));
  assert.ok(activityChanges(detail,entry.event).rows.every(row=>row.before!=='Not recorded'&&row.after!=='Not recorded'));
  const count=database.prepare('SELECT count(*) n FROM asset_activity').get().n;
  await editor.prepare("UPDATE flight_schedules SET updated_at=12345,last_notified_at=12345 WHERE project_id=1 AND asset_id=100").run();
  assert.equal(database.prepare('SELECT count(*) n FROM asset_activity').get().n,count);
});

test('attribute audit includes all assigned projects, photo replacement and server-side identity',async()=>{
  const editor=auditedDatabase(wrapper,{id:2});
  await editor.prepare("UPDATE inventory SET data=json_set(data,'$.faces',4,'$.lastEditedBy',1,'$.photoUrl','data:image/jpeg;base64,bmV3IQ==') WHERE id=1").run();
  const entries=database.prepare("SELECT * FROM asset_activity WHERE event='Attributes updated' ORDER BY id DESC LIMIT 2").all();
  assert.deepEqual(new Set(entries.map(row=>row.project_id)),new Set([1,2]));
  const detail=JSON.parse(entries[0].detail);
  assert.equal(entries[0].actor_id,2);assert.equal(detail.actor.name,'Creator');
  assert.equal(detail.before.faces,2);assert.equal(detail.after.faces,4);
  assert.equal(detail.before.photoUrl,'Previous uploaded image');assert.equal(detail.after.photoUrl,'Replacement uploaded image');
  assert.ok(!entries[0].detail.includes('base64'));assert.ok(!Object.hasOwn(detail.after,'lastEditedBy'));
  database.prepare("UPDATE users SET name='Renamed creator' WHERE id=2").run();
  const history=await (await api.GET(new Request('http://local/api/operations?section=history&projectId=1'))).json();
  assert.equal(history.rows.find(row=>row.id===entries.find(row=>row.project_id===1).id).actor,'Creator');
  database.prepare("UPDATE users SET name='Creator' WHERE id=2").run();
});

test('audit context and event roll back with failed writes and do not leak to automation',async()=>{
  const before=database.prepare('SELECT count(*) n FROM asset_activity').get().n;
  const editor=auditedDatabase(wrapper,{id:2});
  await assert.rejects(editor.batch([
    editor.prepare("UPDATE inventory SET data=json_set(data,'$.faces',99) WHERE id=1"),
    editor.prepare("INSERT INTO projects(id,name,project_type,share_token,created_by,created_at) VALUES(1,'Duplicate','OOH','duplicate',1,1)"),
  ]));
  assert.equal(database.prepare('SELECT count(*) n FROM asset_activity').get().n,before);
  assert.equal(database.prepare('SELECT count(*) n FROM activity_write_context').get().n,0);
  assert.equal(JSON.parse(database.prepare('SELECT data FROM inventory WHERE id=1').get().data).faces,4);
  database.exec("UPDATE flight_schedules SET note='Automated maintenance' WHERE project_id=1 AND asset_id=100");
  const automated=database.prepare("SELECT actor_id,detail FROM asset_activity WHERE event='Flight schedule updated' ORDER BY id DESC LIMIT 1").get();
  assert.equal(automated.actor_id,null);assert.equal(JSON.parse(automated.detail).actor.name,'System automation');
  const total=database.prepare('SELECT count(*) n FROM asset_activity').get().n;
  await installActivityAudit(wrapper);assert.equal(database.prepare('SELECT count(*) n FROM asset_activity').get().n,total);
});

test('new field assignments, corrections, bookings and costs have before/after audit records',async()=>{
  for(const entity of ['validation_assignments','issue_tasks','bookings','actual_costs']){
    const entries=database.prepare("SELECT detail FROM asset_activity WHERE json_extract(detail,'$.entity')=?").all(entity);
    assert.ok(entries.length>0,entity);
    for(const entry of entries){const detail=JSON.parse(entry.detail);assert.ok(Object.hasOwn(detail,'before'));assert.ok(Object.hasOwn(detail,'after'));assert.ok(detail.actor.name);}
  }
  const detail={schemaVersion:2,operation:'insert',before:null,after:{status:'assigned',note:''}};
  assert.equal(activityChanges(detail).rows[0].before,'Not yet created');
  assert.equal(activityChanges({...detail,operation:'delete',before:detail.after,after:null}).rows[0].after,'Removed');
});

test('authenticated main API writes record the editor for inventory, flight and field validation',async()=>{
  const handler=routeSource.slice(routeSource.indexOf('export async function POST(request: Request)'),routeSource.indexOf('export async function DELETE(request: Request)'));
  const prefix=`import {auditedDatabase} from ${JSON.stringify(auditUrl)};
    import {validateRegisterFields} from ${JSON.stringify(new URL('../app/asset-register.mjs',import.meta.url).href)};
    import {validCoordinates} from ${JSON.stringify(rulesUrl)};
    const env=globalThis.__testEnv; const setup=async()=>{}; const currentUser=async()=>globalThis.__testUser;
    const json=(value,status=200)=>Response.json(value,{status});
    const normalizedFlightStatus=(stage,status)=>status;
  `;
  const main=await import(compile(prefix+handler));
  const request=(action,body)=>main.POST(new Request('http://local/api/app?action='+action,{method:'POST',body:JSON.stringify(body)}));
  globalThis.__testUser={id:1,role:'admin',name:'Admin'};
  assert.equal((await request('inventory',{projectId:1,items:[{id:700,street:'Audit fixture',lat:-6,lng:39,faces:1,lastEditedBy:999}]})).status,200);
  assert.equal((await request('flight-schedule',{projectId:1,assetId:700,stage:'design',flightStatus:'unflighted',durationDays:10,reminderDays:3,note:'Draft'})).status,200);
  assert.equal((await request('flight-schedule',{projectId:1,assetId:700,stage:'printing',flightStatus:'unflighted',durationDays:15,reminderDays:2,note:'Printing started'})).status,200);
  assert.equal((await request('assign-validations',{projectId:1,assetId:700,userId:3})).status,200);
  const assignment=database.prepare('SELECT id FROM validation_assignments WHERE asset_id=700').get();
  globalThis.__testUser={id:3,role:'field_user',name:'Field'};
  assert.equal((await request('submit-validation',{assignmentId:assignment.id,verdict:'ok',photo:'data:image/jpeg;base64,dGVzdA=='})).status,200);
  const entries=database.prepare('SELECT * FROM asset_activity WHERE asset_id=700').all();
  assert.ok(entries.some(row=>row.event==='Flight schedule updated'&&row.actor_id===1));
  assert.ok(entries.some(row=>row.event==='Validation updated'&&row.actor_id===3));
  assert.ok(entries.some(row=>row.event==='Attributes updated'&&row.actor_id===3));
  assert.ok(entries.every(row=>row.actor_id!==999));
  assert.equal(database.prepare('SELECT count(*) n FROM activity_write_context').get().n,0);
  globalThis.__testUser={id:1,role:'admin',name:'Admin'};
});
