import {setupLocationEvidence} from './location-evidence.mjs';
export function locationNames(reverse){
 const census=reverse?.census_administration,admin=reverse?.administration;
 const name=x=>typeof x?.name==='string'&&x.name.trim()?x.name.trim().slice(0,160):null;
 return {region:name(census?.administration?.region)||name(admin?.region),district:name(census?.administration?.district)||name(admin?.district),
  council:name(census?.administration?.council)||name(admin?.council),local:census?.ambiguous_ward?null:name(census?.administration?.ward)||name(census?.administration?.shehia)||name(admin?.ward)||name(admin?.shehia),
  village:reverse?.coverage?.ambiguous_village?null:name(admin?.village)};
}
export function applyLocationNames(asset,names,now){
 const previous=asset.locationAddress,next={...asset};
 // Keep human-entered location labels; replace only missing or previous auto-filled values.
 for(const key of ['district','village'])if(names[key]&&(/^(|unknown|n\/a|not recorded|—|-)$/i.test(String(asset[key]??'').trim())||asset[key]===previous?.[key]))next[key]=names[key];
 next.locationAddress={...names,lat:Number(asset.lat),lng:Number(asset.lng),source:'Location IQ',checkedAt:now,status:names.district&&names.village?'complete':'partial',retryAfter:now+(names.district&&names.village?30:1)*86400000};
 return next;
}
export async function populateLocations(db,key,paused='',fetcher=fetch,now=Date.now(),options={}){
 if(!key||paused)return {state:'paused',message:paused||'Location IQ is not configured'};
 await setupLocationEvidence(db);
 const leaseUntil=Date.now()+95000;
 const lease=await db.prepare('UPDATE planning_provider_state SET lease_until=? WHERE id=1 AND lease_until<=? AND blocked_until<=?').bind(leaseUntil,now,now).run();
 if(!lease.meta.changes)return {state:'waiting',updated:0};
 let updated=0,lookedUp=0,failed=0;
 const started=Date.now(),limit=options.maxLookups??8,budget=options.maxMs??25000;
 try{
  const jobs=(await db.prepare(`SELECT * FROM location_enrichment_queue WHERE next_attempt_at<=? ORDER BY CASE WHEN status='queued' AND attempts=0 THEN 0 ELSE 1 END,queued_at DESC,inventory_id LIMIT 100`).bind(now).all()).results;
  for(const job of jobs){
   if(Date.now()-started>=budget)break;
   const coordinates=[job.lat,job.lng],cacheNow=Date.now();
   const cached=await db.prepare('SELECT data FROM location_reverse_cache WHERE lat=? AND lng=? AND fetched_at<=? AND fetched_at>?').bind(...coordinates,cacheNow,cacheNow-30*86400000).first();
   const evidence=cached?null:await db.prepare("SELECT json_extract(data,'$.facts.reverse') reverse FROM planning_location_evidence WHERE lat=? AND lng=? AND updated_at<=? AND updated_at>? AND json_extract(data,'$.facts.reverse') IS NOT NULL ORDER BY updated_at DESC LIMIT 1").bind(...coordinates,cacheNow,cacheNow-7*86400000).first();
   let reverse=cached?JSON.parse(cached.data):evidence?.reverse?JSON.parse(evidence.reverse):null;
   if(!reverse){
    if(lookedUp>=limit)break;
    if(lookedUp)await new Promise(resolve=>setTimeout(resolve,1050));
    lookedUp++;
    try{
     const url=new URL('https://locationiq.co.tz/v1/reverse');url.searchParams.set('latitude',String(job.lat));url.searchParams.set('longitude',String(job.lng));url.searchParams.set('limit','10');
     const response=await fetcher(url,{headers:{'X-API-Key':key,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(Math.max(1000,Math.min(15000,budget-(Date.now()-started))))});
     if(!response.ok){
      if([401,403,429].includes(response.status))await db.prepare('UPDATE planning_provider_state SET blocked_until=?,message=? WHERE id=1').bind(Date.now()+(response.status===429?60000:1800000),'Automatic location lookup is waiting for provider access or rate limits.').run();
      throw Object.assign(new Error('Provider unavailable'),{blocked:[401,403,429].includes(response.status)});
     }
     const text=await response.text();if(text.length>1500000)throw Error('Response too large');reverse=JSON.parse(text);
     if(!reverse||reverse.error||reverse.detail||(!reverse.administration&&!reverse.census_administration))throw Error('Location unavailable');
     await db.prepare('INSERT INTO location_reverse_cache(lat,lng,data,fetched_at) VALUES(?,?,?,?) ON CONFLICT(lat,lng) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(...coordinates,JSON.stringify(reverse),Date.now()).run();
    }catch(error){
     failed++;
     await db.prepare("UPDATE location_enrichment_queue SET status='retrying',attempts=attempts+1,next_attempt_at=?,updated_at=? WHERE inventory_id=? AND lat=? AND lng=?").bind(Date.now()+Math.min(1800000,30000*2**Math.min(job.attempts,5)),Date.now(),job.inventory_id,...coordinates).run();
     const row=await db.prepare('SELECT data FROM inventory WHERE id=?').bind(job.inventory_id).first();
     if(row){const asset=JSON.parse(row.data);if(Number(asset.lat)===job.lat&&Number(asset.lng)===job.lng&&!asset.locationAddress){const next={...asset,locationAddress:{lat:job.lat,lng:job.lng,status:'pending',checkedAt:now,retryAfter:now+30000,source:'Location IQ'}};await db.prepare('UPDATE inventory SET data=? WHERE id=? AND data=?').bind(JSON.stringify(next),job.inventory_id,row.data).run();}}
     if(error.blocked)break;
     continue;
    }
   }
   // Merge into the latest record: a concurrent edit or GPS fix must never be overwritten.
   const row=await db.prepare('SELECT data FROM inventory WHERE id=?').bind(job.inventory_id).first();
   if(!row)continue;
   const asset=JSON.parse(row.data);if(Number(asset.lat)!==job.lat||Number(asset.lng)!==job.lng)continue;
   const next=applyLocationNames(asset,locationNames(reverse),Date.now());
   const result=await db.prepare('UPDATE inventory SET data=? WHERE id=? AND data=?').bind(JSON.stringify(next),job.inventory_id,row.data).run();
   if(result.meta.changes){updated++;await db.prepare('UPDATE location_enrichment_queue SET status=?,next_attempt_at=?,updated_at=?,attempts=0 WHERE inventory_id=? AND lat=? AND lng=?').bind(next.locationAddress.status,next.locationAddress.retryAfter,Date.now(),job.inventory_id,...coordinates).run();}
  }
 }finally{await db.prepare('UPDATE planning_provider_state SET lease_until=? WHERE id=1 AND lease_until=?').bind(Date.now()+1000,leaseUntil).run();}
 return {state:failed?'retrying':'complete',updated,lookedUp:Boolean(lookedUp),requests:lookedUp};
}
