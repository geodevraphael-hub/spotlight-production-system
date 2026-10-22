const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const member=`(EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=?) OR COALESCE(json_extract(i.data,'$.projectId'),1)=?)`;

/** Add memberships only. Never move inventory or copy schedules, plans or contacts. */
export async function assignCentralInventory(db,user,body){
 if(user?.role!=='admin')fail('Only an administrator can assign from the all-project map.',403);
 const ids=body.ids;
 if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)fail('Select between 1 and 500 unique billboards.');
 if(body.confirmed!==true)fail('Confirm the destination before assigning.');
 const requestId=String(body.requestId||'');
 if(!/^[0-9a-f-]{36}$/i.test(requestId))fail('Invalid assignment request. Reopen the assignment dialog.');
 const name=String(body.newProjectName||'').trim(),type=String(body.projectType||'Outdoor media').trim();
 const targetId=body.targetProjectId;
 if(name.length>200||!type||type.length>100)fail('Use a project name up to 200 characters and a type up to 100 characters.');
 if((Boolean(name)&&Boolean(targetId))||(!name&&(!Number.isSafeInteger(targetId)||targetId<=0)))fail('Choose an existing project or enter a new project name.');
 const payload=JSON.stringify({ids:[...ids].sort((a,b)=>a-b),targetId:targetId||null,name,type});
 async function prior(){
  const row=await db.prepare('SELECT user_id,payload,result FROM central_assignment_requests WHERE request_id=?').bind(requestId).first();
  if(!row)return null;
  if(row.user_id!==user.id||row.payload!==payload)fail('This request was already used for another assignment. Reopen the dialog.',409);
  return JSON.parse(row.result);
 }
 const previous=await prior();if(previous)return previous;
 const rows=[];
 for(let n=0;n<ids.length;n+=80){
  const batch=ids.slice(n,n+80);
  const found=await db.prepare(`SELECT id,data FROM inventory WHERE id IN (${batch.map(()=>'?').join(',')})`).bind(...batch).all();
  rows.push(...found.results);
 }
 if(rows.length!==ids.length)fail('Some selected billboards no longer exist. Refresh the map and select again.',409);
 const originals=rows.map(r=>Number(JSON.parse(r.data).id));
 if(originals.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(originals).size!==originals.length)fail('Selected billboards have conflicting original IDs. Assign them separately until the inventory IDs are resolved.',409);
 let project=name?null:await db.prepare('SELECT id,name,project_type FROM projects WHERE id=?').bind(targetId).first();
 if(!name&&!project)fail('The destination project no longer exists.',404);
 const existing=name?[]:(await db.prepare(`SELECT i.id,i.data FROM inventory i WHERE ${member}`).bind(targetId,targetId).all()).results;
 if(existing.some(r=>originals.includes(Number(JSON.parse(r.data).id))&&!ids.includes(r.id)))fail('A different billboard in this project has the same original ID. Choose another destination or resolve the inventory IDs.',409);
 const already=new Set(existing.map(r=>r.id)),added=rows.filter(r=>!already.has(r.id));
 const token=crypto.randomUUID().replaceAll('-',''),now=Date.now();
 const target=name?'(SELECT id FROM projects WHERE share_token=?)':'?',targetValue=name?token:targetId;
 const writes=[db.prepare('INSERT INTO central_assignment_requests(request_id,user_id,payload,result,created_at) VALUES(?,?,?,?,?)').bind(requestId,user.id,payload,'{}',now)];
 if(name){
  writes.push(db.prepare('INSERT INTO projects(name,project_type,share_token,share_code,share_protected,created_by,created_at) VALUES(?,?,?,?,1,?,?)')
   .bind(name,type,token,crypto.randomUUID().slice(0,8),user.id,now));
  writes.push(db.prepare(`INSERT INTO project_users(project_id,user_id) VALUES(${target},?)`).bind(targetValue,user.id));
 }else writes.push(db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=?) THEN 1 ELSE json('Project missing') END").bind(targetId));
 for(const row of rows){
  writes.push(db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM inventory WHERE id=? AND data=?) THEN 1 ELSE json('Inventory changed') END").bind(row.id,row.data));
  if(!name){
   writes.push(db.prepare(`SELECT CASE WHEN (SELECT EXISTS(SELECT 1 FROM inventory i WHERE i.id=? AND ${member}))=? THEN 1 ELSE json('Membership changed') END`)
    .bind(row.id,targetId,targetId,already.has(row.id)?1:0));
   writes.push(db.prepare(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM inventory i WHERE i.id<>? AND CAST(json_extract(i.data,'$.id') AS INTEGER)=? AND ${member}) THEN 1 ELSE json('Conflicting ID') END`)
    .bind(row.id,Number(JSON.parse(row.data).id),targetId,targetId));
  }
 }
 for(const row of added)writes.push(db.prepare(`INSERT OR IGNORE INTO inventory_projects(inventory_id,project_id,assigned_by,assigned_at) VALUES(?,${target},?,?)`).bind(row.id,targetValue,user.id,now));
 writes.push(db.prepare(`UPDATE central_assignment_requests SET result=json_object('ok',json('true'),'selected',?,'assigned',?,'alreadyAssigned',?,'created',json(?),'project',json_object('id',p.id,'name',p.name,'project_type',p.project_type,'share_token',p.share_token,'share_code',p.share_code,'share_protected',p.share_protected,'created_by',p.created_by)) FROM projects p WHERE p.id=${target} AND request_id=?`)
  .bind(ids.length,added.length,ids.length-added.length,name?'true':'false',targetValue,requestId));
 try{await db.batch(writes);}
 catch{
  const completed=await prior();if(completed)return completed;
  fail('Assignment was not saved. No partial changes were applied. Refresh inventory and try again.',409);
 }
 return await prior();
}
