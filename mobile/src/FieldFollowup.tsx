import {useEffect,useState} from 'react';
import {pending,synchronize,queueSubmission,cache,cached} from './offline';

export default function FieldFollowup({owner,send}:{owner:number;send:(path:string,init?:RequestInit)=>Promise<Response>}) {
  const [queue,setQueue]=useState<any[]>([]),[issues,setIssues]=useState<any[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function refresh(){
    setQueue(await pending(owner));
    try{const response=await send('/api/operations?section=my-issues');if(response.ok){const data=await response.json();setIssues(data.rows);await cache(`issues:${owner}`,data.rows);}}
    catch{setIssues(await cached<any[]>(`issues:${owner}`)||[]);}
  }
  async function sync(){setBusy(true);try{await synchronize(owner,send);await refresh();}finally{setBusy(false);}}
  useEffect(()=>{void sync();const online=()=>void sync();window.addEventListener('online',online);const interval=window.setInterval(()=>void refresh(),15000);return()=>{window.removeEventListener('online',online);window.clearInterval(interval);};},[owner]);
  return <section className="field-followup"><h2>Uploads & corrective work</h2><p>{navigator.onLine?'Connected':'Offline — work is saved on this device'} · {queue.length} awaiting upload</p><button className="btn-primary" disabled={busy} onClick={()=>void sync()}>{busy?'Synchronizing…':'Sync saved work'}</button>{message&&<p role="status">{message}</p>}{queue.map(item=><p key={item.id}>Saved {new Date(item.createdAt).toLocaleString()} {item.error&&`— ${item.error}`}</p>)}{issues.map(issue=><article className="mission-card" key={issue.id}><h3>Corrective work #{issue.id}</h3><p>{issue.project_name} · Billboard {issue.asset_id}</p><p>Due: {issue.due_date||'Not set'} · {issue.status.replaceAll('_',' ')}</p><p>{JSON.parse(issue.report||'{}').issueType}</p>{issue.admin_remark&&<p>Review: {issue.admin_remark}</p>}{['open','in_progress','returned'].includes(issue.status)&&<form onSubmit={async event=>{
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const file=data.get('photo') as File;
    if(!file?.size)return;setBusy(true);setMessage('');
    try{
      const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=bitmap.width*scale;canvas.height=bitmap.height*scale;canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      await queueSubmission(owner,'/api/operations',{action:'resolve-issue',id:issue.id,resolution:String(data.get('resolution')),photo:canvas.toDataURL('image/jpeg',.78)});
      form.reset();setMessage('Corrective work saved on this device.');await sync();
    }catch{setMessage('Could not save the report. Keep this form open and try again.');}finally{setBusy(false);}
  }}><label>Work completed<textarea name="resolution" required/></label><label>Corrective photo<input name="photo" type="file" accept="image/*" capture="environment" required/></label><button className="btn-primary" disabled={busy}>Submit for admin review</button></form>}</article>)}</section>;
}
