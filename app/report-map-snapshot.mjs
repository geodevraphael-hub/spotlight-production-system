import {reportGps} from './report-model.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function settleTiles(layer,container){
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);layer.off('load',loaded);error?reject(error):resolve();};
  const loaded=()=>setTimeout(()=>finish(),120);
  const timer=setTimeout(()=>{
   const visible=[...container.querySelectorAll('img.leaflet-tile')].filter(tile=>{const box=tile.getBoundingClientRect(),host=container.getBoundingClientRect();return box.right>host.left&&box.left<host.right&&box.bottom>host.top&&box.top<host.bottom;});
   visible.length&&visible.every(tile=>tile.complete&&tile.naturalWidth)?finish():finish(new Error('Map tiles did not finish loading. Check the connection and retry.'));
  },10000);
  layer.once('load',loaded);
  setTimeout(()=>{if(!layer.isLoading?.())loaded();},500);
 });
}

function snapshot(L,map,container,b){
 const bounds=container.getBoundingClientRect(),scale=1.5,canvas=document.createElement('canvas');
 canvas.width=Math.round(bounds.width*scale);canvas.height=Math.round(bounds.height*scale);
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not create a billboard map image.');
 ctx.scale(scale,scale);ctx.fillStyle='#eef2f1';ctx.fillRect(0,0,bounds.width,bounds.height);
 const tiles=[...container.querySelectorAll('img.leaflet-tile')].filter(tile=>{const r=tile.getBoundingClientRect();return r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom;});
 if(!tiles.length||tiles.some(tile=>!tile.complete||!tile.naturalWidth))throw new Error(`Map tiles are incomplete for ${b.name}. Retry the report export.`);
 tiles.forEach(tile=>{const r=tile.getBoundingClientRect();ctx.drawImage(tile,r.left-bounds.left,r.top-bounds.top,r.width,r.height);});
 const point=map.latLngToContainerPoint([Number(b.lat),Number(b.lng)]);
 ctx.beginPath();ctx.arc(point.x,point.y,10,0,Math.PI*2);ctx.fillStyle='#00866A';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();
 ctx.beginPath();ctx.arc(point.x,point.y,15,0,Math.PI*2);ctx.lineWidth=1.5;ctx.strokeStyle='#00866A';ctx.stroke();
 ctx.fillStyle='#173D35';ctx.textBaseline='top';ctx.font='bold 11px Arial';ctx.fillText(`${Number(b.lat).toFixed(6)}, ${Number(b.lng).toFixed(6)}`,10,9);
 ctx.fillStyle='rgba(255,255,255,.94)';ctx.fillRect(0,bounds.height-19,bounds.width,19);ctx.fillStyle='#243543';ctx.font='10px Arial';ctx.fillText('© OpenStreetMap contributors · Individual billboard location',8,bounds.height-5);
 return canvas.toDataURL('image/png');
}

