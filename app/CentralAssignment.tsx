"use client";
import SearchSelect from './SearchSelect';
import {useEffect,useRef,useState} from 'react';
import {X,Check,FolderPlus,FolderOpen} from 'lucide-react';
export default function CentralAssignment({boards,projects,hiddenCount,onClose,onSaved}:any){
 const [mode,setMode]=useState('existing'),[target,setTarget]=useState(''),[name,setName]=useState(''),[type,setType]=useState('Outdoor media');
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),sending=useRef(false),request=useRef<any>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  root.current?.querySelector<HTMLButtonElement>('.assignment-close')?.focus();
  return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 function changed(){setConfirmed(false);setError('');request.current=null;}
 const destination=mode==='new'?name.trim():projects.find((p:any)=>String(p.id)===target)?.name;
 const already=mode==='existing'?boards.filter((b:any)=>b.memberships?.some((p:any)=>String(p.id)===target)).length:0;
 async function save(){
  if(sending.current||!confirmed||!destination)return;
  sending.current=true;setBusy(true);setError('');
  request.current??={requestId:crypto.randomUUID(),ids:boards.map((b:any)=>b.inventoryDbId),confirmed:true,
   ...(mode==='new'?{newProjectName:name.trim(),projectType:type.trim()}:{targetProjectId:Number(target)})};
  try{
   const response=await fetch('/api/app?action=assign-central-inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.current)});
   const data=await response.json();
   if(!response.ok){if(response.status<500)setUncertain(false);throw Object.assign(new Error(data.error||'Assignment was not saved.'),{known:response.status<500});}
   onSaved(data);
  }catch(e:any){
   if(!e.known)setUncertain(true);
   setError(e.known?e.message:'The outcome could not be confirmed. Retry this same request safely; it will not create a second project or duplicate links. Refresh inventory before starting another assignment.');
  }finally{sending.current=false;setBusy(false);}
 }
 return <div className="inventory-bulk-overlay">
  <div className="central-assignment" ref={root} role="dialog" aria-modal="true" aria-labelledby="central-assignment-title" aria-busy={busy}
   onKeyDown={event=>{
    if(event.key==='Escape'&&!busy){event.stopPropagation();onClose();}
    if(event.key==='Tab'){
     const controls=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')??[]).filter(el=>el.getClientRects().length);
     const first=controls[0],last=controls.at(-1);
     if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
     if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
   }}>
   <header><div><h2 id="central-assignment-title">Assign selected billboards</h2><p>{boards.length} selected{hiddenCount>0?` · ${hiddenCount} hidden by current filters`:''}</p></div><button className="assignment-close" aria-label="Close project assignment" disabled={busy} onClick={onClose}><X size={20}/></button></header>
   <div className="assignment-content">
    <section className="assignment-destination"><h3>Choose a destination</h3>
     <div className="assignment-modes" role="group" aria-label="Destination type">
      <button disabled={busy||uncertain} aria-pressed={mode==='existing'} onClick={()=>{setMode('existing');changed();}}><FolderOpen size={16}/>Existing project</button>
      <button disabled={busy||uncertain} aria-pressed={mode==='new'} onClick={()=>{setMode('new');changed();}}><FolderPlus size={16}/>Create project</button>
     </div>
     <fieldset disabled={busy||uncertain}>
      {mode==='existing'?<label>Destination project<SearchSelect value={target} onChange={e=>{setTarget(e.target.value);changed();}}><option value="">Choose a project</option>{projects.map((p:any)=><option key={p.id} value={p.id}>{p.name} · #{p.id}</option>)}</SearchSelect></label>:
       <><label>New project name<input maxLength={200} value={name} placeholder="Enter project name" onChange={e=>{setName(e.target.value);changed();}}/></label>
        <label>Project type<input maxLength={100} value={type} onChange={e=>{setType(e.target.value);changed();}}/></label></>}
     </fieldset>
     <p className="assignment-note"><Check size={17}/>Current projects and billboard attributes stay unchanged. Only new project links are added.</p>
     <p className="assignment-secondary">Existing flight schedules, plans, contacts and project users are not copied. Users with access to the destination project will also see these billboards.</p>
     {mode==='new'&&<p className="assignment-secondary">The new project starts with protected sharing. No public link or invitation is sent.</p>}
     {destination&&<p className="assignment-preview">{boards.length-already} to add to <strong>{destination}</strong>{already>0?`; ${already} already linked and will be skipped.`:'.'}</p>}
     {error&&<p className="assignment-error" role="alert">{error}</p>}
    </section>
    <section className="assignment-records"><h3>Selected billboards</h3><div tabIndex={0} aria-label="Selected billboards and their current projects"><ul>{boards.map((b:any)=><li key={b.inventoryDbId}><strong>{b.street}</strong><span>{b.projectName||'Unassigned'}</span><small>Inventory #{b.inventoryDbId}{mode==='existing'&&b.memberships?.some((p:any)=>String(p.id)===target)?' · Already linked':''}</small></li>)}</ul></div></section>
   </div>
   <footer><label><input type="checkbox" checked={confirmed} disabled={busy||uncertain||!destination} onChange={e=>setConfirmed(e.target.checked)}/>I confirm the destination for {boards.length===1?'this billboard':`these ${boards.length} billboards`}.</label>
    <div><button disabled={busy} onClick={onClose}>Cancel</button><button className="assignment-save" disabled={busy||!confirmed||!destination||!boards.length||boards.length>500||(mode==='new'&&!type.trim())} onClick={save}>{busy?'Assigning…':uncertain?'Retry safely':mode==='new'?'Create project & assign':'Assign billboards'}</button></div>
   </footer>
  </div>
 </div>;
}
