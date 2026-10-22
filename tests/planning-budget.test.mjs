import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultDecision,proposeShortlist} from '../app/planning-decision.mjs';
const settings=(budget,count=10)=>({...defaultDecision(),budget:String(budget),count});
const row=(id,cost,score,complete=true)=>({board:{id},values:{cost},score,complete});
test('budget combinations beat a greedy expensive first placement',()=>{
  const result=proposeShortlist([row(1,100,100),row(2,50,80),row(3,50,75)],settings(100,2));
  assert.deepEqual(result.ids,[2,3]);
  assert.equal(result.cost,100);assert.equal(result.remaining,0);assert.equal(result.optimal,true);
});
test('budget search honours existing plan, board cap, zero costs and missing evidence',()=>{
  const existing={id:1,rentalPrice:40,printingPrice:0,transportPrice:0,flightingPrice:0};
  const rows=[row(1,40,100),row(2,60,80),row(3,0,70),row(4,null,100),row(5,1,100,false)];
  const result=proposeShortlist(rows,settings(100,2),[existing]);
  assert.deepEqual(result.ids,[2,3]);assert.equal(result.cost,60);assert.equal(result.remaining,0);
  assert.deepEqual(proposeShortlist(rows,settings(0,1)).ids,[3]);
  assert.equal(proposeShortlist(rows,settings(30),[existing]).ids.length,0);
});
test('exact frontier matches exhaustive enumeration across small inventories',()=>{
  let seed=7329;
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let run=0;run<35;run++){
    const rows=Array.from({length:10},(_,id)=>row(id,Math.floor(rand()*100),Math.floor(rand()*100)));
    const budget=150, count=4;
    let best=0;
    for(let mask=0;mask<(1<<rows.length);mask++){
      const selected=rows.filter((_,i)=>mask&(1<<i));
      if(selected.length<=count&&selected.reduce((s,r)=>s+r.values.cost,0)<=budget)
        best=Math.max(best,selected.reduce((s,r)=>s+r.score,0));
    }
    const result=proposeShortlist(rows,settings(budget,count));
    const score=rows.filter(r=>result.ids.includes(r.board.id)).reduce((s,r)=>s+r.score,0);
    assert.equal(result.optimal,true);assert.equal(score,best);
    assert.ok(result.cost<=budget);
  }
});
test('large inventory search stays bounded and never exceeds budget or count',()=>{
  const rows=Array.from({length:393},(_,id)=>row(id,50000+(id*7919)%1900000,100-id/5));
  const start=performance.now();
  const result=proposeShortlist(rows,settings(25000000,30));
  assert.ok(result.ids.length<=30);assert.ok(result.cost<=25000000);
  assert.ok(performance.now()-start<5000,'Search should remain interactive');
  assert.equal(new Set(result.ids).size,result.ids.length);
});
test('typography uses the requested family across the app without downloading proprietary fonts',async()=>{
  const {readFile}=await import('node:fs/promises');
  const css=await readFile(new URL('../app/typography.css',import.meta.url),'utf8');
  const layout=await readFile(new URL('../app/layout.tsx',import.meta.url),'utf8');
  assert.match(css,/"Calibri Light", Calibri, "Segoe UI", Arial, sans-serif/);
  assert.match(css,/body :where\(\*\)/);
  assert.ok(!layout.includes('next/font/google'));
  assert.match(layout,/typography\.css/);
});
test('changing planning inputs clears the previous proposal and its cost summary',async()=>{
  const {readFile}=await import('node:fs/promises');
  const ui=await readFile(new URL('../app/PlanningDecision.tsx',import.meta.url),'utf8');
  assert.match(ui,/useEffect\(\(\)=>\{setProposal\(null\);setMessage\(""\);setLimit\(25\);\},\[inputSignature\]\)/);
});
