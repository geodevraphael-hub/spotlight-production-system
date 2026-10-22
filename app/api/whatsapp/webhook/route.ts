import { env } from "cloudflare:workers";
import { setupReceipts, reconcileWhatsAppReceipts } from '../../../operations-store';

function configuredVerifyToken() {
  return String((env as any).WHATSAPP_VERIFY_TOKEN || '');
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === configuredVerifyToken() && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return Response.json({ error: "Invalid WhatsApp webhook verification" }, { status: 403 });
}

export async function POST(request: Request) {
  const secret = String((env as any).WHATSAPP_APP_SECRET || '');
  if (!secret) return Response.json({error:'Webhook signing secret is not configured'},{status:503});
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 1024 * 1024) return Response.json({error:'Payload too large'},{status:413});
  const signature = request.headers.get('x-hub-signature-256') || '';
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return Response.json({error:'Invalid signature'},{status:401});
  const bytes = new Uint8Array(signature.slice(7).match(/.{2}/g)!.map(value=>parseInt(value,16)));
  if (!await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(raw))) return Response.json({error:'Invalid signature'},{status:401});
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return Response.json({error:'Invalid JSON'},{status:400}); }
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return Response.json({error:'Invalid WhatsApp payload'},{status:400});
  const phoneId = String((env as any).WHATSAPP_PHONE_NUMBER_ID || '');
  if (!phoneId) return Response.json({error:'WhatsApp phone is not configured'},{status:503});
  try {
    await setupReceipts();
    for (const entry of payload.entry) for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change.field !== 'messages' || String(change.value?.metadata?.phone_number_id) !== phoneId) continue;
      for (const status of Array.isArray(change.value?.statuses) ? change.value.statuses : []) {
        if (!['sent','delivered','read','failed'].includes(status.status) || typeof status.id !== 'string' || !/^\d{6,18}$/.test(String(status.recipient_id)) || !Number.isFinite(Number(status.timestamp)) || Number(status.timestamp)<=0) continue;
        const column = `${status.status}_at`;
        await env.DB.prepare(`INSERT INTO whatsapp_receipts(provider_id,recipient,${column},error,received_at) VALUES(?,?,?,?,?)
          ON CONFLICT(provider_id) DO UPDATE SET ${column}=MIN(COALESCE(whatsapp_receipts.${column},excluded.${column}),excluded.${column}),error=CASE WHEN excluded.error!='' THEN excluded.error ELSE whatsapp_receipts.error END,received_at=MAX(whatsapp_receipts.received_at,excluded.received_at)
          WHERE whatsapp_receipts.recipient=excluded.recipient`).bind(status.id,String(status.recipient_id),Number(status.timestamp)*1000,status.errors ? JSON.stringify(status.errors).slice(0,1500) : '',Date.now()).run();
        // Retain the receipt even if startup has not created the outbound table yet.
        const ready = await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notification_jobs'").first();
        if (ready) await reconcileWhatsAppReceipts(status.id);
      }
    }
  } catch {
    return Response.json({error:'Unable to process receipt'},{status:500});
  }
  return Response.json({ ok: true });
}
