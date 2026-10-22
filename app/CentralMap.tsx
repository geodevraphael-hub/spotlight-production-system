"use client";
import {useMemo,useState} from 'react';
import {Layers3,ArrowUpRight,Search,MapPin} from 'lucide-react';
import {centralProjectCounts} from './central-map.mjs';
import {markerState} from './map-symbols.mjs';
const readable=(s:string)=>s.replaceAll('-',' ').replace(/^./,c=>c.toUpperCase());
export function CentralProjects({boards,projects,value,onChange,onOpen,loading}:any) {
 const [search,setSearch]=useState('');
 const counts=useMemo(()=>centralProjectCounts(boards,projects),[boards,projects]);
 const matches=counts.filter((p:any)=>p.name.toLowerCase().includes(search.toLowerCase()));
 const unassigned=boards.filter((b:any)=>!b.memberships?.length).length;
 const selected=projects.find((p:any)=>String(p.id)===value);
 return <aside className="central-projects" aria-label="Browse projects">
   <header><Layers3 size={17}/><h2>Projects</h2><span>{projects.length}</span></header>
   <label className="central-project-search"><Search size={15}/><input aria-label="Find a project" placeholder="Find a project" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <nav aria-label="Project map filters">
    <button aria-pressed={value==='all'} onClick={()=>onChange('all')}><span>All projects<small>Unique billboards in the database</small></span><b>{loading?'—':boards.length}</b></button>
    <div className="central-project-list">
     {matches.map((p:any)=><button key={p.id} aria-pressed={value===String(p.id)} onClick={()=>onChange(String(p.id))}><span>{p.name}<small>{p.project_type||'Project'} · #{p.id}</small></span><b>{loading?'—':p.count}</b></button>)}
     {!matches.length&&<p>No matching projects.</p>}
    </div>
    <button aria-pressed={value==='unassigned'} onClick={()=>onChange('unassigned')}><span>Unassigned<small>No existing project linked</small></span><b>{loading?'—':unassigned}</b></button>
   </nav>
   <footer>{selected?<button className="central-open-project" onClick={()=>onOpen(selected.id)}>Open project inventory<ArrowUpRight size={16}/></button>:<p>Shared billboards appear once on the map. Select a project to see its own flight status.</p>}</footer>
 </aside>;
}
export function CentralMemberships({board,onOpen}:any){
 return <section className="central-memberships" aria-label="Billboard projects"><h3>Projects & flight status</h3>
  {!board.memberships?.length?<p>No existing project linked. This record is retained in central inventory.</p>:
   board.memberships.map((p:any)=><div key={p.id}><span><strong>{p.name}</strong><small>{readable(markerState(p))}{Number(p.flightExpiry)>0?` · End date ${new Date(Number(p.flightExpiry)).toLocaleDateString('en-GB')}`:''}</small></span><button onClick={()=>onOpen(p.id)} aria-label={`Open ${p.name} inventory`}>Open project<ArrowUpRight size={14}/></button></div>)}
 </section>;
}
export function CentralMapContext({name,visible,total,selected,onlySelected,onOnlySelected,onFit,onClear,onAssign,onRemove,loading}:any){
 return <div className="central-map-context">
  <span><MapPin size={14}/><strong>{name}</strong><small aria-live="polite">{loading?'Loading…':`${visible} on map / ${total} matching`}</small></span>
  <div>{selected===0&&onAssign&&<small>Shift-click or Box to select on the map</small>}{selected>0&&<>{onAssign&&<button className="central-assign-button" title={selected>500?'Assign up to 500 billboards at a time':undefined} disabled={loading||selected>500} onClick={onAssign}>Assign selected ({selected})</button>}<button aria-pressed={onlySelected} onClick={onOnlySelected}>{onlySelected?'Show all matches':`Only selected (${selected})`}</button><button onClick={onClear}>Clear selection</button></>}
   {selected>0&&onRemove&&<button disabled={loading||selected>500} onClick={onRemove}>Remove from project</button>}
   <button disabled={!visible||loading} onClick={onFit}>Fit results</button></div>
 </div>;
}