function routeSnapshot(map,container,route){
 const bounds=container.getBoundingClientRect(),scale=1.5,canvas=document.createElement('canvas');
 canvas.width=Math.round(bounds.width*scale);canvas.height=Math.round(bounds.height*scale);
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not create a route map image.');
 ctx.scale(scale,scale);ctx.fillStyle='#eef2f1';ctx.fillRect(0,0,bounds.width,bounds.height);
 const tiles=[...container.querySelectorAll('img.leaflet-tile')].filter(tile=>{const r=tile.getBoundingClientRect();return r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom;});
 if(!tiles.length||tiles.some(tile=>!tile.complete||!tile.naturalWidth))throw new Error(`Map tiles are incomplete for ${route.name}. Retry the report export.`);
 tiles.forEach(tile=>{const r=tile.getBoundingClientRect();ctx.drawImage(tile,r.left-bounds.left,r.top-bounds.top,r.width,r.height);});
 const points=route.assets.filter(reportGps);
 for(const asset of points){const point=map.latLngToContainerPoint([Number(asset.lat),Number(asset.lng)]);ctx.beginPath();ctx.arc(point.x,point.y,points.length>100?3:5,0,Math.PI*2);ctx.fillStyle='#087f63';ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='#fff';ctx.stroke();}
 ctx.fillStyle='rgba(255,255,255,.95)';ctx.fillRect(8,8,Math.min(bounds.width-16,Math.max(180,route.name.length*7+36)),36);
 ctx.fillStyle='#173d35';ctx.textBaseline='middle';ctx.font='bold 13px Arial';ctx.fillText(route.name,16,20,Math.max(100,bounds.width-32));
 ctx.font='11px Arial';ctx.fillText(`${points.length} lamp-post locations`,16,34,Math.max(100,bounds.width-32));
 ctx.fillStyle='rgba(255,255,255,.95)';ctx.fillRect(0,bounds.height-19,bounds.width,19);ctx.fillStyle='#243543';ctx.font='10px Arial';ctx.fillText('© OpenStreetMap contributors · Route locations',8,bounds.height-5);
 return canvas.toDataURL('image/png');
}

/** Capture a separate, GPS-centered map inset for every geotagged billboard. */
export async function captureReportMaps(assets,onProgress=()=>{}){
 const points=assets.filter(reportGps),images={};if(!points.length)return images;
 const host=document.createElement('div');host.setAttribute('aria-hidden','true');host.style.cssText='position:fixed;left:-10000px;top:0;width:440px;height:190px;overflow:hidden;pointer-events:none;';document.body.appendChild(host);
 let map;
 try{
  const imported=await import('leaflet'),L=imported.default||imported;
  map=L.map(host,{zoomControl:false,attributionControl:false,fadeAnimation:false,zoomAnimation:false,markerZoomAnimation:false});
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{crossOrigin:'anonymous',maxZoom:19,updateWhenIdle:true});tiles.addTo(map);
  for(let i=0;i<points.length;i++){
   const b=points[i];onProgress(`Capturing individual map ${i+1} / ${points.length}: ${b.name}`);
   const ready=settleTiles(tiles,host);map.setView([Number(b.lat),Number(b.lng)],16,{animate:false});map.invalidateSize({pan:false,animate:false});
   await ready;await wait(120);images[b.inventoryDbId]=snapshot(L,map,host,b);
  }
  return images;
 }finally{map?.remove();host.remove();}
}

/** Capture one bounded map with all GPS positions for each lamp-post route. */
export async function captureReportRouteMaps(routes,onProgress=()=>{}){
 const groups=(routes||[]).filter(route=>route.assets?.some(reportGps)),images={};if(!groups.length)return images;
 const host=document.createElement('div');host.setAttribute('aria-hidden','true');host.style.cssText='position:fixed;left:-10000px;top:0;width:440px;height:280px;overflow:hidden;pointer-events:none;';document.body.appendChild(host);
 let map;
 try{
  const imported=await import('leaflet'),L=imported.default||imported;
  map=L.map(host,{zoomControl:false,attributionControl:false,fadeAnimation:false,zoomAnimation:false,markerZoomAnimation:false});
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{crossOrigin:'anonymous',maxZoom:19,updateWhenIdle:true});tiles.addTo(map);
  for(let i=0;i<groups.length;i++){
   const route=groups[i],points=route.assets.filter(reportGps);onProgress(`Capturing route map ${i+1} / ${groups.length}: ${route.name}`);
   const ready=settleTiles(tiles,host);
   if(points.length===1)map.setView([Number(points[0].lat),Number(points[0].lng)],17,{animate:false});
   else map.fitBounds(L.latLngBounds(points.map(b=>[Number(b.lat),Number(b.lng)])),{padding:[28,28],maxZoom:17,animate:false});
   map.invalidateSize({pan:false,animate:false});await ready;await wait(120);images[route.key]=routeSnapshot(map,host,route);
  }
  return images;
 }finally{map?.remove();host.remove();}
}
