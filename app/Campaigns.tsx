"use client";
import SearchSelect from './SearchSelect';
import {useEffect,useState} from 'react';
import {Plus,Pencil,RefreshCw,Check,X} from 'lucide-react';
import {campaignClock} from './campaign-road.mjs';
import './campaign-tools.css';
export default function Campaigns({projectId}: {projectId:number}){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[revision,setRevision]=useState(0);
 const [selected,setSelected]=useState(''),[category,setCategory]=useState(''),[draft,setDraft]=useState<any>(null),[query,setQuery]=useState(''),[now,setNow]=useState(Date.now()),[notice,setNotice]=useState('');
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(t);},[]);
 useEffect(()=>{setDraft(null);setSelected('');setCategory('');setNotice('');},[projectId]);
 useEffect(()=>{const c=new AbortController();setBusy(true);setError('');fetch(`/api/campaigns?projectId=${projectId}`,{signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d;}).then(d=>{if(!c.signal.aborted)setData(d);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});return()=>c.abort();},[projectId,revision]);
 const current=data?.projectId===projectId?data:null,campaigns=current?.campaigns||[],assets=current?.assets||[];
 const choices=campaigns.filter((c:any)=>!category||c.subcategory===category),active=choices.find((c:any)=>c.id===selected)||choices[0];
 const shown=assets.filter((b:any)=>`${b.street} ${b.district||''} ${b.owner||''}`.toLowerCase().includes(query.toLowerCase()));
 const clock=active?campaignClock(active.starts_on,active.ends_on,now):null;
 const edit=(c?:any)=>{setError('');setNotice('');setQuery('');setDraft(c?{...c,assetIds:c.assetIds.filter((id:number)=>assets.some((a:any)=>a.inventoryDbId===id))}:{id:crypto.randomUUID(),version:0,name:'',subcategory:'',starts_on:'',ends_on:'',assetIds:[]});};
 async function save(e:React.FormEvent){e.preventDefault();setError('');setSaving(true);try{campaignClock(draft.starts_on,draft.ends_on);const r=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,action:'save-campaign',projectId})});const d=await r.json();if(!r.ok)throw Error(d.error);setSelected(d.id);setCategory('');setDraft(null);setNotice('Campaign saved. Project membership and flight schedules are unchanged.');setRevision(n=>n+1);}catch(e:any){setError(e.message);}finally{setSaving(false);}}
 return <section className="campaign-workspace" aria-label="Project campaigns" aria-busy={busy}>
  <header><div><h2>Campaigns</h2><p>Subcategories, assigned assets and duration within this project.</p></div><div className="campaign-actions">
   <button aria-label="Refresh campaigns" disabled={busy||saving} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={16}/></button>
   {current?.canManage&&!draft&&<button className="ct-primary" onClick={()=>edit()}><Plus size={16}/>New campaign</button>}
  </div></header>
  {error&&<p role="alert" className="ct-alert">{error}</p>}{notice&&<p role="status" className="ct-notice">{notice}</p>}
  {draft?<form onSubmit={save} className="campaign-editor"><fieldset disabled={saving}><legend>{draft.version?'Edit campaign':'New campaign'}</legend>
   <div className="ct-fields"><label>Campaign name<input required maxLength={160} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <label>Subcategory<input required list="campaign-subcategories" maxLength={100} value={draft.subcategory} placeholder="Enter or choose a subcategory" onChange={e=>setDraft({...draft,subcategory:e.target.value})}/><datalist id="campaign-subcategories">{[...new Set(campaigns.map((c:any)=>c.subcategory))].map((c:any)=><option key={c} value={c}/>)}</datalist></label>
    <label>Start date<input required type="date" value={draft.starts_on} onChange={e=>setDraft({...draft,starts_on:e.target.value})}/></label><label>End date<input required type="date" min={draft.starts_on||undefined} value={draft.ends_on} onChange={e=>setDraft({...draft,ends_on:e.target.value})}/></label>
   </div>
   <div className="campaign-pick-head"><label>Find project assets<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Location, area or vendor"/></label><strong>{draft.assetIds.length} selected</strong><button type="button" disabled={new Set([...draft.assetIds,...shown.map((b:any)=>b.inventoryDbId)]).size>500} onClick={()=>setDraft({...draft,assetIds:[...new Set([...draft.assetIds,...shown.map((b:any)=>b.inventoryDbId)])]})}>Select matching</button><button type="button" onClick={()=>setDraft({...draft,assetIds:[]})}>Clear selection</button></div>
   <div className="campaign-asset-list" tabIndex={0} aria-label="Campaign asset selection">{shown.map((b:any)=><label key={b.inventoryDbId}><input type="checkbox" checked={draft.assetIds.includes(b.inventoryDbId)} onChange={e=>setDraft({...draft,assetIds:e.target.checked?[...draft.assetIds,b.inventoryDbId]:draft.assetIds.filter((id:number)=>id!==b.inventoryDbId)})}/><span><b>{b.street||`Asset ${b.inventoryDbId}`}</b><small>{b.district||'Area not recorded'} · {b.owner||'Vendor not recorded'}</small></span><span>{String(b.mediaType||'').replaceAll('-',' ')}</span></label>)}{!shown.length&&<p>No project assets match. Add assets in Inventory first, or save an empty campaign.</p>}</div>
   <p className="ct-help">Up to 500 assets. This groups existing project assets; it does not book faces, change ownership or send flight notifications.</p>
   <footer><button type="button" onClick={()=>setDraft(null)}><X size={16}/>Cancel</button><button className="ct-primary" disabled={draft.assetIds.length>500} type="submit"><Check size={16}/>{saving?'Saving…':'Save campaign'}</button></footer>
  </fieldset></form>:current?<>
   {campaigns.length?<><div className="campaign-selectors"><label>Subcategory<SearchSelect value={category} onChange={e=>{setCategory(e.target.value);setSelected('');}}><option value="">All subcategories</option>{[...new Set(campaigns.map((c:any)=>c.subcategory))].map((c:any)=><option key={c}>{c}</option>)}</SearchSelect></label><label>Campaign<SearchSelect value={active?.id||''} onChange={e=>setSelected(e.target.value)}>{choices.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</SearchSelect></label>{current.canManage&&active&&<button onClick={()=>edit(active)}><Pencil size={15}/>Edit campaign</button>}</div>
    {active&&<div className="campaign-detail"><div className="campaign-timeline"><div><h3>{active.name}</h3><span>{active.subcategory}</span></div><strong data-state={clock!.state}>{clock!.label}</strong><p>{active.starts_on} — {active.ends_on} · {clock!.duration} calendar days · EAT</p><progress value={clock!.progress} max={100} aria-label="Campaign duration progress"/><small>Campaign dates do not change individual billboard expiry dates.</small></div>
     <div className="campaign-totals" aria-label="Selected campaign totals">{[['Assets',active.summary.total],['Faces',active.summary.faces],['Large format',active.summary.types.find((t:any)=>t.id==='large-format')?.boards||0],['Digital screens',active.summary.types.find((t:any)=>t.id==='digital-screen')?.boards||0],['Lamp posts',active.summary.types.find((t:any)=>t.id==='lamp-post')?.boards||0],['Booked today',active.summary.booked],['Flighted',active.summary.states.flighted+active.summary.states.overdue],['In production',active.summary.inProduction],['In transit',active.summary.inTransit]].map(([title,n])=><div key={title}><span>{title}</span><b>{n}</b></div>)}</div>
     {active.missingAssets>0&&<p className="ct-alert">{active.missingAssets} previously assigned assets are no longer in this project and are excluded from totals. Edit the campaign to reconcile the list.</p>}
     <details><summary>View {active.summary.total} campaign assets</summary><div className="campaign-asset-list">{assets.filter((b:any)=>active.assetIds.includes(b.inventoryDbId)).map((b:any)=><div key={b.inventoryDbId}><b>{b.street}</b><span>{b.district||'Area not recorded'}</span></div>)}</div></details>
    </div>}</>:<p className="ct-empty">No campaigns yet. Create a campaign, enter its dates and group the project assets you want to track.</p>}
  </>:<p className="ct-empty">{busy?'Loading campaigns…':'Campaigns unavailable. Use Refresh to try again.'}</p>}
 </section>;
}
