import { env } from 'cloudflare:workers';
import { currentUser } from '../app/route';
import { auditedDatabase } from '../../activity-audit.mjs';
import { money } from '../../operations-rules.mjs';
import { historyFilter, historySource, historyWorkbook } from '../../history-report.mjs';
import { projectDashboard } from '../../dashboard-data.mjs';

async function access(user: any, projectId: number) {
  return projectId > 0 && Boolean(await env.DB.prepare(`SELECT id FROM projects WHERE id=? AND (?='admin' OR created_by=? OR EXISTS(SELECT 1 FROM project_users WHERE project_id=projects.id AND user_id=?))`).bind(projectId,user.role,user.id,user.id).first());
}
async function asset(projectId: number, inventoryId: number) {
  return env.DB.prepare(`SELECT i.id,i.data FROM inventory i JOIN inventory_projects ip ON ip.inventory_id=i.id WHERE ip.project_id=? AND i.id=?`).bind(projectId,inventoryId).first<any>();
}
const cors={'Access-Control-Allow-Origin':'http://localhost','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin'};
const reply = (data: unknown, status = 200) => Response.json(data,{status,headers:cors});
export async function OPTIONS(){return new Response(null,{status:204,headers:cors});}
function date(value: unknown) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0,10)!==text) throw new Error('Enter a valid date');
  return text;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return reply({error:'Sign in required'},401);
  const url = new URL(request.url);
  const projectId = Number(url.searchParams.get('projectId'));
  const section = url.searchParams.get('section');
  if (section === 'my-issues' && user.role === 'field_user') {
    const rows = await env.DB.prepare(`SELECT t.*,v.report,p.name AS project_name FROM issue_tasks t JOIN validation_assignments v ON v.id=t.assignment_id JOIN projects p ON p.id=t.project_id WHERE t.owner_id=? AND t.status!='approved' ORDER BY t.due_date`).bind(user.id).all();
    return reply({rows:rows.results});
  }
  // The project dashboard is read-only overview data: any user with access to the
  // project (including viewers) may read it.
  if(section==='dashboard'){
    if(!(await access(user,projectId))) return reply({error:'Select an accessible project'},403);
    try{return new Response(JSON.stringify(await projectDashboard(env.DB,projectId)),{headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});}
    catch{return reply({error:'Dashboard data could not be loaded. Please retry.'},500);}
  }
  const allNotifications=section==='notifications' && url.searchParams.get('scope')==='all';
  if (!['admin','creator','planner'].includes(user.role) || (allNotifications ? user.role!=='admin' : !(await access(user,projectId)))) return reply({error:'Select an accessible project'},403);
  if (section === 'notifications') {
    const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||1)));
    const limit=50;
    const query=String(url.searchParams.get('q')||'').trim().slice(0,200).toLowerCase();
    const status=String(url.searchParams.get('status')||'all');
    const channel=String(url.searchParams.get('channel')||'all');
    const source=String(url.searchParams.get('source')||'all');
    // Legacy audit rows may represent a recipient group. Keep them labelled rather
    // than inventing individual delivery outcomes. Queued audits duplicate jobs.
    const cte=`WITH messages AS (
      SELECT j.id,'queue' source,j.project_id,COALESCE(p.name,CASE WHEN j.project_id=0 THEN 'System / unassigned' ELSE 'Deleted project' END) project_name,j.asset_id,
        j.recipient,1 recipient_count,j.channel,j.subject,j.status,j.attempts,j.provider_id,j.last_error,j.created_at,j.updated_at,r.delivered_at,r.read_at,
        CASE WHEN json_valid(j.payload) THEN COALESCE(json_extract(j.payload,'$.message'),'') ELSE '' END message_text
      FROM notification_jobs j LEFT JOIN projects p ON p.id=j.project_id
      LEFT JOIN whatsapp_receipts r ON r.provider_id=j.provider_id AND r.recipient=j.recipient AND j.channel='whatsapp'
      WHERE (?=1 OR j.project_id=?)
      UNION ALL
      SELECT 'audit:'||a.id,'history',a.project_id,COALESCE(p.name,CASE WHEN a.project_id=0 THEN 'System / unassigned' ELSE 'Deleted project' END),a.asset_id,
        a.recipients,a.recipient_count,a.channel,a.subject,a.status,NULL,a.provider_id,
        CASE WHEN a.status IN ('failed','unknown') THEN a.provider_response ELSE '' END,a.created_at,a.created_at,NULL,NULL,''
      FROM notification_audit a LEFT JOIN projects p ON p.id=a.project_id
      WHERE (?=1 OR a.project_id=?) AND a.status!='queued'
        AND NOT EXISTS(SELECT 1 FROM notification_jobs j WHERE j.project_id=a.project_id AND j.channel=a.channel AND a.provider_id!='' AND j.provider_id=a.provider_id)
    ), filtered AS (SELECT * FROM messages WHERE (?='all' OR status=?) AND (?='all' OR channel=?) AND (?='all' OR source=?)
      AND (?='' OR instr(lower(COALESCE(recipient,'')||' '||COALESCE(subject,'')||' '||project_name||' '||COALESCE(provider_id,'')||' '||message_text),?)>0))`;
    const bindings=[allNotifications?1:0,projectId||0,allNotifications?1:0,projectId||0,status,status,channel,channel,source,source,query,query];
    const [rows,count]=await Promise.all([
      env.DB.prepare(`${cte} SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...bindings,limit,(page-1)*limit).all(),
      env.DB.prepare(`${cte} SELECT count(*) total FROM filtered`).bind(...bindings).first<{total:number}>(),
    ]);
    const project=allNotifications?null:await env.DB.prepare('SELECT name FROM projects WHERE id=?').bind(projectId).first<{name:string}>();
    return reply({rows:rows.results,total:count?.total||0,page,pageSize:limit,scope:allNotifications?'all':'project',scopeName:allNotifications?'All projects & system':project?.name||'Selected project'});
  }
  if (section === 'history') {
    const exporting=url.searchParams.get('format')==='excel';
    if(exporting && user.role!=='admin')return reply({error:'Only administrators can export activity history'},403);
    let filters;
    try { filters=historyFilter(url.searchParams,projectId); }
    catch(error) { return reply({error:error instanceof Error?error.message:'Invalid history filters'},400); }
    const query=`${historySource} SELECT * FROM history a WHERE ${filters.where}`;
    const bindings=[projectId,...filters.values];
    const [options,types]=await Promise.all([
      env.DB.prepare(`${historySource} SELECT actor_id,actor,MAX(id) AS latest_id FROM history GROUP BY actor_id`).bind(projectId).all<any>(),
      env.DB.prepare('SELECT DISTINCT event FROM asset_activity WHERE project_id=? ORDER BY event').bind(projectId).all<any>(),
    ]);
    const actors=new Map<string,string>();
    const events=new Set<string>();
    for(const row of options.results) {
      const id=row.actor_id==null?'system':String(row.actor_id);
      if(!actors.has(id))actors.set(id,id==='system'?'System / legacy unrecorded user':row.actor);
    }
    for(const row of types.results)events.add(row.event);
    const users=[...actors].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name));
    if(exporting) {
      const rows=await env.DB.prepare(`${query} ORDER BY a.created_at DESC,a.id DESC`).bind(...bindings).all();
      const project=await env.DB.prepare('SELECT name FROM projects WHERE id=?').bind(projectId).first<{name:string}>();
      const workbook=historyWorkbook(rows.results,{project:project?.name||`Project ${projectId}`,filters:{...filters,actorLabel:filters.actor?actors.get(filters.actor)||`User ${filters.actor}`:'All users'},exportedBy:user.name});
      return new Response(workbook,{headers:{...cors,'Content-Type':'application/vnd.ms-excel; charset=utf-8','Content-Disposition':`attachment; filename="spotlight-project-${projectId}-activity-history.xls"`,'Cache-Control':'no-store'}});
    }
    const count=await env.DB.prepare(`${historySource} SELECT count(*) total FROM history a WHERE ${filters.where}`).bind(...bindings).first<{total:number}>();
    const total=count?.total||0,pageSize=50;
    const page=Math.min(Math.max(1,Math.ceil(total/pageSize)),Math.max(1,Math.floor(Number(url.searchParams.get('page'))||1)));
    const rows=await env.DB.prepare(`${query} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).bind(...bindings,pageSize,(page-1)*pageSize).all();
    return reply({rows:rows.results,total,page,pageSize,users,events:[...events].sort()});
  }
  if (section === 'issues') {
    const rows = await env.DB.prepare(`SELECT t.*,v.report,u.name AS owner FROM issue_tasks t JOIN validation_assignments v ON v.id=t.assignment_id LEFT JOIN users u ON u.id=t.owner_id WHERE t.project_id=? ORDER BY CASE WHEN t.status='approved' THEN 1 ELSE 0 END,t.due_date,t.id DESC`).bind(projectId).all();
    const users = await env.DB.prepare(`SELECT id,name FROM users WHERE role='field_user' ORDER BY name`).all();
    return reply({rows:rows.results,users:users.results});
  }
  if (section === 'bookings') {
    const rows = await env.DB.prepare(`SELECT b.*,json_extract(i.data,'$.street') AS billboard FROM bookings b JOIN inventory i ON i.id=b.inventory_id WHERE b.project_id=? ORDER BY b.starts_on,b.id`).bind(projectId).all();
    return reply({rows:rows.results});
  }
  if (section === 'costs') {
    const rows = await env.DB.prepare(`SELECT c.*,json_extract(i.data,'$.street') AS billboard,u.name AS recorded_by FROM actual_costs c JOIN inventory i ON i.id=c.inventory_id LEFT JOIN users u ON u.id=c.created_by WHERE c.project_id=? ORDER BY c.incurred_on DESC,c.id DESC`).bind(projectId).all();
    const plans = await env.DB.prepare(`SELECT id,name,data FROM campaign_plans WHERE project_id=? AND (?='admin' OR user_id=?) ORDER BY name`).bind(projectId,user.role,user.id).all();
    return reply({rows:rows.results,plans:plans.results});
  }
  return reply({error:'Unknown section'},404);
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return reply({error:'Sign in required'},401);
  const db = auditedDatabase(env.DB,user);
  try {
    const body = await request.json() as any;
    const projectId = Number(body.projectId);
    const now = Date.now();
    if (body.action === 'resolve-issue' && user.role === 'field_user') {
      const issue = await db.prepare(`SELECT * FROM issue_tasks WHERE id=? AND owner_id=?`).bind(Number(body.id),user.id).first<any>();
      if(issue&&issue.status==='awaiting_approval'&&issue.resolution===String(body.resolution)&&issue.photo===body.photo)return reply({ok:true,replayed:true});
      if (!issue || !['open','in_progress','returned'].includes(issue.status)) return reply({error:'Issue unavailable'},409);
      if (!String(body.resolution || '').trim() || !/^data:image\/(jpeg|png|webp);base64,/.test(String(body.photo || ''))) return reply({error:'Add a corrective photo and resolution note'},400);
      await db.prepare(`UPDATE issue_tasks SET status='awaiting_approval',resolution=?,photo=?,updated_at=? WHERE id=? AND owner_id=?`).bind(String(body.resolution).slice(0,4000),body.photo,now,issue.id,user.id).run();
      return reply({ok:true});
    }
    if (!['admin','creator','planner'].includes(user.role) || !(await access(user,projectId))) return reply({error:'Forbidden'},403);
    if (body.action === 'retry-notification') {
      if (user.role !== 'admin') return reply({error:'Admin only'},403);
      const result = await db.prepare(`UPDATE notification_jobs SET status='pending',attempts=0,provider_id=NULL,last_error='',next_attempt_at=?,updated_at=? WHERE id=? AND project_id=? AND status IN ('failed','unknown')`).bind(now,now,body.id,projectId).run();
      return reply({ok:!!result.meta.changes});
    }
    if (body.action === 'update-issue') {
      const issue = await db.prepare('SELECT * FROM issue_tasks WHERE id=? AND project_id=?').bind(Number(body.id),projectId).first<any>();
      if (!issue) return reply({error:'Issue not found'},404);
      if (body.status === 'approved' || body.status === 'returned') {
        if (user.role !== 'admin' || issue.status !== 'awaiting_approval') return reply({error:'Admin approval requires submitted corrective evidence'},403);
        const remark = String(body.remark || '').trim();
        if (!remark) return reply({error:'Review remark is required'},400);
        const statements = [db.prepare('UPDATE issue_tasks SET status=?,admin_remark=?,updated_at=? WHERE id=?').bind(body.status,remark,now,issue.id)];
        if (body.status === 'approved') {
          statements.push(db.prepare(`UPDATE validation_assignments SET status='ok',report=json_set(report,'$.adminRemark',?,'$.approvedBy',?,'$.approvedAt',?,'$.resolution',?),updated_at=? WHERE id=?`).bind(remark,user.id,now,issue.resolution,now,issue.assignment_id));
          statements.push(db.prepare(`UPDATE inventory SET data=json_set(data,'$.photoUrl',?,'$.validationStatus','ok','$.validatedBy',?,'$.validatedAt',?) WHERE id IN (SELECT inventory_id FROM inventory_projects WHERE project_id=?) AND CAST(json_extract(data,'$.id') AS INTEGER)=?`).bind(issue.photo,user.id,now,projectId,issue.asset_id));
        }
        await db.batch(statements);
      } else {
        if (!['open','in_progress','returned'].includes(issue.status)) return reply({error:'This issue is awaiting review or already approved'},409);
        const owner = await db.prepare(`SELECT id FROM users WHERE id=? AND role='field_user'`).bind(Number(body.ownerId)).first();
        if (!owner) return reply({error:'Select a field user'},400);
        await db.prepare(`UPDATE issue_tasks SET owner_id=?,due_date=?,status='in_progress',updated_at=? WHERE id=?`).bind(Number(body.ownerId),date(body.dueDate),now,issue.id).run();
      }
      return reply({ok:true});
    }
    if (body.action === 'book') {
      const board = await asset(projectId,Number(body.inventoryId));
      if (!board) return reply({error:'Billboard is not in this project'},400);
      const face = Number(body.face);
      if (!Number.isInteger(face) || face<1 || face>Math.max(1,Number(JSON.parse(board.data).faces)||1)) return reply({error:'Choose an existing billboard face'},400);
      const start = date(body.startsOn), end = date(body.endsOn);
      if (end<start || !String(body.campaign || '').trim()) return reply({error:'Enter campaign and valid date range'},400);
      const activeFlight=await db.prepare(`SELECT f.id FROM flight_schedules f JOIN inventory_projects ip ON ip.project_id=f.project_id WHERE ip.inventory_id=? AND f.asset_id=? AND f.flight_status='flighted' AND (f.start_at IS NULL OR date(f.start_at/1000,'unixepoch','+3 hours')<=?) AND (f.end_at IS NULL OR date(f.end_at/1000,'unixepoch','+3 hours')>=?) LIMIT 1`).bind(board.id,JSON.parse(board.data).id,end,start).first();
      if(activeFlight)return reply({error:'This billboard has an overlapping flight schedule. Review the schedule before reserving a face.'},409);
      await db.prepare(`INSERT INTO bookings(inventory_id,project_id,face,campaign,starts_on,ends_on,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(board.id,projectId,face,String(body.campaign).slice(0,200),start,end,user.id,now).run();
      return reply({ok:true});
    }
    if (body.action === 'cancel-booking') {
      const booking = await db.prepare('SELECT * FROM bookings WHERE id=? AND project_id=?').bind(Number(body.id),projectId).first<any>();
      if (!booking) return reply({error:'Booking not found'},404);
      await db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=? AND project_id=?`).bind(booking.id,projectId).run();
      const board = await asset(projectId,booking.inventory_id);
      return reply({ok:true});
    }
    if (body.action === 'record-cost') {
      const board = await asset(projectId,Number(body.inventoryId));
      if (!board || !['rental','printing','transport','flighting'].includes(body.category)) return reply({error:'Choose a billboard and cost category'},400);
      await db.prepare(`INSERT INTO actual_costs(project_id,inventory_id,category,amount_minor,incurred_on,reference,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(projectId,board.id,body.category,money(body.amount),date(body.incurredOn),String(body.reference || '').slice(0,200),String(body.note || '').slice(0,2000),user.id,now).run();
      return reply({ok:true});
    }
    return reply({error:'Unknown operation'},400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save';
    return reply({error:message.includes('BOOKING_CONFLICT') ? 'This face is already reserved for these dates, possibly in another project. Choose another face or date range.' : message},message.includes('BOOKING_CONFLICT') ? 409 : 400);
  }
}
