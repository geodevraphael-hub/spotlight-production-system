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
export async function populateLocations(db,key,paused='',fetcher=fetch,now=Date.now()){
 if(!key||paused)return {state:'paused',message:paused||'Location IQ is not configured'};
 await setupLocationEvidence(db);
 const state=await db.prepare('SELECT * FROM planning_provider_state WHERE id=1').first();
 if(state.blocked_until>now||state.lease_until>now)return {state:'waiting'};
 const rows=(await db.prepare(`SELECT i.id,i.data FROM inventory i WHERE
  json_type(data,'$.lat') IN ('integer','real') AND json_type(data,'$.lng') IN ('integer','real') AND abs(json_extract(data,'$.lat'))<=90 AND abs(json_extract(data,'$.lng'))<=180 AND
  (json_extract(data,'$.locationAddress.lat') IS NOT json_extract(data,'$.lat') OR json_extract(data,'$.locationAddress.lng') IS NOT json_extract(data,'$.lng') OR COALESCE(json_extract(data,'$.locationAddress.retryAfter'),0)<=?)
  ORDER BY COALESCE(json_extract(data,'$.locationAddress.checkedAt'),0),i.id LIMIT 20`).bind(now).all()).results;
 let updated=0,lookedUp=false;
 for(const row of rows){
  const asset=JSON.parse(row.data);
  const cached=await db.prepare("SELECT json_extract(data,'$.facts.reverse') reverse FROM planning_location_evidence WHERE inventory_id=? AND lat=? AND lng=? AND json_extract(data,'$.facts.reverse') IS NOT NULL ORDER BY updated_at DESC LIMIT 1").bind(row.id,asset.lat,asset.lng).first();
  let reverse=cached?.reverse?JSON.parse(cached.reverse):null;
  if(!reverse){
   if(lookedUp)break;
   const lease=await db.prepare('UPDATE planning_provider_state SET lease_until=? WHERE id=1 AND lease_until<=? AND blocked_until<=?').bind(now+95000,now,now).run();
   if(!lease.meta.changes)break;
   lookedUp=true;
   try{
    const url=new URL('https://locationiq.co.tz/v1/reverse');url.searchParams.set('latitude',String(asset.lat));url.searchParams.set('longitude',String(asset.lng));url.searchParams.set('limit','10');
    const r=await fetcher(url,{headers:{'X-API-Key':key,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(40000)});
    if(!r.ok){if([401,403,429].includes(r.status))await db.prepare('UPDATE planning_provider_state SET blocked_until=?,message=? WHERE id=1').bind(now+(r.status===429?60000:1800000),'Automatic location lookup is waiting for provider access or rate limits.').run();throw new Error('Provider unavailable');}
    const text=await r.text();if(text.length>1500000)throw new Error('Response too large');reverse=JSON.parse(text);
    if(!reverse||reverse.error||reverse.detail||(!reverse.administration&&!reverse.census_administration))throw new Error('Location unavailable');
   }catch{
    const next={...asset,locationAddress:{lat:asset.lat,lng:asset.lng,status:'pending',checkedAt:now,retryAfter:now+1800000,source:'Location IQ'}};
    await db.prepare('UPDATE inventory SET data=? WHERE id=? AND data=?').bind(JSON.stringify(next),row.id,row.data).run();
    return {state:'retrying',updated};
   }finally{await db.prepare('UPDATE planning_provider_state SET lease_until=? WHERE id=1').bind(Date.now()+1000).run();}
  }
  const next=applyLocationNames(asset,locationNames(reverse),now);
  const result=await db.prepare('UPDATE inventory SET data=? WHERE id=? AND data=?').bind(JSON.stringify(next),row.id,row.data).run();
  updated+=Number(result.meta.changes||0);
 }
 return {state:'complete',updated,lookedUp};
}
