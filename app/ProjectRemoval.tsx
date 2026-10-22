"use client";
import {useEffect,useRef,useState} from 'react';
import {X,ShieldCheck} from 'lucide-react';

export default function ProjectRemoval({boards,projects,initialProjectId,lockedProject=false,hiddenCount,onClose,onSaved}:any){
 const [target,setTarget]=useState(String(initialProjectId||''));
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),sending=useRef(false),request=useRef<any>(null);
 const project=projects.find((p:any)=>String(p.id)===target);
 const included=(b:any)=>b.memberships?b.memberships.some((p:any)=>String(p.id)===target):String(b.projectId)===target;
 const affected=boards.filter(included);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  root.current?.querySelector<HTMLButtonElement>('.assignment-close')?.focus();
  return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 async function save(){
  if(sending.current||!confirmed||!project||!affected.length)return;
  sending.current=true;setBusy(true);setError('');
  request.current??={requestId:crypto.randomUUID(),ids:boards.map((b:any)=>b.inventoryDbId),projectId:project.id,confirmed:true};
  try{
   const response=await fetch('/api/app?action=remove-project-inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.current)});
   const data=await response.json();
   if(!response.ok)throw Object.assign(new Error(data.error||'Removal was not saved.'),{known:response.status<500});
   onSaved(data);
  }catch(e:any){
   setUncertain(!e.known);
   setError(e.known?e.message:'The outcome could not be confirmed. Retry safely with the same request, or refresh inventory before starting another removal.');
  }finally{sending.current=false;setBusy(false);}
 }
 return <div className="inventory-bulk-overlay"><div className="central-assignment project-removal" ref={root} role="dialog" aria-modal="true" aria-labelledby="project-removal-title" aria-describedby="project-removal-preserved" aria-busy={busy}
  onKeyDown={event=>{
   if(event.key==='Escape'&&!busy){event.stopPropagation();onClose();}
   if(event.key==='Tab'){
    const controls=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')??[]).filter(el=>el.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
   }
  }}>
  <header><div><h2 id="project-removal-title">Remove from project</h2><p>{boards.length} selected{hiddenCount>0?` · ${hiddenCount} hidden by current filters`:''}</p></div><button className="assignment-close" aria-label="Close project removal" disabled={busy} onClick={onClose}><X size={20}/></button></header>
  <div className="assignment-content">
   <section className="assignment-destination">
    <h3>Review project removal</h3>
    <fieldset disabled={busy||uncertain||lockedProject}><label>Remove from this project<select value={target} onChange={e=>{setTarget(e.target.value);setConfirmed(false);setError('');request.current=null;}}><option value="">Choose a project</option>{projects.map((p:any)=><option key={p.id} value={p.id}>{p.name} · #{p.id}</option>)}</select></label></fieldset>
    <p className="assignment-note" id="project-removal-preserved"><ShieldCheck size={18}/>Billboards, photos and attributes remain in the central inventory. All other project memberships are preserved.</p>
    <p className="assignment-secondary">This removes access through this project, including its shared map. Previous plans, flight schedules and validation records are retained as history; they are not deleted. You can assign the billboards again later.</p>
    {project&&<p className="assignment-preview"><strong>{affected.length}</strong> billboard{affected.length===1?'':'s'} to remove from <strong>{project.name}</strong>.{boards.length>affected.length?` ${boards.length-affected.length} not linked to this project will be skipped.`:''}</p>}
    {error&&<p className="assignment-error" role="alert">{error}</p>}
   </section>
   <section className="assignment-records"><h3>{project?'Billboards affected':'Selected billboards'}</h3><div tabIndex={0} aria-label="Billboards included in project removal"><ul>{boards.map((b:any)=><li key={b.inventoryDbId}><strong>{b.street}</strong><span>{project?(included(b)?`Remove from ${project.name}`:'Not in this project · No change'):(b.projectName||'Choose a project to review')}</span><small>Inventory #{b.inventoryDbId} · Central record retained</small></li>)}</ul></div></section>
  </div>
  <footer><label><input type="checkbox" checked={confirmed} disabled={busy||uncertain||!affected.length} onChange={e=>setConfirmed(e.target.checked)}/>Remove {affected.length} billboard{affected.length===1?'':'s'} from {project?.name||'the chosen project'} only.</label><div><button disabled={busy} onClick={onClose}>Cancel</button><button className="assignment-remove" disabled={busy||!confirmed||!affected.length||boards.length>500} onClick={save}>{busy?'Removing…':uncertain?'Retry safely':'Remove from project'}</button></div></footer>
 </div></div>;
}
