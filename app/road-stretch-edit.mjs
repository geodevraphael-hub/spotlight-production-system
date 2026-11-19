import {campaignAccess} from './campaign-store.mjs';
import {roadPreview} from './campaign-road.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
async function rowsFor(db,id){return (await db.prepare("SELECT id,data FROM inventory WHERE json_extract(data,'$.roadStretch.id')=? ORDER BY id").bind(id).all()).results;}
async function version(rows){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function accessible(db,user,projectId,rows){
 if(!rows.length)fail('Road stretch no longer exists.',404);
 const members=(await db.prepare("SELECT ip.inventory_id,ip.project_id FROM inventory_projects ip JOIN inventory i ON i.id=ip.inventory_id WHERE json_extract(i.data,'$.roadStretch.id')=?").bind(JSON.parse(rows[0].data).roadStretch.id).all()).results;
 for(const row of rows){const item=JSON.parse(row.data);if(Number(item.projectId)!==projectId&&!members.some(m=>m.inventory_id===row.id&&m.project_id===projectId))fail('The complete stretch must belong to this project.',403);
 if(user.role!=='admin'&&(Number(item.projectId)!==projectId||members.some(m=>m.inventory_id===row.id&&m.project_id!==projectId)))fail('An administrator must edit stretches shared across projects.',403);}
}
export async function roadStretchList(db,user,projectId){
 await campaignAccess(db,user,projectId,true);
 const ids=(await db.prepare("SELECT DISTINCT json_extract(data,'$.roadStretch.id') id FROM inventory i WHERE json_extract(data,'$.roadStretch.id') IS NOT NULL AND (COALESCE(json_extract(data,'$.projectId'),1)=? OR EXISTS(SELECT 1 FROM inventory_projects WHERE inventory_id=i.id AND project_id=?))").bind(projectId,projectId).all()).results;
 const roads=[];for(const {id} of ids){const rows=await rowsFor(db,id);try{await accessible(db,user,projectId,rows);}catch{continue;}const items=rows.map(row=>JSON.parse(row.data)).sort((a,b)=>a.roadStretch.index-b.roadStretch.index),first=items[0];
 if(items.some((item,index)=>item.mediaType!=='lamp-post'||item.roadStretch.index!==index+1||item.roadStretch.count!==items.length))continue;
 roads.push({id,name:first.roadStretch.name,anchors:first.roadStretch.anchors,count:items.length,faces:first.faces,vendor:first.owner||'',area:first.district||'',width:first.width||0,height:first.height||0,verified:items.filter(item=>item.positionVerified===true||item.positionSource!=='estimated-road-stretch').length,version:await version(rows)});}
 return {roads:roads.sort((a,b)=>a.name.localeCompare(b.name))};
}
export async function updateRoadStretch(db,user,body){
 const projectId=Number(body.projectId);await campaignAccess(db,user,projectId,true);
 if(typeof body.roadId!=='string')fail('Choose a saved road stretch.');
 const rows=await rowsFor(db,body.roadId);await accessible(db,user,projectId,rows);
 if(body.version!==await version(rows))fail('This stretch changed elsewhere. Reopen it before saving.',409);
 const name=String(body.name||'').trim(),vendor=String(body.vendor||'').trim(),area=String(body.area||'').trim();
 if(!name||[name,vendor,area].some(v=>v.length>160)||body.confirmed!==true)fail('Enter a road name and confirm the updated stretch.');
 if(body.count!==rows.length)fail('Editing keeps the existing pole count.');
 const preview=roadPreview(body.anchors,body.count),now=Date.now(),writes=[];let moved=0,verified=0;
 const original=JSON.parse(rows[0].data),geometryChanged=JSON.stringify(original.roadStretch.anchors)!==JSON.stringify(body.anchors);
 if(new Set(rows.map(row=>JSON.parse(row.data).roadStretch.index)).size!==rows.length)fail('Pole numbering has changed. Refresh the inventory.',409);
 writes.push(db.prepare("SELECT CASE WHEN count(*)=? THEN 1 ELSE json('Road membership changed') END FROM inventory WHERE json_extract(data,'$.roadStretch.id')=?").bind(rows.length,body.roadId));
 for(const row of rows){const item=JSON.parse(row.data),index=item.roadStretch.index-1;
 if(item.mediaType!=='lamp-post'||!Number.isInteger(index)||index<0||index>=rows.length||item.roadStretch.count!==rows.length)fail('This stretch has missing or changed poles. Refresh the inventory.',409);
 const next={...item,roadStretch:{...item.roadStretch,name,anchors:body.anchors,chainage:preview.points[index].chainage,spacing:preview.spacing,updatedAt:now,updatedBy:user.id},lastEditedAt:now};
 // Only changed shared fields are propagated; individual pole customizations remain.
 if(name!==original.roadStretch.name&&item.street===`${item.roadStretch.name} · Pole ${index+1}`)next.street=`${name} · Pole ${index+1}`;
 if(vendor!==String(original.owner||''))next.owner=vendor;
 if(area!==String(original.district||''))next.district=area;
 for(const field of ['width','height']){const value=Number(body[field]);if(!Number.isFinite(value)||value<0||value>100)fail('Dimensions must be between 0 and 100 m.');if(value!==Number(original[field]||0))next[field]=value;}
 if(item.positionVerified===true||item.positionSource!=='estimated-road-stretch')verified++;else if(geometryChanged){const point=preview.points[index];if(item.lat!==point.lat||item.lng!==point.lng){next.lat=point.lat;next.lng=point.lng;delete next.locationAddress;moved++;}}
 next.sourceAttributes={...item.sourceAttributes,'ROAD STRETCH':name,'CHAINAGE (M)':String(preview.points[index].chainage)};
 writes.push(db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM inventory WHERE id=? AND data=?) THEN 1 ELSE json('Road changed') END").bind(row.id,row.data));
 writes.push(db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM inventory i WHERE i.id=? AND (CAST(json_extract(i.data,'$.projectId') AS INTEGER)=? OR EXISTS(SELECT 1 FROM inventory_projects WHERE inventory_id=i.id AND project_id=?))) THEN 1 ELSE json('Project membership changed') END").bind(row.id,projectId,projectId));
 if(user.role!=='admin')writes.push(db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM inventory_projects WHERE inventory_id=? AND project_id!=?) THEN 1 ELSE json('Shared stretch changed') END").bind(row.id,projectId));
 writes.push(db.prepare('UPDATE inventory SET data=?,latitude=?,longitude=? WHERE id=?').bind(JSON.stringify(next),next.lat,next.lng,row.id));
 }
 writes.push(db.prepare('INSERT INTO asset_activity(project_id,asset_id,actor_id,event,detail,created_at) VALUES(?,0,?,?,?,?)').bind(projectId,user.id,'Road stretch updated',JSON.stringify({roadId:body.roadId,roadName:name,poles:rows.length,moved,verifiedPreserved:verified}),now));
 try{await db.batch(writes);}catch{fail('The stretch changed while saving. Reload before editing; no partial update was applied.',409);}
 return {ok:true,updated:true,name,count:rows.length,moved,verifiedPreserved:verified,projectId};
}
