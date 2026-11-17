import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryGeography,matchesGeography,geographyOptions,changeGeography,emptyGeoFilters,uniqueInventory,inventoryCsv} from '../app/inventory-workflow.mjs';
const now=Date.now();
const board={id:1,inventoryDbId:101,street:'Airport',lat:-6,lng:39,faces:2};
const area=(level,key,name,population=100)=>({level,key,name,population,verified:true});
const entry=(areas)=>({lat:-6,lng:39,fetchedAt:now,demographics:{areas}});
const evidence={101:entry([area('region','r1','Zanzibar'),area('district','d1','West'),area('ward','w1','Airport'),area('village','v1','Airport village')])};

test('region options merge source IDs, case, whitespace and Region suffix while matching all records',()=>{
 const boards=[board,{...board,id:2,inventoryDbId:102,locationAddress:{lat:-6,lng:39,status:'ready',region:'  DAR  ES SALAAM Region  ',district:'Kinondoni'}},{...board,id:3,inventoryDbId:103}];
 const all={101:entry([area('region','official-dar','Dar es Salaam'),area('district','d1','Ilala')]),103:entry([area('region','other','Arusha')])};
 const options=geographyOptions(boards,all,{},'region',now);
 assert.deepEqual(options,[{value:'region:arusha',label:'Arusha'},{value:'region:dar es salaam',label:'Dar es Salaam'}]);
 const filters=changeGeography(emptyGeoFilters(),'region','region:dar es salaam');
 assert.deepEqual(boards.filter(b=>matchesGeography(b,all,filters,now)).map(b=>b.id),[1,2]);
 assert.equal(geographyOptions(boards,all,filters,'district',now).length,2);
 assert.equal(geographyOptions(boards,all,{},'region',now).length,2);
});
