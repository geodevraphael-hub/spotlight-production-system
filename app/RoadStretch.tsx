"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X,Undo2,MapPin,Check} from 'lucide-react';
import {roadPreview} from './campaign-road.mjs';
import './campaign-tools.css';
export default function RoadStretch({projectId,projectName,center,onClose,onSaved}:any){
 const dialog=useRef<HTMLDialogElement>(null),node=useRef<HTMLDivElement>(null),map=useRef<any>(null),layers=useRef<any>(null),leaflet=useRef<any>(null);
 const [anchors,setAnchors]=useState<any[]>([]),[count,setCount]=useState(10),[name,setName]=useState(''),[vendor,setVendor]=useState(''),[area,setArea]=useState(''),[faces,setFaces]=useState(2),[width,setWidth]=useState(''),[height,setHeight]=useState('');
 const [lat,setLat]=useState(''),[lng,setLng]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[ready,setReady]=useState(false),[requestId]=useState(()=>crypto.randomUUID());
 const locked=useRef(false),closeButton=useRef<HTMLButtonElement>(null);
 let preview:any=null,previewError='';try{if(anchors.length>=2)preview=roadPreview(anchors,count);}catch(e:any){previewError=e.message;}
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();closeButton.current?.focus();return()=>{dialog.current?.close();previous?.focus();};},[]);
 useEffect(()=>{let disposed=false;const element=node.current;
  import('leaflet').then(L=>{if(disposed||!element)return;leaflet.current=L;const m=L.map(element,{zoomControl:true,doubleClickZoom:false}).setView(center&&Number.isFinite(center.lat)?[center.lat,center.lng]:[-6.16,39.2],14);map.current=m;
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(m);layers.current=L.layerGroup().addTo(m);
   m.on('click',(e:any)=>{if(locked.current)return;setAnchors(a=>a.length<50?[...a,{lat:Number(e.latlng.lat.toFixed(7)),lng:Number(e.latlng.lng.toFixed(7))}]:a);});
   m.invalidateSize();setReady(true);
  }).catch(()=>setError('Map could not load. Reopen the mapper or enter coordinates manually.'));
  return()=>{disposed=true;map.current?.remove();map.current=null;};
 },[]);
 useEffect(()=>{setConfirmed(false);},[anchors,count,name,vendor,area,faces,width,height]);
 useEffect(()=>{if(!ready)return;const L=leaflet.current,group=layers.current;group.clearLayers();if(anchors.length>1)L.polyline(anchors.map(p=>[p.lat,p.lng]),{color:'#087f63',weight:3}).addTo(group);
  preview?.points.forEach((p:any,i:number)=>L.circleMarker([p.lat,p.lng],{radius:5,color:'#a77b35',fillColor:'#fff',fillOpacity:1,weight:2,dashArray:'3 2'}).bindTooltip(`Estimated pole ${i+1} · ${p.chainage} m`).addTo(group));
  anchors.forEach((p,i)=>L.circleMarker([p.lat,p.lng],{radius:7,color:'#087f63',fillColor:'#087f63',fillOpacity:1}).bindTooltip(`Road point ${i+1}`).addTo(group));
 },[anchors,count,ready]);
 function addCoordinate(){const a=Number(lat),b=Number(lng);if(!lat.trim()||!lng.trim()||!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>85||Math.abs(b)>180){setError('Enter valid latitude and longitude.');return;}setError('');setAnchors(v=>[...v,{lat:a,lng:b}]);setLat('');setLng('');map.current?.panTo([a,b]);}
 async function save(){if(!preview||!confirmed||busy)return;locked.current=true;setBusy(true);setError('');try{const r=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save-road',requestId,projectId,name,vendor,area,anchors,count,faces,width:Number(width),height:Number(height),confirmed})});const d=await r.json();if(!r.ok)throw Error(d.error);onSaved(d);}catch(e:any){setError(e.message);}finally{locked.current=false;setBusy(false);}}
 return createPortal(<dialog ref={dialog} className="road-dialog" aria-labelledby="road-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header><div><h2 id="road-title">Map a lamp-post road stretch</h2><p>{projectName} · One inventory record per pole</p></div><button ref={closeButton} disabled={busy} aria-label="Close road mapper" onClick={onClose}><X size={22}/></button></header>
  <div className="road-body"><section className="road-settings"><fieldset disabled={busy}><legend>Road & structure</legend>
   <label>Road name<input autoComplete="off" value={name} maxLength={160} onChange={e=>setName(e.target.value)} placeholder="e.g. Airport Road"/></label>
   <div className="ct-fields"><label>Vendor (optional)<input value={vendor} maxLength={160} onChange={e=>setVendor(e.target.value)}/></label><label>Area (optional)<input value={area} maxLength={160} onChange={e=>setArea(e.target.value)}/></label></div>
   <div className="ct-fields"><label>Known number of poles<input type="number" min={2} max={200} value={count} onChange={e=>setCount(Number(e.target.value))}/></label><label>Faces per pole<input type="number" min={1} max={8} value={faces} onChange={e=>setFaces(Number(e.target.value))}/></label><label>Width (m, optional)<input type="number" min={0} max={100} step="any" value={width} onChange={e=>setWidth(e.target.value)}/></label><label>Height (m, optional)<input type="number" min={0} max={100} step="any" value={height} onChange={e=>setHeight(e.target.value)}/></label></div>
   <h3>Mark the road in order</h3><p className="ct-help">Click the first pole, each bend, then the last pole. Follow one side of the road per stretch. The pole count includes both endpoints.</p>
   <div className="road-coordinate-input"><label>Latitude<input value={lat} inputMode="decimal" onChange={e=>setLat(e.target.value)}/></label><label>Longitude<input value={lng} inputMode="decimal" onChange={e=>setLng(e.target.value)}/></label><button type="button" disabled={anchors.length>=50} aria-label="Add road coordinate" onClick={addCoordinate}><PlusIcon/></button></div>
   <div className="campaign-actions"><button type="button" disabled={!anchors.length} onClick={()=>setAnchors(a=>a.slice(0,-1))}><Undo2 size={15}/>Undo last point</button><button type="button" disabled={!anchors.length} onClick={()=>setAnchors([])}>Clear road</button></div>
   <ol className="road-points">{anchors.map((p,i)=><li key={i}><span>{i===0?'Start':i===anchors.length-1?'End':'Bend'} {i+1}</span><span>{p.lat.toFixed(6)}, {p.lng.toFixed(6)}</span></li>)}</ol>
  </fieldset></section><section className="road-preview"><div className="road-map" ref={node} aria-label="Click map to mark road points"/>
   <div className="road-preview-caption"><span><i className="road-anchor-dot"/>Road points</span><span><i className="road-pole-dot"/>Estimated poles</span><button disabled={!ready||anchors.length<2} onClick={()=>map.current.fitBounds(anchors.map(p=>[p.lat,p.lng]),{padding:[30,30],maxZoom:18})}>Fit road</button></div>
   <div className="road-review" aria-live="polite">{preview?<><strong>{preview.points.length} poles · {(preview.length/1000).toFixed(2)} km · approximately {preview.spacing.toFixed(1)} m apart</strong><p>Positions follow your drawn line at equal spacing. This does not snap to roads or locate actual poles. Check bends and count; field GPS validation is still required.</p></>:<p>{previewError||'Mark at least two road points to preview the estimated poles.'}</p>}</div>
  </section></div>
  <footer>{error&&<p role="alert" className="ct-alert">{error}</p>}<label className="road-confirm"><input type="checkbox" checked={confirmed} disabled={!preview||busy} onChange={e=>setConfirmed(e.target.checked)}/>I checked the road and pole count. Save these as estimated locations requiring field verification.</label><div className="campaign-actions"><button disabled={busy} onClick={onClose}>Cancel</button><button className="ct-primary" disabled={!preview||!confirmed||!name.trim()||busy} onClick={save}><Check size={16}/>{busy?'Saving poles…':`Add ${preview?.points.length||0} poles to project`}</button></div></footer>
 </dialog>,document.body);
}
function PlusIcon(){return <MapPin size={17}/>;}
