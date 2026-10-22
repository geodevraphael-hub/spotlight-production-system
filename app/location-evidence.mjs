import { knownNumber } from './planning-decision.mjs';
import { mayPlan, planningWorkspace } from './planning-store.mjs';
import { demographicAreas } from './planning-demographics.mjs';

const PROVIDER='https://locationiq.co.tz';
const validPoint=board=>board.lat!==''&&board.lng!==''&&board.lat!=null&&board.lng!=null&&Number.isFinite(Number(board.lat))&&Number.isFinite(Number(board.lng))&&Math.abs(Number(board.lat))<=90&&Math.abs(Number(board.lng))<=180;
export function normalizeLocation(reverse,catchment,board,radius,now=Date.now()) {
  // This contract is from Location IQ Tanzania's published catchment example,
  // not the unrelated locationiq.com geocoder. Preserve unknowns and source notes.
  if(catchment?.example_snapshot) throw new Error('Provider returned an example, not a live result.');
  if(catchment?.coordinate && (Math.abs(Number(catchment.coordinate.latitude)-Number(board.lat))>0.00001 || Math.abs(Number(catchment.coordinate.longitude)-Number(board.lng))>0.00001)) throw new Error('Provider coordinates do not match this billboard.');
  const categories=catchment?.facilities?.by_category;
  const population=catchment?.population;
  return {
    version:1,provider:PROVIDER,lat:Number(board.lat),lng:Number(board.lng),radius,fetchedAt:now,
    metrics:{population:population?.status==='estimated' && population?.reference_year===2022 ? knownNumber(population.estimated_population):null,
      commerce:knownNumber(categories?.commerce_services),transport:knownNumber(categories?.transport),buildings:knownNumber(catchment?.buildings?.detections)},
    populationYear:population?.reference_year??null,
    coverageStatus:catchment?.coverageStatus==='outside-official-coverage'?'administrative-only':'full',
    demographics:demographicAreas(reverse),
    // Retain structured evidence for inspection; never overwrite the inventory.
    facts:{reverse:reverse??null,catchment:catchment??null},
    notes:[...(catchment?.coverageStatus==='outside-official-coverage'?['Location IQ returned administrative demographics but rejected this coordinate for radius catchment coverage. Radius population, facilities and building counts are unavailable, not zero.']:[]),'Population is modelled resident population, not billboard impressions or daily reach.','Facility records are not observed footfall; building detections are not households.','Nearby roads do not establish viewing direction, visibility or current traffic.','Catchments overlap: do not sum their populations as unique reach.'],
  };
}
export async function setupLocationEvidence(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS planning_location_evidence (
    inventory_id INTEGER NOT NULL,radius INTEGER NOT NULL,lat REAL NOT NULL,lng REAL NOT NULL,
    data TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(inventory_id,radius))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS planning_provider_state (
    id INTEGER PRIMARY KEY CHECK(id=1),lease_until INTEGER NOT NULL DEFAULT 0,
    blocked_until INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '')`).run();
  await db.prepare('INSERT OR IGNORE INTO planning_provider_state(id) VALUES(1)').run();
}
export async function readLocationEvidence(db,user,radius,keyConfigured,detailId=null) {
  if(!mayPlan(user))throw Object.assign(new Error('Forbidden'),{status:403});
  if(![500,1000,2000].includes(radius))throw Object.assign(new Error('Invalid radius.'),{status:400});
  await setupLocationEvidence(db);
  const workspace=await planningWorkspace(db,user), allowed=new Map(workspace.inventory.map(b=>[b.id,b]));
  if(detailId!==null&&!allowed.has(detailId))throw Object.assign(new Error('Billboard is not accessible.'),{status:403});
  const result=detailId===null
    ? await db.prepare("SELECT inventory_id,radius,lat,lng,json_remove(data,'$.facts') AS data,json_extract(data,'$.facts.reverse') AS reverse,updated_at FROM planning_location_evidence WHERE radius=?").bind(radius).all()
    : await db.prepare('SELECT * FROM planning_location_evidence WHERE radius=? AND inventory_id=?').bind(radius,detailId).all();
  const evidence={};
  for(const row of result.results) if(allowed.has(row.inventory_id)){
    const board=allowed.get(row.inventory_id);
    if(Number(board.lat)===row.lat&&Number(board.lng)===row.lng){
      const data=JSON.parse(row.data);
      // Upgrade already-cached evidence without re-requesting or relabelling source facts.
      data.demographics??=demographicAreas(data.facts?.reverse??(row.reverse?JSON.parse(row.reverse):{}));
      evidence[row.inventory_id]=data;
    }
  }
  const state=await db.prepare('SELECT blocked_until,message FROM planning_provider_state WHERE id=1').first();
  return {evidence,provider:PROVIDER,configured:keyConfigured,blocked:state.blocked_until>Date.now(),message:state.blocked_until>Date.now()?state.message:''};
}
export async function enrichLocation(db,user,body,key,fetcher=fetch,now=Date.now()) {
  if(!mayPlan(user))throw Object.assign(new Error('Forbidden'),{status:403});
  const radius=Number(body.radius), id=Number(body.id);
  if(![500,1000,2000].includes(radius)||!Number.isSafeInteger(id))throw Object.assign(new Error('Invalid billboard or radius.'),{status:400});
  const workspace=await planningWorkspace(db,user),board=workspace.inventory.find(item=>item.id===id);
  if(!board)throw Object.assign(new Error('Billboard is not accessible.'),{status:403});
  if(!validPoint(board))throw Object.assign(new Error('This billboard needs valid GPS coordinates.'),{status:400});
  if(!key)throw Object.assign(new Error('Location IQ server key is not configured.'),{status:503});
  await setupLocationEvidence(db);
  const cached=await db.prepare('SELECT * FROM planning_location_evidence WHERE inventory_id=? AND radius=?').bind(id,radius).first();
  if(cached&&cached.lat===Number(board.lat)&&cached.lng===Number(board.lng)&&now-cached.updated_at<7*86400000){
    const evidence=JSON.parse(cached.data);evidence.demographics??=demographicAreas(evidence.facts?.reverse);
    return {evidence,cached:true};
  }
  const lease=await db.prepare('UPDATE planning_provider_state SET lease_until=? WHERE id=1 AND lease_until<=? AND blocked_until<=?').bind(now+95000,now,now).run();
  if(!lease.meta.changes){
    const state=await db.prepare('SELECT * FROM planning_provider_state WHERE id=1').first();
    throw Object.assign(new Error(state.blocked_until>now?state.message:'Another location lookup is running. Please wait before trying again.'),{status:429});
  }
  async function request(path,params){
    const url=new URL(path,PROVIDER);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
    let response;
    // Workers supports "manual", not "error". Reject all non-2xx below without
    // following redirects or forwarding the API key to another destination.
    try {response=await fetcher(url,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(40000),redirect:'manual'});}
    catch (error) {
      // Only transport diagnostics, never headers, URL parameters or credentials.
      console.error('Location IQ transport failure', error?.name, String(error?.message ?? '').slice(0,240));
      throw Object.assign(new Error('Location IQ could not be reached. Existing evidence is unchanged.'),{status:502});
    }
    if(!response.ok){
      // Coastal coverage can differ between the census and catchment datasets.
      // Preserve successful reverse evidence only for this explicit provider
      // response; never turn authorization, validation or outages into success.
      if(response.status===422&&path==='/v1/catchment'){
        const problem=await response.text();
        let detail;
        try{if(problem.length<=1500000)detail=JSON.parse(problem).detail;}catch{}
        if(detail==='The coordinate is outside the official Tanzania coverage.'){
          return {coordinate:{latitude:Number(board.lat),longitude:Number(board.lng)},mode:'radius',
            coverageStatus:'outside-official-coverage',population:{status:'unavailable'},
            facilities:{by_category:{}},buildings:{},note:detail};
        }
      }
      const message=[401,403].includes(response.status)?'Location IQ denied server access. Its administrator must check Cloudflare, the approved server IP and API key scopes. No automatic retries will be sent.':response.status===429?'Location IQ rate limit reached. Wait before requesting more data.':'Location IQ could not complete this lookup. Existing evidence is unchanged.';
      if([401,403,429].includes(response.status))await db.prepare('UPDATE planning_provider_state SET blocked_until=?,message=? WHERE id=1').bind(now+([401,403].includes(response.status)?30*60000:60000),message).run();
      throw Object.assign(new Error(message),{status:502});
    }
    const text=await response.text();
    if(text.length>1500000)throw Object.assign(new Error('Location IQ response exceeded the safe size limit.'),{status:502});
    try { const data=JSON.parse(text);if(!data||typeof data!=='object'||data.error||data.detail)throw new Error();return data; }
    catch {throw Object.assign(new Error('Location IQ returned an unsupported response.'),{status:502});}
  }
  try {
    const params={latitude:board.lat,longitude:board.lng,radius_m:radius};
    const reverse=await request('/v1/reverse',{...params,limit:10});
    const catchment=await request('/v1/catchment',{...params,mode:'radius',minimum_confidence:0.75,include_geometry:false});
    if(catchment.mode!=='radius'||!catchment.population||!catchment.facilities||!catchment.coordinate)throw Object.assign(new Error('Location IQ response format changed; no scoring data was stored.'),{status:502});
    const evidence=normalizeLocation(reverse,catchment,board,radius,Date.now());
    await db.prepare(`INSERT INTO planning_location_evidence(inventory_id,radius,lat,lng,data,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(inventory_id,radius) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,data=excluded.data,updated_at=excluded.updated_at`)
      .bind(id,radius,Number(board.lat),Number(board.lng),JSON.stringify(evidence),evidence.fetchedAt).run();
    return {evidence,cached:false};
  } finally {await db.prepare('UPDATE planning_provider_state SET lease_until=? WHERE id=1').bind(Date.now()+1000).run();}
}
