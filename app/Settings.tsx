"use client";
import {useEffect,useState} from 'react';
import {DICTIONARY_TABS} from './inventory-dictionaries.mjs';
import './settings.css';
type Entry={kind:string;value:string;label:string;version:number};
export default function Settings({onChanged}:{onChanged:(data:any)=>void}){
 const [tab,setTab]=useState('mediaType'),[entries,setEntries]=useState<Entry[]>([]),[editing,setEditing]=useState<Entry|null>(null);
 const [code,setCode]=useState(''),[label,setLabel]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<Entry|null>(null);
 async function load(){setLoading(true);setError('');try{const r=await fetch('/api/app?action=inventory-dictionaries');const d=await r.json();if(!r.ok)throw Error(d.error);setEntries(d.entries);onChanged(d);reset();}catch(e:any){setError(e.message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 function reset(){setEditing(null);setCode('');setLabel('');setDeleting(null);}
 async function save(operation:string,entry?:Entry){
  setBusy(true);setError('');setNotice('');
  try{const r=await fetch('/api/app?action=inventory-dictionaries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,kind:tab,value:entry?.value??code,label:entry?.label??label,version:entry?.version??editing?.version})});const d=await r.json();if(!r.ok)throw Error(d.error);setEntries(d.entries);onChanged(d);reset();setNotice(operation==='delete'?'Value deleted.':'Dictionary saved. Inventory options are updated.');}
  catch(e:any){setError(e.message||'Could not save. Reload to check the latest values.');}finally{setBusy(false);}
 }
 return <main className="settings-page"><header><span className="eyebrow">Administration</span><h1>Settings</h1><p>Manage the data dictionaries used by Refine inventory and billboard forms.</p></header>
  <nav className="settings-tabs" aria-label="Settings sections">{DICTIONARY_TABS.map(([key,title])=><button key={key} disabled={busy} aria-current={tab===key?'page':undefined} onClick={()=>{setTab(key);reset();setError('');setNotice('');}}>{title}</button>)}</nav>
  {error&&<p className="settings-error" role="alert">{error} <button disabled={busy} onClick={load}>Reload</button></p>}{notice&&<p role="status" className="settings-notice">{notice}</p>}
  <div className="settings-columns"><section><h2>{DICTIONARY_TABS.find(([key])=>key===tab)?.[1]}</h2><p>Labels can be renamed. Codes stay stable so existing billboard records keep their meaning.</p>
   {loading?<p role="status">Loading dictionaries…</p>:<table><thead><tr><th>Label</th><th>Code</th><th>Actions</th></tr></thead><tbody>{entries.filter(e=>e.kind===tab).map(entry=><tr key={entry.value}><td>{entry.label}</td><td><code>{entry.value}</code></td><td><button disabled={busy} onClick={()=>{setEditing(entry);setCode(entry.value);setLabel(entry.label);setDeleting(null);setNotice('');}}>Edit</button><button disabled={busy} onClick={()=>setDeleting(entry)}>Delete</button></td></tr>)}{!entries.some(e=>e.kind===tab)&&<tr><td colSpan={3}>No values yet. Add the first value.</td></tr>}</tbody></table>}
   {deleting&&<div className="settings-delete" role="alert"><p>Delete “{deleting.label}”? Values used by inventory cannot be deleted.</p><button disabled={busy} onClick={()=>save('delete',deleting)}>Delete value</button><button disabled={busy} onClick={()=>setDeleting(null)}>Cancel</button></div>}
  </section><form onSubmit={e=>{e.preventDefault();void save(editing?'update':'create');}}><h2>{editing?'Edit value':'Add value'}</h2><fieldset disabled={busy||loading}><label>Code<input required maxLength={60} pattern="[a-zA-Z0-9][a-zA-Z0-9-]{0,59}" readOnly={!!editing} value={code} onChange={e=>setCode(tab==='priority'?e.target.value.toUpperCase():e.target.value)} placeholder={tab==='priority'?'D':'new-value'}/></label><label>Label<input required maxLength={100} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Display name"/></label><button className="primary-button" type="submit">{busy?'Saving…':editing?'Save changes':'Add value'}</button>{editing&&<button type="button" onClick={reset}>Cancel editing</button>}</fieldset></form></div>
 </main>;
}
