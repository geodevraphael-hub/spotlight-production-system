import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/image-cache-sw.js',import.meta.url),'utf8');
function setup(){
 let now=100000,fetches=0;
 const stores=new Map(),listeners={};
 const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return {async match(key){return data.get(key.url)?.clone();},async put(key,value){data.set(key.url,value.clone());},async delete(key){return data.delete(key.url);},async keys(){return [...data.keys()].map(url=>new Request(url));}};},async delete(name){return stores.delete(name);}};
 const context=vm.createContext({Request,Response,URL,Map,Promise,encodeURIComponent,Date:{now:()=>now},caches,fetch:async()=>{fetches++;return new Response('image-'+fetches,{headers:{'Content-Type':'image/png'}});},self:{location:{origin:'https://spotlight.co.tz'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(type,listener)=>listeners[type]=listener}});
 vm.runInContext(source,context);
 const image=(url='https://photos.example/board.png',mode='no-cors')=>{const request=new Request(url,{mode});Object.defineProperty(request,'destination',{value:'image'});return request;};
 return {context,stores,listeners,image,fetches:()=>fetches,advance:ms=>{now+=ms;}};
}
test('image cache reuses images until the exact 30-day expiry, then fetches fresh bytes',async()=>{
 const t=setup();await t.context.setContext('client','user:1');
 assert.equal(await (await t.context.cachedImage(t.image(),'client')).text(),'image-1');
 t.advance(30*86400000-1);
 assert.equal(await (await t.context.cachedImage(t.image(),'client')).text(),'image-1');assert.equal(t.fetches(),1);
 t.advance(1);
 assert.equal(await (await t.context.cachedImage(t.image(),'client')).text(),'image-2');assert.equal(t.fetches(),2);
});
test('cache isolates accounts and clears the previous private cache on logout',async()=>{
 const t=setup();await t.context.setContext('a','user:1');await t.context.setContext('b','user:2');
 await t.context.cachedImage(t.image(),'a');await t.context.cachedImage(t.image(),'b');assert.equal(t.fetches(),2);
 await t.context.cachedImage(t.image(),'a');assert.equal(t.fetches(),2);
 await t.context.setContext('a','public');assert.ok(!t.stores.has('spotlight-images-v1-user:1'));
 assert.ok(t.stores.has('spotlight-images-v1-user:2'));
});
test('CORS images used by report exports never reuse opaque thumbnail responses',async()=>{
 const t=setup();await t.context.setContext('a','user:1');
 await t.context.cachedImage(t.image(),'a');await t.context.cachedImage(t.image(undefined,'cors'),'a');assert.equal(t.fetches(),2);
 await t.context.cachedImage(t.image(undefined,'cors'),'a');assert.equal(t.fetches(),2);
});
test('missing context bypasses cache; API responses, pages and map tiles are excluded',async()=>{
 const t=setup();await t.context.cachedImage(t.image(),'unknown');await t.context.cachedImage(t.image(),'unknown');assert.equal(t.fetches(),2);
 assert.equal(t.context.isCacheableImageRequest(t.image()),true);
 for(const url of ['https://spotlight.co.tz/api/app?action=photo&id=1','https://a.tile.openstreetmap.org/12/23/45.png','https://server.arcgisonline.com/ArcGIS/MapServer/tile/1/2/3'])assert.equal(t.context.isCacheableImageRequest(t.image(url)),false);
 assert.equal(t.context.isCacheableImageRequest(new Request('https://spotlight.co.tz/')),false);
});
test('errors, HTML login pages and no-store responses are never cached',()=>{
 const {context}=setup();
 assert.equal(context.canStoreImage(new Response('failure',{status:404,headers:{'Content-Type':'image/png'}})),false);
 assert.equal(context.canStoreImage(new Response('login',{headers:{'Content-Type':'text/html'}})),false);
 assert.equal(context.canStoreImage(new Response('private',{headers:{'Content-Type':'image/png','Cache-Control':'no-store'}})),false);
 assert.equal(context.canStoreImage({type:'opaque'}),true);
});
test('storage failures fall back to networking without hiding the image',async()=>{
 const t=setup();await t.context.setContext('a','user:1');
 t.context.caches.open=async()=>{throw Error('Storage unavailable');};
 assert.equal(await (await t.context.cachedImage(t.image(),'a')).text(),'image-1');
});
test('photo replacement invalidates only that account and URL, including export variants',async()=>{
 const t=setup();await t.context.setContext('a','user:1');await t.context.setContext('b','user:2');
 await t.context.cachedImage(t.image(),'a');await t.context.cachedImage(t.image(undefined,'cors'),'a');await t.context.cachedImage(t.image(),'b');
 await t.context.invalidateImages('a',[t.image().url]);
 await t.context.cachedImage(t.image(),'a');assert.equal(t.fetches(),4);
 await t.context.cachedImage(t.image(),'b');assert.equal(t.fetches(),4);
});
test('cache context survives service worker suspension and concurrent requests share one fetch',async()=>{
 const t=setup();await t.context.setContext('a','user:1');
 await Promise.all([t.context.cachedImage(t.image(),'a'),t.context.cachedImage(t.image(),'a')]);assert.equal(t.fetches(),1);
 vm.runInContext('contexts.clear()',t.context);
 await t.context.cachedImage(t.image(),'a');assert.equal(t.fetches(),1);
});
