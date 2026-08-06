import { env } from "cloudflare:workers";

function configuredVerifyToken() {
  return String((env as any).WHATSAPP_VERIFY_TOKEN || "spotlight_whatsapp_verify_2026");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === configuredVerifyToken() && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return Response.json({ error: "Invalid WhatsApp webhook verification" }, { status: 403 });
}

export async function POST(request: Request) {
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  console.log("WhatsApp webhook received", JSON.stringify(payload));
  return Response.json({ ok: true });
}
