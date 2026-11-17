import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as dictionaries from '../app/inventory-dictionaries.mjs';
import * as geography from '../app/inventory-workflow.mjs';
import * as symbols from '../app/map-symbols.mjs';
import * as register from '../app/asset-register.mjs';
const require=createRequire(import.meta.url);
function component(file,resolve){
 const module={exports:{}};
 const compiled=ts.transpileModule(readFileSync(new URL(`../app/${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
 new Function('require','module','exports',compiled.outputText)(resolve,module,module.exports);
 return module.exports;
}
const select=component('SearchSelect.tsx',require);
const {InventoryControls}=component('InventoryTable.tsx',name=>({
 react:{...React,useState:()=>[true,()=>{}]}, // Open Refine inventory for server rendering.
 './SearchSelect':select,
 './inventory-dictionaries.mjs':dictionaries,
 './inventory-workflow.mjs':geography,
 './map-symbols.mjs':symbols,
 './asset-register.mjs':register,
 }[name]??require(name)));
test('Refine inventory and central Board type selectors use renamed and custom dictionary entries',()=>{
 const configured={mediaType:[['large-format','Renamed large board'],['wall-wrap','Building wrap']],priority:[['A','Renamed priority']],status:[['selected','Renamed status']]};
 for(const central of [false,true]){
  const html=renderToStaticMarkup(React.createElement(InventoryControls,{central,dictionaries:configured,boards:[],rows:[],evidence:{},geo:geography.emptyGeoFilters(),view:'split',type:'large-format',priority:'A',status:'selected',flight:'All flight status',vendor:'',projectFilter:'All projects'}));
  assert.match(html,/inventory-more-filters/);
  assert.match(html,/<option value="large-format" selected="">Renamed large board<\/option>/);
  assert.match(html,/<option value="wall-wrap">Building wrap<\/option>/);
  assert.match(html,/Renamed priority/);assert.match(html,/Renamed status/);
  assert.doesNotMatch(html,/<option value="fabricated-banner"/);
 }
});
