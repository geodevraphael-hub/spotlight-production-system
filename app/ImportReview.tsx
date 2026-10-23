"use client";
import SearchSelect from './SearchSelect';
import {useMemo,useState} from 'react';
import {validCoordinates,inventoryFingerprint} from './operations-rules.mjs';
import {validateRegisterFields} from './asset-register.mjs';
export default function ImportReview({items,existing,onCancel,onImport}:{items:any[];existing:any[];onCancel:()=>void;onImport:(items:any[])=>Promise<void>}) {
 const [rows,setRows]=useState(items.map(item=>({...item,include:true})));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const problems=useMemo(()=>{
  const seen=new Set(existing.map(inventoryFingerprint));
  return rows.map(row=>{
   if(!row.include)return 'Excluded';
   if(!validCoordinates(row.lat,row.lng))return 'Invalid or missing GPS';
   if(!String(row.street||'').trim())return 'Name required';
   if(!['lamp-post','large-format','digital-screen','fabricated-banner'].includes(row.mediaType))return 'Choose board type';
   try{validateRegisterFields(row);}catch(e:any){return e.message;}
   const key=inventoryFingerprint(row);if(seen.has(key))return 'Duplicate location/name/type';
   seen.add(key);return '';
  });
 },[rows,existing]);
 const update=(index:number,key:string,value:any)=>setRows(current=>current.map((row,position)=>position===index?{...row,[key]:value}:row));
 const ready=rows.filter((row,index)=>row.include&&!problems[index]);
 const fields=[['street','Name'],['lat','Latitude'],['lng','Longitude'],['registrationNumber','Registration number'],['priority','Priority A / B / C'],['installations','Installations'],['mediaGroup','Media group'],['photoUrl','Photo URL']];
 return <div className="import-review-backdrop"><section className="import-review" role="dialog" aria-modal="true" aria-label="Review import">
  <header className="ops-heading"><div><h2>Review before importing</h2><p>{ready.length} ready · {rows.length-ready.length} excluded or need attention. Correct values or exclude rows. Leave registration blank until KM provides it.</p></div><button onClick={onCancel} disabled={busy} aria-label="Close import review">Close</button></header>
  {error&&<p role="alert" className="ops-error">{error}</p>}
  <div className="ops-table"><table><thead><tr><th>Import</th><th>Row</th>{fields.map(([key,title])=><th key={key}>{title}</th>)}<th>Media type</th><th>Review</th></tr></thead><tbody>
   {rows.map((row,index)=><tr key={index}><td><input type="checkbox" disabled={busy} aria-label={`Include row ${index+2}`} checked={row.include} onChange={event=>update(index,'include',event.target.checked)}/></td><td>{index+2}</td>
    {fields.map(([key,title])=><td key={key}><input disabled={busy} aria-label={`${title} row ${index+2}`} value={typeof row[key]==='number'&&Number.isNaN(row[key])?'':row[key]??''} onChange={event=>update(index,key,event.target.value)}/></td>)}
    <td><SearchSelect disabled={busy} aria-label={`Type row ${index+2}`} value={row.mediaType} onChange={event=>update(index,'mediaType',event.target.value)}>{['lamp-post','large-format','digital-screen','fabricated-banner'].map(type=><option key={type}>{type}</option>)}</SearchSelect></td><td>{problems[index]||'Ready'}</td></tr>)}
  </tbody></table></div>
  <footer><button className="text-button" disabled={busy} onClick={()=>setRows(current=>current.map((row,index)=>({...row,include:!problems[index]})))}>Exclude flagged rows</button><button className="primary-button" disabled={busy||!ready.length||rows.some((row,index)=>row.include&&problems[index])} onClick={async()=>{setBusy(true);setError('');try{await onImport(ready.map(({include,...row})=>validateRegisterFields(row)));}catch(error){setError(error instanceof Error?error.message:'Import failed');}finally{setBusy(false);}}}>{busy?'Importing…':`Import ${ready.length} billboards`}</button></footer>
 </section></div>;
}
