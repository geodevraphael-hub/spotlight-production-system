import {historySource} from './history-report.mjs';
import {installationCount} from './asset-register.mjs';
import {assetBookings} from './asset-booking.mjs';
const DAY=86400000;
export const eatDay=ms=>new Date(ms+10800000).toISOString().slice(0,10);
const dayNumber=ms=>Date.parse(eatDay(ms))/DAY;
const count=value=>Math.max(0,Number(value)||0);
const boardTypes=[['large-format','Large format'],['digital-screen','Digital screens'],['lamp-post','Lamp posts'],['fabricated-banner','Fabricated banners']];
export function dashboardInventory(inventory,schedules,projectId,now=Date.now()){
 const flightById=new Map(schedules.map(s=>[Number(s.asset_id),s]));
 const states={flighted:0,overdue:0,deflighted:0,unflighted:0};
 const types=boardTypes.map(([id,label])=>({id,label,boards:0,faces:0}));
 const expiry=[],areas=new Map();let faces=0,missingExpiry=0,installations=0,missingInstallations=0,inProduction=0,inTransit=0,booked=0;
 for(const b of inventory){
  const n=count(b.faces);faces+=n;
  const units=installationCount(b);
  if(units===null)missingInstallations++;else installations+=units;
  if(b.bookingStatus==='booked')booked++;
  let type=types.find(t=>t.id===b.mediaType);
  if(!type){type=types.find(t=>t.id==='other');if(!type){type={id:'other',label:'Other / not recorded',boards:0,faces:0};types.push(type);}}
  type.boards++;type.faces+=n;
  const area=b.district?.trim()||'Area not recorded';areas.set(area,(areas.get(area)||0)+1);
  const schedule=flightById.get(Number(b.id)),source=Number(b.projectId??1)===projectId;
  const status=schedule?.flight_status??(source?b.flightStatus:null)??'unflighted';
  const stage=schedule?.stage??(source?b.flightStage:null);
  if(!['flighted','expired','deflighted'].includes(status)){
   if(stage==='printing')inProduction++;
   if(stage==='transport')inTransit++;
  }
  const rawEnd=schedule?.end_at??(source?b.flightExpiry:null);
  const end=rawEnd?(Number(rawEnd)||Date.parse(String(rawEnd))):NaN;
  const remaining=Number.isFinite(end)&&end>0?dayNumber(end)-dayNumber(now):null;
  if(status==='flighted'||status==='expired'){
   const overdue=remaining!==null&&remaining<0;
   states[overdue?'overdue':'flighted']++;
   if(remaining===null)missingExpiry++;
   else expiry.push({inventoryId:b.inventoryDbId,id:Number(b.id),name:b.street||`Billboard ${b.id}`,area,end,remaining});
  }else states[status==='deflighted'?'deflighted':'unflighted']++;
 }
 expiry.sort((a,b)=>a.remaining-b.remaining||a.name.localeCompare(b.name));
 return {total:inventory.length,faces,installations,missingInstallations,booked,inProduction,inTransit,states,types,expiry,missingExpiry,
  dueToday:expiry.filter(b=>b.remaining===0).length,dueSoon:expiry.filter(b=>b.remaining>0&&b.remaining<=3).length,
  areas:[...areas].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label))};
}
export async function projectDashboard(db,projectId,now=Date.now()){
 const [inventory,schedules,validations,collections,messages,activity,trend,bookings]=await Promise.all([
  db.prepare(`SELECT i.id inventoryDbId,json_extract(i.data,'$.id') id,json_extract(i.data,'$.street') street,
   json_extract(i.data,'$.projectId') projectId,json_extract(i.data,'$.district') district,
   json_extract(i.data,'$.mediaType') mediaType,json_extract(i.data,'$.faces') faces,
   json_extract(i.data,'$.installations') installations,
   json_object('INSTALLATION',COALESCE(json_extract(i.data,'$.sourceAttributes.INSTALLATION'),json_extract(i.data,'$.sourceAttributes.INSTALLATIONS'),json_extract(i.data,'$.sourceAttributes.Installations'),json_extract(i.data,'$.sourceAttributes.Installation'))) sourceAttributes,
   json_extract(i.data,'$.flightStage') flightStage,
   json_extract(i.data,'$.flightStatus') flightStatus,json_extract(i.data,'$.flightExpiry') flightExpiry
   FROM inventory i WHERE EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=?)
    OR COALESCE(json_extract(i.data,'$.projectId'),1)=?`).bind(projectId,projectId).all(),
  db.prepare('SELECT asset_id,stage,flight_status,end_at FROM flight_schedules WHERE project_id=?').bind(projectId).all(),
  db.prepare(`SELECT va.status,count(*) value FROM validation_assignments va WHERE va.project_id=?
    AND EXISTS(SELECT 1 FROM inventory i WHERE CAST(json_extract(i.data,'$.id') AS INTEGER)=va.asset_id
    AND (COALESCE(json_extract(i.data,'$.projectId'),1)=va.project_id OR EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=va.project_id)))
    GROUP BY va.status`).bind(projectId).all(),
  db.prepare('SELECT status,count(*) value FROM field_collections WHERE COALESCE(project_id,1)=? GROUP BY status').bind(projectId).all(),
  db.prepare('SELECT channel,status,count(*) value FROM notification_jobs WHERE project_id=? GROUP BY channel,status').bind(projectId).all(),
  db.prepare(`${historySource} SELECT id,event,actor,billboard,project_name,created_at FROM history ORDER BY created_at DESC,id DESC LIMIT 8`).bind(projectId).all(),
  db.prepare(`SELECT date(created_at/1000,'unixepoch','+3 hours') day,count(*) value FROM asset_activity
   WHERE project_id=? AND created_at>=? AND created_at<=? GROUP BY day ORDER BY day`).bind(projectId,Date.parse(eatDay(now)+'T00:00:00+03:00')-13*DAY,now).all(),
  assetBookings(db,now),
 ]);
 const trendMap=new Map(trend.results.map(r=>[r.day,r.value]));
 return {...dashboardInventory(inventory.results.map(b=>({...b,sourceAttributes:JSON.parse(b.sourceAttributes||'{}'),...bookings.get(b.inventoryDbId)})),schedules.results,projectId,now),projectId,generatedAt:now,
  validations:validations.results,collections:collections.results,messages:messages.results,activity:activity.results,
  trend:Array.from({length:14},(_,i)=>{const day=eatDay(now-(13-i)*DAY);return {day,value:trendMap.get(day)||0};})};
}
