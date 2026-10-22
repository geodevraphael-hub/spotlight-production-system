import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/PlanningBillboard.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} });
const loaded = { exports: {} };
new Function("require", "module", "exports", output.outputText)(require, loaded, loaded.exports);
const Placement = loaded.exports.default;
const props = {
  board: { id: 1, street: "Test placement", district: "Central", owner: "Vendor", width: 6, height: 3, faces: 2, from: "A", to: "B", sourceAttributes: { Road: "Main street" } },
  costs: { rental: "1000", printing: "200", transport: "0", flighting: "300" },
  inPlan: false, type: "Large format", image: "", flightStatus: "flighted",
  onCost() {}, onToggle() {}, onReview() {}, onClose() {}, onLocate() {}, onPhoto() {},
};
test("planning placement only exposes plan estimates, selection and read-only context", () => {
  const html = renderToStaticMarkup(React.createElement(Placement, props));
  assert.match(html, /Placement for this plan/);
  assert.match(html, /Add &amp; review plan/);
  assert.equal((html.match(/type="number"/g) || []).length, 4);
  assert.doesNotMatch(html, /Save flight status|Save attributes|Assign|Upload image|Delete billboard|type="file"|<select/);
  assert.match(html, /Main street/);
  assert.match(html, /flighted/);
});
test("zero is a real cost, missing and invalid costs remain partial", () => {
  const full = renderToStaticMarkup(React.createElement(Placement, props));
  assert.match(full, /4\/4 prices entered/);
  assert.match(full, /TZS 1,500/);
  const partial = renderToStaticMarkup(React.createElement(Placement, { ...props, costs: { ...props.costs, transport: "", printing: "-3" } }));
  assert.match(partial, /Partial estimate/);
  assert.match(partial, /2\/4 prices entered/);
  assert.match(partial, /TZS 1,300/);
});
test("selected placements have review and remove actions and explicit unknown dimensions", () => {
  const html = renderToStaticMarkup(React.createElement(Placement, { ...props, inPlan: true, board: { ...props.board, width: 0 } }));
  assert.match(html, /Remove from plan/);
  assert.match(html, /Review plan/);
  assert.match(html, /Not recorded/);
  assert.doesNotMatch(html, /Add &amp; review plan/);
});

const uiSource = readFileSync(new URL("../app/PlannerUI.tsx", import.meta.url), "utf8");
const uiOutput = ts.transpileModule(uiSource, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
const uiLoaded={exports:{}};
new Function("require","module","exports",uiOutput.outputText)(require,uiLoaded,uiLoaded.exports);
test("inventory selection controls distinguish in-plan selection from inventory status",()=>{
  const off=renderToStaticMarkup(React.createElement(uiLoaded.exports.PlanSelectionButton,{name:"Airport",selected:false,onClick(){}}));
  const on=renderToStaticMarkup(React.createElement(uiLoaded.exports.PlanSelectionButton,{name:"Airport",selected:true,onClick(){}}));
  assert.match(off,/aria-label="Add Airport to plan"/);
  assert.match(off,/aria-pressed="false"/);
  assert.match(on,/aria-label="Remove Airport from plan"/);
  assert.match(on,/aria-pressed="true"/);
  assert.match(on,/In plan/);
});
test("inventory summary is expandable and keeps all face categories readable",()=>{
  const html=renderToStaticMarkup(React.createElement(uiLoaded.exports.InventorySummary,{faces:42,large:20,digital:10,banners:2,lamps:10}));
  assert.match(html,/<details/);
  assert.doesNotMatch(html,/<details[^>]+open/);
  for(const label of ["Large format faces","Digital screen faces","Fabricated banner faces","Lamp posts"]) assert.ok(html.includes(label));
});
test("map legend describes type, dimensions, selection and flight animation",()=>{
  const html=renderToStaticMarkup(React.createElement(uiLoaded.exports.PlanningMapLegend));
  assert.match(html,/Map legend/);
  assert.match(html,/check means in this plan/);
  assert.match(html,/Flighted · gently pulsing dot/);
  assert.match(html,/Expired · amber diamond/);
  assert.match(html,/Reduced-motion/);
});
