import {REPORT_PALETTES,REPORT_TYPES,reportSummary,reportGps,reportLampPostRoutes,googleMapsRoute} from './report-model.mjs';
export const RW=1440,RH=810;
export const reportDate=value=>value?new Date(value).toLocaleDateString('en-GB',{timeZone:'Africa/Nairobi',day:'2-digit',month:'short',year:'numeric'}):'Not recorded';
export function googleMapsLocation(b){if(reportGps(b)){const center=`${Number(b.lat).toFixed(6)},${Number(b.lng).toFixed(6)}`;return `https://www.google.com/maps/@?api=1&map_action=map&center=${encodeURIComponent(center)}&zoom=19&basemap=satellite`;}const query=[b.name,b.road,b.village,b.district].filter(v=>v&&v!=='Not recorded').join(', ');return query?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`:'';}
// One shared layout model drives the preview, editable PowerPoint and vector PDF.
export function reportScenes(workspace,settings,media={}){
 const p=REPORT_PALETTES[settings.palette]||REPORT_PALETTES.navy,assets=workspace.assets.filter(b=>settings.includeFabricatedBanners!==false||b.type!=='Fabricated banners'),slides=[];
 const rect=(x,y,w,h,fill)=>({kind:'rect',x,y,w,h,fill});
 const text=(value,x,y,w,h,size=24,color=p.ink,bold=false,link)=>({kind:'text',text:String(value),x,y,w,h,size,color,bold,link});
 const image=(data,x,y,w,h,fit='contain',link)=>({kind:'image',data,x,y,w,h,fit,link});
 const base=(name,title,eyebrow='VISIBILITY REPORT')=>{const s={name,elements:[rect(0,0,RW,RH,'#FFFFFF'),rect(56,51,42,5,p.accent),text(eyebrow,112,37,1250,28,16,p.accent,true),text(title,56,91,1328,84,42,p.ink,true),rect(56,751,1328,1,'#DCE3E8'),text(workspace.project.name,56,768,880,24,15),text(`${reportDate(workspace.generatedAt)} · ${slides.length+1}`,1030,768,354,24,15)]};slides.push(s);return s.elements;};
 let el=base('Cover',settings.title);el.splice(0,el.length,rect(0,0,RW,RH,p.ink),rect(56,60,56,6,p.accent),text('SPOTLIGHT / OUTDOOR VISIBILITY',56,90,610,40,19,'#FFFFFF',true),text(settings.title,56,200,630,275,48,'#FFFFFF',true),text(settings.subtitle||workspace.campaign?.name||workspace.project.name,56,505,630,100,26,'#FFFFFF'),text(`${reportDate(workspace.generatedAt)} · ${assets.length} assets`,56,710,630,40,20,'#FFFFFF'));
 if(settings.cover)el.push(image(settings.cover,740,0,700,810,'cover'));else el.push(rect(740,0,700,810,p.paper),text('OUTDOOR\nVISIBILITY\nREPORT',800,310,580,230,48,p.ink,true),rect(800,580,100,8,p.accent));
 el=base('Summary','Placement summary');
 const summary=reportSummary(assets),total={type:'TOTAL',...Object.fromEntries(['assets','faces','booked','production','flighted'].map(k=>[k,summary.reduce((n,r)=>n+r[k],0)]))};
 const columns=[['Media type',390],['Assets',145],['Faces',145],['Booked',145],['In production',190],['Flighted*',145],['Flighted %',168]];
 const tableStart=el.length;
 slides.at(-1).table={columns,rows:[...summary,total].map(r=>[r.type,r.assets,r.faces,r.booked,r.production,r.flighted,`${r.assets?Math.round(r.flighted/r.assets*100):0}%`]),ink:p.ink,paper:p.paper};
 let x=56;for(const [label,w]of columns){el.push(rect(x,210,w,52,p.ink),text(label,x+14,223,w-28,30,19,'#FFFFFF',true));x+=w;}
 [...summary,total].forEach((r,i)=>{let left=56;const values=[r.type,r.assets,r.faces,r.booked,r.production,r.flighted,`${r.assets?Math.round(r.flighted/r.assets*100):0}%`];columns.forEach(([,w],j)=>{el.push(rect(left,262+i*57,w,57,r.type==='TOTAL'?p.paper:i%2?'#F7F9FA':'#FFFFFF'),text(values[j],left+14,277+i*57,w-28,32,22,p.ink,r.type==='TOTAL'));left+=w;});});
 el.slice(tableStart).forEach(e=>e.tablePart=true);
 el.push(text('*Flighted includes overdue assets until deflighted. Percentage = flighted ÷ included assets. Booked reflects current physical availability.',56,650,1328,50,18),text(`Snapshot: ${reportDate(workspace.generatedAt)}${workspace.campaign?` · Campaign: ${workspace.campaign.starts_on} to ${workspace.campaign.ends_on}`:''}`,56,706,1328,28,18));
 el=base('Location notes','Location notes','REPORT READING GUIDE');
 el.push(text(`${assets.filter(reportGps).length} of ${assets.length} included assets have verified coordinates.`,56,220,1240,70,30,p.ink,true));
 el.push(text('Billboards and digital screens keep individual pages with their own location map and satellite QR. Lamp posts are grouped by road route: one route page shows its shared photo, pole total and route-wide location map.',56,325,1220,160,27));
 if(!assets.every(reportGps))el.push(text(`${assets.filter(b=>!reportGps(b)).length} assets have no valid GPS. Their page or route summary identifies this clearly and provides a location-search link where possible.`,56,520,1220,115,23,p.accent,true));
 for(const type of REPORT_TYPES){const group=assets.filter(b=>b.type===type);if(!group.length)continue;
 const routes=type==='Lampposts'?reportLampPostRoutes(group):[];
 el=base(type,type,'MEDIA INVENTORY');
 el.push(text(type==='Lampposts'?`${group.length} lamp posts · ${routes.length} road routes · ${group.reduce((n,b)=>n+b.faces,0)} faces`:`${group.length} assets · ${group.reduce((n,b)=>n+b.faces,0)} faces`,56,280,1150,80,38),rect(56,411,120,8,p.accent),text(type==='Lampposts'?'Shared route evidence & pole totals':'Location evidence & delivery status',56,473,1180,55,28));
 if(type==='Lampposts'){
  for(const route of routes){
   el=base(route.name,route.name,'LAMP-POST ROUTE');slides.at(-1).routeKey=route.key;slides.at(-1).inventoryDbIds=route.assets.map(b=>b.inventoryDbId);
   const photo=settings.evidence&&route.photoAsset?media.photos?.[route.photoAsset.inventoryDbId]:'';
   const mapImage=media.routeMaps?.[route.key],mapLink=googleMapsRoute(route),routeQr=media.routeQrs?.[route.key];
   el.push(text(`ROUTE PHOTO${route.photos.length>1?` · ${route.photos.length} DISTINCT IMAGES`:' · SHARED BY THIS ROUTE'}`,56,174,630,18,12,p.accent,true));
   if(photo)el.push(image(photo,56,198,630,426,'cover',route.photoAsset?.photoOriginalUrl?.startsWith('http')?route.photoAsset.photoOriginalUrl:undefined));
   else el.push(rect(56,198,630,426,p.paper),text(settings.evidence?'No route photo recorded':'Route photo omitted by report settings',95,380,552,70,22,p.ink,true));
   el.push(text(`ROUTE MAP · ${route.gpsCount} OF ${route.poleCount} POLES WITH GPS`,720,174,664,18,12,p.accent,true));
   if(mapImage)el.push(image(mapImage,720,198,664,426,'cover',mapLink));
   else el.push(rect(720,198,664,426,p.paper),text(route.gpsCount?'Route map is ready when the report is prepared':'No GPS locations recorded for this route',760,380,584,65,22,p.ink,true));
   const metrics=[['Lamp posts',route.poleCount],['Total faces',route.faces],['GPS positions',`${route.gpsCount} / ${route.poleCount}`],['Flighted',`${route.flighted} · ${route.notFlighted} not flighted`]];
   metrics.forEach(([label,value],i)=>{const x=56+i*292;el.push(text(String(label).toUpperCase(),x,649,270,18,12,p.accent,true),text(value,x,671,270,30,22,p.ink,true));});
   if(route.vendors.length)el.push(text(`Vendor${route.vendors.length>1?'s':''}: ${route.vendors.join(', ')}`,56,713,840,24,15,p.ink));
   if(route.recorded===false)el.push(text('Road name not recorded in inventory; grouped by area.',56,733,840,18,11,p.accent,true));
   if(routeQr)el.push(image(routeQr,1306,654,68,68,'contain',mapLink));
   if(mapLink)el.push(text('Open route area in satellite view ↗',910,721,380,22,12,p.accent,true,mapLink));
  }
  continue;
 }
 for(const b of group){el=base(b.name,b.name,type.toUpperCase());slides.at(-1).inventoryDbId=b.inventoryDbId;const photo=settings.evidence?media.photos?.[b.inventoryDbId]:'';const mapImage=media.assetMaps?.[b.inventoryDbId];if(photo)el.push(image(photo,56,199,850,510,'contain',b.photoOriginalUrl?.startsWith('http')?b.photoOriginalUrl:undefined));else{el.push(text('INDIVIDUAL LOCATION MAP',56,174,850,18,12,p.accent,true));if(mapImage)el.push(image(mapImage,56,199,850,510,'cover',googleMapsLocation(b)));else{el.push(rect(56,199,850,510,p.paper),text(settings.evidence?(b.photoUrl?'Photo unavailable · map shown when GPS is available':'No photo recorded · map shown when GPS is available'):'Photo omitted · individual map',180,420,650,90,25));}}
 const fields=[['Vendor',b.vendor],['Location',`${b.district} · ${b.village}`],['Road',b.road],['Closest landmark',b.landmark||'Not recorded'],['Visibility',b.visibility||'Not recorded'],['Dimension / faces',`${b.width||'—'} × ${b.height||'—'} m · ${b.faces} faces`],['Flight status',`${b.status}${b.end?` · Ends ${reportDate(b.end)}`:''}`],['GPS',reportGps(b)?`${Number(b.lat).toFixed(6)}, ${Number(b.lng).toFixed(6)}`:'Not recorded']];
 fields.forEach(([label,value],i)=>el.push(text(label.toUpperCase(),936,192+i*48,448,18,13,p.accent,true),text(value,936,211+i*48,448,34,18,p.ink)));
 const mapLink=googleMapsLocation(b);
 if(photo){el.push(text('INDIVIDUAL LOCATION MAP',936,596,332,18,12,p.accent,true));if(mapImage)el.push(image(mapImage,936,616,332,120,'cover',mapLink));else el.push(rect(936,616,332,120,p.paper),text(reportGps(b)?'Map inset not captured':'GPS not recorded · scan to search address',950,657,304,40,15,p.ink,true));}
 if(mapLink){const assetQr=media.assetQrs?.[b.inventoryDbId];el.push(text(reportGps(b)?'SATELLITE MAP QR':'LOCATION SEARCH QR',1284,596,100,18,10,p.accent,true));if(assetQr)el.push(image(assetQr,1292,616,88,88,'contain',mapLink));el.push(text(reportGps(b)?'Open satellite view ↗':'Search address ↗',1284,710,100,30,11,p.accent,true,mapLink));}
 if(b.photoOriginalUrl?.startsWith('http'))el.push(text('Open original photo ↗',56,717,340,24,16,p.accent,true,b.photoOriginalUrl));
 }
 }
 el=base('Thank you','Thank You');el.push(text('Thank you for your continued partnership.',56,228,1100,95,38,p.ink,true),text('Billboards and digital screens have individual location pages; lamp-post locations are summarized by road route with pole totals.',56,370,1220,105,27),text('This report is a dated project snapshot. QR codes open the corresponding asset or route area in Google Maps satellite view.',56,520,1220,90,22));
 return slides;
}
export function textLines(value,width,size){const result=[];for(const paragraph of String(value).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if((line.length+word.length+1)*size*.53>width&&line){result.push(line);line=word;}else line+=(line?' ':'')+word;}result.push(line);}return result;}
