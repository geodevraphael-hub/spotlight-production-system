"use client";
import SearchSelect from './SearchSelect';
import { useEffect, useState } from 'react';
import { operationsData, activityChanges } from './operations-view.mjs';

type Section = 'notifications'|'history'|'issues'|'bookings'|'costs';
const categories = ['rental','printing','transport','flighting'];
const currency = (value:number) => new Intl.NumberFormat('en-TZ',{style:'currency',currency:'TZS',maximumFractionDigits:0}).format(value);
const dateTime = (value:number) => new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Nairobi'});

function ActivityChangeDetails({row}:{row:any}) {
  const changes=activityChanges(row.detail,row.event);
  return <details className="ops-change-details"><summary>View change details{changes.rows.length>0&&` (${changes.rows.length})`}</summary>
    {changes.rows.length>0?<>
      <p className="ops-change-help">Changed fields are shown below. “Not set” means empty or absent. Older records may show “Not recorded” where a previous value was not captured.</p>
      <div className="ops-changes-wrap"><table className="ops-changes" aria-label={`${row.event} changes`}><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>
        {changes.rows.map((change:any,index:number)=><tr key={index}><th scope="row">{change.field}</th><td>{change.before}</td><td>{change.after}</td></tr>)}
      </tbody></table></div>
    </>:<p className="ops-change-help">{changes.message}</p>}
  </details>;
}

