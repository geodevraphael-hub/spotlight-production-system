import {calendarDate,campaignClock,roadPreview} from './campaign-road.mjs';
import {dashboardInventory} from './dashboard-data.mjs';
import {assetBookings} from './asset-booking.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export async function setupCampaignTools(db){
 await db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS project_campaigns(id TEXT PRIMARY KEY,project_id INTEGER NOT NULL,name TEXT NOT NULL,subcategory TEXT NOT NULL,starts_on TEXT NOT NULL,ends_on TEXT NOT NULL,asset_ids TEXT NOT NULL,version INTEGER NOT NULL,created_by INTEGER NOT NULL,updated_at INTEGER NOT NULL)`),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_campaigns_project ON project_campaigns(project_id)'),
  db.prepare(`CREATE TABLE IF NOT EXISTS road_mapping_requests(id TEXT PRIMARY KEY,project_id INTEGER NOT NULL,user_id INTEGER NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL)`),
 ]);
}
export async function campaignAccess(db,user,projectId,write=false){
 if(!user||!['admin','creator','planner'].includes(user.role)||!Number.isSafeInteger(projectId)||projectId<=0||write&&user.role==='planner')fail('Only project administrators and creators can change campaigns or map road stretches.',403);
 if(!await db.prepare(`SELECT id FROM projects WHERE id=? AND (?='admin' OR created_by=? OR EXISTS(SELECT 1 FROM project_users WHERE project_id=projects.id AND user_id=?))`).bind(projectId,user.role,user.id,user.id).first())fail('Choose an accessible project.',403);
}
export async function campaignInventory(db,projectId){
 // Project only, compact projection: no image blobs or private contacts in the chooser.
 return (await db.prepare(`SELECT i.id inventoryDbId,json_extract(data,'$.id') id,json_extract(data,'$.projectId') projectId,
  json_extract(data,'$.street') street,json_extract(data,'$.district') district,json_extract(data,'$.owner') owner,
  json_extract(data,'$.mediaType') mediaType,json_extract(data,'$.faces') faces,json_extract(data,'$.installations') installations,
  json_extract(data,'$.flightStatus') flightStatus,json_extract(data,'$.flightStage') flightStage,json_extract(data,'$.flightExpiry') flightExpiry
  FROM inventory i WHERE COALESCE(json_extract(data,'$.projectId'),1)=? OR EXISTS(SELECT 1 FROM inventory_projects WHERE inventory_id=i.id AND project_id=?) ORDER BY street,i.id`).bind(projectId,projectId).all()).results;
}
export async function campaignList(db,user,projectId){
 await campaignAccess(db,user,projectId);
 const [rows,assets,schedules,bookings]=await Promise.all([
  db.prepare('SELECT * FROM project_campaigns WHERE project_id=? ORDER BY starts_on DESC,name').bind(projectId).all(),campaignInventory(db,projectId),
  db.prepare('SELECT asset_id,stage,flight_status,end_at FROM flight_schedules WHERE project_id=?').bind(projectId).all(),assetBookings(db),
 ]);
 const inventory=assets.map(b=>({...b,...bookings.get(b.inventoryDbId)}));
 return {projectId,assets:inventory,canManage:user.role!=='planner',campaigns:rows.results.map(c=>{const ids=JSON.parse(c.asset_ids);const included=inventory.filter(b=>ids.includes(b.inventoryDbId));return {...c,assetIds:ids,asset_ids:undefined,missingAssets:ids.length-included.length,clock:campaignClock(c.starts_on,c.ends_on),summary:dashboardInventory(included,schedules.results,projectId)};})};
}
function uuid(value){if(typeof value!=='string'||! /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))fail('Reopen the form to create a new request.');return value;}
function audit(db,user,projectId,event,before,after){return db.prepare('INSERT INTO asset_activity(project_id,asset_id,actor_id,event,detail,created_at) VALUES(?,0,?,?,?,?)').bind(projectId,user.id,event,JSON.stringify({schemaVersion:2,entity:'project_campaigns',operation:before?'update':'insert',actor:{id:user.id,name:user.name,role:user.role},before,after}),Date.now());}
export async function saveCampaign(db,user,body){
 const projectId=Number(body.projectId);await campaignAccess(db,user,projectId,true);
 const id=uuid(body.id),name=String(body.name??'').trim(),subcategory=String(body.subcategory??'').trim();
 if(!name||name.length>160||!subcategory||subcategory.length>100)fail('Enter a campaign name (up to 160 characters) and subcategory (up to 100).');
 const starts_on=calendarDate(body.starts_on),ends_on=calendarDate(body.ends_on);campaignClock(starts_on,ends_on);
 const ids=body.assetIds;
 if(!Array.isArray(ids)||ids.length>500||ids.some(n=>!Number.isSafeInteger(n)||n<=0)||new Set(ids).size!==ids.length)fail('Select up to 500 unique project assets.');
 const assets=await campaignInventory(db,projectId),available=new Set(assets.map(a=>a.inventoryDbId));
 if(ids.some(n=>!available.has(n)))fail('Some assets are no longer in this project. Reload and select again.',409);
 const current=await db.prepare('SELECT * FROM project_campaigns WHERE id=?').bind(id).first();
 if(current&&current.project_id!==projectId)fail('Campaign unavailable.',404);
 const next={name,subcategory,starts_on,ends_on,asset_ids:JSON.stringify([...ids].sort((a,b)=>a-b))};
 const same=current&&Object.keys(next).every(k=>current[k]===next[k]);
 if(same)return {ok:true,id,version:current.version};
 if(current?body.version!==current.version:body.version!==0)fail('Campaign changed elsewhere. Reload before editing.',409);
 const version=(current?.version||0)+1,now=Date.now();
 const detail=c=>c?{campaignName:c.name,subcategory:c.subcategory,start:c.starts_on,end:c.ends_on,billboards:JSON.parse(c.asset_ids).map(n=>assets.find(b=>b.inventoryDbId===n)?.street||`Inventory ${n}`).join('; ')}:null;
 const writes=[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=?) THEN 1 ELSE json('Project missing') END").bind(projectId)];
 for(const inventoryId of ids)writes.push(db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM inventory i WHERE id=? AND (COALESCE(json_extract(data,'$.projectId'),1)=? OR EXISTS(SELECT 1 FROM inventory_projects WHERE inventory_id=i.id AND project_id=?))) THEN 1 ELSE json('Membership changed') END").bind(inventoryId,projectId,projectId));
 if(current){
  writes.push(db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM project_campaigns WHERE id=? AND version=?) THEN 1 ELSE json('Campaign changed') END").bind(id,current.version));
  writes.push(db.prepare('UPDATE project_campaigns SET name=?,subcategory=?,starts_on=?,ends_on=?,asset_ids=?,version=?,updated_at=? WHERE id=?').bind(name,subcategory,starts_on,ends_on,next.asset_ids,version,now,id));
 }else writes.push(db.prepare('INSERT INTO project_campaigns VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,projectId,name,subcategory,starts_on,ends_on,next.asset_ids,version,user.id,now));
 writes.push(audit(db,user,projectId,current?'Campaign updated':'Campaign created',detail(current),detail(next)));
 try{await db.batch(writes);}catch{const replay=await db.prepare('SELECT * FROM project_campaigns WHERE id=?').bind(id).first();if(replay?.project_id===projectId&&Object.keys(next).every(k=>replay[k]===next[k]))return {ok:true,id,version:replay.version};fail('Campaign could not be saved. Reload to check for changes.',409);}
 return {ok:true,id,version};
}
export async function saveRoad(db,user,body){
 const projectId=Number(body.projectId);await campaignAccess(db,user,projectId,true);
 const id=uuid(body.requestId),name=String(body.name??'').trim(),vendor=String(body.vendor??'').trim(),area=String(body.area??'').trim();
 if(!name||name.length>160||vendor.length>160||area.length>160)fail('Enter a road name; names must be up to 160 characters.');
 if(body.confirmed!==true)fail('Confirm the estimated pole positions before saving.');
 const preview=roadPreview(body.anchors,body.count),faces=Number(body.faces),width=Number(body.width),height=Number(body.height);
 if(!Number.isInteger(faces)||faces<1||faces>8||![width,height].every(n=>Number.isFinite(n)&&n>=0&&n<=100))fail('Enter 1–8 faces per pole and dimensions between 0 and 100 m. Use 0 if unknown.');
 const payload=JSON.stringify({projectId,name,vendor,area,anchors:body.anchors,count:body.count,faces,width,height});
 const prior=async()=>{const row=await db.prepare('SELECT * FROM road_mapping_requests WHERE id=?').bind(id).first();if(!row)return null;if(row.user_id!==user.id||row.payload!==payload)fail('This request was already used. Reopen the mapper.',409);return JSON.parse(row.result);};
 const previous=await prior();if(previous)return previous;
 const now=Date.now(),base=parseInt(id.replaceAll('-','').slice(0,12),16),result={ok:true,count:preview.points.length,name,projectId};
 const writes=[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=?) THEN 1 ELSE json('Project missing') END").bind(projectId),db.prepare('INSERT INTO road_mapping_requests VALUES(?,?,?,?,?,?)').bind(id,projectId,user.id,payload,JSON.stringify(result),now)];
 for(const [index,point] of preview.points.entries()){
  const assetId=base+index+1;
  const item={id:assetId,projectId,street:`${name} · Pole ${index+1}`,owner:vendor,district:area,mediaType:'lamp-post',mediaGroup:'Street furniture',faces,installations:1,lampPosts:1,width,height,
   lat:point.lat,lng:point.lng,status:'not-selected',flightStatus:'unflighted',positionSource:'estimated-road-stretch',positionVerified:false,
   roadStretch:{id,name,index:index+1,count:body.count,anchors:body.anchors,chainage:point.chainage,spacing:preview.spacing,method:'equal-distance-polyline',createdBy:user.id,createdAt:now},
   sourceAttributes:{'POSITION SOURCE':'Estimated along road — field GPS verification required','ROAD STRETCH':name,'POLE NUMBER':String(index+1),'CHAINAGE (M)':String(point.chainage)}};
  writes.push(db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM inventory WHERE source_id=? OR json_extract(data,'$.id')=?) THEN 1 ELSE json('Asset ID conflict') END").bind(assetId,assetId));
  writes.push(db.prepare('INSERT INTO inventory(source_id,data,latitude,longitude,created_at) VALUES(?,?,?,?,?)').bind(assetId,JSON.stringify(item),point.lat,point.lng,now));
  writes.push(db.prepare('INSERT INTO inventory_projects(inventory_id,project_id,assigned_by,assigned_at) SELECT id,?,?,? FROM inventory WHERE source_id=?').bind(projectId,user.id,now,assetId));
 }
 writes.push(audit(db,user,projectId,'Road stretch mapped',null,{roadName:name,poles:body.count,positionSource:'Estimated — field verification required',spacingMetres:Number(preview.spacing.toFixed(1))}));
 try{await db.batch(writes);}catch{const replay=await prior();if(replay)return replay;fail('The road stretch was not saved. No partial assets were added. Refresh and retry.',409);}
 return result;
}
