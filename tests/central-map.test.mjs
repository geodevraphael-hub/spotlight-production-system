import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {centralInventory,centralProjectView,centralProjectCounts} from '../app/central-map.mjs';
import * as central from '../app/central-map.mjs';
import * as symbols from '../app/map-symbols.mjs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const data=JSON.stringify({id:123,projectId:1,street:'Airport',flightStatus:'unflighted'});
const rows=[{inventory_id:40,data,project_id:1,project_name:'A'},{inventory_id:40,data,project_id:2,project_name:'B'}];
const schedules=[{project_id:2,asset_id:123,flight_status:'flighted',end_at:3000}];
test('one physical record retains distinct project schedules and stable database identity',()=>{
 const [b]=centralInventory(rows,schedules);
 assert.equal(b.id,40);assert.equal(b.originalAssetId,123);
 assert.deepEqual(b.projectIds,[1,2]);
 assert.equal(b.memberships[0].flightStatus,'unflighted');
 assert.equal(b.memberships[1].flightStatus,'flighted');
 assert.equal(centralInventory([...rows,rows[0]],schedules)[0].memberships.length,2);
});
test('project scope uses IDs and its own status, not the source project status',()=>{
 const boards=centralInventory(rows,schedules);
 assert.equal(centralProjectView(boards,'1',1000)[0].flightStatus,'unflighted');
 assert.equal(centralProjectView(boards,'2',1000)[0].flightStatus,'flighted');
 assert.equal(centralProjectView(boards,'3',1000).length,0);
 assert.deepEqual(centralProjectView(boards,'all',4000)[0].centralStates,['unflighted','expired']);
 assert.equal(symbols.markerState(centralProjectView(boards,'all',4000)[0],4000),'expired');
 assert.equal(symbols.markerState(centralProjectView(boards,'all',4000,'unflighted')[0],4000),'unflighted');
});
test('unassigned rows remain visible and never invent project memberships',()=>{
 const boards=centralInventory([{inventory_id:41,data,project_id:null,project_name:null}],[]);
 assert.equal(boards[0].projectName,'Unassigned');
 assert.equal(centralProjectView(boards,'unassigned').length,1);
 assert.equal(centralProjectView(boards,'1').length,0);
});
test('rail counts include empty projects and count each shared billboard once per project',()=>{
 const boards=centralInventory(rows,schedules);
 const counts=centralProjectCounts(boards,[{id:1,name:'Same'},{id:2,name:'Same'},{id:3,name:'Empty'}]);
 assert.deepEqual(counts.map(p=>[p.id,p.count]),[[3,0],[1,1],[2,1]]);
});
test('SQL includes source and linked projects but preserves orphan inventory without fake names',()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE inventory(id INTEGER,data TEXT);CREATE TABLE projects(id INTEGER,name TEXT);CREATE TABLE inventory_projects(inventory_id INTEGER,project_id INTEGER);INSERT INTO projects VALUES(1,"Source"),(2,"Linked");'.replaceAll('"',"'"));
 sql.prepare('INSERT INTO inventory VALUES(?,?)').run(40,data);
 sql.prepare('INSERT INTO inventory VALUES(?,?)').run(41,JSON.stringify({id:123,projectId:99}));
 sql.exec('INSERT INTO inventory_projects VALUES(40,2),(40,999)');
 const source=readFileSync(new URL('../app/api/app/route.ts',import.meta.url),'utf8');
 const query=source.match(/SELECT i.id AS inventory_id,i.data,p.id AS project_id,p.name AS project_name[\s\S]+?ORDER BY p.name,i.id/)[0];
 const result=centralInventory(sql.prepare(query).all(),schedules);
 assert.equal(result.length,2);
 assert.deepEqual(result.find(b=>b.id===40).projectIds,[2,1]);
 assert.deepEqual(result.find(b=>b.id===41).memberships,[]);
 assert.match(source,/if \(allProjects\) \{\s+if \(user.role !== "admin"\) return json\(\{ error: "Forbidden" \}, 403\)/);
 sql.close();
});
const require=createRequire(import.meta.url),component={exports:{}};
const compiled=ts.transpileModule(readFileSync(new URL('../app/CentralMap.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
new Function('require','module','exports',compiled.outputText)(name=>name==='./central-map.mjs'?central:name==='./map-symbols.mjs'?symbols:require(name),component,component.exports);
test('project browser has accessible persistent filters without metric cards or editing controls',()=>{
 const html=renderToStaticMarkup(React.createElement(component.exports.CentralProjects,{boards:centralInventory(rows,schedules),projects:[{id:1,name:'A'},{id:2,name:'B'}],value:'all'}));
 assert.match(html,/Find a project/);assert.match(html,/Project map filters/);assert.match(html,/Unassigned/);
 assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
 assert.doesNotMatch(html,/stats-card|metric-card|Delete|Add billboard/);
});
test('detail lists actual project flight status with explicit navigation',()=>{
 const html=renderToStaticMarkup(React.createElement(component.exports.CentralMemberships,{board:centralInventory(rows,schedules)[0]}));
 assert.match(html,/Open A inventory/);assert.match(html,/Open B inventory/);
 assert.match(html,/Unflighted/);assert.match(html,/Expired/);
});
test('selection isolation is explicit and empty map cannot fit unrelated billboards',()=>{
 const html=renderToStaticMarkup(React.createElement(component.exports.CentralMapContext,{name:'A',visible:0,total:0,selected:2,onlySelected:true}));
 assert.match(html,/Show all matches/);assert.match(html,/Clear selection/);assert.match(html,/disabled=""[^>]*>Fit results/);
});
