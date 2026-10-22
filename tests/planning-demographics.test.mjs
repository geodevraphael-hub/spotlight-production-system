import test from 'node:test';
import assert from 'node:assert/strict';
import { demographicAreas,demographicArea,groupDemographicRows } from '../app/planning-demographics.mjs';
import { defaultDecision,decisionSettings,rankBillboards,decisionCsv } from '../app/planning-decision.mjs';
const reverse=()=>({
 census_administration:{ambiguous_ward:false,administration:{ward:{boundary_id:12,name:'Ward A',demographics:{year:2022,population:1000,male:450,female:550,households:250,name_link_needs_verification:0}}}},
 administration:{village:{id:42,name:'Village A'}},coverage:{ambiguous_village:false},
 building_population:{available:true,status:'estimated',village_id:42,name:'Village A',estimates:{population:400,male:180,female:220,households:100},ward_components:[{boundary_name_link_needs_verification:false}],method:'Ward-constrained building counts'}
});
const board={id:1,street:'Board',lat:-6,lng:39,faces:1};
const evidence=()=>({version:1,radius:1000,lat:-6,lng:39,fetchedAt:Date.now(),metrics:{population:9999},demographics:demographicAreas(reverse())});
test('published census and NBS-anchored village allocations remain separate',()=>{
 const result=demographicAreas(reverse());
 assert.equal(demographicArea({demographics:result},'local').population,1000);
 const village=demographicArea({demographics:result},'village');
 assert.equal(village.population,400);assert.equal(village.basis,'NBS-anchored village estimate');
 assert.equal(village.year,2022);assert.equal(village.verified,true);
});
test('missing village never falls back to ward, region or radius population',()=>{
 const source=reverse();delete source.building_population;
 const e=evidence();e.demographics=demographicAreas(source);
 const settings={...defaultDecision(),demographicLevel:'village',weights:{population:5}};
 const row=rankBillboards([board],{},{1:e},settings)[0];
 assert.equal(row.values.population,null);assert.equal(row.complete,false);
});
test('ambiguous, unverified, wrong-year and inconsistent demographics cannot score',()=>{
 for(const change of [
   s=>s.census_administration.ambiguous_ward=true,
   s=>s.census_administration.administration.ward.demographics.name_link_needs_verification=1,
   s=>s.census_administration.administration.ward.demographics.year=2020,
   s=>s.census_administration.administration.ward.demographics.male=999
 ]){
  const source=reverse();change(source);
  assert.equal(demographicArea({demographics:demographicAreas(source)},'local').population,null);
 }
 const source=reverse();source.coverage.ambiguous_village=true;
 assert.equal(demographicArea({demographics:demographicAreas(source)},'village').population,null);
});
test('NBS choice and radius model are explicit; old saved weights keep original meaning',()=>{
 const e=evidence(),nbs={...defaultDecision(),weights:{population:5,households:1}};
 const row=rankBillboards([board],{},{1:e},nbs)[0];
 assert.equal(row.values.population,1000);assert.equal(row.values.households,250);
 const legacy=decisionSettings({...defaultDecision(),version:1,populationBasis:undefined});
 assert.equal(legacy.populationBasis,'radius');
 assert.equal(rankBillboards([board],{},{1:e},legacy)[0].values.population,9999);
 assert.throws(()=>decisionSettings({...nbs,demographicLevel:'automatic-region-fallback'}));
 assert.match(decisionCsv([row],nbs),/Published census/);
});
test('grouping uses level and area identity without summing residents per board',()=>{
 const rows=rankBillboards([board,{...board,id:2}],{},{1:evidence(),2:evidence()},defaultDecision());
 const groups=groupDemographicRows(rows);
 assert.equal(groups.length,1);assert.equal(groups[0].rows.length,2);assert.equal(groups[0].area.population,1000);
});
test('stale evidence does not label a board with current demographic criteria',()=>{
 const e=evidence();e.fetchedAt=Date.now()-8*86400000;
 const row=rankBillboards([board],{},{1:e},defaultDecision())[0];
 assert.equal(row.area,null);assert.equal(row.values.population,null);
});
