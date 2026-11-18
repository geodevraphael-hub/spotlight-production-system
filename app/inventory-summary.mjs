import {assetPriority,installationCount,registrationNumber} from './asset-register.mjs';
import {inventoryGeography,regionOption} from './inventory-workflow.mjs';
import {validCoordinates} from './operations-rules.mjs';
import {markerState} from './map-symbols.mjs';
import {assetBookings} from './asset-booking.mjs';
import {readDictionaries} from './dictionary-store.mjs';
import {DEFAULT_DICTIONARIES,dictionaryLabel} from './inventory-dictionaries.mjs';
const number=value=>Math.max(0,Number(value)||0);
const words=value=>String(value||'Not recorded').replaceAll('-',' ').replace(/^./,c=>c.toUpperCase());
const flightLabels={flighted:'Flighted',expired:'Expired / overdue',unflighted:'Unflighted',deflighted:'Deflighted'};
export function inventorySummary(records,schedules,projectId,bookings=new Map(),dictionaries=DEFAULT_DICTIONARIES,now=Date.now()){
 const flights=new Map(schedules.map(row=>[Number(row.asset_id),row]));
 const unique=new Map(records.map(record=>[Number(record.inventoryDbId),record]));
 const assets=[...unique.values()].map(record=>{
  const schedule=flights.get(Number(record.id)),own=Number(record.projectId??1)===projectId;
  const flight={flightStatus:schedule?.flight_status??(own?record.flightStatus:null)??'unflighted',flightExpiry:schedule?.end_at??(own?record.flightExpiry:null)};
  const geography=inventoryGeography(record,{},now),region=geography.region?regionOption(geography.region):null;
  const priority=assetPriority(record),installations=installationCount(record),state=markerState(flight,now);
  const gps=validCoordinates(record.lat,record.lng),photo=Boolean(record.hasPhoto),registered=Boolean(registrationNumber(record));
  const locationReady=gps&&Boolean(geography.region&&geography.district);
  const gaps=[...(!gps?['gps']:[]),...(!photo?['photo']:[]),...(!priority?['priority']:[]),...(!registered?['registration']:[]),...(!(number(record.width)>0&&number(record.height)>0)?['dimensions']:[]),...(!locationReady?['location']:[])];
  return {id:Number(record.inventoryDbId),sourceId:Number(record.id),name:record.street||`Asset ${record.inventoryDbId}`,type:record.mediaType||'__missing__',typeLabel:dictionaryLabel(dictionaries,'mediaType',record.mediaType)||'Not recorded',
   vendor:String(record.owner||'').trim()||'Not recorded',priority:priority||'__missing__',priorityLabel:dictionaryLabel(dictionaries,'priority',priority)||'Not assigned',
   status:record.status||'not-selected',statusLabel:dictionaryLabel(dictionaries,'status',record.status||'not-selected'),region:region?.value||'__missing__',regionLabel:region?.label||'Not recorded',district:geography.district?.name||record.district||'Not recorded',
   faces:number(record.faces),installations,flight:state,flightLabel:flightLabels[state],booked:bookings.get(Number(record.inventoryDbId))?.bookingStatus==='booked',gps,photo,registered,locationReady,gaps};
 });
 function facet(key,labelKey){const groups=new Map();for(const asset of assets){const value=asset[key],group=groups.get(value)||{value,label:asset[labelKey]||words(value),count:0,faces:0,ids:[]};group.count++;group.faces+=asset.faces;group.ids.push(asset.id);groups.set(value,group);}return [...groups.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));}
 const quality=[['gps','GPS missing'],['photo','Photo missing'],['priority','Priority not assigned'],['registration','Registration not recorded'],['dimensions','Dimensions missing'],['location','Location details incomplete']].map(([value,label])=>{const ids=assets.filter(asset=>asset.gaps.includes(value)).map(asset=>asset.id);return {value,label,count:ids.length,ids};});
 return {projectId,generatedAt:now,assets,total:assets.length,faces:assets.reduce((sum,asset)=>sum+asset.faces,0),installations:assets.reduce((sum,asset)=>sum+(asset.installations??0),0),missingInstallations:assets.filter(asset=>asset.installations===null).length,
  booked:assets.filter(asset=>asset.booked).length,available:assets.filter(asset=>!asset.booked).length,photos:assets.filter(asset=>asset.photo).length,locationReady:assets.filter(asset=>asset.locationReady).length,
  facets:{types:facet('type','typeLabel'),vendors:facet('vendor','vendor'),priorities:facet('priority','priorityLabel'),regions:facet('region','regionLabel'),statuses:facet('status','statusLabel'),flights:facet('flight','flightLabel')},quality};
}
export async function projectInventorySummary(db,projectId,now=Date.now()){
 const member=`(EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=?) OR COALESCE(json_extract(i.data,'$.projectId'),1)=?)`;
 const [records,schedules,bookings,dictionaries,costs,validations]=await Promise.all([
  db.prepare(`SELECT i.id inventoryDbId,json_extract(i.data,'$.id') id,json_extract(i.data,'$.projectId') projectId,
   json_extract(i.data,'$.street') street,json_extract(i.data,'$.owner') owner,json_extract(i.data,'$.district') district,
   json_extract(i.data,'$.mediaType') mediaType,json_extract(i.data,'$.priority') priority,json_extract(i.data,'$.status') status,
   json_extract(i.data,'$.faces') faces,json_extract(i.data,'$.installations') installations,json_extract(i.data,'$.registrationNumber') registrationNumber,
   json_extract(i.data,'$.lat') lat,json_extract(i.data,'$.lng') lng,json_extract(i.data,'$.locationAddress') locationAddress,
   json_extract(i.data,'$.width') width,json_extract(i.data,'$.height') height,json_extract(i.data,'$.flightStatus') flightStatus,json_extract(i.data,'$.flightExpiry') flightExpiry,
   CASE WHEN COALESCE(NULLIF(json_extract(i.data,'$.photoUrl'),''),json_extract(i.data,'$.photoOriginalUrl'),'')!='' THEN 1 ELSE 0 END hasPhoto,
   (SELECT json_group_object(key,value) FROM json_each(i.data,'$.sourceAttributes') WHERE lower(replace(replace(replace(key,' ',''),'_',''),'-','')) IN ('priority','prioritylevel','installation','installations','numberofinstallations','registrationnumber','registrationno','regnumber')) sourceAttributes
   FROM inventory i WHERE ${member} ORDER BY i.id`).bind(projectId,projectId).all(),
  db.prepare('SELECT asset_id,flight_status,end_at FROM flight_schedules WHERE project_id=?').bind(projectId).all(),
  assetBookings(db,now,projectId),readDictionaries(db),
  db.prepare(`SELECT c.inventory_id,c.category,SUM(c.amount_minor) amount FROM actual_costs c JOIN inventory i ON i.id=c.inventory_id WHERE c.project_id=? AND ${member} GROUP BY c.inventory_id,c.category`).bind(projectId,projectId,projectId).all(),
  db.prepare(`SELECT v.asset_id,v.status,count(*) count FROM validation_assignments v WHERE v.project_id=? AND EXISTS(SELECT 1 FROM inventory i WHERE CAST(json_extract(i.data,'$.id') AS INTEGER)=v.asset_id AND ${member}) GROUP BY v.asset_id,v.status`).bind(projectId,projectId,projectId).all(),
 ]);
 const summary=inventorySummary(records.results.map(row=>({...row,sourceAttributes:JSON.parse(row.sourceAttributes||'{}'),locationAddress:row.locationAddress?JSON.parse(row.locationAddress):null})),schedules.results,projectId,bookings,dictionaries.dictionaries,now);
 const costGroups=new Map();for(const row of costs.results){const category=row.category==='transport'?'other':row.category,group=costGroups.get(category)||{value:category,label:category==='other'?'Other costs':words(category),amount:0,ids:[]};group.amount+=row.amount/100;if(!group.ids.includes(row.inventory_id))group.ids.push(row.inventory_id);costGroups.set(category,group);}
 const validationGroups=new Map();for(const row of validations.results){const group=validationGroups.get(row.status)||{value:row.status,label:words(row.status),count:0,ids:[]};group.count+=row.count;for(const asset of summary.assets)if(asset.sourceId===row.asset_id&&!group.ids.includes(asset.id))group.ids.push(asset.id);validationGroups.set(row.status,group);}
 return {...summary,costs:[...costGroups.values()],recordedCost:costs.results.reduce((sum,row)=>sum+row.amount/100,0),validations:[...validationGroups.values()]};
}
