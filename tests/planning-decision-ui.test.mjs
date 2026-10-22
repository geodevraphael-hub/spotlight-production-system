import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultDecision } from '../app/planning-decision.mjs';
const sourceUrl=new URL('../app/PlanningDecision.tsx',import.meta.url);
const output=ts.transpileModule(readFileSync(sourceUrl,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
const loaded={exports:{}};
new Function('require','module','exports',output.outputText)(createRequire(sourceUrl),loaded,loaded.exports);
const props={boards:[],allBoards:[],costs:{},selected:[],settings:defaultDecision(),onSettings(){},onAdd(){},onLocate(){},onClose(){}};
test('decision dialog keeps provenance, geographic choices and nine grouped priorities visible',()=>{
  const html=renderToStaticMarkup(React.createElement(loaded.exports.default,props));
  assert.match(html,/aria-modal="true"/);assert.match(html,/Close decision support/);
  assert.equal((html.match(/type="range"/g)||[]).length,9);
  assert.match(html,/Demographic comparison level/);assert.match(html,/Village · estimated/);
  assert.match(html,/NBS-based administrative area/);assert.match(html,/Group visible results/);
  assert.match(html,/not measured audience/);assert.match(html,/Historical 2004 traffic/);
  assert.match(html,/Inventory value only/);assert.match(html,/Location radius/);
});
test('missing location data is never presented as a fully evidenced recommendation',()=>{
  const boards=[{id:1,street:'Test board',lat:-6,lng:39,faces:1,rentalPrice:100,printingPrice:0,transportPrice:0,flightingPrice:0}];
  const html=renderToStaticMarkup(React.createElement(loaded.exports.default,{...props,boards,allBoards:boards}));
  assert.match(html,/Incomplete/);assert.match(html,/0 \/ 1 fully evidenced/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Propose shortlist<\/button>/);
});
