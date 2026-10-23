"use client";
import SearchSelect from './SearchSelect';
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
export default function PoleAssignment({boards,projectId,projectName,users,onClose,onSaved}:any){
 const [userId,setUserId]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),request=useRef<any>(null),sending=useRef(false);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;root.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>previous?.isConnected&&previous.focus();},[]);
 async function save(){
  if(sending.current||!confirmed||!userId)return;
  sending.current=true;setBusy(true);setError('');
  request.current??={ids:boards.map((b:any)=>b.inventoryDbId),projectId,userId:Number(userId),confirmed:true,requestId:crypto.randomUUID()};
  try{const r=await fetch('/api/app?action=assign-pole-gps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.current)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Assignment failed. Retry or refresh.');onSaved(d);}
  catch(e:any){setError(e.message);}finally{sending.current=false;setBusy(false);}
 }
 return <div className="inventory-bulk-overlay"><div className="central-assignment" ref={root} role="dialog" aria-modal="true" aria-labelledby="pole-assignment-title" onKeyDown={e=>{
  if(e.key==='Escape'&&!busy)onClose();
  if(e.key==='Tab'){const controls=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')||[]).filter(x=>x.getClientRects().length);if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0]?.focus();}}
 }}>
  <header><div><h2 id="pole-assignment-title">Assign GPS verification</h2><p>{projectName} · {boards.length} estimated poles</p></div><button className="assignment-close" aria-label="Close GPS assignment" disabled={busy} onClick={onClose}><X size={20}/></button></header>
  <div className="assignment-content"><section className="assignment-destination"><h3>Choose a field user</h3>
   <fieldset><label>Field user<SearchSelect value={userId} disabled={busy||!!request.current} onChange={e=>{setUserId(e.target.value);setConfirmed(false);}}><option value="">Select field user</option>{users.map((u:any)=><option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}</SearchSelect></label></fieldset>
   {!users.length&&<p role="status">No field users loaded. Close and reopen to retry, or add a field user in Field management.</p>}
   <p className="assignment-note">The APK will show these poles in the field user's validation list, with directions to each estimated location.</p>
   <p className="assignment-secondary">A photo, a GPS fix accurate to 10 m or better, and confirmation beside the pole are required. Successful verification updates the shared pole location in every linked project. “Not okay” reports leave the location unchanged.</p>
   <p>Existing assignments to this field user are kept. Poles assigned to another field user are not reassigned silently.</p>
   {error&&<p className="assignment-error" role="alert">{error}</p>}
  </section><section className="assignment-records"><h3>Poles to verify</h3><div tabIndex={0} aria-label="Selected poles"><ul>{boards.map((b:any)=><li key={b.inventoryDbId}><strong>{b.street}</strong><span>Estimated GPS · {Number(b.lat).toFixed(6)}, {Number(b.lng).toFixed(6)}</span></li>)}</ul></div></section></div>
  <footer><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Assign these {boards.length} poles for GPS verification.</label><div><button disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy||!confirmed||!userId||!boards.length||boards.length>200} onClick={save}>{busy?'Assigning…':'Assign GPS verification'}</button></div></footer>
 </div></div>;
}
