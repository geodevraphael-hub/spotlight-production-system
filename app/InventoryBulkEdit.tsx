"use client";
import SearchSelect from './SearchSelect';
import {useEffect,useRef,useState} from 'react';
import {X,ArrowLeft,Check} from 'lucide-react';
import {BULK_FIELDS,normalizeBulkChanges} from './inventory-bulk.mjs';
const groups=[...new Set(BULK_FIELDS.map(field=>field.group))];
function display(value:any,key:string){
 if(value===null||value===undefined||value==='')return 'Empty';
 const field=BULK_FIELDS.find(f=>f.key===key);
 return field?.options?.find(([v]:any)=>v===value)?.[1]??String(value);
}
function differences(change:any){
 if(change.key!=='sourceAttributes')return [change];
 const before=change.before||{},after=change.after||{};
 return Object.keys(after).filter(key=>before[key]!==after[key]).map(key=>({key:`csv:${key}`,label:`CSV · ${key}`,before:before[key],after:after[key]}));
}
export default function InventoryBulkEdit({boards,projectId,projectName,hiddenCount,onClose,onSaved}:any){
 const [enabled,setEnabled]=useState<Record<string,boolean>>({});
 const [values,setValues]=useState<Record<string,string>>({});
 const [review,setReview]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
 const root=useRef<HTMLDivElement>(null),alive=useRef(true),busyRef=useRef(false);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;alive.current=true;
  root.current?.querySelector<HTMLButtonElement>('.bulk-close')?.focus();
  return()=>{alive.current=false;if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 const ids=boards.map((b:any)=>b.inventoryDbId);
 const unavailable=ids.some((id:any)=>!Number.isSafeInteger(id));
 function toggle(field:any,checked:boolean){
  setEnabled(old=>({...old,[field.key]:checked}));setError('');
  if(checked&&values[field.key]===undefined){
   const all=boards.map((b:any)=>String(b[field.key]??''));
   setValues(old=>({...old,[field.key]:all.every((v:string)=>v===all[0])?all[0]:''}));
  }
 }
 async function requestReview(){
  if(busyRef.current)return;
  setError('');
  try{
   const changes=normalizeBulkChanges(Object.fromEntries(Object.keys(enabled).filter(key=>enabled[key]).map(key=>[key,values[key]??''])));
   busyRef.current=true;setBusy(true);
   const response=await fetch('/api/app?action=inventory-bulk-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,ids,changes})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Could not prepare the review. Try again.');
   if(alive.current){setReview({...data,patch:changes});setConfirmed(false);root.current?.querySelector('.bulk-body')?.scrollTo({top:0});}
  }catch(e:any){if(alive.current)setError(e.message||'Could not prepare the review. Check your connection.');}
  finally{busyRef.current=false;if(alive.current)setBusy(false);}
 }
 async function save(){
  if(busyRef.current||!confirmed||!review?.changedCount)return;
  busyRef.current=true;setBusy(true);setError('');
  try{
   const response=await fetch('/api/app?action=inventory-bulk-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    projectId,ids,changes:review.patch,versions:Object.fromEntries(review.rows.map((r:any)=>[r.id,r.version])),confirmed:true,
   })});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Could not save. Review again before retrying.');
   if(alive.current)onSaved(data);
  }catch(e:any){if(alive.current){setError(`${e.message||'Connection lost; the outcome could not be confirmed.'} Review again to check current values.`);setReview(null);setConfirmed(false);}}
  finally{busyRef.current=false;if(alive.current)setBusy(false);}
 }
 return <div className="inventory-bulk-overlay">
  <div className="inventory-bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="inventory-bulk-title" ref={root} aria-busy={busy}
   onKeyDown={event=>{
    if(event.key==='Escape'&&!busy){event.stopPropagation();onClose();}
    if(event.key==='Tab'){
     const controls=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')??[]).filter(el=>el.getClientRects().length);
     const first=controls[0],last=controls[controls.length-1];
     if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
     else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
   }}>
   <header className="bulk-header"><div><h2 id="inventory-bulk-title">{review?'Review bulk changes':'Edit selected billboards'}</h2>
    <p>{boards.length} selected · {projectName}{hiddenCount>0?` · ${hiddenCount} hidden by current filters`:''}</p></div>
    <button className="bulk-close" disabled={busy} onClick={onClose} aria-label="Close bulk editor"><X size={20}/></button>
   </header>
   <div className="bulk-steps" aria-label="Bulk edit progress"><span aria-current={!review?'step':undefined}>Choose changes</span><span aria-current={review?'step':undefined}>Review & confirm</span></div>
   <div className="bulk-body">
    {error&&<p className="bulk-error" role="alert">{error}</p>}
    {unavailable&&<p className="bulk-error" role="alert">Some selected records have no database identity. Refresh inventory before editing.</p>}
    {!review?<>
     <p className="bulk-guidance">Enable only the fields you want to replace. All other values stay unchanged. Blank text clears an enabled field; numbers require a value.</p>
     <details className="bulk-targets"><summary>View {boards.length} selected billboards</summary><ul>{boards.map((b:any)=><li key={b.inventoryDbId??b.id}>{b.street}</li>)}</ul></details>
     {groups.map(group=><fieldset key={group} className="bulk-field-group" disabled={busy}><legend>{group}</legend>
      {BULK_FIELDS.filter(f=>f.group===group&&f.key!=='transportPrice').map(field=>{
       const mixed=new Set(boards.map((b:any)=>String(b[field.key]??''))).size>1;
       return <div key={field.key} className={`bulk-field${enabled[field.key]?' is-enabled':''}`}>
        <label className="bulk-enable"><input type="checkbox" checked={!!enabled[field.key]} onChange={e=>toggle(field,e.target.checked)}/>{field.label}</label>
        {field.options?<SearchSelect aria-label={`New ${field.label}`} disabled={!enabled[field.key]} value={values[field.key]??''} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))}><option value="">Choose a value</option>{field.options.map(([value,title]:any)=><option key={value} value={value}>{title}</option>)}</SearchSelect>:
         <input aria-label={`New ${field.label}`} disabled={!enabled[field.key]} type={field.number?'number':'text'} min={field.min} max={field.max} step={field.integer?1:'any'} maxLength={300} value={values[field.key]??''} placeholder={mixed?'Mixed values':String(boards[0]?.[field.key]??'Not recorded')} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))}/>}
       </div>;
      })}
     </fieldset>)}
     <p className="bulk-guidance">Shared billboard records change in every linked project. GPS, photos and flight schedules are excluded. LocationIQ geography and saved plan prices are not changed.</p>
    </>:<>
     <p className="bulk-guidance">{review.changedCount} billboard{review.changedCount===1?'':'s'} will change. {review.unchangedCount} already match and will be left unchanged.</p>
     {review.sharedCount>0&&<p className="bulk-warning">{review.sharedCount} changed billboard{review.sharedCount===1?' is':'s are'} shared with other projects. These attribute updates will appear there too.</p>}
     {!review.changedCount&&<p role="status">There is nothing to save. Go back to choose different values.</p>}
     {review.rows.filter((r:any)=>r.changes.length).map((row:any)=><section key={row.id} className="bulk-review-record"><h3>{row.name}{row.shared&&<small>Shared record</small>}</h3>
      <table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{row.changes.flatMap(differences).map((c:any)=><tr key={c.key}><th>{c.label}</th><td>{display(c.before,c.key)}</td><td>{display(c.after,c.key)}</td></tr>)}</tbody></table>
     </section>)}
    </>}
   </div>
   <footer className="bulk-footer">
    {review?<><label className="bulk-confirm"><input type="checkbox" checked={confirmed} disabled={busy||!review.changedCount} onChange={e=>setConfirmed(e.target.checked)}/>I confirm these changes to {review.changedCount} billboards.</label>
     <div><button disabled={busy} onClick={()=>{setReview(null);setConfirmed(false);setError('');}}><ArrowLeft size={16}/>Back to edit</button><button className="bulk-save" disabled={busy||!confirmed||!review.changedCount} onClick={save}><Check size={16}/>{busy?'Saving…':`Save ${review.changedCount} billboard${review.changedCount===1?'':'s'}`}</button></div></>:
     <><span>{Object.values(enabled).filter(Boolean).length} fields enabled</span><div><button disabled={busy} onClick={onClose}>Cancel</button><button className="bulk-save" disabled={busy||unavailable||!Object.values(enabled).some(Boolean)||boards.length>500} onClick={requestReview}>{busy?'Preparing review…':'Review changes'}</button></div></>}
   </footer>
  </div>
 </div>;
}
