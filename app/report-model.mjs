export const REPORT_PALETTES={navy:{name:'Navy & emerald',ink:'#10263D',accent:'#00866A',paper:'#F1F5F6'},forest:{name:'Forest & gold',ink:'#173D35',accent:'#A37014',paper:'#F6F5EF'},slate:{name:'Slate & blue',ink:'#263547',accent:'#2466AF',paper:'#F2F5FA'}};
export const REPORT_TYPES=['Large format','Digital screens','Lampposts','Fabricated banners','Other'];
const clean=v=>String(v??'').trim();
export function reportType(value){const s=clean(value).toLowerCase().replace(/[^a-z]/g,'');return /lamp|lightpost/.test(s)?'Lampposts':/digital|screen|led/.test(s)?'Digital screens':/fabricat|banner/.test(s)?'Fabricated banners':/large|billboard/.test(s)?'Large format':'Other';}
export function reportGps(b){return b.lat!==null&&b.lng!==null&&b.lat!==''&&b.lng!==''&&Number.isFinite(Number(b.lat))&&Number.isFinite(Number(b.lng))&&Math.abs(Number(b.lat))<=90&&Math.abs(Number(b.lng))<=180&&!(Number(b.lat)===0&&Number(b.lng)===0);}
export function attr(b,...keys){const entries=Object.entries(b.sourceAttributes||{});for(const key of keys){const match=entries.find(([k])=>k.toLowerCase().replace(/[^a-z0-9]/g,'')===key.toLowerCase().replace(/[^a-z0-9]/g,''));if(clean(match?.[1]))return clean(match[1]);}return '';}
export function reportAsset(b,schedule,booking={},projectId,now=Date.now()){
 const own=Number(b.projectId||1)===projectId,geo=b.locationAddress;
 const location=geo&&Number(geo.lat)===Number(b.lat)&&Number(geo.lng)===Number(b.lng)?geo:{};
 const status=schedule?.flight_status||(own?b.flightStatus:'unflighted')||'unflighted';
 const start=schedule?.start_at??(own?b.flightStart:null),end=schedule?.end_at??(own?b.flightExpiry:null);
 return {inventoryDbId:b.inventoryDbId,id:b.id,name:attr(b,'SPECIFIC LOCATION')||clean(b.street)||clean(b.owner)||`Asset ${b.id}`,
 type:reportType(b.mediaType),vendor:clean(b.owner)||attr(b,'VENDOR')||'Not recorded',district:location.district||clean(b.district)||attr(b,'DISTRICT')||'Not recorded',
 village:location.village||clean(b.village)||attr(b,'VILLAGE','SHEHIA')||'Not recorded',road:attr(b,'ROAD (From - To)','ROAD','STREET')||clean(b.from)||'Not recorded',
 landmark:attr(b,'CLOSEST LANDMARK','LANDMARK'),visibility:attr(b,'VISIBILITY'),registration:clean(b.registrationNumber)||attr(b,'REGISTRATION NUMBER'),
 width:Number(b.width)||0,height:Number(b.height)||0,faces:Math.max(0,Number(b.faces)||0),installations:Math.max(0,Number(b.installations)||1),lat:b.lat,lng:b.lng,
 photoUrl:clean(b.photoUrl||b.photoOriginalUrl),photoOriginalUrl:clean(b.photoOriginalUrl||b.photoUrl),
 status:['flighted','expired'].includes(status)?(end&&Number(end)<now?'overdue':status):status,
 stage:schedule?.stage||(own?b.flightStage:'')||'',start:start||null,end:end||null,booked:booking.bookingStatus==='booked'};
}
export function reportSummary(assets){return REPORT_TYPES.map(type=>{const rows=assets.filter(b=>b.type===type);return {type,assets:rows.length,faces:rows.reduce((n,b)=>n+b.faces,0),booked:rows.filter(b=>b.booked).length,production:rows.filter(b=>['design','printing','production'].includes(b.stage)&&!['flighted','expired','overdue'].includes(b.status)).length,flighted:rows.filter(b=>['flighted','expired','overdue'].includes(b.status)).length};}).filter(r=>r.assets);}
export function reportSettings(input={}){
 const title=clean(input.title),subtitle=clean(input.subtitle),cover=clean(input.cover);
 if(title.length>160||subtitle.length>240)throw new Error('Use a title up to 160 characters and subtitle up to 240.');
 if(cover&&(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(cover)||cover.length>1800000))throw new Error('Upload a JPG, PNG or WebP cover under 1.3 MB after resizing.');
 return {title,subtitle,cover,palette:Object.hasOwn(REPORT_PALETTES,input.palette)?input.palette:'navy',evidence:input.evidence!==false,includeFabricatedBanners:input.includeFabricatedBanners!==false};
}
export function imageSource(value){try{if(/^data:image\/(png|jpeg|webp);base64,/.test(value))return value;const u=new URL(value,typeof location==='undefined'?'https://spotlight.co.tz':location.origin);if(!['https:','http:'].includes(u.protocol))return '';if(['drive.google.com','docs.google.com'].includes(u.hostname)){const id=u.searchParams.get('id')||u.pathname.match(/\/d\/([^/]+)/)?.[1];if(id)return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;}return u.href;}catch{return '';}}
