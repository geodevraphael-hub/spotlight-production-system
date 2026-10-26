"use client";
import SearchSelect from './SearchSelect';
import {useEffect,useState} from 'react';
import {ArrowUpRight,RefreshCw,Clock3,MapPin,ClipboardList} from 'lucide-react';
import './dashboard.css';
import Campaigns from './Campaigns';
const number=(n:number)=>Number(n||0).toLocaleString('en-GB');
const date=(n:number)=>new Date(n).toLocaleDateString('en-GB',{timeZone:'Africa/Nairobi',day:'numeric',month:'short',year:'numeric'});
const time=(n:number)=>new Date(n).toLocaleString('en-GB',{timeZone:'Africa/Nairobi',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const flightLabels:any={flighted:'Flighted · not marked overdue',overdue:'Overdue for deflighting',unflighted:'Unflighted',deflighted:'Deflighted'};
const validationLabels:any={ok:'Confirmed okay',issue:'Needs attention',assigned:'Awaiting visit',in_progress:'In progress'};
const statusLabels:any={accepted:'Provider accepted',sent:'Provider accepted',delivered:'Delivered',read:'Read',failed:'Failed',unknown:'Unconfirmed',pending:'Queued',retry:'Retry scheduled',processing:'Processing'};
export default function Dashboard({projectId,projects,onProject,onNavigate}:any){
 const [result,setResult]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const [measure,setMeasure]=useState<'boards'|'faces'>('boards'),[horizon,setHorizon]=useState(7);
 useEffect(()=>{
  if(!projectId){setResult(null);setBusy(false);setError('');return;}
  const controller=new AbortController();setBusy(true);setError('');
  fetch(`/api/operations?section=dashboard&projectId=${projectId}`,{signal:controller.signal})
   .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to load dashboard.');return d;})
   .then(d=>{if(!controller.signal.aborted)setResult(d);})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message);})
   .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[projectId,revision]);
 const data=result?.projectId===projectId?result:null;
 const project=projects.find((p:any)=>p.id===projectId);
 const expiry=(data?.expiry||[]).filter((b:any)=>b.remaining<=horizon);
 const issues=(data?.validations||[]).find((v:any)=>v.status==='issue')?.value||0;
 const failed=(data?.messages||[]).filter((m:any)=>['failed','unknown'].includes(m.status)).reduce((s:number,m:any)=>s+m.value,0);
 const validationTotal=(data?.validations||[]).reduce((s:number,v:any)=>s+v.value,0);
 const trends=data?.trend||[],trendMax=Math.max(1,...trends.map((t:any)=>t.value));
 return <section className="spot-dashboard" aria-label="Project dashboard" aria-busy={busy}>
  <header className="sd-header"><div><h1>Project dashboard</h1><p>{project?.name||'Choose a project to review its operations'}</p></div>
   <div className="sd-header-actions"><label>Project<SearchSelect aria-label="Dashboard project" value={projectId||''} onChange={e=>onProject(Number(e.target.value))}><option value="" disabled>Choose project</option>{projects.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</SearchSelect></label>
    <button aria-label="Refresh dashboard" disabled={busy||!projectId} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16} className={busy?'sd-refreshing':''}/><span>Refresh</span></button>
    <button disabled={!projectId} onClick={()=>onNavigate('inventory')}><MapPin size={16}/>Inventory<ArrowUpRight size={14}/></button></div>
  </header>
  <div className="sd-sync" role="status">{busy?'Refreshing project data…':data?`Updated ${time(data.generatedAt)} EAT · Inventory and operational totals are all-time; activity chart shows 14 days.`:'Select a project to begin.'}</div>
  {error&&<div className="sd-error" role="alert">{error} {data?'Showing the last successful snapshot.':''} <button onClick={()=>setRevision(v=>v+1)}>Retry</button></div>}
  {projectId>0&&<Campaigns key={projectId} projectId={projectId}/>}
  {!data?<div className="sd-empty">{busy?'Loading inventory, flight status and activity…':!projectId?'Your dashboard follows one project at a time. Choose a project above.':'No dashboard snapshot is available yet.'}</div>:<>
   <div className="sd-summary" aria-label="Project overview">
    {[['Total assets',data.total,'inventory'],['Total faces',data.faces,'inventory'],['Large format',data.types.find((t:any)=>t.id==='large-format')?.boards||0,'inventory',{type:'large-format'}],['Digital screens',data.types.find((t:any)=>t.id==='digital-screen')?.boards||0,'inventory',{type:'digital-screen'}],['Lamp posts',data.types.find((t:any)=>t.id==='lamp-post')?.boards||0,'inventory',{type:'lamp-post'}],['Recorded installations',data.installations,'inventory'],['Flighted',data.states.flighted+data.states.overdue,'flighting'],['Overdue for removal',data.states.overdue,'flighting'],['Validation issues',issues,'field']].map(([label,value,target,filters]:any)=><button key={String(label)} onClick={()=>onNavigate(target,filters||{})}><span>{label}</span><strong>{number(Number(value))}</strong><ArrowUpRight size={15}/></button>)}
   </div>
   {data.missingInstallations>0&&<p className="sd-count-note">{data.missingInstallations} asset{data.missingInstallations===1?' has':'s have'} no recorded installation count. Faces, installations and asset records are counted separately.</p>}
   <div className="sd-performance" aria-label="Campaign operations">
    <button onClick={()=>onNavigate('bookings')}><span>Booked assets</span><strong>{number(data.booked)}</strong><small>Active reservations or flighting · today (EAT)</small></button>
    <button onClick={()=>onNavigate('tracker')}><span>In production</span><strong>{number(data.inProduction)}</strong><small>Printing stage, not yet flighted</small></button>
    <button onClick={()=>onNavigate('tracker')}><span>In transit</span><strong>{number(data.inTransit)}</strong><small>Transport stage, not yet flighted</small></button>
   </div>
   <div className="sd-primary">
    <section className="sd-panel"><header><div><h2>Flight status</h2><p>One status per billboard in this project.</p></div><button onClick={()=>onNavigate('flighting')}>Manage flighting<ArrowUpRight size={14}/></button></header>
     <div className="sd-flight-stack" role="img" aria-label={Object.entries(data.states).map(([k,v])=>`${flightLabels[k]}: ${v}`).join(', ')}>{Object.entries(data.states).map(([key,value])=><span key={key} data-tone={key} style={{width:`${data.total?Number(value)/data.total*100:0}%`}}/>)}</div>
     <div className="sd-flight-legend">{Object.entries(data.states).map(([key,value])=><button key={key} onClick={()=>onNavigate('inventory',{flight:key==='overdue'?'expired':key})}><i data-tone={key}/><span>{flightLabels[key]}</span><strong>{number(Number(value))}</strong><small>{data.total?Math.round(Number(value)/data.total*100):0}%</small></button>)}</div>
     <div className="sd-inline-facts"><span><Clock3 size={14}/><b>{data.dueToday}</b> due today</span><span><b>{data.dueSoon}</b> due in 1–3 days</span>{data.missingExpiry>0&&<span><b>{data.missingExpiry}</b> flighted without an expiry date</span>}</div>
    </section>
    <section className="sd-panel"><header><div><h2>Inventory mix</h2><p>Compare formats by billboard count or faces.</p></div><div className="sd-switch" role="group" aria-label="Inventory chart measure">{(['boards','faces'] as const).map(m=><button key={m} aria-pressed={measure===m} onClick={()=>setMeasure(m)}>{m==='boards'?'Billboards':'Faces'}</button>)}</div></header>
     <div className="sd-bars">{data.types.map((t:any)=><button key={t.id} className="sd-bar" disabled={t.id==='other'||!t.boards} onClick={()=>onNavigate('inventory',{type:t.id})} aria-label={`${t.label}: ${number(t[measure])} ${measure==='boards'?'billboards':'faces'}. View inventory`}><span>{t.label}</span><strong>{number(t[measure])}</strong><div><i style={{width:`${(measure==='boards'?data.total:data.faces)?t[measure]/(measure==='boards'?data.total:data.faces)*100:0}%`}}/></div></button>)}</div>
     {!data.total&&<p className="sd-muted">No billboards are assigned to this project.</p>}
    </section>
   </div>
   <div className="sd-work-grid">
    <section className="sd-panel sd-expiry"><header><div><h2>Deflighting worklist</h2><p>{expiry.length} overdue or due within {horizon} days · dates use East Africa Time.</p></div><label>Look ahead<SearchSelect aria-label="Expiry look ahead" value={horizon} onChange={e=>setHorizon(Number(e.target.value))}><option value={3}>3 days</option><option value={7}>7 days</option><option value={30}>30 days</option></SearchSelect></label></header>
     <div className="sd-table-scroll" tabIndex={0} aria-label="Deflighting worklist"><table><thead><tr><th>Billboard / location</th><th>Expiry date</th><th>Time remaining</th><th><span className="planner-sr-only">Action</span></th></tr></thead><tbody>{expiry.slice(0,50).map((b:any)=><tr key={b.inventoryId}><td><strong>{b.name}</strong><small>{b.area||'Area not recorded'}</small></td><td>{date(b.end)}</td><td><span className="sd-due" data-overdue={b.remaining<0}>{b.remaining<0?`${Math.abs(b.remaining)} day${b.remaining===-1?'':'s'} overdue`:b.remaining===0?'Due today':`${b.remaining} day${b.remaining===1?'':'s'} left`}</span></td><td><button onClick={()=>onNavigate('inventory',{query:b.name})} aria-label={`Locate ${b.name}`}><MapPin size={15}/>Locate</button></td></tr>)}</tbody></table>{!expiry.length&&<p className="sd-empty">No billboards are overdue or due within this window.</p>}</div>
     {expiry.length>50&&<p className="sd-muted">Showing the first 50 by expiry. Open flighting for the full list.</p>}
    </section>
    <section className="sd-panel"><header><div><h2>Field validation</h2><p>{validationTotal} assignments on current project billboards.</p></div><button onClick={()=>onNavigate('field')}>Field work<ArrowUpRight size={14}/></button></header>
     <div className="sd-bars">{data.validations.map((v:any)=><button className="sd-bar" key={v.status} onClick={()=>onNavigate('field')}><span>{validationLabels[v.status]||v.status.replaceAll('_',' ')}</span><strong>{v.value}</strong><div><i data-tone={v.status==='issue'?'overdue':undefined} style={{width:`${validationTotal?v.value/validationTotal*100:0}%`}}/></div></button>)}</div>
     {!validationTotal&&<p className="sd-empty">No validation assignments for these billboards.</p>}
     <div className="sd-inline-facts">{data.collections.map((c:any)=><span key={c.status}><b>{c.value}</b> {c.status} collections</span>)}</div>
    </section>
   </div>
   <div className="sd-primary">
    <section className="sd-panel"><header><div><h2>Activity over 14 days</h2><p>Recorded changes per day · EAT.</p></div><button onClick={()=>onNavigate('history')}>Activity history<ArrowUpRight size={14}/></button></header>
     <div className="sd-trend" role="img" aria-label={trends.map((t:any)=>`${t.day}: ${t.value} activities`).join('; ')}>{trends.map((t:any)=><div key={t.day} title={`${t.day}: ${t.value} activities`}><strong>{t.value||''}</strong><i style={{height:`${t.value/trendMax*100}%`}}/><span>{t.day.slice(8)}</span></div>)}</div>
     <div className="sd-trend-axis"><span>{trends[0]?.day}</span><span>{trends.at(-1)?.day}</span></div>
     <details className="sd-chart-data"><summary>View chart data</summary><ul>{trends.map((t:any)=><li key={t.day}>{t.day}<strong>{t.value} changes</strong></li>)}</ul></details>
    </section>
    <section className="sd-panel"><header><div><h2>Message delivery</h2><p>Individual delivery queue · all time.</p></div><button onClick={()=>onNavigate('notifications')}>Delivery log<ArrowUpRight size={14}/></button></header>
     <div className="sd-message-list">{['sms','email','whatsapp'].map(channel=>{const rows=data.messages.filter((m:any)=>m.channel===channel);return <div key={channel}><strong>{channel==='sms'?'SMS':channel==='email'?'Email':'WhatsApp'}</strong><div>{rows.length?rows.map((m:any)=><span key={m.status} data-warning={['failed','unknown'].includes(m.status)}><b>{number(m.value)}</b> {statusLabels[m.status]||m.status}</span>):<span>No queued messages</span>}</div></div>;})}</div>
     <p className="sd-muted">Provider acceptance is not proof of delivery. Historical batch sends are available in the delivery log.{failed>0?` ${number(failed)} failed or unconfirmed messages need review.`:''}</p>
    </section>
   </div>
   <section className="sd-panel sd-recent"><header><div><h2>Recent project activity</h2><p>Assignments, removals and other recorded changes.</p></div><button onClick={()=>onNavigate('history')}><ClipboardList size={15}/>View full history</button></header>
    {data.activity.length?<ol>{data.activity.map((a:any)=><li key={a.id}><time dateTime={new Date(a.created_at).toISOString()}>{time(a.created_at)} EAT</time><div><strong>{a.event}</strong><span>{a.billboard}</span></div><span>{a.actor}</span><button onClick={()=>onNavigate('history')} aria-label={`View history for ${a.billboard}`}><ArrowUpRight size={16}/></button></li>)}</ol>:<p className="sd-empty">Changes to this project will appear here.</p>}
   </section>
  </>}
 </section>;
}
