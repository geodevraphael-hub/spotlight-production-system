import {setupLocationEvidence} from './location-evidence.mjs';
export async function locationProgress(db,user,projectId,since=0,now=Date.now()){
 const fail=()=>{throw Object.assign(Error('Choose an accessible inventory scope.'),{status:403});};
 if(!['admin','creator','planner','viewer'].includes(user?.role)||!Number.isSafeInteger(projectId)||projectId<0)fail();
 if(projectId>0&&user.role!=='admin'&&!await db.prepare('SELECT 1 FROM project_users WHERE project_id=? AND user_id=?').bind(projectId,user.id).first())fail();
 await setupLocationEvidence(db);
 const args=projectId>0?[projectId,projectId]:user.role==='admin'?[]:[user.id];
 const scope=projectId>0?`(EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=?) OR COALESCE(json_extract(i.data,'$.projectId'),1)=?)`:user.role==='admin'?'1=1':`EXISTS(SELECT 1 FROM projects p JOIN project_users pu ON pu.project_id=p.id AND pu.user_id=? WHERE p.id=COALESCE(json_extract(i.data,'$.projectId'),1) OR EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=p.id))`;
 const [pending,updates,provider]=await Promise.all([
  db.prepare(`SELECT count(*) pending FROM location_enrichment_queue q JOIN inventory i ON i.id=q.inventory_id WHERE q.status IN ('queued','retrying') AND ${scope}`).bind(...args).first(),
  db.prepare(`SELECT i.id inventoryDbId,json_extract(i.data,'$.locationAddress') address,json_extract(i.data,'$.district') district,json_extract(i.data,'$.village') village
   FROM location_enrichment_queue q JOIN inventory i ON i.id=q.inventory_id WHERE q.updated_at>? AND ${scope} AND json_extract(i.data,'$.locationAddress.lat')=json_extract(i.data,'$.lat') AND json_extract(i.data,'$.locationAddress.lng')=json_extract(i.data,'$.lng')`).bind(Math.max(0,Number(since)||0),...args).all(),
  db.prepare('SELECT blocked_until FROM planning_provider_state WHERE id=1').first(),
 ]);
 return {cursor:now,pending:pending.pending,blockedUntil:provider?.blocked_until||0,updates:updates.results.map(({address,...row})=>({...row,locationAddress:address?JSON.parse(address):null}))};
}
