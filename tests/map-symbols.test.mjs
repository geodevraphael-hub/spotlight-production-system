import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {markerSize,markerHtml,markerState} from '../app/map-symbols.mjs';
test('square, landscape and portrait boards have bounded dimensions and adequate hit targets',()=>{
 const square=markerSize({width:1,height:1});assert.equal(square.markerWidth,square.markerHeight);
 const landscape=markerSize({width:12,height:4});assert.ok(landscape.markerWidth>landscape.markerHeight);
 const portrait=markerSize({width:4,height:12});assert.ok(portrait.markerHeight>portrait.markerWidth);
 for(const item of [{width:0,height:0},{width:Infinity,height:1},{width:10000,height:.01}]){
  const size=markerSize(item);assert.ok(size.hitWidth>=44&&size.hitHeight>=44);assert.ok(size.markerWidth<=41);
 }
});
test('selection, format and flight state coexist without raw HTML or fabricated status',()=>{
 const item={mediaType:'digital-screen',faces:'<img>',flightStatus:'flighted',flightExpiry:100};
 assert.equal(markerState(item,101),'expired');assert.equal(markerState({...item,flightStatus:'deflighted'},101),'deflighted');
 const html=markerHtml(item,true,true,10);
 assert.match(html,/asset-marker--digital/);assert.match(html,/asset-marker--active/);assert.match(html,/asset-marker--flighted/);
 assert.match(html,/planner-marker-check/);assert.ok(!html.includes('<img>'));
});
test('marker animations are stationary, selection is finite and reduced motion is supported',()=>{
 const css=readFileSync(new URL('../app/map-symbols.css',import.meta.url),'utf8');
 assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/380ms ease-out 1/);
 assert.ok(!css.includes('translateY'));assert.match(css,/3.6s ease-in-out infinite/);
});
