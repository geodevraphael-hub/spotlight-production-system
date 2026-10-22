import { env } from 'cloudflare:workers';
import { dayKey } from './operations-rules.mjs';
import { initializeOnce } from './initialize-once.mjs';
import { installActivityAudit } from './activity-audit.mjs';

export const setupReceipts = initializeOnce(async () => {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS whatsapp_receipts (provider_id TEXT PRIMARY KEY, recipient TEXT NOT NULL, sent_at INTEGER, delivered_at INTEGER, read_at INTEGER, failed_at INTEGER, error TEXT NOT NULL DEFAULT '', received_at INTEGER NOT NULL)`).run();
});

// The inbox survives callbacks arriving before the outbound API response, retries,
// and process restarts. Only Meta-confirmed receipts can advance these states.
export async function reconcileWhatsAppReceipts(providerId = '') {
  await env.DB.prepare(`UPDATE notification_jobs SET
    status=CASE
      WHEN status='read' OR r.read_at IS NOT NULL THEN 'read'
      WHEN status='delivered' OR r.delivered_at IS NOT NULL THEN 'delivered'
      WHEN r.failed_at IS NOT NULL AND r.failed_at>=COALESCE(r.sent_at,0) THEN 'failed'
      WHEN r.sent_at IS NOT NULL THEN 'accepted' ELSE status END,
    last_error=CASE WHEN r.read_at IS NOT NULL OR r.delivered_at IS NOT NULL OR status IN ('read','delivered') THEN '' ELSE r.error END,
    updated_at=MAX(updated_at,r.received_at)
    FROM whatsapp_receipts r
    WHERE channel='whatsapp' AND notification_jobs.provider_id=r.provider_id AND notification_jobs.recipient=r.recipient
      AND (?='' OR notification_jobs.provider_id=?)`).bind(providerId,providerId).run();
}

export const setupOperations = initializeOnce(async () => {
  await setupReceipts();
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS notification_jobs (id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, asset_id INTEGER, event_key TEXT NOT NULL, channel TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, lease_until INTEGER, provider_id TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(event_key,channel,recipient))`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_due ON notification_jobs(status,next_attempt_at)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_provider ON notification_jobs(provider_id,channel)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_project_created ON notification_jobs(project_id,created_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS asset_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, asset_id INTEGER NOT NULL, actor_id INTEGER, event TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_asset ON asset_activity(project_id,asset_id,created_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS issue_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER NOT NULL UNIQUE, project_id INTEGER NOT NULL, asset_id INTEGER NOT NULL, owner_id INTEGER, due_date TEXT, status TEXT NOT NULL DEFAULT 'open', resolution TEXT NOT NULL DEFAULT '', photo TEXT NOT NULL DEFAULT '', admin_remark TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_id INTEGER NOT NULL, project_id INTEGER NOT NULL, face INTEGER NOT NULL CHECK(face>0), campaign TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL CHECK(ends_on>=starts_on), status TEXT NOT NULL DEFAULT 'reserved', created_by INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_bookings_asset ON bookings(inventory_id,face,starts_on,ends_on)`),
    env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS prevent_booking_overlap BEFORE INSERT ON bookings WHEN NEW.status!='cancelled' AND EXISTS(SELECT 1 FROM bookings WHERE inventory_id=NEW.inventory_id AND face=NEW.face AND status!='cancelled' AND starts_on<=NEW.ends_on AND ends_on>=NEW.starts_on) BEGIN SELECT RAISE(ABORT,'BOOKING_CONFLICT'); END`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS actual_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, inventory_id INTEGER NOT NULL, category TEXT NOT NULL CHECK(category IN ('rental','printing','transport','flighting')), amount_minor INTEGER NOT NULL CHECK(amount_minor>=0), incurred_on TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_receipts (request_key TEXT PRIMARY KEY, user_id INTEGER NOT NULL, action TEXT NOT NULL, result_id INTEGER, completed INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`INSERT OR IGNORE INTO issue_tasks(assignment_id,project_id,asset_id,owner_id,updated_at) SELECT id,project_id,asset_id,assigned_to,updated_at FROM validation_assignments WHERE status='issue'`),
    env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS create_validation_issue AFTER UPDATE ON validation_assignments WHEN NEW.status='issue' BEGIN INSERT INTO issue_tasks(assignment_id,project_id,asset_id,owner_id,updated_at) VALUES(NEW.id,NEW.project_id,NEW.asset_id,NEW.assigned_to,NEW.updated_at) ON CONFLICT(assignment_id) DO UPDATE SET status='open',resolution='',photo='',admin_remark='',updated_at=NEW.updated_at; END`),
    env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS close_approved_validation_issue AFTER UPDATE ON validation_assignments WHEN NEW.status='ok' AND json_extract(NEW.report,'$.approvedBy') IS NOT NULL BEGIN UPDATE issue_tasks SET status='approved',admin_remark=COALESCE(json_extract(NEW.report,'$.adminRemark'),''),updated_at=NEW.updated_at WHERE assignment_id=NEW.id; END`),
  ]);
  await installActivityAudit(env.DB);
});

