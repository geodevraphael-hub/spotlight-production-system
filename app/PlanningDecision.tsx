"use client";
import SearchSelect from './SearchSelect';
import { useEffect, useMemo, useRef, useState } from "react";
import { X, SlidersHorizontal, MapPin, Plus, Check, Download, RefreshCw } from "lucide-react";
import { CRITERIA, decisionCriteria, rankBillboards, proposeShortlist, decisionCsv, usableEvidence } from "./planning-decision.mjs";
import { DEMOGRAPHIC_LEVELS, groupDemographicRows } from "./planning-demographics.mjs";

export type DecisionSettings={version:number;radius:number;weights:Record<string,number>;budget:string;count:number;populationBasis:string;demographicLevel:string};
type Settings=DecisionSettings;
type Board={id:number;street:string;projectName?:string;lat:number;lng:number;faces:number;[key:string]:any};
const number=(value:any)=>value==null?"Unavailable":Number(value).toLocaleString("en-US",{maximumFractionDigits:1});
const human=(key:string)=>key.replaceAll("_"," ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,c=>c.toUpperCase());
function Facts({value,depth=0}:{value:any;depth?:number}) {
  if(value===null||value===undefined)return <span>Unavailable</span>;
  if(typeof value!=="object")return <span>{typeof value==="boolean"?(value?"Yes":"No"):String(value)}</span>;
  if(depth>7)return <span>Nested detail omitted</span>;
  return <dl className="decision-facts">{Object.entries(value).filter(([key])=>!["geometry","coordinates"].includes(key)).slice(0,100).map(([key,item])=><div key={key}><dt>{Array.isArray(value)?`Record ${Number(key)+1}`:human(key)}</dt><dd>{item&&typeof item==="object"?<details><summary>View details</summary><Facts value={item} depth={depth+1}/></details>:<Facts value={item} depth={depth+1}/>}</dd></div>)}</dl>;
}
export default function PlanningDecision({boards,allBoards,costs,selected,settings,onSettings,onAdd,onLocate,onClose}:{
  boards:Board[];allBoards:Board[];costs:Record<number,any>;selected:number[];settings:Settings;
  onSettings:(value:Settings)=>void;onAdd:(ids:number[])=>void;onLocate:(board:Board)=>void;onClose:()=>void;
}) {
  const [evidence,setEvidence]=useState<Record<number,any>>({});
  const [provider,setProvider]=useState({configured:false,blocked:false,message:"Checking Location IQ connection…"});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[expanded,setExpanded]=useState<number|null>(null);
  const [proposal,setProposal]=useState<number[]|null>(null),[limit,setLimit]=useState(25),[groupAreas,setGroupAreas]=useState(true);
  const stop=useRef(false), closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
    closeRef.current?.focus();
    return()=>{stop.current=true;if(trigger?.isConnected)trigger.focus();};
  },[]);
  useEffect(()=>{
    let alive=true;setEvidence({});setMessage("");setProposal(null);
    fetch(`/api/app?action=planning-evidence&radius=${settings.radius}`,{cache:"no-store"}).then(async res=>{
      const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not load evidence.");
      if(alive){setEvidence(data.evidence??{});setProvider(data);}
    }).catch(error=>{if(alive)setProvider({configured:false,blocked:false,message:error.message});});
    return()=>{alive=false;};
  },[settings.radius]);
  // React object identity can change during background refresh without a real edit.
  const inputSignature=JSON.stringify([settings,boards.map(b=>[b.id,b.lat,b.lng,b.faces,b.rentalPrice,b.printingPrice,b.transportPrice,b.flightingPrice]),costs,selected]);
  useEffect(()=>{setProposal(null);setMessage("");setLimit(25);},[inputSignature]);
  const ranked=useMemo(()=>rankBillboards(boards,costs,evidence,settings),[boards,costs,evidence,settings]);
  const complete=ranked.filter((row:any)=>row.complete).length;
  const pending=boards.filter(board=>!usableEvidence(board,evidence[board.id],settings.radius));
  async function expand(id:number){
    setExpanded(expanded===id?null:id);
    if(!evidence[id]||evidence[id].facts)return;
    try {
      const res=await fetch(`/api/app?action=planning-evidence&radius=${settings.radius}&id=${id}`,{cache:"no-store"});
      const data=await res.json();if(!res.ok)throw new Error(data.error||"Unable to load location facts.");
      setEvidence(current=>({...current,...data.evidence}));
    }catch(error){setMessage(error instanceof Error?error.message:"Unable to load location facts.");}
  }
  async function enrich() {
    stop.current=false;setBusy(true);setMessage("");
    const batch=[...pending];
    try{
      for(let i=0;i<batch.length;i++){
        if(stop.current)break;
        setMessage(`Checking location ${i+1} of ${batch.length}: ${batch[i].street}`);
        const res=await fetch("/api/app?action=planning-enrich",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:batch[i].id,radius:settings.radius})});
        const data=await res.json();
        if(!res.ok)throw new Error(data.error||"Location lookup failed.");
        if(stop.current)break;
        setEvidence(current=>({...current,[batch[i].id]:data.evidence}));
        if(i<batch.length-1)await new Promise(resolve=>setTimeout(resolve,1200));
      }
      setMessage(stop.current?"Stopped. Completed evidence is retained.":"Location enrichment complete. Review coverage before adding recommendations.");
    }catch(error){setMessage(error instanceof Error?error.message:"Location lookup failed.");}
    finally{setBusy(false);}
  }
  function propose(){
    const result=proposeShortlist(ranked,settings,allBoards.filter(board=>selected.includes(board.id)),costs);
    const method=result.method==="budget-combinations"
      ? `${result.optimal?"Best combined criteria score":"Budget-optimised combination (bounded search)"} within your budget and board limit. Additional cost TZS ${number(result.cost)}; remaining budget TZS ${number(result.remaining)}.`
      : "Highest-ranked placements for your selected criteria.";
    setProposal(result.ids);setMessage(result.error||`${method} Review ${result.ids.length} placements, then add them to your plan. Scores are not unique audience reach.`);
  }
  function exportScores(){
    const url=URL.createObjectURL(new Blob(["\uFEFF"+decisionCsv(ranked,settings)],{type:"text/csv;charset=utf-8;"}));
    const link=document.createElement("a");link.href=url;link.download="spotlight-planning-decision.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="decision-overlay" onKeyDown={event=>{
    if(event.key==="Escape"){event.stopPropagation();onClose();}
    if(event.key==="Tab"){
      const nodes=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]')).filter(n=>n.getClientRects().length);
      const first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }}>
    <section className="decision-panel" role="dialog" aria-modal="true" aria-labelledby="decision-title">
      <header><div><h2 id="decision-title">Planning decision support</h2><p>Compare {boards.length} filtered billboards. Review evidence, then build your shortlist.</p></div><button ref={closeRef} onClick={onClose} className="icon-button" aria-label="Close decision support"><X size={20}/></button></header>
      <div className="decision-workspace">
        <aside className="decision-settings">
          <h3><SlidersHorizontal size={17}/>Your priorities</h3>
          <p>Weights express importance, not accuracy. Zero turns a criterion off.</p>
          <label>Starting point<SearchSelect disabled={busy} value="" onChange={e=>{
            const off=Object.fromEntries(CRITERIA.map(c=>[c.id,0]));
            if(e.target.value==="inventory")onSettings({...settings,weights:{...off,cost:3,faces:2}});
            if(e.target.value==="context")onSettings({...settings,populationBasis:'nbs',weights:{...off,cost:3,faces:2,population:3,commerce:2,transport:2}});
          }}><option value="">Custom priorities</option><option value="inventory">Inventory value only</option><option value="context">Cost and NBS location context</option></SearchSelect></label>
          <label>Population source<SearchSelect disabled={busy} value={settings.populationBasis} onChange={e=>onSettings({...settings,populationBasis:e.target.value})}><option value="nbs">NBS-based administrative area</option><option value="radius">WorldPop model within radius</option></SearchSelect></label>
          <label>Demographic comparison level<SearchSelect disabled={busy} value={settings.demographicLevel} onChange={e=>onSettings({...settings,demographicLevel:e.target.value})}>{DEMOGRAPHIC_LEVELS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</SearchSelect></label>
          <p>Missing village data stays unavailable. No larger area's population is substituted. Choose the same level for a fair comparison. Population and male/female counts overlap; avoid giving the same population multiple weights unintentionally.</p>
          {[['Placement',['cost','faces']],['Demographics',['population','households','male','female']],['Nearby context',['commerce','transport','buildings']]].map(([title,ids])=><fieldset className="decision-criteria-group" key={title as string}><legend>{title}</legend>{decisionCriteria(settings).filter(c=>(ids as string[]).includes(c.id)).map(c=><label className="decision-weight" key={c.id}><span>{c.label}<b>{settings.weights[c.id]??0}/5</b></span><input disabled={busy} aria-label={`${c.label} importance`} type="range" min="0" max="5" step="1" value={settings.weights[c.id]??0} onChange={e=>onSettings({...settings,weights:{...settings.weights,[c.id]:Number(e.target.value)}})}/><small>{c.source}</small></label>)}</fieldset>)}
          <label>Location radius<SearchSelect disabled={busy} value={settings.radius} onChange={e=>onSettings({...settings,radius:Number(e.target.value)})}><option value="500">500 metres</option><option value="1000">1 kilometre</option><option value="2000">2 kilometres</option></SearchSelect></label>
          <label>Total plan budget (TZS)<input type="number" min="0" step="0.01" placeholder="No budget limit" value={settings.budget} onChange={e=>onSettings({...settings,budget:e.target.value})}/></label>
          <label>Additional boards to suggest<input type="number" min="1" max="100" value={settings.count} onChange={e=>onSettings({...settings,count:Math.max(1,Math.min(100,Number(e.target.value)||1))})}/></label>
          <button className="primary-button" onClick={propose} disabled={!complete||busy}>Propose shortlist</button>
          <p>Compares combinations within your remaining budget and board limit to maximise the combined criteria score. Large searches are bounded and labelled accordingly. Requires complete evidence for every active criterion. Shared area population is not unique campaign reach. Confirm vendor availability before booking.</p>
        </aside>
        <main className="decision-results">
          <div className="decision-provider"><div><strong>Location IQ Tanzania</strong><p>{provider.message||(!provider.configured?"Server key is not configured.":"Data is cached for 7 days. Enrichment covers all pending results in your current filters. Keep this panel open until complete; completed records are retained if stopped.")}</p></div>
            {busy?<button onClick={()=>{stop.current=true;setMessage("Stopping after the current lookup…");}}>Stop after current</button>:<button disabled={!provider.configured||provider.blocked||!pending.length} onClick={enrich}><RefreshCw size={15}/>{pending.length?`Enrich ${pending.length} pending`:"Location data ready"}</button>}
          </div>
          <p className="decision-warning">Location context is not measured audience, visibility, footfall or ROI. NBS figures refer to 2022; village allocations are estimates, not census counts. Radius population uses a separate WorldPop model. Historical 2004 traffic is not used in these scores.</p>
          {message&&<p role="status" className="decision-message">{message}</p>}
          <div className="decision-results-head"><div><strong>{complete} / {boards.length} fully evidenced</strong><p>{boards.length-pending.length} location records ready · {pending.length} need enrichment or refresh for this radius</p>{ranked.some((row:any)=>row.usable&&row.context.coverageStatus==="administrative-only")&&<p>Some records have limited geographic coverage. Missing values never count as zero; open a result to inspect its available data.</p>}</div><button onClick={exportScores} disabled={!ranked.length}><Download size={15}/>Export scores</button></div>
          <label className="decision-group-toggle"><input type="checkbox" checked={groupAreas} onChange={e=>setGroupAreas(e.target.checked)}/>Group visible results by demographic area</label>
          {groupAreas&&<p>Ranked within each area below; shortlist suggestions use the overall ranking. Shared area populations are shown once, never added per billboard.</p>}
          {proposal!==null&&proposal.length>0&&<div className="decision-proposal"><span>{proposal.length} suggested additions highlighted below. Existing selections stay in your plan.</span><button className="primary-button" onClick={()=>{onAdd(proposal);setProposal(null);setMessage("Suggested placements added to the unsaved plan. Save the plan to keep them.");}}><Plus size={16}/>Add {proposal.length} to plan</button></div>}
          <div className="decision-table-wrap"><table><thead><tr><th>Billboard</th><th>Score</th><th>Evidence</th><th>Complete cost</th><th>Actions</th></tr></thead>{(groupAreas?groupDemographicRows(ranked.slice(0,limit)):[{key:'all',area:null,rows:ranked.slice(0,limit)}]).map((group:any)=><tbody key={group.key}>{groupAreas&&<tr className="decision-area-heading"><th colSpan={5} scope="rowgroup">{group.area?`${human(group.area.level)}: ${group.area.name}`:'Area unavailable'}<small>{group.rows.length} shown {group.rows.length===1?'billboard':'billboards'}{group.area?` · ${group.area.basis} · ${group.area.year} · Population ${number(group.area.population)}`:''}</small></th></tr>}{group.rows.map((row:any)=><DecisionRow key={row.board.id} row={row} expanded={expanded===row.board.id} proposed={proposal?.includes(row.board.id)??false} selected={selected.includes(row.board.id)} onExpand={()=>expand(row.board.id)} onAdd={()=>onAdd([row.board.id])} onLocate={()=>onLocate(row.board)}/>)}</tbody>)}</table></div>
          {!ranked.length&&<p>No billboards match the current inventory filters. Close this panel and adjust your filters.</p>}
          {ranked.length>limit&&<button onClick={()=>setLimit(n=>n+25)}>Show 25 more results</button>}
          <details className="decision-method"><summary>How to interpret this ranking</summary><p>Each active criterion is scaled from 0 to 100 relative to these filtered candidates. Lower cost is better; other criteria favour higher values. Equal values receive 50. The weighted average gives the score; missing values contribute no points and remain explicitly unavailable. Fully evidenced candidates come first. Scores change when filters, radius, costs or weights change.</p><p>Source years and coverage matter more than a precise-looking score. No viewing angle, illumination, obstruction, legal permit, live traffic, campaign availability, impressions or sales figures are inferred. Verify those separately. Save the plan to retain your weights and budget. Export scores to retain the current ranking snapshot.</p><a href="https://locationiq.co.tz/static/data-credits.html" target="_blank" rel="noreferrer">Location IQ source credits and limitations</a></details>
        </main>
      </div>
    </section>
  </div>;
}
function DecisionRow({row,expanded,proposed,selected,onExpand,onAdd,onLocate}:any){
  return <><tr data-proposed={proposed||undefined}><td><button className="decision-name" aria-expanded={expanded} onClick={onExpand}>{row.board.street}</button><small>{row.board.projectName}</small></td><td><strong>{row.score==null?"—":row.score.toFixed(1)}</strong><small>{row.complete?"Comparable":"Incomplete"}</small></td><td>{Math.round(row.coverage)}%</td><td>{number(row.values.cost)}{row.values.cost!=null&&<small>TZS</small>}</td><td><div className="decision-row-actions"><button onClick={onLocate} aria-label={`Locate ${row.board.street}`}><MapPin size={16}/></button><button disabled={selected} onClick={onAdd} aria-label={`Add ${row.board.street} from recommendations`}>{selected?<Check size={16}/>:<Plus size={16}/>} {selected?"In plan":"Add"}</button></div></td></tr>
    {expanded&&<tr><td colSpan={5}><section className="decision-explanation"><h4>Why this score?</h4><table><thead><tr><th>Criterion</th><th>Value</th><th>Weight</th><th>Points</th></tr></thead><tbody>{row.reasons.map((r:any)=><tr key={r.id}><td>{r.label}<small>{r.source}</small></td><td>{number(r.value)} {r.value!=null?r.unit:""}</td><td>{r.weight}/5</td><td>{r.score==null?"Unavailable":`${r.contribution.toFixed(1)} / 100`}</td></tr>)}</tbody></table>
    <p>{row.context?`Location data retrieved ${new Date(row.context.fetchedAt).toLocaleString()}. ${row.usable?"Matching coordinates and radius; within cache validity.":"Stale or mismatched evidence is excluded from scoring."}`:"No Location IQ evidence available for this billboard."}</p>
    {row.context?.demographics&&<section className="decision-demographics"><h4>Administrative demographic insight</h4><p>{row.context.demographics.note}</p><div className="decision-table-wrap"><table><thead><tr><th>Level / area</th><th>Population</th><th>Households</th><th>Male</th><th>Female</th></tr></thead><tbody>{row.context.demographics.areas.map((area:any)=><tr key={area.key} data-proposed={area.key===row.area?.key||undefined}><td>{human(area.level)} · {area.name}<small>{area.basis} · {area.year??'Year unavailable'}{!area.verified?' · Unverified':''}</small></td><td>{number(area.population)}</td><td>{number(area.households)}</td><td>{number(area.male)}</td><td>{number(area.female)}</td></tr>)}</tbody></table></div>{!row.context.demographics.areas.some((area:any)=>area.level==='village')&&<p>No village estimate is available at this coordinate. Ward/shehia totals are not village totals.</p>}</section>}
    {row.context&&<details><summary>Location facts, source dates and limitations</summary><Facts value={row.context.facts}/>{row.context.notes?.map((note:string)=><p key={note}>{note}</p>)}</details>}</section></td></tr>}</>;
}
