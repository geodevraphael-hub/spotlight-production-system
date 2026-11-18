import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {inventorySummary,projectInventorySummary} from '../app/inventory-summary.mjs';
import {DEFAULT_DICTIONARIES} from '../app/inventory-dictionaries.mjs';
import {readDictionaries} from '../app/dictionary-store.mjs';
import {emptySummaryFilters,changeSummaryFilter,summaryFilterOptions} from '../app/inventory-summary-filters.mjs';
import {summaryNarrative,inventorySummaryPdf} from '../app/inventory-summary-pdf.mjs';
const now=Date.UTC(2026,10,18,8);
const a={inventoryDbId:1,id:101,projectId:1,street:'Airport display',owner:'Vendor A',mediaType:'large-format',priority:'A',status:'selected',faces:2,installations:0,lat:-6.8,lng:39.2,width:4,height:8,hasPhoto:1,registrationNumber:'KM001',locationAddress:{lat:-6.8,lng:39.2,status:'complete',region:' DAR ES SALAAM Region ',district:'Ilala'}};
const b={inventoryDbId:2,id:102,projectId:2,street:'Shared wall',owner:'Vendor B',mediaType:'wall-wrap',priority:'D',faces:3,lat:-6.7,lng:39.1,hasPhoto:1,flightStatus:'flighted',flightExpiry:now+86400000};
test('summary counts unique physical assets, custom dictionaries, faces and zero installations correctly',()=>{
 const dictionaries={...DEFAULT_DICTIONARIES,mediaType:[['large-format','Large display'],['wall-wrap','Wall wrap']],priority:[...DEFAULT_DICTIONARIES.priority,['D','Priority D']]};
 const data=inventorySummary([a,b,a],[],1,new Map([[2,{bookingStatus:'booked'}]]),dictionaries,now);
 assert.equal(data.total,2);assert.equal(data.faces,5);assert.equal(data.installations,0);assert.equal(data.missingInstallations,1);assert.equal(data.booked,1);assert.equal(data.available,1);
 assert.equal(data.assets[0].typeLabel,'Large display');assert.equal(data.assets[1].priorityLabel,'Priority D');
 assert.deepEqual(data.facets.types.find(row=>row.value==='wall-wrap').ids,[2]);assert.equal(data.assets[0].regionLabel,'Dar es Salaam');
 assert.equal(data.assets[1].flight,'unflighted'); // No project-1 schedule: never inherit project-2 flighting.
 assert.equal(data.locationReady,1);assert.equal(data.photos,2);
});
test('chart selections and quality details partition the same IDs and preserve project-specific flighting',()=>{
 const missing={inventoryDbId:3,id:103,projectId:1,street:'Incomplete',faces:0,lat:null,lng:null,sourceAttributes:{INSTALLATION:'4'}};
 const data=inventorySummary([a,b,missing],[{asset_id:101,flight_status:'flighted',end_at:now-1},{asset_id:102,flight_status:'deflighted'}],1,new Map(),DEFAULT_DICTIONARIES,now);
 assert.equal(data.assets[0].flight,'expired');assert.equal(data.assets[1].flight,'deflighted');assert.equal(data.installations,4);
 for(const rows of Object.values(data.facets))assert.deepEqual(rows.flatMap(row=>row.ids).sort(),[1,2,3]);
 assert.deepEqual(data.quality.find(row=>row.value==='gps').ids,[3]);assert.deepEqual(data.quality.find(row=>row.value==='photo').ids,[3]);
 const empty=inventorySummary([],[],1);assert.equal(empty.total,0);assert.equal(empty.booked,0);assert.deepEqual(empty.facets.types,[]);
});
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE inventory(id INTEGER PRIMARY KEY,data TEXT);CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER,PRIMARY KEY(inventory_id,project_id));
 CREATE TABLE flight_schedules(project_id INTEGER,asset_id INTEGER,flight_status TEXT,start_at INTEGER,end_at INTEGER);
 CREATE TABLE bookings(inventory_id INTEGER,face INTEGER,status TEXT,starts_on TEXT,ends_on TEXT);
 CREATE TABLE actual_costs(project_id INTEGER,inventory_id INTEGER,category TEXT,amount_minor INTEGER);CREATE TABLE validation_assignments(project_id INTEGER,asset_id INTEGER,status TEXT);`);
 for(const item of [a,b,{...b,inventoryDbId:3,id:103,street:'Private asset'}])sql.prepare('INSERT INTO inventory VALUES(?,?)').run(item.inventoryDbId,JSON.stringify({...item,photoUrl:'data:image/png;base64,PRIVATE_PHOTO_MUST_NOT_BE_RETURNED'}));
 sql.exec("INSERT INTO inventory_projects VALUES(2,1),(2,2);INSERT INTO flight_schedules VALUES(2,102,'flighted',0,NULL);INSERT INTO actual_costs VALUES(1,1,'rental',12000),(1,2,'transport',5000),(1,3,'rental',999900);INSERT INTO validation_assignments VALUES(1,101,'issue'),(1,102,'assigned'),(1,103,'issue');");
 const db={prepare(query){let args=[];const p={bind(...values){args=values;return p;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};return p;},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const p of statements)results.push(await p.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};return {db,sql};
}
test('project report uses compact projections, current membership and live dictionary labels without leaking photos',async()=>{
 const {db,sql}=fixture();await readDictionaries(db);sql.exec("UPDATE inventory_dictionaries SET label='Renamed large display' WHERE kind='mediaType' AND value='large-format'");
 const data=await projectInventorySummary(db,1,now);
 assert.equal(data.total,2);assert.deepEqual(data.assets.map(asset=>asset.id),[1,2]);assert.equal(data.assets[0].typeLabel,'Renamed large display');
 assert.equal(data.recordedCost,170);assert.deepEqual(data.costs.find(row=>row.value==='other').ids,[2]);assert.equal(data.validations.find(row=>row.value==='issue').count,1);
 assert.equal(data.booked,1);assert.equal(data.assets[1].flight,'unflighted');
 assert.ok(!JSON.stringify(data).includes('PRIVATE_PHOTO_MUST_NOT_BE_RETURNED'));assert.ok(!JSON.stringify(data).includes('Private asset'));
});

test('board type selection scopes totals, costs, validations and drill-down IDs while retaining project options',async()=>{
 const {db,sql}=fixture();await readDictionaries(db);
 sql.exec("UPDATE inventory_dictionaries SET label='Large display renamed' WHERE kind='mediaType' AND value='large-format'");
 const filtered=await projectInventorySummary(db,1,now,'large-format');
 assert.equal(filtered.boardType,'large-format');assert.equal(filtered.total,1);assert.equal(filtered.faces,2);
 assert.equal(filtered.recordedCost,120);assert.deepEqual(filtered.costs.flatMap(row=>row.ids),[1]);
 assert.deepEqual(filtered.validations.map(row=>row.value),['issue']);assert.equal(filtered.validations[0].count,1);
 assert.equal(filtered.boardTypes.length,2);assert.equal(filtered.boardTypes.find(row=>row.value==='large-format').label,'Large display renamed');
 for(const rows of Object.values(filtered.facets))assert.deepEqual(rows.flatMap(row=>row.ids),[1]);
 const empty=await projectInventorySummary(db,1,now,'unknown-type');
 assert.equal(empty.total,0);assert.equal(empty.recordedCost,0);assert.deepEqual(empty.validations,[]);assert.equal(empty.boardTypes.length,2);
 assert.equal((await projectInventorySummary(db,1,now)).total,2);
});

test('vendor and cascading geography selections scope every total and exclude missing or stale locations',async()=>{
 const {db,sql}=fixture();await readDictionaries(db);
 const record={...a,locationAddress:{...a.locationAddress,local:'Kipawa',village:'Airport'}};
 sql.prepare('UPDATE inventory SET data=? WHERE id=1').run(JSON.stringify(record));
 const all=await projectInventorySummary(db,1,now),asset=all.assets[0];
 const filters={vendor:'Vendor A',region:asset.region,district:asset.districtKey,local:asset.localKey,village:asset.villageKey};
 const selected=await projectInventorySummary(db,1,now,'large-format',filters);
 assert.equal(selected.total,1);assert.equal(selected.projectTotal,2);assert.equal(selected.faces,2);assert.equal(selected.recordedCost,120);
 assert.deepEqual(selected.validations.flatMap(row=>row.ids),[1]);assert.equal(selected.selectedFilters.length,6);
 assert.deepEqual(selected.filterOptions.local.map(row=>row.label),['Kipawa']);assert.deepEqual(selected.filterOptions.village.map(row=>row.label),['Airport']);
 const missing=await projectInventorySummary(db,1,now,'',{local:'__missing__'});assert.deepEqual(missing.assets.map(row=>row.id),[2]);
 const changed=changeSummaryFilter({...emptySummaryFilters(),...filters},'region','region:arusha');
 assert.equal(changed.vendor,'Vendor A');for(const key of ['district','local','village'])assert.equal(changed[key],'');
 assert.deepEqual(summaryFilterOptions(all.assets,{vendor:'Vendor B'}).district.map(row=>row.value),['__missing__']);
 sql.prepare('UPDATE inventory SET data=? WHERE id=1').run(JSON.stringify({...record,lat:-7}));
 assert.equal((await projectInventorySummary(db,1,now,'',filters)).total,0);
});

test('PDF report contains a filtered narrative and produces a valid multi-page document for populated and empty scopes',async()=>{
 const {db}=fixture();await readDictionaries(db);
 const data=await projectInventorySummary(db,1,now,'large-format');
 assert.match(summaryNarrative(data)[0],/1 of 2 project assets/);
 assert.match(summaryNarrative(data).join(' '),/TZS 120/);
 const bytes=await inventorySummaryPdf(data,'Test Campaign');
 assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
 assert.match(Buffer.from(bytes).toString('latin1'),/\/Count 4/);
 const empty=await projectInventorySummary(db,1,now,'unknown');assert.match(summaryNarrative(empty)[0],/No assets match/);
 assert.ok((await inventorySummaryPdf(empty,'Empty project')).length>1000);
});
