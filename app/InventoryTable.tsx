"use client";
import {useEffect,useMemo,useState,useRef} from 'react';
import {Download,RefreshCw,Plus,FileUp,ArrowUpDown,X,Map,Table2,PanelsTopLeft,SlidersHorizontal} from 'lucide-react';
import {GEO_LEVELS,geographyOptions,changeGeography,inventoryGeography,inventoryCsv} from './inventory-workflow.mjs';
import {markerState} from './map-symbols.mjs';
const estimatedPole=(b:any)=>b?.mediaType==='lamp-post'&&b.positionSource==='estimated-road-stretch'&&b.positionVerified!==true;
import {PRIORITIES,assetPriority,registrationNumber} from './asset-register.mjs';
const label=(s:string)=>String(s??'').replaceAll('-',' ').replace(/^./,c=>c.toUpperCase());
function exportRows(items:any[],evidence:any){
 const url=URL.createObjectURL(new Blob([inventoryCsv(items,evidence,(b:any)=>b.centralStates?.join(' / ')||markerState(b))],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download='spotlight-inventory.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function InventoryControls({boards,rows,evidence,geo,onGeo,geoLoading,geoError,loading,error,query,onQuery,
 type,onType,status,onStatus,flight,onFlight,vendor,onVendor,priority='',onPriority,onRefresh,onReset,
 onAdd,onRoad,onImport,onTemplate,canManage,isAdmin,projectFilter,onProject,projectNames,view,onView,message,central=false}:any){
 const [expanded,setExpanded]=useState(false);
 const vendors=[...new Set(boards.map((b:any)=>b.owner).filter(Boolean))].sort() as string[];
 const ready=boards.filter((b:any)=>inventoryGeography(b,evidence).ready).length;
 const active=Object.values(geo).filter(Boolean).length+Number(Boolean(query))+Number(type!=='All types')+Number(Boolean(vendor))+Number(Boolean(priority))+Number(status!=='All status')+Number(flight!=='All flight status')+Number(projectFilter!=='All projects');
 function areaSelect(key:string,title:string){return <label key={key}>{title}<select aria-label={`Inventory ${title}`} disabled={geoLoading} value={geo[key]} onChange={e=>onGeo(changeGeography(geo,key,e.target.value))}><option value="">All {title.toLowerCase()}</option><option value="__missing__">Not available / stale</option>{geographyOptions(boards,evidence,geo,key).map((o:any)=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;}
 return <section className="inventory-controls" aria-label="Inventory controls">
  <header className="inventory-register-head">
   <div className="inventory-title"><h1>{central?'All-project map':'Inventory'}</h1><span>{loading?'Loading…':`${rows.length} of ${boards.length} billboards`}</span></div>
   <div className="inventory-view-switch" role="group" aria-label="Inventory view">
    {[['split','Split',PanelsTopLeft],['map','Map',Map],['table','Table',Table2]].map(([value,title,Icon]:any)=><button key={value} aria-pressed={view===value} onClick={()=>onView(value)}><Icon size={15}/>{title}</button>)}
   </div>
   <div className="inventory-actions">
    <button disabled={loading} onClick={onRefresh} aria-label="Refresh inventory" title="Refresh inventory"><RefreshCw size={15}/></button>
    <button disabled={!rows.length||loading} onClick={()=>exportRows(rows,evidence)}><Download size={15}/>Export</button>
    {canManage&&<button className="primary-button" onClick={onAdd}><Plus size={15}/>Add billboard</button>}
    {canManage&&onRoad&&<button onClick={onRoad}><Map size={15}/>Map lamp-post stretch</button>}
    {canManage&&isAdmin&&<label className="inventory-file-button"><FileUp size={15}/>Import<input aria-label="Import CSV or KML" type="file" accept=".csv,.kml" onChange={e=>{const file=e.target.files?.[0];if(file)onImport(file);e.target.value='';}}/></label>}
   </div>
  </header>
  <div className="inventory-quick-filters">
   <label className="inventory-search">Search<input aria-label="Search inventory table" value={query} onChange={e=>onQuery(e.target.value)} placeholder="Name, vendor or location"/></label>
   {central?<><label>Board type<select aria-label="Central board type" value={type} onChange={e=>onType(e.target.value)}><option>All types</option>{['large-format','digital-screen','lamp-post','fabricated-banner'].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
    <label>Flight status<select aria-label="Central flight status" value={flight} onChange={e=>onFlight(e.target.value)}><option>All flight status</option>{['flighted','unflighted','expired','deflighted'].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
    {areaSelect('region','Region')}</>:GEO_LEVELS.filter(([key])=>key!=='council').map(([key,title])=>areaSelect(key,title))}
   <button aria-expanded={expanded} aria-controls="inventory-more-filters" onClick={()=>setExpanded(!expanded)}><SlidersHorizontal size={15}/>Filters{active>0?` (${active})`:''}</button>
   {active>0&&<button onClick={onReset} title="Clear all filters" aria-label="Clear all inventory filters"><X size={15}/></button>}
  </div>
  {expanded&&<div className="inventory-filter-popover" id="inventory-more-filters" onKeyDown={e=>{if(e.key==='Escape')setExpanded(false);}}>
   <header><strong>{central?'Location & inventory filters':'Refine inventory'}</strong><button aria-label="Close inventory filters" onClick={()=>setExpanded(false)}><X size={17}/></button></header>
   <div className="inventory-filters">
    {projectNames&&<label>Project<select aria-label="Inventory project filter" value={projectFilter} onChange={e=>onProject(e.target.value)}><option>All projects</option>{projectNames.map((p:string)=><option key={p}>{p}</option>)}</select></label>}
    <label>Board type<select value={type} onChange={e=>onType(e.target.value)}><option value="All types">All types</option>{['large-format','digital-screen','lamp-post','fabricated-banner'].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
    <label>Vendor<select value={vendor} onChange={e=>onVendor(e.target.value)}><option value="">All vendors</option>{vendors.map(v=><option key={v}>{v}</option>)}</select></label>
    <label>Priority<select value={priority} onChange={e=>onPriority(e.target.value)}><option value="">All priorities</option>{PRIORITIES.map(([v,title]:any)=><option key={v} value={v}>{title}</option>)}<option value="__missing__">Not assigned</option></select></label>
    <label>Inventory status<select value={status} onChange={e=>onStatus(e.target.value)}><option>All status</option><option value="selected">Selected</option><option value="not-selected">Not selected</option></select></label>
    <label>Flight status<select value={flight} onChange={e=>onFlight(e.target.value)}><option>All flight status</option>{['flighted','unflighted','expired','deflighted'].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label>
    {areaSelect('council','Council')}
    {central&&GEO_LEVELS.filter(([key])=>!['region','council'].includes(key)).map(([key,title])=>areaSelect(key,title))}
   </div>
   <p className="inventory-provenance">{geoLoading?'Loading location data…':`${ready} of ${boards.length} location records current. Location IQ / NBS 2022. Village populations are estimates, not measured audience.`}</p>
   <footer><button onClick={onReset}>Clear filters</button>{canManage&&isAdmin&&<button onClick={onTemplate}>Download import template</button>}<button className="primary-button" onClick={()=>setExpanded(false)}>Show {rows.length} billboards</button></footer>
  </div>}
  {(error||geoError)&&<p className="inventory-error" role="alert">{error||geoError} <button onClick={onRefresh}>Retry</button></p>}
  {message&&<p className="inventory-feedback" role="status">{message}</p>}
 </section>;
}
export default function InventoryTable({boards,rows,evidence,selected,onSelection,onOpen,onLocate,onReset,onAssign,onRemove,onBulkEdit,onVerifyGps,canManage,canAssign=canManage,loading,projectName,focusedId,focusRevision,central=false}:any){
 const [page,setPage]=useState(1),[size,setSize]=useState(25),[sort,setSort]=useState('street'),[direction,setDirection]=useState(1);
 const scrollRef=useRef<HTMLDivElement>(null);
 const signature=JSON.stringify([rows.map((b:any)=>b.id),sort,direction,size]);
 useEffect(()=>setPage(1),[signature]);
 const sorted=useMemo(()=>[...rows].sort((a,b)=>{
  const av=sort==='faces'?Number(a.faces):sort==='flight'?markerState(a):String(a[sort]??'');
  const bv=sort==='faces'?Number(b.faces):sort==='flight'?markerState(b):String(b[sort]??'');
  return direction*(typeof av==='number'?av-Number(bv):av.localeCompare(String(bv),undefined,{numeric:true}))||a.id-b.id;
 }),[rows,sort,direction]);
 useEffect(()=>{
  const index=sorted.findIndex((b:any)=>b.id===focusedId);
  if(index>=0)setPage(Math.floor(index/size)+1);
 },[focusedId,focusRevision,sorted,size]);
 const pages=Math.max(1,Math.ceil(sorted.length/size)),safePage=Math.min(page,pages),shown=sorted.slice((safePage-1)*size,safePage*size);
 useEffect(()=>{
  const frame=requestAnimationFrame(()=>{
   const container=scrollRef.current,row=container?.querySelector<HTMLElement>('tr[data-focused]');
   if(!container||!row)return;
   const header=container.querySelector('thead')?.getBoundingClientRect().height??40;
   const top=row.getBoundingClientRect().top-container.getBoundingClientRect().top+container.scrollTop;
   container.scrollTo({top:Math.max(0,top-header-8),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  });
  return()=>cancelAnimationFrame(frame);
 },[focusedId,focusRevision,safePage,sorted,size]);
 const selectedSet=new Set(selected),selectedRows=boards.filter((b:any)=>selectedSet.has(b.id));
 const allPage=shown.length>0&&shown.every((b:any)=>selectedSet.has(b.id));
 function toggle(ids:number[],add:boolean){onSelection(add?[...new Set([...selected,...ids])]:selected.filter((id:number)=>!ids.includes(id)));}
 function sortButton(key:string,title:string){return <button onClick={()=>{setDirection(sort===key?-direction:1);setSort(key);}}>{title}<ArrowUpDown size={12}/></button>;}
 return <section className="inventory-register" aria-label="Inventory register">
  <div className="inventory-selection"><span>{selectedRows.length} selected{selectedRows.some((b:any)=>!rows.some((r:any)=>r.id===b.id))?' (includes hidden results)':''}</span>
   {onVerifyGps&&selectedRows.some(estimatedPole)&&<button disabled={loading||selectedRows.filter(estimatedPole).length>200} onClick={onVerifyGps}>Assign GPS verification ({selectedRows.filter(estimatedPole).length} poles)</button>}
   <button disabled={!rows.length||loading} onClick={()=>toggle(rows.map((b:any)=>b.id),true)}>Select all {rows.length} filtered</button>
   {selectedRows.length>0&&<><button onClick={()=>onSelection([])}>Clear selection</button>{canManage&&<button disabled={loading||selectedRows.length>500} title={selectedRows.length>500?'Edit up to 500 billboards at once':undefined} onClick={onBulkEdit}>Edit selected</button>}<button onClick={()=>exportRows(selectedRows,evidence)}>Export selected</button>{canAssign&&<button disabled={loading||(central&&selectedRows.length>500)} onClick={onAssign}>Assign to project</button>}{onRemove&&<button disabled={loading||selectedRows.length>500} onClick={onRemove}>Remove from project</button>}</>}
   <small className="inventory-table-help">Click a row to locate · {central?'Details to inspect':'Details to edit'}</small>
  </div>
  <div ref={scrollRef} className="inventory-table-scroll" tabIndex={0} aria-label="Scrollable billboard inventory">
   <table><caption className="planner-sr-only">Filtered inventory. Row selection is separate from the uploaded inventory status.</caption><thead><tr>
    <th><input type="checkbox" aria-label="Select current page" checked={allPage} disabled={!shown.length||loading} onChange={e=>toggle(shown.map((b:any)=>b.id),e.target.checked)}/></th>
    <th aria-sort={sort==='street'?(direction===1?'ascending':'descending'):'none'}>{sortButton('street','Billboard')}</th>
    <th>{sortButton('mediaType','Type')}</th><th>{sortButton('owner','Vendor')}</th>
    <th>Region / district</th><th>Council / ward</th><th>Village</th>
    <th>{sortButton('faces','Faces')}</th><th>Dimension</th><th>Priority</th><th>Booking · today</th><th>Planning selection</th><th>{sortButton('flight','Flight status')}</th><th>Photo</th>
   </tr></thead><tbody>
    {loading?<tr><td colSpan={12}>Loading inventory…</td></tr>:!shown.length?<tr><td colSpan={12}>No billboards match these filters. <button onClick={onReset}>Clear filters</button></td></tr>:shown.map((b:any)=>{
     const g=inventoryGeography(b,evidence);
     return <tr key={b.inventoryDbId??b.id} data-selected={selectedSet.has(b.id)||undefined} data-focused={focusedId===b.id||undefined}
       onClick={event=>{if(!(event.target as HTMLElement).closest('button,input,a,select'))onLocate(b);}}>
      <td><input type="checkbox" checked={selectedSet.has(b.id)} aria-label={`Select ${b.street}`} onChange={e=>toggle([b.id],e.target.checked)}/></td>
      <td><button className="inventory-name" onClick={()=>onLocate(b)} title="Locate on map">{b.street}</button>{registrationNumber(b)&&<small>Registration: {registrationNumber(b)}</small>}{b.positionSource==='estimated-road-stretch'&&<small>Estimated location · field verification required</small>}<div className="inventory-row-meta"><small>{b.projectName||projectName}</small><button onClick={()=>onOpen(b)} aria-label={`View ${b.street} details`}>Details</button></div></td>
      <td>{label(b.mediaType)}</td><td>{b.owner||'Not recorded'}</td>
      <td>{g.region?.name??'Unavailable'}<small>{g.district?.name??'Unavailable'}</small></td>
      <td>{g.council?.name??'Unavailable'}<small>{g.local?.name??'Unavailable'}</small></td>
      <td>{g.village?.name??'Unavailable'}{g.village?.population!=null&&<small>{Number(g.village.population).toLocaleString()} residents · estimate</small>}</td>
      <td>{b.faces??'—'}</td><td>{b.width>0&&b.height>0?`${b.width} × ${b.height} m`:'Not recorded'}</td>
      <td>{assetPriority(b)||'Not assigned'}</td><td>{b.bookingStatus?label(b.bookingStatus):'Not checked'}{b.reservedFaces>0&&<small>{b.reservedFaces} face(s) reserved</small>}</td>
      <td>{label(b.status??'not-selected')}</td><td>{(central?b.centralStates??[markerState(b)]:[markerState(b)]).map((state:string)=><span key={state} className={`inventory-flight inventory-flight--${state}`}>{label(state)}</span>)}{central&&b.centralStates?.length>1&&<small>Varies by project</small>}</td>
      <td>{b.photoUrl||b.photoOriginalUrl?'Attached':'Missing'}</td>
     </tr>;
    })}
   </tbody></table>
  </div>
  <footer className="inventory-pagination"><span>{rows.length?`${(safePage-1)*size+1}–${Math.min(safePage*size,rows.length)} of ${rows.length}`:'0 results'}</span><label>Rows<select aria-label="Inventory rows per page" value={size} onChange={e=>setSize(Number(e.target.value))}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label><button disabled={safePage<=1} onClick={()=>setPage(safePage-1)}>Previous</button><span>Page {safePage} of {pages}</span><button disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}>Next</button></footer>
 </section>;
}
