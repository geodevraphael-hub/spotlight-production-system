import {assetPriority,installationCount,registrationNumber,mediaGroup} from './asset-register.mjs';
export const GEO_LEVELS=[['region','Region'],['district','District'],['council','Council'],['local','Ward / shehia'],['village','Village']];
export const emptyGeoFilters=()=>Object.fromEntries(GEO_LEVELS.map(([key])=>[key,'']));
/** @returns {{region:any,district:any,council:any,local:any,village:any,ready:boolean,partial:boolean,fetchedAt:any}} */
export function inventoryGeography(board,evidence,now=Date.now()){
  const entry=evidence?.[board.inventoryDbId];
  const valid=entry&&Number.isFinite(entry.fetchedAt)&&Number(board.lat)===entry.lat&&Number(board.lng)===entry.lng&&entry.fetchedAt<=now&&now-entry.fetchedAt<=7*86400000;
  const address=board.locationAddress;
  const addressValid=address&&address.lat===Number(board.lat)&&address.lng===Number(board.lng)&&address.status!=='pending';
  const areas=valid?(entry.demographics?.areas??[]):[];
  const result=Object.fromEntries(GEO_LEVELS.map(([level])=>[level,areas.find(a=>(level==='local'?['ward','shehia'].includes(a.level):a.level===level)&&a.verified)??null]));
  if(addressValid)for(const [level] of GEO_LEVELS)if(!result[level]&&address[level])result[level]={name:address[level],key:`address:${level}:${address.region||''}:${address.district||''}:${address[level]}`,population:null};
  return {region:result.region,district:result.district,council:result.council,local:result.local,village:result.village,ready:Boolean(valid),partial:entry?.coverageStatus==='administrative-only',fetchedAt:entry?.fetchedAt??null};
}
export function matchesGeography(board,evidence,filters,now=Date.now()){
  const geo=inventoryGeography(board,evidence,now);
  return GEO_LEVELS.every(([key])=>!filters[key]||(filters[key]==='__missing__'?!geo[key]:geo[key]?.key===filters[key]));
}
export function geographyOptions(boards,evidence,filters,level,now=Date.now()){
  const index=GEO_LEVELS.findIndex(([key])=>key===level);
  const parents=Object.fromEntries(GEO_LEVELS.slice(0,index).map(([key])=>[key,filters[key]]));
  const options=new Map();
  for(const board of boards){
    if(!matchesGeography(board,evidence,parents,now))continue;
    const area=inventoryGeography(board,evidence,now)[level];
    if(area)options.set(area.key,area.name);
  }
  return [...options].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label)||a.value.localeCompare(b.value));
}
export function changeGeography(filters,key,value){
  const next={...filters,[key]:value},index=GEO_LEVELS.findIndex(([level])=>level===key);
  for(const [level] of GEO_LEVELS.slice(index+1))next[level]='';
  return next;
}
export function uniqueInventory(rows){
  const map=new Map();
  for(const row of rows){
    const key=row.inventoryDbId??row.id;
    if(!map.has(key))map.set(key,{...row,projectNames:[],projectIds:[]});
    const item=map.get(key);
    item.projectNames=[...new Set([...item.projectNames,...(row.projectNames??[row.projectName]).filter(Boolean)])];
    item.projectIds=[...new Set([...item.projectIds,...(row.projectIds??[row.projectId]).filter(Number.isFinite)])];
    item.projectName=item.projectNames.join(' · ');
  }
  return [...map.values()];
}
export function inventoryCsv(boards,evidence,flightStatus){
  const cell=value=>`"${String(value??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')}"`;
  const header=['Billboard','Inventory ID','Projects','Media type','Vendor','Width m','Height m','Faces','Inventory status','Flight status','Registration number','Priority','Installations','Media group',
    'Region','District','Council','Ward / shehia','Village','Ward / shehia population (NBS 2022)','Village population (estimated, NBS 2022)','Latitude','Longitude','Photo URL','Location evidence retrieved','Position source'];
  const rows=boards.map(b=>{
    const g=inventoryGeography(b,evidence);
    return [b.street,b.inventoryDbId,b.projectName,b.mediaType,b.owner,b.width,b.height,b.faces,b.status??'not-selected',flightStatus(b),registrationNumber(b),assetPriority(b),installationCount(b)??'',mediaGroup(b),
      ...GEO_LEVELS.map(([key])=>g[key]?.name??''),g.local?.population??'',g.village?.population??'',b.lat,b.lng,b.photoOriginalUrl||b.photoUrl||'',g.fetchedAt?new Date(g.fetchedAt).toISOString():'',b.positionSource==='estimated-road-stretch'?'Estimated road stretch — field verification required':b.positionSource||'Not recorded'];
  });
  return '\uFEFF'+[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
}
