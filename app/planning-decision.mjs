import { demographicArea, DEMOGRAPHIC_LEVELS } from './planning-demographics.mjs';
export const DECISION_VERSION = 2;
export const CRITERIA = [
  {id:'cost', label:'Lower campaign cost', unit:'TZS', direction:'min', source:'Your four plan prices'},
  {id:'faces', label:'Recorded faces', unit:'faces', direction:'max', source:'Inventory; not measured visibility'},
  {id:'population', label:'Estimated nearby population', unit:'people', direction:'max', source:'Location IQ / WorldPop 2022 model; not impressions'},
  {id:'commerce', label:'Commercial facilities', unit:'mapped facilities', direction:'max', source:'Location IQ radius count; not customer footfall'},
  {id:'transport', label:'Transport facilities', unit:'mapped facilities', direction:'max', source:'Location IQ radius count; not traffic volume'},
  {id:'buildings', label:'Building detections', unit:'detections', direction:'max', source:'Google Open Buildings via Location IQ; not households'},
  {id:'households', label:'Area households', unit:'households', direction:'max', source:'NBS 2022 census / village allocation; selected administrative level'},
  {id:'male', label:'Area male population', unit:'people', direction:'max', source:'NBS 2022 census / village allocation; not campaign reach'},
  {id:'female', label:'Area female population', unit:'people', direction:'max', source:'NBS 2022 census / village allocation; not campaign reach'},
];
export const defaultDecision = () => ({version:2, populationBasis:'nbs',demographicLevel:'local',radius:1000, weights:{cost:3,faces:2,population:3,commerce:2,transport:2,buildings:0,households:0,male:0,female:0}, budget:'', count:10});
export function decisionSettings(value) {
  const base=defaultDecision();
  if (!value) return base;
  const radius=Number(value.radius), count=Number(value.count);
  if (![500,1000,2000].includes(radius) || !Number.isInteger(count) || count<1 || count>100) throw new Error('Choose a valid radius and 1–100 placements.');
  /** @type {Record<string, number>} */
  const weights={};
  for (const c of CRITERIA) {
    const n=Number(value.weights?.[c.id] ?? 0);
    if (!Number.isInteger(n)||n<0||n>5) throw new Error('Criterion weights must be whole numbers from 0 to 5.');
    weights[c.id]=n;
  }
  const budget=value.budget==null ? '' : String(value.budget);
  if (budget!=='' && (budget.trim()==='' || !Number.isFinite(Number(budget)) || Number(budget)<0 || Number(budget)>1e15)) throw new Error('Enter a valid budget.');
  // Existing plans keep their WorldPop radius meaning until the user chooses NBS.
  const populationBasis=value.populationBasis??(value.version===1?'radius':'nbs');
  const demographicLevel=value.demographicLevel??'local';
  if(!['nbs','radius'].includes(populationBasis)||!DEMOGRAPHIC_LEVELS.some(([id])=>id===demographicLevel))throw new Error('Choose a supported population source and geographic level.');
  return {version:DECISION_VERSION,radius,weights,budget,count,populationBasis,demographicLevel};
}
export function decisionCriteria(settings){
  return CRITERIA.map(c=>c.id==='population'&&settings.populationBasis==='nbs'
    ? {...c,label:'Area population (NBS-based)',source:'NBS 2022 census / village allocation; whole selected area, not radius reach'}:c);
}
export function knownNumber(value) {
  return value!==null && value!==undefined && value!=='' && typeof value!=='boolean' && Number.isFinite(Number(value)) && Number(value)>=0 ? Number(value) : null;
}
export function completeCost(board, overrides={}) {
  const values=['rental','printing','transport','flighting'].map(key=>knownNumber(overrides?.[key] ?? board[`${key}Price`]));
  return values.some(value=>value===null) ? null : values.reduce((sum,value)=>sum+value,0);
}
export function usableEvidence(board,evidence,radius,now=Date.now()) {
  return evidence?.version===1 && evidence.radius===radius && Number(evidence.lat)===Number(board.lat) && Number(evidence.lng)===Number(board.lng)
    && Number.isFinite(evidence.fetchedAt) && now-evidence.fetchedAt<=7*86400000 && now>=evidence.fetchedAt;
}
export function rankBillboards(boards,costs,evidence,settings,now=Date.now()) {
  const active=decisionCriteria(settings).filter(c=>settings.weights[c.id]>0), weight=active.reduce((sum,c)=>sum+settings.weights[c.id],0);
  const rows=boards.map(board=>{
    const context=evidence[board.id], usable=usableEvidence(board,context,settings.radius,now);
    const area=usable?demographicArea(context,settings.demographicLevel):null;
    const values={cost:completeCost(board,costs[board.id]),faces:knownNumber(board.faces),population:null,commerce:null,transport:null,buildings:null,households:null,male:null,female:null};
    if (values.faces===0) values.faces=null;
    for(const key of ['population','commerce','transport','buildings']) if(usable) values[key]=knownNumber(context.metrics?.[key]);
    if(settings.populationBasis==='nbs')values.population=usable&&area?.verified?knownNumber(area.population):null;
    for(const key of ['households','male','female'])if(usable&&area?.verified)values[key]=knownNumber(area[key]);
    return {board,values,context,usable,area};
  });
  const bounds=Object.fromEntries(active.map(c=>{
    const known=rows.map(r=>r.values[c.id]).filter(v=>v!==null);
    return [c.id,known.length ? [Math.min(...known),Math.max(...known)] : [0,0]];
  }));
  return rows.map(row=>{
    let covered=0, weighted=0;
    const reasons=active.map(c=>{
      const value=row.values[c.id], [min,max]=bounds[c.id], w=settings.weights[c.id];
      // Missing values never receive a favourable score. Equal known values are neutral.
      const score=value===null ? null : max===min ? 50 : 100*(c.direction==='min' ? max-value : value-min)/(max-min);
      if(score!==null){covered+=w;weighted+=w*score;}
      return {...c,value,score,weight:w,contribution:weight ? (score ?? 0)*w/weight : 0};
    });
    return {...row,reasons,score:weight ? weighted/weight : null,coverage:weight ? covered/weight*100 : 0,complete:weight>0 && covered===weight};
  }).sort((a,b)=>(b.complete-a.complete)||((b.score??-1)-(a.score??-1))||String(a.board.street).localeCompare(String(b.board.street))||a.board.id-b.board.id);
}
export function proposeShortlist(ranked,settings,selectedBoards=[],costs={}) {
  try { settings=decisionSettings(settings); } catch(error) { return {ids:[],error:error.message}; }
  const selected=new Set(selectedBoards.map(b=>b.id));
  let remaining=settings.budget==='' ? Infinity : Number(settings.budget);
  if(Number.isFinite(remaining)) for(const board of selectedBoards){
    const cost=completeCost(board,costs[board.id]);
    if(cost===null) return {ids:[],error:'Complete prices for the existing plan before using a budget.'};
    remaining-=cost;
  }
  if(remaining<0) return {ids:[],error:'The existing plan already exceeds this budget.'};
  const eligible=ranked.filter(row=>!selected.has(row.board.id)&&row.complete&&Number.isFinite(row.score));
  // Unbounded budgets need no combinatorial search.
  if(!Number.isFinite(remaining)){
    const ids=eligible.slice(0,settings.count).map(row=>row.board.id);
    return {ids,error:ids.length?'':'No additional fully evidenced placements meet these criteria and budget.',method:'rank',optimal:true};
  }
  const candidates=eligible.filter(row=>row.values.cost!==null&&row.values.cost<=remaining);
  // Keep nondominated (cost, score) combinations for each cardinality. Exact
  // until the frontier cap; bounded search protects the UI for large inventories.
  let frontier=[{cost:0,score:0,ids:[]}], optimal=true;
  const cap=6000, quota=Math.max(30,Math.floor(cap/(settings.count+1)));
  for(const row of candidates){
    const added=frontier.filter(s=>s.ids.length<settings.count&&s.cost+row.values.cost<=remaining)
      .map(s=>({cost:s.cost+row.values.cost,score:s.score+row.score,ids:[...s.ids,row.board.id]}));
    const groups=new Map();
    for(const state of [...frontier,...added]){
      const count=state.ids.length;
      if(!groups.has(count))groups.set(count,[]);
      groups.get(count).push(state);
    }
    frontier=[];
    for(const states of groups.values()){
      states.sort((a,b)=>a.cost-b.cost||b.score-a.score);
      let best=-Infinity;
      const efficient=states.filter(s=>{if(s.score<=best)return false;best=s.score;return true;});
      if(efficient.length>quota){
        optimal=false;
        // Retain the full cost spectrum rather than only expensive high scores.
        const keep=new Set([0,efficient.length-1]);
        for(let i=1;i<quota-1;i++)keep.add(Math.round(i*(efficient.length-1)/(quota-1)));
        frontier.push(...[...keep].map(i=>efficient[i]));
      }else frontier.push(...efficient);
    }
  }
  let best=frontier.sort((a,b)=>b.score-a.score||a.cost-b.cost||a.ids.length-b.ids.length)[0];
  // Retain rank-first as a baseline: bounded search must never make it worse.
  const baseline={ids:[],score:0,cost:0};
  for(const row of candidates){
    if(baseline.ids.length>=settings.count)break;
    if(baseline.cost+row.values.cost>remaining)continue;
    baseline.ids.push(row.board.id);baseline.cost+=row.values.cost;baseline.score+=row.score;
  }
  if(baseline.score>best.score)best=baseline;
  const chosen=new Set(best.ids);
  const ids=ranked.filter(row=>chosen.has(row.board.id)).map(row=>row.board.id);
  return {ids,error:ids.length?'':'No additional fully evidenced placements meet these criteria and budget.',
    method:'budget-combinations',optimal,cost:best.cost,remaining:remaining-best.cost};
}
export function decisionCsv(rows,settings) {
  const quote=value=>`"${String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')}"`;
  const header=['Billboard','Projects','Score / 100','Evidence coverage %','Radius m',...decisionCriteria(settings).map(c=>c.label), 'Location data retrieved','Model','Criteria weights','Caution','Population basis','Area level','Area name','Area reference year','Area source / method'];
  return [header,...rows.map(r=>[r.board.street,r.board.projectName,r.score?.toFixed(1)??'',r.coverage.toFixed(0),settings.radius,
    ...CRITERIA.map(c=>r.values[c.id]??''),r.context?.fetchedAt ? new Date(r.context.fetchedAt).toISOString():'',`Weighted relative score v${DECISION_VERSION}`,
    decisionCriteria(settings).map(c=>`${c.label}: ${settings.weights[c.id]??0}`).join('; '),'Decision aid, not audience or ROI forecast. Radius population is a 2022 estimate. Census and village allocations retain their basis. Blank means unavailable; repeated areas are not additive.',
    settings.populationBasis,r.area?.level,r.area?.name,r.area?.year,r.area?`${r.area.basis}; ${r.area.source}`:'Unavailable'])].map(row=>row.map(quote).join(',')).join('\r\n');
}
