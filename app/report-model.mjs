import {lamppostRoute,uniqueImageReferences} from './lamppost-routes.mjs';
export const REPORT_PALETTES={navy:{name:'Navy & emerald',ink:'#10263D',accent:'#00866A',paper:'#F1F5F6'},forest:{name:'Forest & gold',ink:'#173D35',accent:'#A37014',paper:'#F6F5EF'},slate:{name:'Slate & blue',ink:'#263547',accent:'#2466AF',paper:'#F2F5FA'}};
export const REPORT_TYPES=['Large format','Digital screens','Lampposts','Fabricated banners','Other'];
const clean=v=>String(v??'').trim();
export function reportType(value){const s=clean(value).toLowerCase().replace(/[^a-z]/g,'');return /lamp|lightpost/.test(s)?'Lampposts':/digital|screen|led/.test(s)?'Digital screens':/fabricat|banner/.test(s)?'Fabricated banners':/large|billboard/.test(s)?'Large format':'Other';}
export function reportGps(b){const lat=Number(b.lat),lng=Number(b.lng);return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-12.35&&lat<=-0.65&&lng>=29.2&&lng<=40.85&&!(lat===0&&lng===0);}
export function attr(b,...keys){const entries=Object.entries(b.sourceAttributes||{});for(const key of keys){const match=entries.find(([k])=>k.toLowerCase().replace(/[^a-z0-9]/g,'')===key.toLowerCase().replace(/[^a-z0-9]/g,''));if(clean(match?.[1]))return clean(match[1]);}return '';}
export function reportAsset(b,schedule,booking={},projectId,now=Date.now()){
 const own=Number(b.projectId||1)===projectId,geo=b.locationAddress;
 const location=geo&&Number(geo.lat)===Number(b.lat)&&Number(geo.lng)===Number(b.lng)?geo:{};
 const status=schedule?.flight_status||(own?b.flightStatus:'unflighted')||'unflighted';
 const start=schedule?.start_at??(own?b.flightStart:null),end=schedule?.end_at??(own?b.flightExpiry:null);
 const type=reportType(b.mediaType),route=type==='Lampposts'?lamppostRoute({...b,mediaType:'lamp-post'}):null;
 return {inventoryDbId:b.inventoryDbId,id:b.id,name:attr(b,'SPECIFIC LOCATION')||clean(b.street)||clean(b.owner)||`Asset ${b.id}`,
 type,mediaType:b.mediaType,routeKey:route?.key||'',routeName:route?.label||'',routeRecorded:route?.recorded??false,
 street:clean(b.street),from:clean(b.from),to:clean(b.to),photoSharedRoad:clean(b.photoSharedRoad),photoSharedAt:Number(b.photoSharedAt)||0,roadName:clean(b.roadName),roadStretch:b.roadStretch||null,sourceAttributes:b.sourceAttributes||{},
 vendor:clean(b.owner)||attr(b,'VENDOR')||'Not recorded',district:location.district||clean(b.district)||attr(b,'DISTRICT')||'Not recorded',
 village:location.village||clean(b.village)||attr(b,'VILLAGE','SHEHIA')||'Not recorded',road:attr(b,'ROAD (From - To)','ROAD','STREET')||clean(b.from)||'Not recorded',
 landmark:attr(b,'CLOSEST LANDMARK','LANDMARK'),visibility:attr(b,'VISIBILITY'),registration:clean(b.registrationNumber)||attr(b,'REGISTRATION NUMBER'),
 width:Number(b.width)||0,height:Number(b.height)||0,faces:Math.max(0,Number(b.faces)||0),installations:Math.max(0,Number(b.installations)||1),lat:b.lat,lng:b.lng,
 photoUrl:clean(b.photoUrl||b.photoOriginalUrl),photoOriginalUrl:clean(b.photoOriginalUrl||b.photoUrl),
 status:['flighted','expired'].includes(status)?(end&&Number(end)<now?'overdue':status):status,
 stage:schedule?.stage||(own?b.flightStage:'')||'',start:start||null,end:end||null,booked:booking.bookingStatus==='booked'};
}
export function reportLampPostRoutes(assets){
 const groups=new Map();
 for(const asset of assets||[]){
  if(asset.type!=='Lampposts')continue;
  const route=asset.routeKey?{key:asset.routeKey,label:asset.routeName||'Road not recorded',recorded:asset.routeRecorded!==false}:lamppostRoute({...asset,mediaType:'lamp-post'});
  if(!route)continue;
  const group=groups.get(route.key)||{key:route.key,name:route.label,recorded:route.recorded,assets:[]};
  group.assets.push(asset);groups.set(route.key,group);
 }
 return [...groups.values()].map(route=>{
  const photos=uniqueImageReferences(route.assets.filter(asset=>asset.photoUrl));
  const photoAsset=[...photos].sort((a,b)=>Number(b.photoSharedAt||0)-Number(a.photoSharedAt||0))[0]||null;
  const points=route.assets.filter(reportGps),vendors=[...new Set(route.assets.map(asset=>asset.vendor).filter(vendor=>vendor&&vendor!=='Not recorded'))];
  const districts=[...new Set(route.assets.map(asset=>asset.district).filter(area=>area&&area!=='Not recorded'))];
  const flighted=route.assets.filter(asset=>['flighted','expired','overdue'].includes(asset.status)).length;
  return {...route,poleCount:route.assets.length,faces:route.assets.reduce((sum,asset)=>sum+asset.faces,0),gpsCount:points.length,
   vendors,districts,flighted,notFlighted:route.assets.length-flighted,photos,photoAsset};
 }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
}
export function googleMapsRoute(route){
 const points=(route?.assets||[]).filter(reportGps);
 if(points.length){const lat=points.reduce((sum,b)=>sum+Number(b.lat),0)/points.length,lng=points.reduce((sum,b)=>sum+Number(b.lng),0)/points.length;return `https://www.google.com/maps/@?api=1&map_action=map&center=${encodeURIComponent(`${lat.toFixed(6)},${lng.toFixed(6)}`)}&zoom=16&basemap=satellite`;}
 const query=[route?.name,...(route?.districts||[])].filter(Boolean).join(', ');
 return query?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`:'';
}
export function reportSummary(assets){return REPORT_TYPES.map(type=>{const rows=assets.filter(b=>b.type===type);return {type,assets:rows.length,faces:rows.reduce((n,b)=>n+b.faces,0),booked:rows.filter(b=>b.booked).length,production:rows.filter(b=>['design','printing','production'].includes(b.stage)&&!['flighted','expired','overdue'].includes(b.status)).length,flighted:rows.filter(b=>['flighted','expired','overdue'].includes(b.status)).length};}).filter(r=>r.assets);}
export function reportSettings(input={}){
 const title=clean(input.title),subtitle=clean(input.subtitle),cover=clean(input.cover);
 if(title.length>160||subtitle.length>240)throw new Error('Use a title up to 160 characters and subtitle up to 240.');
 if(cover&&(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(cover)||cover.length>1800000))throw new Error('Upload a JPG, PNG or WebP cover under 1.3 MB after resizing.');
 return {title,subtitle,cover,palette:Object.hasOwn(REPORT_PALETTES,input.palette)?input.palette:'navy',evidence:input.evidence!==false,includeFabricatedBanners:input.includeFabricatedBanners!==false};
}
export function imageSource(value){try{if(/^data:image\/(png|jpeg|webp);base64,/.test(value))return value;const u=new URL(value,typeof location==='undefined'?'https://spotlight.co.tz':location.origin);if(!['https:','http:'].includes(u.protocol))return '';if(['drive.google.com','docs.google.com'].includes(u.hostname)){const id=u.searchParams.get('id')||u.pathname.match(/\/d\/([^/]+)/)?.[1];if(id)return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;}return u.href;}catch{return '';}}
