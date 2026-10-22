import {campaignAccess,setupCampaignTools} from './campaign-store.mjs';
import {assetBookings} from './asset-booking.mjs';
import {reportAsset,reportSettings} from './report-model.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export async function setupReports(db){await setupCampaignTools(db);await db.batch([
 db.prepare('CREATE TABLE IF NOT EXISTS report_settings(project_id INTEGER NOT NULL,scope TEXT NOT NULL,settings TEXT NOT NULL,version INTEGER NOT NULL,updated_by INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(project_id,scope))'),
 db.prepare('CREATE TABLE IF NOT EXISTS report_map_links(token TEXT PRIMARY KEY,project_id INTEGER NOT NULL,scope TEXT NOT NULL,created_by INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(project_id,scope))'),
 db.prepare('CREATE TABLE IF NOT EXISTS report_share_variants(token TEXT PRIMARY KEY,project_id INTEGER NOT NULL,scope TEXT NOT NULL,excluded_assets TEXT NOT NULL,created_by INTEGER NOT NULL,created_at INTEGER NOT NULL)')]);}
async function scopeData(db,projectId,scope=''){
 const project=await db.prepare('SELECT id,name,project_type,share_protected,share_code FROM projects WHERE id=?').bind(projectId).first();if(!project)fail('Project no longer exists.',404);
 const campaign=scope?await db.prepare('SELECT * FROM project_campaigns WHERE project_id=? AND id=?').bind(projectId,scope).first():null;if(scope&&!campaign)fail('Campaign no longer exists.',404);
 const ids=campaign?new Set(JSON.parse(campaign.asset_ids)):null;
 const records=await db.prepare("SELECT id,data FROM inventory i WHERE COALESCE(json_extract(data,'$.projectId'),1)=? OR EXISTS(SELECT 1 FROM inventory_projects WHERE inventory_id=i.id AND project_id=?) ORDER BY i.id").bind(projectId,projectId).all();
 return {project,campaign,assets:records.results.filter(r=>!ids||ids.has(r.id)).map(r=>({...JSON.parse(r.data),inventoryDbId:r.id}))};
}
export async function reportWorkspace(db,user,projectId,scope=''){
 await campaignAccess(db,user,projectId);const {project,campaign,assets}=await scopeData(db,projectId,scope);
 const [schedules,bookings,settings,campaigns,link,variant]=await Promise.all([
 db.prepare('SELECT asset_id,stage,flight_status,start_at,end_at FROM flight_schedules WHERE project_id=?').bind(projectId).all(),assetBookings(db),
 db.prepare('SELECT settings,version FROM report_settings WHERE project_id=? AND scope=?').bind(projectId,scope).first(),
 db.prepare('SELECT id,name,starts_on,ends_on FROM project_campaigns WHERE project_id=? ORDER BY name').bind(projectId).all(),
 db.prepare('SELECT token FROM report_map_links WHERE project_id=? AND scope=?').bind(projectId,scope).first(),
 db.prepare('SELECT token,excluded_assets FROM report_share_variants WHERE project_id=? AND scope=? ORDER BY created_at DESC LIMIT 1').bind(projectId,scope).first()]);
 const scheduleMap=new Map(schedules.results.map(s=>[Number(s.asset_id),s])),now=Date.now();
 return {project:{id:project.id,name:project.name,protected:project.share_protected!==0},campaign:campaign?{id:campaign.id,name:campaign.name,starts_on:campaign.starts_on,ends_on:campaign.ends_on}:null,campaigns:campaigns.results,
 assets:assets.map(b=>reportAsset(b,scheduleMap.get(Number(b.id)),bookings.get(b.inventoryDbId),projectId,now)),
 settings:settings?reportSettings(JSON.parse(settings.settings)):reportSettings({title:`${campaign?.name||project.name} — Outdoor Visibility Report`}),version:settings?.version||0,canManage:user.role!=='planner',mapToken:variant?.token||link?.token||'',mapExcludedInventoryIds:variant?JSON.parse(variant.excluded_assets||'[]'):[],generatedAt:now};
}
export async function saveReport(db,user,body){
 const projectId=Number(body.projectId),scope=String(body.scope||'');await campaignAccess(db,user,projectId,true);await scopeData(db,projectId,scope);
 const settings=reportSettings(body.settings);if(!settings.title)fail('Enter a report title.');
 const previous=await db.prepare('SELECT settings,version FROM report_settings WHERE project_id=? AND scope=?').bind(projectId,scope).first();
 if((previous?.version||0)!==body.version)fail('Report was changed by another user. Reload before saving.',409);
 const now=Date.now(),version=body.version+1;
 const write=previous?db.prepare('UPDATE report_settings SET settings=?,version=?,updated_by=?,updated_at=? WHERE project_id=? AND scope=? AND version=?').bind(JSON.stringify(settings),version,user.id,now,projectId,scope,body.version):db.prepare('INSERT INTO report_settings VALUES(?,?,?,?,?,?)').bind(projectId,scope,JSON.stringify(settings),version,user.id,now);
 const summary=s=>s?{title:s.title,subtitle:s.subtitle,palette:s.palette,evidencePages:s.evidence,includeFabricatedBanners:s.includeFabricatedBanners,coverPhoto:s.cover?'Attached':'None'}:null;
 const result=await db.batch([db.prepare("SELECT CASE WHEN COALESCE((SELECT version FROM report_settings WHERE project_id=? AND scope=?),0)=? THEN 1 ELSE json('Report changed') END").bind(projectId,scope,body.version),write,
 db.prepare('INSERT INTO asset_activity(project_id,asset_id,actor_id,event,detail,created_at) VALUES(?,0,?,?,?,?)').bind(projectId,user.id,'Report design saved',JSON.stringify({schemaVersion:2,entity:'report_settings',operation:previous?'update':'insert',actor:{id:user.id,name:user.name,role:user.role},before:summary(previous?JSON.parse(previous.settings):null),after:{...summary(settings),scope:scope||'Entire project'}}),now)]);
 if(result[1].meta?.changes===0)fail('Report changed elsewhere. Reload before saving.',409);
 return {ok:true,version};
}
export async function reportLink(db,user,body){
 const projectId=Number(body.projectId),scope=String(body.scope||'');await campaignAccess(db,user,projectId,true);const {project}=await scopeData(db,projectId,scope);
 if(project.share_protected!==0&&!project.share_code)fail('Set a project sharing secret code before generating a protected report link.');
 const excluded=[...new Set((Array.isArray(body.excludedInventoryIds)?body.excludedInventoryIds:[]).map(Number).filter(Number.isSafeInteger))];
 const {assets}=await scopeData(db,projectId,scope),valid=new Set(assets.map(a=>Number(a.inventoryDbId)));
 if(excluded.some(id=>!valid.has(id)))fail('The report filter contains an asset outside this report scope.');
 const prior=await db.prepare('SELECT token FROM report_share_variants WHERE project_id=? AND scope=? AND excluded_assets=? ORDER BY created_at DESC LIMIT 1').bind(projectId,scope,JSON.stringify(excluded)).first();if(prior)return {token:prior.token,protected:project.share_protected!==0};
 const token=`r_${crypto.randomUUID().replaceAll('-','')}`;
 await db.prepare('INSERT INTO report_share_variants VALUES(?,?,?,?,?,?)').bind(token,projectId,scope,JSON.stringify(excluded),user.id,Date.now()).run();
 return {token,protected:project.share_protected!==0};
}
export async function sharedReport(db,token,code){
 await setupReports(db);const link=await db.prepare('SELECT token,project_id,scope,excluded_assets FROM report_share_variants WHERE token=?').bind(token).first()||await db.prepare("SELECT token,project_id,scope,'[]' AS excluded_assets FROM report_map_links WHERE token=?").bind(token).first();if(!link)fail('Shared report map not found.',404);
 const {project,campaign,assets}=await scopeData(db,link.project_id,link.scope);
 if(project.share_protected!==0&&(!code||code!==String(project.share_code).toUpperCase()))throw Object.assign(new Error('Secret code required'),{status:401,protected:true});
 // Re-read current membership on every request: removed campaign/project assets never leak.
 const schedules=await db.prepare('SELECT asset_id,stage,flight_status,start_at,end_at FROM flight_schedules WHERE project_id=?').bind(project.id).all();const byId=new Map(schedules.results.map(s=>[Number(s.asset_id),s]));
 const excluded=new Set(JSON.parse(link.excluded_assets||'[]').map(Number));
 return {project:{id:project.id,name:campaign?`${project.name} · ${campaign.name}`:project.name,project_type:project.project_type,share_token:token,share_protected:project.share_protected},inventory:assets.filter(b=>!excluded.has(Number(b.inventoryDbId))).map(b=>{const s=byId.get(Number(b.id)),own=Number(b.projectId||1)===project.id;return {...b,projectId:project.id,flightStatus:s?.flight_status||(own?b.flightStatus:'unflighted'),flightStage:s?.stage||(own?b.flightStage:''),flightExpiry:s?.end_at??(own?b.flightExpiry:null),flightStart:s?.start_at??(own?b.flightStart:null)};})};
}
