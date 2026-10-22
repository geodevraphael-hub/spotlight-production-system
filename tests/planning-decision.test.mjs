import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDecision,decisionSettings,completeCost,rankBillboards,proposeShortlist,decisionCsv,usableEvidence } from '../app/planning-decision.mjs';
import { normalizeLocation } from '../app/location-evidence.mjs';
const board=(id,cost,faces=1)=>({id,street:`Board ${id}`,lat:-6,lng:39,faces,rentalPrice:cost,printingPrice:0,transportPrice:0,flightingPrice:0});
const inventorySettings=()=>({...defaultDecision(),weights:{cost:3,faces:2,population:0,commerce:0,transport:0,buildings:0}});
test('complete prices preserve zero and never treat missing components as free',()=>{
  assert.equal(completeCost(board(1,0)),0);
  assert.equal(completeCost({...board(1,50),printingPrice:undefined}),null);
  assert.equal(completeCost(board(1,50),{printing:''}),null);
  assert.equal(completeCost(board(1,50),{rental:'-5'}),null);
});
test('relative ranking weights lower cost and higher faces; ties are deterministic',()=>{
  const rows=rankBillboards([board(2,200,1),board(1,100,2)],{},{},inventorySettings());
  assert.equal(rows[0].board.id,1);assert.equal(rows[0].score,100);
  assert.equal(rows[1].score,0);assert.equal(rows[0].coverage,100);
  assert.equal(rankBillboards([board(2,100),board(1,100)],{},{},inventorySettings())[0].board.id,1);
});
test('missing provider evidence is incomplete and cannot earn a recommendation',()=>{
  const rows=rankBillboards([board(1,100)],{},{},defaultDecision());
  assert.equal(rows[0].complete,false);assert.ok(rows[0].coverage<100);
  assert.equal(proposeShortlist(rows,defaultDecision()).ids.length,0);
  assert.equal(rankBillboards([board(1,100)],{},{},{...defaultDecision(),weights:{}})[0].score,null);
});
test('normalization retains provenance, absent categories stay null, and coordinates/radius invalidate evidence',()=>{
  const b=board(1,100);
  const input={coordinate:{latitude:-6,longitude:39},mode:'radius',population:{status:'estimated',reference_year:2022,estimated_population:300},facilities:{by_category:{commerce_services:0}},buildings:{detections:5}};
  const result=normalizeLocation({},input,b,1000,10000);
  assert.equal(result.metrics.commerce,0);assert.equal(result.metrics.transport,null);
  assert.equal(result.metrics.population,300);assert.equal(result.populationYear,2022);
  assert.ok(usableEvidence(b,result,1000,11000));
  assert.ok(!usableEvidence(b,result,500,11000));
  assert.ok(!usableEvidence({...b,lng:40},result,1000,11000));
  assert.ok(!usableEvidence(b,result,1000,8*86400000));
  assert.throws(()=>normalizeLocation({},{...input,example_snapshot:{}},b,1000));
  assert.throws(()=>normalizeLocation({},{...input,coordinate:{latitude:3,longitude:4}},b,1000));
});
test('a known old or unknown population reference cannot silently become current evidence',()=>{
  const result=normalizeLocation({}, {population:{status:'estimated',reference_year:2020,estimated_population:999}},board(1,100),1000);
  assert.equal(result.metrics.population,null);
});
test('budget subtracts existing plan, avoids duplicates and requires known costs',()=>{
  const settings={...inventorySettings(),budget:'200',count:3};
  const rows=rankBillboards([board(1,100),board(2,80),board(3,200)],{},{},settings);
  assert.deepEqual(proposeShortlist(rows,settings,[board(1,100)]).ids,[2]);
  assert.equal(proposeShortlist(rows,settings,[{...board(1,100),printingPrice:null}]).ids.length,0);
  assert.equal(proposeShortlist(rows,{...settings,budget:'-1'}).ids.length,0);
  assert.equal(proposeShortlist(rows,{...settings,budget:'Infinity'}).ids.length,0);
});
test('criteria settings reject malformed data and retain only supported configuration',()=>{
  assert.throws(()=>decisionSettings({...defaultDecision(),radius:50}));
  assert.throws(()=>decisionSettings({...defaultDecision(),weights:{cost:100}}));
  assert.throws(()=>decisionSettings({...defaultDecision(),count:500}));
  const settings=decisionSettings({...defaultDecision(),secret:'not retained'});
  assert.equal(settings.secret,undefined);
});
test('score export includes missing evidence, source caveats and spreadsheet injection protection',()=>{
  const rows=rankBillboards([{...board(1,100),street:'=HYPERLINK("bad")'}],{},{},defaultDecision());
  const csv=decisionCsv(rows,defaultDecision());
  assert.ok(csv.includes(`"'=HYPERLINK`));assert.ok(csv.includes('2022 estimate'));assert.ok(csv.includes('Criteria weights'));
  assert.ok(!csv.includes('NaN'));
});
