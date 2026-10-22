const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const membership=`(EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=?) OR COALESCE(json_extract(i.data,'$.projectId'),1)=?)`;

// projectId=0 is an explicit "no legacy source membership" sentinel. Keeping
// originProjectId preserves provenance; links to every other project stay intact.
export const inventoryMembershipBackfill=`INSERT OR IGNORE INTO inventory_projects (inventory_id,project_id,assigned_by,assigned_at)
 SELECT id, COALESCE(json_extract(data,'$.projectId'),1), 1, ? FROM inventory
 WHERE COALESCE(json_extract(data,'$.projectId'),1)>0`;

export async function removeProjectInventory(db,user,body){
 if(user?.role!=='admin')fail('Only an administrator can remove billboards from a project.',403);
 const {ids,projectId,requestId}=body;
 if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)fail('Select between 1 and 500 unique billboards.');
 if(!Number.isSafeInteger(projectId)||projectId<=0)fail('Choose the project to remove from.');
 if(body.confirmed!==true)fail('Confirm removal from this project.');
 if(!/^[0-9a-f-]{36}$/i.test(String(requestId||'')))fail('Reopen the removal dialog and try again.');
 const payload=JSON.stringify({projectId,ids:[...ids].sort((a,b)=>a-b)});
 async function prior(){
  const receipt=await db.prepare('SELECT user_id,payload,result FROM project_removal_requests WHERE request_id=?').bind(requestId).first();
  if(!receipt)return null;
  if(receipt.user_id!==user.id||receipt.payload!==payload)fail('This request has already been used. Reopen the dialog.',409);
  return JSON.parse(receipt.result);
 }
 const previous=await prior();if(previous)return previous;
 const project=await db.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first();
 if(!project)fail('The project no longer exists. Refresh inventory.',404);
 const rows=[];
 for(let n=0;n<ids.length;n+=80){
  const chunk=ids.slice(n,n+80);
  const found=await db.prepare(`SELECT i.id,i.data,${membership} AS linked,
   EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=${projectId}) AS explicit_link
   FROM inventory i WHERE i.id IN (${chunk.map(()=>'?').join(',')})`)
   .bind(projectId,projectId,...chunk).all();
  rows.push(...found.results);
 }
 if(rows.length!==ids.length)fail('Some billboards no longer exist. Refresh inventory and select again.',409);
 const linked=rows.filter(row=>row.linked),now=Date.now();
 const result={ok:true,removed:linked.length,skipped:rows.length-linked.length,project:{...project}};
 const writes=[
  db.prepare('INSERT INTO project_removal_requests(request_id,user_id,payload,result,created_at) VALUES(?,?,?,?,?)').bind(requestId,user.id,payload,JSON.stringify(result),now),
  db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=? AND name=?) THEN 1 ELSE json('Project changed') END").bind(projectId,project.name)
 ];
 for(const row of rows){
  writes.push(db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM inventory i WHERE i.id=? AND i.data=? AND ${membership}=?
   AND EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=?)=?) THEN 1 ELSE json('Inventory changed') END`)
   .bind(row.id,row.data,projectId,projectId,row.linked?1:0,projectId,row.explicit_link?1:0));
 }
 for(const row of linked){
  if(!row.explicit_link){
   // Very old records can still have an implicit source membership but no link
   // row, so no DELETE trigger would fire. Record that real removal explicitly.
   const item=JSON.parse(row.data);
   const snapshot=JSON.stringify({projectId,projectName:project.name,inventoryId:row.id,billboardName:item.street||`Inventory ${row.id}`});
   writes.push(db.prepare(`INSERT INTO asset_activity(project_id,asset_id,actor_id,event,detail,created_at)
    SELECT ?,?,?,'Billboard removed from project',
    json_object('schemaVersion',2,'operation','delete','entity','inventory_projects',
    'actor',json_object('id',?,'name',COALESCE((SELECT name FROM users WHERE id=?),'User '||?),'role',?),
    'before',json(?),'after',NULL),?
    WHERE NOT EXISTS(SELECT 1 FROM inventory_projects WHERE inventory_id=? AND project_id=?)`)
    .bind(projectId,Number(item.id)||row.id,user.id,user.id,user.id,user.id,user.role,snapshot,now,row.id,projectId));
  }
  // Disable the legacy fallback only when it refers to the removed project.
  // Never replace it with another project: that would mix project flight states.
  writes.push(db.prepare(`UPDATE inventory SET data=json_set(data,'$.originProjectId',COALESCE(json_extract(data,'$.originProjectId'),?), '$.projectId',0)
   WHERE id=? AND COALESCE(json_extract(data,'$.projectId'),1)=?`).bind(projectId,row.id,projectId));
  writes.push(db.prepare('DELETE FROM inventory_projects WHERE inventory_id=? AND project_id=?').bind(row.id,projectId));
 }
 try{await db.batch(writes);}
 catch{
  const completed=await prior();if(completed)return completed;
  fail('Removal was not saved. No partial changes were applied. Refresh inventory and try again.',409);
 }
 return result;
}
