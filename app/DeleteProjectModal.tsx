"use client";
import {useEffect,useRef,useState} from 'react';
import {X,Trash2} from 'lucide-react';
import './delete-project.css';
export default function DeleteProjectModal({project,onClose,onDelete}:{project:{id:number;name:string};onClose:()=>void;onDelete:(id:number)=>Promise<void>}){
 const [confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),sending=useRef(false);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();return()=>{previous?.focus();};},[]);
 async function remove(){if(sending.current||confirmation!=='DELETE')return;sending.current=true;setBusy(true);setError('');try{await onDelete(project.id);onClose();}catch(e:any){setError(e.message||'Could not delete the project.');}finally{sending.current=false;setBusy(false);}}
 return <div className="delete-project-overlay"><div className="delete-project-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" aria-describedby="delete-project-description" aria-busy={busy} ref={root} onKeyDown={e=>{
  if(e.key==='Escape'&&!busy){e.stopPropagation();onClose();}
  if(e.key==='Tab'){const controls=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')??[]);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
 }}><header><Trash2 size={22}/><h2 id="delete-project-title">Delete project</h2><button aria-label="Close delete project" disabled={busy} onClick={onClose}><X size={20}/></button></header>
 <p id="delete-project-description">Permanently delete <strong>{project.name}</strong> and its project data? This removes its plans, missions, field collections, contacts, flight schedules and user assignments. Unshared billboards owned by this project are deleted. Billboards used by other projects remain in those projects.</p>
 <p className="delete-project-warning">This cannot be undone.</p>
 <form onSubmit={e=>{e.preventDefault();void remove();}}><label>Type DELETE to confirm<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false}/></label>
 {error&&<p role="alert" className="delete-project-warning">{error}</p>}<footer><button type="button" data-cancel disabled={busy} onClick={onClose}>Cancel</button><button className="delete-project-confirm" disabled={busy||confirmation!=='DELETE'}>{busy?'Deleting…':'Delete project'}</button></footer></form>
 </div></div>;
}
