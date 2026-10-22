import {markerState} from './map-symbols.mjs';

// One physical inventory record, with independent flight schedules per membership.
export function centralInventory(rows,schedules) {
  const flights=new Map(schedules.map(s=>[`${s.project_id}:${s.asset_id}`,s]));
  const records=new Map();
  for(const row of rows) {
    const item=JSON.parse(row.data),key=Number(row.inventory_id);
    if(!records.has(key))records.set(key,{...item,id:key,inventoryDbId:key,originalAssetId:Number(item.id),memberships:[]});
    const board=records.get(key);
    if(!row.project_name||!row.project_id||board.memberships.some(p=>p.id===Number(row.project_id)))continue;
    const schedule=flights.get(`${row.project_id}:${item.id}`);
    const source=Number(item.projectId??1)===Number(row.project_id);
    board.memberships.push({id:Number(row.project_id),name:row.project_name,
      flightStatus:schedule?.flight_status??(source?item.flightStatus:null)??'unflighted',
      flightStage:schedule?.stage??(source?item.flightStage:null)??'design',
      flightExpiry:schedule?.end_at??(source?item.flightExpiry:null)??'',
      flightStart:schedule?.start_at??(source?item.flightStart:null)??'',
      flightDurationDays:schedule?.duration_days??(source?item.flightDurationDays:null)??''});
  }
  return [...records.values()].map(b=>({...b,projectIds:b.memberships.map(p=>p.id),
    projectNames:b.memberships.map(p=>p.name),projectName:b.memberships.map(p=>p.name).join(' · ')||'Unassigned'}));
}
export function centralProjectView(boards,project='all',now=Date.now(),flightFilter='All flight status') {
  return boards.filter(b=>project==='all'||(project==='unassigned'?!b.memberships?.length:b.memberships?.some(p=>String(p.id)===project)))
    .map(b=>{
      const memberships=b.memberships??[];
      const scoped=project==='all'?memberships:memberships.filter(p=>String(p.id)===project);
      const priority=['expired','flighted','deflighted','unflighted'];
      const ranked=[...scoped].sort((a,c)=>priority.indexOf(markerState(a,now))-priority.indexOf(markerState(c,now)));
      const flight=ranked.find(p=>markerState(p,now)===flightFilter)??ranked[0]??b;
      return {...b,flightStatus:flight.flightStatus,flightExpiry:flight.flightExpiry,
        flightStage:flight.flightStage,flightStart:flight.flightStart,flightDurationDays:flight.flightDurationDays,
        centralStates:[...new Set(scoped.length?scoped.map(p=>markerState(p,now)):[markerState(b,now)])]};
    });
}
export function centralProjectCounts(boards,projects) {
  const counts=new Map(projects.map(p=>[p.id,{...p,count:0}]));
  for(const b of boards)for(const id of new Set((b.memberships??[]).map(p=>p.id))) {
    if(counts.has(id))counts.get(id).count++;
  }
  return [...counts.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
}