export default function Operations({projectId,boards,role,initialSection='notifications'}: {projectId:number;boards:any[];role:string;initialSection?:Section}) {
  const [section,setSection] = useState<Section>(initialSection);
  const [result,setResult] = useState<any>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [revision,setRevision] = useState(0);
  const [filter,setFilter] = useState('');
  const [status,setStatus] = useState('all');
  const [scope,setScope] = useState(role==='admin'?'all':'project');
  const [channel,setChannel] = useState('all');
  const [source,setSource] = useState('all');
  const [page,setPage] = useState(1);
  const [searchQuery,setSearchQuery] = useState('');
  const [assetId,setAssetId] = useState('');
  const [historyActor,setHistoryActor] = useState('');
  const [historyEvent,setHistoryEvent] = useState('');
  const [historyFrom,setHistoryFrom] = useState('');
  const [historyTo,setHistoryTo] = useState('');
  const [exporting,setExporting] = useState(false);
  const [planId,setPlanId] = useState('');
  const [month,setMonth] = useState(new Date().toISOString().slice(0,7));
  const notificationScope=role==='admin'&&(!projectId||scope==='all')?'all':'project';
  const canShow=Boolean(projectId)||(section==='notifications'&&notificationScope==='all');
  const params=new URLSearchParams({projectId:String(projectId||0),section,assetId});
  if(section==='notifications')Object.entries({scope:notificationScope,page:String(page),q:searchQuery,status,channel,source}).forEach(([key,value])=>params.set(key,value));
  if(section==='history')Object.entries({page:String(page),q:searchQuery,actor:historyActor,event:historyEvent,from:historyFrom,to:historyTo}).forEach(([key,value])=>params.set(key,value));
  const requestKey=params.toString();
  const data=operationsData(result,requestKey);
  const previousParams=new URLSearchParams(result?.key||'');
  const historyOptions=previousParams.get('section')==='history'&&previousParams.get('projectId')===String(projectId)?result.data:{};
  useEffect(()=>{setAssetId('');setPlanId('');setFilter('');setSearchQuery('');setStatus('all');setPage(1);setChannel('all');setSource('all');setHistoryActor('');setHistoryEvent('');setHistoryFrom('');setHistoryTo('');},[projectId,section]);
  useEffect(()=>{const timer=window.setTimeout(()=>setSearchQuery(filter),250);return ()=>window.clearTimeout(timer);},[filter]);
  useEffect(()=>{
    const controller = new AbortController();
    if (!canShow) return;
    setBusy(true); setError('');
    fetch(`/api/operations?${requestKey}`,{signal:controller.signal}).then(async response=>{
      const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
    }).then(data=>{if(!controller.signal.aborted)setResult({key:requestKey,data});}).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[requestKey,revision,canShow]);
  useEffect(()=>{
    if (!canShow || section!=='notifications') return;
    const refresh=()=>{if(document.visibilityState==='visible')setRevision(value=>value+1);};
    const timer=window.setInterval(refresh,15000);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[canShow,section]);
  async function save(action:string,values:any) {
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,projectId:values.projectId??projectId,action})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      setRevision(value=>value+1);return true;
    } catch(error){setError(error instanceof Error?error.message:'Unable to save');return false;} finally{setBusy(false);}
  }
  async function submit(event:React.FormEvent<HTMLFormElement>,action:string) {
    event.preventDefault();const form=event.currentTarget;
    if(await save(action,Object.fromEntries(new FormData(form))))form.reset();
  }
  const rows=['notifications','history'].includes(section)?(data.rows||[]):(data.rows || []).filter((row:any)=>(status==='all'||row.status===status)&&JSON.stringify(row).toLowerCase().includes(filter.toLowerCase()));
  const deliveryStatuses=['pending','sending','retry','accepted','delivered','read','failed','unknown','sent','skipped'];
  const pages=Math.max(1,Math.ceil((data.total||0)/(data.pageSize||50)));
  function changeDelivery(setter:(value:string)=>void,value:string){setPage(1);setter(value);}
  async function exportHistory() {
    setExporting(true);setError('');
    try {
      const exportParams=new URLSearchParams(requestKey);exportParams.set('format','excel');exportParams.delete('page');
      const response=await fetch(`/api/operations?${exportParams}`);
      if(!response.ok)throw new Error((await response.json()).error||'Unable to export history');
      const blob=await response.blob();const url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download=`spotlight-project-${projectId}-activity-history.xls`;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error){setError(error instanceof Error?error.message:'Unable to export history');} finally{setExporting(false);}
  }
  const boardOptions=boards.filter(board=>board.inventoryDbId).map(board=><option key={board.inventoryDbId} value={board.inventoryDbId}>{board.street} — {board.district}</option>);
  const plan=data.plans?.find((item:any)=>String(item.id)===planId);
  let planned:any={};try{planned=plan?JSON.parse(plan.data):{};}catch{}
  const scopedCosts=(data.rows||[]).filter((row:any)=>!plan||(planned.shortlist||[]).map(Number).includes(Number(boards.find(board=>board.inventoryDbId===row.inventory_id)?.id)));
  const summary=categories.map(category=>({category,budget:(planned.shortlist||[]).reduce((sum:number,id:number)=>sum+Number(planned.costs?.[id]?.[category]||0),0),actual:scopedCosts.reduce((sum:number,row:any)=>sum+(row.category===category?row.amount_minor/100:0),0)}));
  function exportCosts() {
    const cells=[['Scope',plan?.name||'Entire project'],['Category','Budget TZS','Actual TZS','Variance TZS'],...summary.map(row=>[row.category,plan?row.budget:'Not selected',row.actual,plan?row.actual-row.budget:'Not selected']),[],['Billboard','Category','Amount TZS','Date','Reference'],...scopedCosts.map((row:any)=>[row.billboard,row.category,row.amount_minor/100,row.incurred_on,row.reference])];
    const csv=cells.map(row=>row.map((value:unknown)=>`"${String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`).join(',')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='budget-actual-costs.csv';link.click();URL.revokeObjectURL(url);
  }
  return <section className="ops-page">
    <header className="ops-heading"><div><h2>Project operations</h2><p>Delivery, field follow-up, reservations and spending.</p></div><button className="text-button" disabled={busy} onClick={()=>setRevision(value=>value+1)}>Refresh</button></header>
    <nav className="ops-tabs" aria-label="Operations sections">{(['notifications','issues','bookings','costs','history'] as Section[]).map(item=><button key={item} aria-current={item===section?'page':undefined} onClick={()=>setSection(item)}>{{notifications:'Message delivery',issues:'Issue resolution',bookings:'Booking calendar',costs:'Budget & actuals',history:'Activity history'}[item]}</button>)}</nav>
    {!canShow?<p className="empty-state">Choose one project from the project selector to manage its operations.</p>:<>
      {error&&<p role="alert" className="ops-error">{error}</p>}
      <div className="ops-toolbar"><input aria-label="Search operations" placeholder={section==='notifications'?'Search recipient, message or reference':'Search this list'} value={filter} onChange={event=>changeDelivery(setFilter,event.target.value)}/>{['notifications','issues','bookings'].includes(section)&&<SearchSelect aria-label="Filter status" value={status} onChange={event=>changeDelivery(setStatus,event.target.value)}><option value="all">All statuses</option>{(section==='notifications'?deliveryStatuses:[...new Set((data.rows||[]).map((row:any)=>row.status))]).map((value:any)=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</SearchSelect>}{section==='history'&&<SearchSelect aria-label="Billboard history" value={assetId} onChange={event=>changeDelivery(setAssetId,event.target.value)}><option value="">All billboards</option>{boards.map(board=><option key={board.id} value={board.id}>{board.street}</option>)}</SearchSelect>}<span role="status">{busy?'Loading…':['notifications','history'].includes(section)?`${data.total||0} matching records`:`${rows.length} records`}</span></div>
      {section==='history'&&<div className="ops-toolbar ops-history-filters">
        <label>User<SearchSelect aria-label="History user" value={historyActor} onChange={event=>changeDelivery(setHistoryActor,event.target.value)}><option value="">All users</option>{(historyOptions.users||[]).map((user:any)=><option key={user.id} value={user.id}>{user.name}{user.id!=='system'?` (#${user.id})`:''}</option>)}</SearchSelect></label>
        <label>Type of change<SearchSelect aria-label="History change type" value={historyEvent} onChange={event=>changeDelivery(setHistoryEvent,event.target.value)}><option value="">All change types</option>{(historyOptions.events||[]).map((event:string)=><option key={event} value={event}>{event}</option>)}</SearchSelect></label>
        <label>From date (EAT)<input aria-label="History from date" type="date" value={historyFrom} max={historyTo||undefined} onBlur={event=>changeDelivery(setHistoryFrom,event.currentTarget.value)} onChange={event=>changeDelivery(setHistoryFrom,event.target.value)}/></label>
        <label>To date (EAT)<input aria-label="History to date" type="date" value={historyTo} min={historyFrom||undefined} onBlur={event=>changeDelivery(setHistoryTo,event.currentTarget.value)} onChange={event=>changeDelivery(setHistoryTo,event.target.value)}/></label>
        <div className="ops-history-actions"><button className="text-button" onClick={()=>{setPage(1);setFilter('');setSearchQuery('');setAssetId('');setHistoryActor('');setHistoryEvent('');setHistoryFrom('');setHistoryTo('');}}>Clear filters</button>
        {role==='admin'&&<button className="primary-button" disabled={busy||exporting||filter!==searchQuery||!data.total||Boolean(error)} onClick={()=>void exportHistory()}>{exporting?'Exporting…':'Export filtered Excel'}</button>}</div>
      </div>}
      {section==='notifications'&&<>
        <div className="ops-toolbar ops-delivery-filters">
          {role==='admin'&&<label>Message scope<SearchSelect aria-label="Message scope" value={notificationScope} onChange={event=>changeDelivery(setScope,event.target.value)}><option value="all">All projects &amp; system</option><option value="project" disabled={!projectId}>Selected project only</option></SearchSelect></label>}
          <label>Channel<SearchSelect aria-label="Message channel" value={channel} onChange={event=>changeDelivery(setChannel,event.target.value)}><option value="all">All channels</option><option value="sms">Normal SMS</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></SearchSelect></label>
          <label>Records<SearchSelect aria-label="Record source" value={source} onChange={event=>changeDelivery(setSource,event.target.value)}><option value="all">Current &amp; historical</option><option value="queue">Current delivery queue</option><option value="history">Historical log</option></SearchSelect></label>
          <button className="text-button" onClick={()=>{setPage(1);setFilter('');setSearchQuery('');setStatus('all');setChannel('all');setSource('all');}}>Clear filters</button>
        </div>
        <p className="ops-delivery-scope"><strong>Showing: {data.scopeName||(notificationScope==='all'?'All projects & system':'Selected project')}</strong> · Includes older notification logs. Historical rows may group several recipients.</p>
        <p className="ops-help">Updates every 15 seconds. Accepted means submitted to the provider, not confirmed handset delivery. Delivered/read require provider evidence; historical “sent” is the original logged result. A dash means the timestamp or attempt count was not recorded. Unknown outcomes must be checked with the provider before retrying. Viewing this page never sends messages.</p>
        <div className="ops-table"><table>
          <thead><tr>{['Project','Recipient','Channel','Message / reference','Status','Delivered','Read','Attempts','Created / updated','Action'].map(text=><th key={text}>{text}</th>)}</tr></thead>
          <tbody>{rows.map((row:any)=><tr key={`${row.source}:${row.id}`}>
            <td>{row.project_name}<small className="ops-record-meta">{row.source==='history'?'Historical log':'Delivery queue'}</small></td>
            <td>{row.recipient||'Not recorded'}{row.recipient_count>1&&<small className="ops-record-meta">Group record · {row.recipient_count} recipients</small>}</td><td>{row.channel==='sms'?'Normal SMS':row.channel}</td>
            <td>{row.subject}{row.provider_id&&<small className="ops-record-meta">Reference: {row.provider_id}</small>}{row.message_text&&<details><summary>View message</summary><p className="ops-message-text">{row.message_text}</p></details>}{row.last_error&&<details><summary>Delivery details</summary><p className="ops-message-text">{row.last_error}</p></details>}</td>
            <td><span className="ops-status">{row.status}</span></td>
            <td>{row.delivered_at?dateTime(row.delivered_at):['delivered','read'].includes(row.status)?'Reported; time not recorded':'—'}</td><td>{row.read_at?dateTime(row.read_at):'—'}</td>
            <td>{row.attempts??'—'}</td><td>{dateTime(row.created_at)}{row.updated_at!==row.created_at&&<small className="ops-record-meta">Updated: {dateTime(row.updated_at)}</small>}</td>
            <td>{role==='admin'&&row.source==='queue'&&row.project_id>0&&['failed','unknown'].includes(row.status)&&<button disabled={busy} onClick={()=>{if(row.status!=='unknown'||window.confirm('Confirm the provider did not deliver this message before retrying.'))void save('retry-notification',{id:row.id,projectId:row.project_id});}}>Retry</button>}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="ops-pagination"><span>{data.total?`${(page-1)*(data.pageSize||50)+1}–${Math.min(page*(data.pageSize||50),data.total)} of ${data.total} records`:'0 records'} · Page {page} of {pages}</span><button disabled={busy||page<=1} onClick={()=>setPage(value=>value-1)}>Previous</button><button disabled={busy||page>=pages} onClick={()=>setPage(value=>value+1)}>Next</button></div>
      </>}
      {section==='issues'&&<div className="ops-issues">{rows.map((row:any)=>{let report:any={};try{report=JSON.parse(row.report);}catch{}return <article key={row.id} className="ops-issue"><header><h3>{boards.find(board=>Number(board.id)===row.asset_id)?.street||`Billboard ${row.asset_id}`}</h3><span className="ops-status">{row.status.replaceAll('_',' ')}{row.due_date<new Date().toISOString().slice(0,10)&&row.status!=='approved'?' · Overdue':''}</span></header><p>{report.issueType} — {report.issueDetail || report.customIssue}</p><p>Owner: {row.owner||'Unassigned'} · Due: {row.due_date||'Not set'}</p>{report.photo&&<a href={report.photo} target="_blank" rel="noreferrer">Original evidence</a>}{['open','in_progress','returned'].includes(row.status)&&<form className="ops-form" onSubmit={event=>submit(event,'update-issue')}><input type="hidden" name="id" value={row.id}/><label>Assigned field user<SearchSelect name="ownerId" defaultValue={row.owner_id||''} required><option value="">Choose owner</option>{(data.users||[]).map((user:any)=><option key={user.id} value={user.id}>{user.name}</option>)}</SearchSelect></label><label>Deadline<input name="dueDate" type="date" required defaultValue={row.due_date||''}/></label><button className="primary-button" disabled={busy}>Assign corrective work</button></form>}{row.resolution&&<p><strong>Corrective work:</strong> {row.resolution}</p>}{row.photo&&<a href={row.photo} target="_blank" rel="noreferrer"><img className="ops-evidence" src={row.photo} alt="Corrective work evidence"/></a>}{row.admin_remark&&<p>Review: {row.admin_remark}</p>}{role==='admin'&&row.status==='awaiting_approval'&&<form className="ops-form" onSubmit={event=>submit(event,'update-issue')}><input type="hidden" name="id" value={row.id}/><label>Review decision<SearchSelect name="status"><option value="approved">Approve and mark okay</option><option value="returned">Return for correction</option></SearchSelect></label><label>Review remark<input name="remark" required/></label><button disabled={busy} className="primary-button">Save review</button></form>}</article>;})}</div>}
      {section==='bookings'&&<><form className="ops-form" onSubmit={event=>submit(event,'book')}><label>Billboard<SearchSelect name="inventoryId" required><option value="">Select billboard</option>{boardOptions}</SearchSelect></label><label>Face number<input name="face" type="number" min="1" step="1" required defaultValue="1"/></label><label>Campaign<input name="campaign" required/></label><label>From<input name="startsOn" type="date" required/></label><label>Through (inclusive)<input name="endsOn" type="date" required/></label><button disabled={busy} className="primary-button">Reserve face</button></form><label className="ops-month">Calendar month<input type="month" value={month} onChange={event=>setMonth(event.target.value)}/></label><div className="ops-calendar">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><strong className="ops-weekday" key={day}>{day}</strong>)}{Array.from({length:(new Date(`${month}-01T12:00:00`).getDay()+6)%7},(_,index)=><div className="ops-calendar-blank" key={`blank-${index}`} aria-hidden="true"/>)}{Array.from({length:new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()},(_,index)=>{const day=`${month}-${String(index+1).padStart(2,'0')}`;return <div key={day}><strong>{index+1}</strong>{rows.filter((row:any)=>row.status!=='cancelled'&&row.starts_on<=day&&row.ends_on>=day).map((row:any)=><span key={row.id} title={`${row.campaign}: ${row.billboard}, face ${row.face}`}>{row.billboard} · F{row.face}</span>)}</div>;})}</div><div className="ops-table"><table><thead><tr><th>Billboard</th><th>Face</th><th>Campaign</th><th>From</th><th>Through</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row:any)=><tr key={row.id}><td>{row.billboard}</td><td>{row.face}</td><td>{row.campaign}</td><td>{row.starts_on}</td><td>{row.ends_on}</td><td>{row.status}</td><td>{row.status!=='cancelled'&&<button disabled={busy} onClick={()=>{if(window.confirm('Cancel this reservation? Its history will be kept.'))void save('cancel-booking',{id:row.id});}}>Cancel reservation</button>}</td></tr>)}</tbody></table></div></>}
      {section==='costs'&&<><p className="ops-help">Actuals include all recorded costs in this project. Selecting a plan limits the comparison to that plan’s billboards; it does not filter costs by campaign date.</p><div className="ops-toolbar"><label>Compare against plan<SearchSelect value={planId} onChange={event=>setPlanId(event.target.value)}><option value="">Choose saved plan</option>{(data.plans||[]).map((plan:any)=><option key={plan.id} value={plan.id}>{plan.name}</option>)}</SearchSelect></label><button className="text-button" onClick={exportCosts}>Export cost comparison</button></div><div className="ops-table"><table><thead><tr><th>Category</th><th>Planned</th><th>Actual</th><th>Actual − planned</th></tr></thead><tbody>{summary.map(row=><tr key={row.category}><td>{row.category}</td><td>{plan?currency(row.budget):'Choose a plan'}</td><td>{currency(row.actual)}</td><td>{plan?currency(row.actual-row.budget):'—'}</td></tr>)}<tr><th>Total</th><th>{plan?currency(summary.reduce((sum,row)=>sum+row.budget,0)):'—'}</th><th>{currency(summary.reduce((sum,row)=>sum+row.actual,0))}</th><th>{plan?currency(summary.reduce((sum,row)=>sum+row.actual-row.budget,0)):'—'}</th></tr></tbody></table></div><form className="ops-form" onSubmit={event=>submit(event,'record-cost')}><label>Billboard<SearchSelect name="inventoryId" required><option value="">Select billboard</option>{boardOptions}</SearchSelect></label><label>Category<SearchSelect name="category">{categories.map(category=><option key={category}>{category}</option>)}</SearchSelect></label><label>Actual amount (TZS)<input name="amount" type="number" min="0" step="0.01" required/></label><label>Date<input name="incurredOn" type="date" required/></label><label>Invoice / receipt reference<input name="reference"/></label><label>Note<input name="note"/></label><button className="primary-button" disabled={busy}>Record actual cost</button></form><div className="ops-table"><table><thead><tr><th>Billboard</th><th>Category</th><th>Actual</th><th>Date</th><th>Reference</th><th>Recorded by</th></tr></thead><tbody>{rows.map((row:any)=><tr key={row.id}><td>{row.billboard}</td><td>{row.category}</td><td>{currency(row.amount_minor/100)}</td><td>{row.incurred_on}</td><td>{row.reference}</td><td>{row.recorded_by}</td></tr>)}</tbody></table></div></>}
      {section==='history'&&<>
        <p className="ops-help">Selected project, newest first. Date ranges include both days in East Africa Time (UTC+3).{role==='admin'&&' Excel exports include every matching activity and its field-by-field before and after values, across all pages.'}</p>
        {rows.length>0?<ol className="ops-timeline">{rows.map((row:any)=><li key={row.id}><time dateTime={new Date(row.created_at).toISOString()}>{dateTime(row.created_at)} EAT</time><div><strong>{row.event}</strong><p>{row.billboard||boards.find(board=>Number(board.id)===Number(row.asset_id))?.street||(row.asset_id?`Billboard ${row.asset_id}`:'Project activity')} · {row.project_name||`Project #${projectId}`}</p><p>By {row.actor||'System / legacy unrecorded user'}</p><ActivityChangeDetails row={row}/></div></li>)}</ol>:!busy&&!error&&<p className="empty-state">{filter||assetId||historyActor||historyEvent||historyFrom||historyTo?'No activity matches these filters. Use Clear filters to see all history.':'No activity has been recorded for this project yet.'}</p>}
        <div className="ops-pagination"><span>{data.total?`${((data.page||1)-1)*50+1}–${Math.min((data.page||1)*50,data.total)} of ${data.total} activities`:'0 activities'} · Page {data.page||1} of {pages}</span><button disabled={busy||!data.total||(data.page||1)<=1} onClick={()=>setPage((data.page||1)-1)}>Previous</button><button disabled={busy||!data.total||(data.page||1)>=pages} onClick={()=>setPage((data.page||1)+1)}>Next</button></div>
      </>}
      {section!=='history'&&!busy&&!rows.length&&<p className="empty-state">No records match this view.</p>}
    </>}
  </section>;
}
