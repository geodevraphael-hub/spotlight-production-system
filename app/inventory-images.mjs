import {validCoordinates} from './operations-rules.mjs';

const photoFields=['photoUrl','photoOriginalUrl'];
const raster=['jpeg','png','webp','gif','avif'];
export function restoreInventoryImages(item,stored,inventoryId){
 const next={...item};
 for(const field of photoFields){
  if(typeof item[field]!=='string'||!item[field].includes('inventory-image'))continue;
  let url;try{url=new URL(String(item[field]||''),'https://spotlight.co.tz');}catch{continue;}
  if(url.pathname!=='/api/app'||url.searchParams.get('action')!=='inventory-image')continue;
  if(Number(url.searchParams.get('id'))!==inventoryId||url.searchParams.get('kind')!==field||!stored?.[field])throw Object.assign(Error('Refresh inventory before saving this image reference.'),{status:409});
  next[field]=stored[field];
 }
 return next;
}
export function compactInventoryData(userId){
 if(!Number.isSafeInteger(userId)||userId<=0)throw Error('Authenticated image identity required');
 const version="MAX(COALESCE(json_extract(i.data,'$.lastEditedAt'),0),COALESCE(json_extract(i.data,'$.validatedAt'),0),i.created_at)";
 const fields=photoFields.flatMap(field=>{
  const value=`json_extract(i.data,'$.${field}')`;
  return [`'$.${field}'`,`CASE WHEN (${raster.map(type=>`${value} LIKE 'data:image/${type};base64,%'`).join(' OR ')}) THEN '/api/app?action=inventory-image&id='||i.id||'&uid=${userId}&kind=${field}&v='||${version} ELSE ${value} END`];
 });
 return `json_set(i.data,${fields.join(',')})`;
}
export async function inventoryImage(db,user,params){
 const id=Number(params.get('id')),uid=Number(params.get('uid')),kind=params.get('kind')||'photoUrl';
 const fail=(message,status)=>new Response(message,{status,headers:{'Cache-Control':'no-store'}});
 if(!Number.isSafeInteger(id)||id<=0||uid!==user.id||!photoFields.includes(kind))return fail('Image not found',404);
 const row=await db.prepare(`SELECT json_extract(i.data,?) photo,i.data FROM inventory i WHERE i.id=? AND
  (?='admin' OR EXISTS(SELECT 1 FROM project_users pu WHERE pu.user_id=? AND
   (pu.project_id=COALESCE(json_extract(i.data,'$.projectId'),1) OR EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=pu.project_id))))`).bind(`$.${kind}`,id,user.role,user.id).first();
 if(!row||!validCoordinates(JSON.parse(row.data).lat,JSON.parse(row.data).lng))return fail('Image not found',404);
 const match=/^data:(image\/(?:jpeg|png|webp|gif|avif));base64,([a-z0-9+/=\s]+)$/i.exec(row.photo||'');
 if(!match)return fail('Image not found',404);
 let bytes;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}catch{return fail('Image unavailable',422);}
 return new Response(bytes,{headers:{'Content-Type':match[1],'Cache-Control':'private, max-age=2592000','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'}});
}
