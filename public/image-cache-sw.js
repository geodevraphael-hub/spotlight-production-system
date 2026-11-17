/* Cache displayed images for 30 days. Never cache pages, APIs or map tiles. */
const IMAGE_CACHE_PREFIX='spotlight-images-v1-';
const CONTEXT_CACHE='spotlight-image-context-v1';
const IMAGE_MAX_AGE=30*24*60*60*1000;
const IMAGE_MAX_ENTRIES=200;
const contexts=new Map();
const pendingImages=new Map();
const contextKey=id=>new Request(new URL('/__image_cache_context__/'+encodeURIComponent(id),self.location.origin));
const metadataKey=url=>new Request(new URL('/__image_cache_time__/'+encodeURIComponent(url),self.location.origin));
const imageKey=request=>new Request(new URL('/__spotlight_cached_image__?url='+encodeURIComponent(request.url)+'&mode='+encodeURIComponent(request.mode||'no-cors')+'&credentials='+encodeURIComponent(request.credentials||'same-origin'),self.location.origin));
const cacheName=scope=>IMAGE_CACHE_PREFIX+scope;
async function readContext(id){
 if(!id)return null;
 if(contexts.has(id))return contexts.get(id);
 try{const saved=await (await caches.open(CONTEXT_CACHE)).match(contextKey(id));if(saved){const value=await saved.json();if(Date.now()-value.time<IMAGE_MAX_AGE){contexts.set(id,value.scope);return value.scope;}}}catch{}
 return null;
}
async function setContext(id,scope){
 if(!id||typeof scope!=='string'||!/^(public|user:[0-9]+|share:[a-f0-9]{64})$/.test(scope))return;
 const previous=await readContext(id);
 contexts.set(id,scope);
 try{
  await (await caches.open(CONTEXT_CACHE)).put(contextKey(id),new Response(JSON.stringify({scope,time:Date.now()})));
  if(previous&&previous!==scope&&previous.startsWith('user:'))await Promise.all([caches.delete(cacheName(previous)),caches.delete(cacheName(previous)+'-times')]);
 }catch{}
}
function isCacheableImageRequest(request){
 if(request.method!=='GET'||request.destination!=='image')return false;
 const url=new URL(request.url);
 if(!['http:','https:'].includes(url.protocol))return false;
 if(url.origin===self.location.origin&&url.pathname.startsWith('/api/'))return false;
 if(/(^|\.)tile\.openstreetmap\.org$/i.test(url.hostname)||/(^|\.)arcgisonline\.com$/i.test(url.hostname)||/\/MapServer\/tile\//i.test(url.pathname))return false;
 return true;
}
function canStoreImage(response){
 if(response.type==='opaque')return true;
 return response.ok&&response.headers.get('Content-Type')?.toLowerCase().startsWith('image/')&&!/no-store/i.test(response.headers.get('Cache-Control')||'')&&!response.headers.get('Vary')?.includes('*');
}
async function cachedImage(request,clientId){
 const scope=await readContext(clientId);
 if(!scope)return fetch(request);
 const name=cacheName(scope),storageKey=imageKey(request),key=name+'|'+storageKey.url;
 if(pendingImages.has(key))return (await pendingImages.get(key)).clone();
 const task=(async()=>{
  let images,times;
  try{
   [images,times]=await Promise.all([caches.open(name),caches.open(name+'-times')]);
   const [saved,metadata]=await Promise.all([images.match(storageKey),times.match(metadataKey(storageKey.url))]);
   const timestamp=metadata?Number(await metadata.text()):0;
   if(saved&&timestamp>0&&Date.now()>=timestamp&&Date.now()-timestamp<IMAGE_MAX_AGE)return saved;
   if(saved)await Promise.all([images.delete(storageKey),times.delete(metadataKey(storageKey.url))]);
  }catch{}
  const response=await fetch(request,{cache:'reload'});
  if(images&&times&&canStoreImage(response)&&await readContext(clientId)===scope){
   try{
    try{await images.put(storageKey,response.clone());}
    catch{
     // Opaque third-party images may consume more quota than their byte size.
     const oldest=await images.keys();
     for(const old of oldest.slice(0,Math.max(1,Math.ceil(oldest.length/4))))await Promise.all([images.delete(old),times.delete(metadataKey(old.url))]);
     await images.put(storageKey,response.clone());
    }
    await times.put(metadataKey(storageKey.url),new Response(String(Date.now())));
    const keys=await images.keys();
    for(const old of keys.slice(0,Math.max(0,keys.length-IMAGE_MAX_ENTRIES)))await Promise.all([images.delete(old),times.delete(metadataKey(old.url))]);
   }catch{/* Storage pressure must never prevent the original image displaying. */}
  }
  return response;
 })();
 pendingImages.set(key,task);
 try{return (await task).clone();}finally{pendingImages.delete(key);}
}
async function invalidateImages(clientId,urls){
 const scope=await readContext(clientId);
 if(!scope||!Array.isArray(urls))return;
 try{
  const wanted=new Set(urls.filter(url=>typeof url==='string').slice(0,20));
  const images=await caches.open(cacheName(scope)),times=await caches.open(cacheName(scope)+'-times');
  for(const key of await images.keys())if(wanted.has(new URL(key.url).searchParams.get('url')))await Promise.all([images.delete(key),times.delete(metadataKey(key.url))]);
 }catch{}
}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 await self.clients.claim();
 // Expire abandoned client contexts; image entries expire on access and are bounded.
 try{const cache=await caches.open(CONTEXT_CACHE);for(const key of await cache.keys()){const entry=await cache.match(key);const value=await entry.json();if(Date.now()-value.time>=IMAGE_MAX_AGE)await cache.delete(key);}}catch{}
})()));
self.addEventListener('message',event=>{
 if(event.data?.type==='IMAGE_CACHE_CONTEXT')event.waitUntil(setContext(event.source?.id,event.data.scope));
 if(event.data?.type==='IMAGE_CACHE_INVALIDATE')event.waitUntil(invalidateImages(event.source?.id,event.data.urls));
});
self.addEventListener('fetch',event=>{
 if(isCacheableImageRequest(event.request))event.respondWith(cachedImage(event.request,event.clientId));
});
