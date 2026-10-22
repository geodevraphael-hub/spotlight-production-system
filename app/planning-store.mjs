import { decisionSettings } from './planning-decision.mjs';
const plannerRoles = new Set(['admin', 'creator', 'planner']);
export const mayPlan = user => plannerRoles.has(user?.role);
const access = `(?='admin' OR EXISTS (SELECT 1 FROM project_users pu WHERE pu.project_id=p.id AND pu.user_id=?))`;

export async function planningWorkspace(db, user) {
  if (!mayPlan(user)) throw Object.assign(new Error('Forbidden'), { status: 403 });
  const rows = await db.prepare(`SELECT i.id AS inventory_id,i.data,p.id AS project_id,p.name AS project_name
    FROM inventory i JOIN projects p ON
    (EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=p.id)
      OR p.id=COALESCE(json_extract(i.data,'$.projectId'),1))
    WHERE ${access} ORDER BY i.id,p.name`).bind(user.role,user.id).all();
  const inventory = new Map();
  for (const row of rows.results) {
    if (!inventory.has(row.inventory_id)) {
      const item = JSON.parse(row.data);
      inventory.set(row.inventory_id, {...item, id:row.inventory_id, inventoryDbId:row.inventory_id,
        originalAssetId:Number(item.id), projectId:row.project_id, projectNames:[], projectIds:[]});
    }
    const item = inventory.get(row.inventory_id);
    item.projectNames.push(row.project_name);
    item.projectIds.push(row.project_id);
    item.projectName = item.projectNames.join(' · ');
  }
  const plans = await db.prepare(`SELECT cp.*,u.name AS creator,p.name AS project_name FROM campaign_plans cp
    JOIN users u ON u.id=cp.user_id JOIN projects p ON p.id=cp.project_id
    WHERE ${access} AND (?='admin' OR cp.user_id=?) ORDER BY cp.updated_at DESC`)
    .bind(user.role,user.id,user.role,user.id).all();
  return { inventory:[...inventory.values()], plans:plans.results.map(plan => {
    const data = JSON.parse(plan.data);
    if (data.identity !== 'inventory-db') {
      const shortlist=[], costs={};
      for (const oldId of data.shortlist || []) {
        const match=[...inventory.values()].filter(item => item.originalAssetId===Number(oldId) && item.projectIds.includes(plan.project_id));
        // Never guess when an older source ID is ambiguous.
        if (match.length===1) { shortlist.push(match[0].id); costs[match[0].id]=data.costs?.[oldId] || {}; }
      }
      data.unresolvedCount=(data.shortlist || []).length-shortlist.length;
      data.shortlist=shortlist; data.costs=costs; data.identity='inventory-db';
    }
    return {...plan,data};
  }) };
}

export async function savePlanningWorkspace(db, user, body) {
  if (!mayPlan(user)) throw Object.assign(new Error('Forbidden'), {status:403});
  const fail = message => { throw Object.assign(new Error(message), {status:400}); };
  const name=String(body.name || '').trim();
  if (!name || name.length>200) fail('Enter a plan name of up to 200 characters.');
  const ids=body.data?.shortlist;
  if (!Array.isArray(ids) || !ids.length || ids.length>2000 || ids.some(id=>!Number.isSafeInteger(id)||id<=0) || new Set(ids).size!==ids.length) fail('Select between 1 and 2,000 unique billboards.');
  const workspace=await planningWorkspace(db,user);
  const available=new Map(workspace.inventory.map(item=>[item.id,item]));
  if (ids.some(id=>!available.has(id))) fail('Some selected billboards are no longer accessible. Refresh the inventory before saving.');
  const costs={};
  for (const id of ids) {
    costs[id]={};
    for (const category of ['rental','printing','transport','flighting']) {
      const value=body.data?.costs?.[id]?.[category] ?? '';
      if (typeof value!=='string' && typeof value!=='number') fail('Invalid plan price.');
      if (value!=='' && (String(value).trim()==='' || !Number.isFinite(Number(value)) || Number(value)<0)) fail('Prices must be zero or positive numbers.');
      costs[id][category]=String(value);
    }
  }
  const existing=body.id ? workspace.plans.find(plan=>plan.id===Number(body.id)) : null;
  if (body.id && !existing) throw Object.assign(new Error('Plan not found or not editable.'),{status:403});
  let projectId=Number(body.projectId);
  const newName=String(body.newProjectName || '').trim();
  const token=crypto.randomUUID().replaceAll('-','');
  const now=Date.now(), writes=[];
  if (newName) {
    if (!['admin','creator'].includes(user.role)) throw Object.assign(new Error('Only administrators and creators can create projects.'),{status:403});
    if (newName.length>200) fail('Project name must be at most 200 characters.');
    writes.push(db.prepare('INSERT INTO projects(name,project_type,share_token,share_code,created_by,created_at) VALUES(?,?,?,?,?,?)')
      .bind(newName,'Outdoor media',token,crypto.randomUUID().slice(0,8),user.id,now));
  } else {
    const project=await db.prepare(`SELECT p.id FROM projects p WHERE p.id=? AND ${access}`).bind(projectId,user.role,user.id).first();
    if (!project) throw Object.assign(new Error('Choose an accessible destination project.'),{status:403});
  }
  // Use the token in the same transaction, never a global last_insert_rowid.
  const target=newName ? '(SELECT id FROM projects WHERE share_token=?)' : '?';
  const targetValue=newName ? token : projectId;
  if (newName) writes.push(db.prepare(`INSERT INTO project_users(project_id,user_id) VALUES(${target},?)`).bind(targetValue,user.id));
  // Existing trackers use the original asset ID: reject collisions rather than merge unrelated boards.
  const originals=ids.map(id=>available.get(id).originalAssetId);
  if (new Set(originals).size!==originals.length) fail('Selected billboards contain duplicate legacy asset IDs. Resolve those inventory IDs before combining them in one project.');
  if (!newName) {
    const members=await db.prepare(`SELECT i.id,i.data FROM inventory i WHERE EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=?) OR COALESCE(json_extract(i.data,'$.projectId'),1)=?`).bind(projectId,projectId).all();
    for (const row of members.results) if (originals.includes(Number(JSON.parse(row.data).id)) && !ids.includes(row.id)) fail('A different billboard in the destination project uses the same legacy asset ID.');
  }
  for (const id of ids) writes.push(db.prepare(`INSERT OR IGNORE INTO inventory_projects(inventory_id,project_id,assigned_by,assigned_at) VALUES(?,${target},?,?)`).bind(id,targetValue,user.id,now));
  let decision;
  try { decision=decisionSettings(body.data?.decision); } catch(error) { fail(error.message); }
  const data=JSON.stringify({identity:'inventory-db',shortlist:ids,costs,decision});
  if (existing) writes.push(db.prepare(`UPDATE campaign_plans SET project_id=${target},name=?,data=?,note=?,updated_at=? WHERE id=?`).bind(targetValue,name,data,String(body.note||''),now,existing.id));
  else writes.push(db.prepare(`INSERT INTO campaign_plans(project_id,user_id,name,data,note,updated_at) VALUES(${target},?,?,?,?,?)`).bind(targetValue,user.id,name,data,String(body.note||''),now));
  const results=await db.batch(writes);
  if (newName) projectId=Number((await db.prepare('SELECT id FROM projects WHERE share_token=?').bind(token).first()).id);
  return {id:existing?.id || Number(results.at(-1).meta.last_row_id),projectId};
}