export async function activity(projectId: number, assetId: number, actorId: number, event: string, detail: unknown) {
  await env.DB.prepare('INSERT INTO asset_activity(project_id,asset_id,actor_id,event,detail,created_at) VALUES(?,?,?,?,?,?)').bind(projectId,assetId,actorId,event,JSON.stringify(detail),Date.now()).run();
}

export type DeliveryContext = { projectId?: number; assetId?: number; eventKey?: string };
export async function enqueue(channel: string, recipient: string, subject: string, payload: unknown, context: DeliveryContext = {}) {
  const now = Date.now();
  const input = `${context.projectId || 0}:${context.assetId || 0}:${dayKey()}:${subject}:${JSON.stringify(payload)}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const eventKey = context.eventKey || Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare(`INSERT OR IGNORE INTO notification_jobs(id,project_id,asset_id,event_key,channel,recipient,subject,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),context.projectId || 0,context.assetId || null,eventKey,channel,recipient,subject,JSON.stringify(payload),now,now,now).run();
  return { sent: false, queued: true, skipped: false, provider: 'delivery-queue' };
}

export async function deliverJobs(send: (job: any) => Promise<any>) {
  // Receipt reconciliation cannot prevent independent SMS/email work.
  try { await reconcileWhatsAppReceipts(); } catch { console.error('WhatsApp receipt reconciliation unavailable'); }
  const now = Date.now();
  await env.DB.prepare(`UPDATE notification_jobs SET status='unknown',last_error='Delivery interrupted. Check provider before retrying to avoid duplicates.',updated_at=? WHERE status='sending' AND lease_until<?`).bind(now,now).run();
  // Separate bounded channel lanes: a WhatsApp backlog cannot starve SMS/email.
  const lanes = await Promise.all(['sms','email','whatsapp'].map(async channel =>
    (await env.DB.prepare(`SELECT * FROM notification_jobs WHERE channel=? AND status IN ('pending','retry') AND next_attempt_at<=? ORDER BY created_at,id LIMIT 10`).bind(channel,now).all<any>()).results));
  let accepted = 0;
  let processed = 0;
  await Promise.all(lanes.map(async jobs => { for (const job of jobs) {
    // Leave unclaimed work for the next minute rather than exceed the cron request budget.
    if (Date.now()-now >= 45000) break;
    const claimed = await env.DB.prepare(`UPDATE notification_jobs SET status='sending',attempts=attempts+1,lease_until=?,updated_at=? WHERE id=? AND status IN ('pending','retry')`).bind(Date.now()+120000,Date.now(),job.id).run();
    if (!claimed.meta.changes) continue;
    processed++;
    try {
      const result = await send({ ...job, payload: JSON.parse(job.payload) });
      const success = Boolean(result.sent) && !result.error;
      let response: any = result.response;
      if (typeof response === 'string') { try { response = JSON.parse(response); } catch { response = {}; } }
      const providerId = result.providerId || response?.messages?.[0]?.id || result.messageId || '';
      const ambiguous = result.ambiguous || /fetch failed|network|timeout|timed out|socket|connection reset|internal error; reference/i.test(String(result.error || ''));
      const status = success ? 'accepted' : ambiguous ? 'unknown' : result.permanent || result.skipped || job.attempts >= 4 ? 'failed' : 'retry';
      await env.DB.prepare(`UPDATE notification_jobs SET status=CASE WHEN status IN ('read','delivered') THEN status ELSE ? END,provider_id=?,last_error=?,next_attempt_at=?,lease_until=NULL,updated_at=? WHERE id=?`).bind(status,providerId,success ? '' : JSON.stringify(result).slice(0,1500),Date.now()+Math.min(3600000,60000*2**job.attempts),Date.now(),job.id).run();
      if (job.channel === 'whatsapp' && providerId) await reconcileWhatsAppReceipts(providerId);
      if (success) accepted++;
    } catch {
      await env.DB.prepare(`UPDATE notification_jobs SET status='unknown',last_error='No delivery acknowledgement. Check provider before retrying.',updated_at=? WHERE id=? AND status='sending'`).bind(Date.now(),job.id).run();
    }
  } }));
  return { processed, accepted };
}
