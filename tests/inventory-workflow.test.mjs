import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryGeography,matchesGeography,geographyOptions,changeGeography,emptyGeoFilters,uniqueInventory,inventoryCsv} from '../app/inventory-workflow.mjs';
import {markerState} from '../app/map-symbols.mjs';
import * as geography from '../app/inventory-workflow.mjs';
import * as symbols from '../app/map-symbols.mjs';
import * as register from '../app/asset-register.mjs';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const now=Date.now();
const board={id:1,inventoryDbId:101,street:'Airport',lat:-6,lng:39,faces:2};
const area=(level,key,name,population=100)=>({level,key,name,population,verified:true});
const entry=(areas)=>({lat:-6,lng:39,fetchedAt:now,demographics:{areas}});
const evidence={101:entry([area('region','r1','Zanzibar'),area('district','d1','West'),area('ward','w1','Airport'),area('village','v1','Airport village')])};
test('joins enrichment by database identity, never the imported asset ID',()=>{
 assert.equal(inventoryGeography(board,evidence,now).local.name,'Airport');
 assert.equal(inventoryGeography({...board,inventoryDbId:102},{1:evidence[101]},now).ready,false);
});
test('stale, future, malformed and coordinate-mismatched evidence is unavailable',()=>{
 for(const patch of [{fetchedAt:now-8*86400000},{fetchedAt:now+1},{fetchedAt:null},{lat:-7}]){
  const g=inventoryGeography(board,{101:{...evidence[101],...patch}},now);
  assert.equal(g.ready,false);assert.equal(g.local,null);
 }
});
test('cascading options respect parent area keys and preserve equal-name identities',()=>{
 const boards=[board,{...board,id:2,inventoryDbId:102},{...board,id:3,inventoryDbId:103}];
 const all={...evidence,102:entry([area('region','r2','Other'),area('district','d2','West')]),103:entry([area('region','r1','Zanzibar'),area('district','d3','West')])};
 assert.deepEqual(geographyOptions(boards,all,{region:'r1'},'district',now).map(v=>v.value),['d1','d3']);
});
test('changing a parent clears dependent geography but retains ancestors',()=>{
 const filters={region:'r1',district:'d1',council:'c1',local:'w1',village:'v1'};
 assert.deepEqual(changeGeography(filters,'district','d2'),{region:'r1',district:'d2',council:'',local:'',village:''});
 assert.equal(filters.local,'w1');
});
test('missing area filters do not substitute imported location labels',()=>{
 assert.equal(matchesGeography(board,evidence,{...emptyGeoFilters(),local:'w1'},now),true);
 assert.equal(matchesGeography(board,{}, {village:'__missing__'},now),true);
 assert.equal(matchesGeography(board,{}, {local:'w1'},now),false);
});
test('all-project inventory counts shared billboards once, retaining project names',()=>{
 const rows=uniqueInventory([{...board,projectName:'A',projectId:1},{...board,projectName:'B',projectId:2}]);
 assert.equal(rows.length,1);assert.deepEqual(rows[0].projectNames,['A','B']);
 assert.deepEqual(rows[0].projectIds,[1,2]);
});
test('export contains location provenance, readable columns and safe spreadsheet cells',()=>{
 const csv=inventoryCsv([{...board,street:'=DANGEROUS()',owner:'@vendor'}],evidence,markerState);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('Village population (estimated, NBS 2022)'));
 assert.ok(csv.includes("\"'=DANGEROUS()\""));assert.ok(csv.includes("\"'@vendor\""));
 assert.ok(csv.includes('Airport village'));
});
const require=createRequire(import.meta.url),component={exports:{}};
const compiled=ts.transpileModule(readFileSync(new URL('../app/InventoryTable.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
new Function('require','module','exports',compiled.outputText)(name=>name==='./inventory-workflow.mjs'?geography:name==='./map-symbols.mjs'?symbols:name==='./asset-register.mjs'?register:require(name),component,component.exports);
test('inventory toolbar exposes view modes and location filters without statistics cards',()=>{
 const html=renderToStaticMarkup(React.createElement(component.exports.InventoryControls,{boards:[board],rows:[board],evidence,geo:emptyGeoFilters(),view:'split',type:'All types',status:'All status',flight:'All flight status',projectFilter:'All projects',vendor:'',query:'',canManage:false,isAdmin:false}));
 assert.match(html,/aria-label="Inventory view"/);
 assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
 for(const name of ['Region','District','Ward / shehia','Village'])assert.ok(html.includes(`aria-label="Inventory ${name}"`));
 assert.doesNotMatch(html,/metric-card|stats-card|Add billboard|type="file"/);
 assert.doesNotMatch(html,/id="inventory-more-filters"/);
});
test('table keeps locate and explicit details actions separate and paginates records',()=>{
 const rows=Array.from({length:32},(_,i)=>({...board,id:i+1,inventoryDbId:101+i,street:`Board ${i+1}`}));
 const html=renderToStaticMarkup(React.createElement(component.exports.default,{boards:rows,rows,evidence,selected:[],loading:false,projectName:'Test',focusedId:1}));
 assert.equal((html.match(/title="Locate on map"/g)||[]).length,25);
 assert.match(html,/data-focused="true"/);
 assert.match(html,/Details to edit/);assert.match(html,/Page 1 of 2/);
 assert.match(html,/Scrollable billboard inventory/);
});
