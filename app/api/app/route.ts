import { env } from "cloudflare:workers";

type User = { id: number; name: string; email: string; role: string };

const encoder = new TextEncoder();

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function passwordHash(password: string, salt: string) {
  let value = `${salt}:${password}`;
  for (let index = 0; index < 12000; index += 1) value = await digest(value);
  return `${salt}:${value}`;
}

function shareCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function splitContacts(value: string) {
  return String(value ?? "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function whatsappLink(phone: string, message: string) {
  const digits = phone.replace(/[^\d]/g, "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : "";
}

function whatsappDigits(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("0") && digits.length >= 10) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function smsDigits(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("0") && digits.length >= 10) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function runtimeSecret(name: string) {
  const workerValue = (env as Record<string, unknown>)[name];
  if (workerValue !== undefined && workerValue !== null) return String(workerValue);
  const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return nodeProcess?.env?.[name] ?? "";
}

async function sendWhatsAppText(to: string, message: string) {
  const accessToken = runtimeSecret("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = runtimeSecret("WHATSAPP_PHONE_NUMBER_ID");
  const recipient = whatsappDigits(to);
  if (!accessToken || !phoneNumberId || !recipient) {
    return { phone: to, sent: false, skipped: true };
  }
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { preview_url: false, body: message },
      }),
    });
    if (!response.ok) {
      return { phone: to, sent: false, error: await response.text() };
    }
  } catch (error) {
    return { phone: to, sent: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { phone: to, sent: true };
}

async function sendSmsText(to: string, message: string) {
  const user = runtimeSecret("MSHASTRA_USER");
  const password = runtimeSecret("MSHASTRA_PASSWORD");
  const senderId = runtimeSecret("MSHASTRA_SENDER_ID") || "Spotlight";
  const countryCode = runtimeSecret("MSHASTRA_COUNTRY_CODE") || "255";
  const recipient = smsDigits(to);
  if (!user || !password || !recipient) {
    return { phone: to, sent: false, skipped: true };
  }
  const params = new URLSearchParams({
    user,
    pwd: password,
    senderid: senderId,
    mobileno: recipient,
    msgtext: message,
    CountryCode: countryCode,
  });
  try {
    const response = await fetch(`https://mshastra.com/sendurl.aspx?${params.toString()}`);
    const text = await response.text();
    const failed = /error|invalid|fail|not allowed|denied|unauthori[sz]ed/i.test(text);
    return {
      phone: to,
      sent: response.ok && !failed,
      status: response.status,
      response: text,
    };
  } catch (error) {
    return { phone: to, sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendResendEmail(to: string[], subject: string, html: string) {
  const apiKey = runtimeSecret("RESEND_API_KEY");
  if (!apiKey || !to.length) return { sent: 0, skipped: true };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Spotlight Billboard 360 <notifications@spotlight.co.tz>",
      to,
      subject,
      html,
    }),
  });
  const text = await response.text();
  if (!response.ok) return { sent: 0, error: text };
  let providerId = "";
  try {
    providerId = String(JSON.parse(text)?.id ?? "");
  } catch {
    providerId = "";
  }
  return { sent: to.length, providerId, response: text };
}

async function recordNotificationAudit(entry: {
  projectId: number;
  assetId?: number | null;
  notificationType: string;
  channel: string;
  recipients: string[];
  subject: string;
  status: string;
  providerId?: string;
  providerResponse?: unknown;
  createdBy?: number | null;
  createdAt?: number;
}) {
  await env.DB.prepare(`
    INSERT INTO notification_audit
      (project_id,asset_id,notification_type,channel,recipients,recipient_count,subject,status,provider_id,provider_response,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    entry.projectId,
    entry.assetId ?? null,
    entry.notificationType,
    entry.channel,
    entry.recipients.join(","),
    entry.recipients.length,
    entry.subject,
    entry.status,
    entry.providerId ?? "",
    JSON.stringify(entry.providerResponse ?? {}),
    entry.createdBy ?? null,
    entry.createdAt ?? Date.now(),
  ).run();
}

function normalizedFlightStatus(stage: string, requestedStatus: string) {
  if (stage === "flighted") return "flighted";
  if (stage === "removed") return "unflighted";
  return requestedStatus === "flighted" ? "flighted" : "unflighted";
}

function cookieToken(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer ?? request.headers.get("cookie")?.match(/kmk_session=([^;]+)/)?.[1] ?? "";
}

async function setup() {
  const db = env.DB;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'planner', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, data TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS plans (user_id INTEGER PRIMARY KEY, data TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, project_type TEXT NOT NULL, share_token TEXT NOT NULL UNIQUE, share_code TEXT NOT NULL DEFAULT '', share_protected INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS project_users (project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(project_id,user_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS campaign_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS user_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS user_group_members (group_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(group_id, user_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS missions (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', config TEXT NOT NULL DEFAULT '{}', boundary_id INTEGER, assigned_users TEXT NOT NULL DEFAULT '[]', assigned_groups TEXT NOT NULL DEFAULT '[]', created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS field_collections (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL DEFAULT 1, mission_id INTEGER NOT NULL, user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', data TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy REAL DEFAULT 0, validated_by INTEGER, validated_at INTEGER, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS field_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, collection_id INTEGER NOT NULL, photo_type TEXT NOT NULL DEFAULT 'billboard', photo_data TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS admin_boundaries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, boundary_type TEXT NOT NULL DEFAULT 'mainland', geojson TEXT NOT NULL, levels TEXT NOT NULL DEFAULT '[]', uploaded_by INTEGER NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS project_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, emails TEXT NOT NULL DEFAULT '', phones TEXT NOT NULL DEFAULT '', is_default INTEGER NOT NULL DEFAULT 0, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS flight_schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, asset_id INTEGER NOT NULL, stage TEXT NOT NULL DEFAULT 'design', flight_status TEXT NOT NULL DEFAULT 'unflighted', start_at INTEGER, end_at INTEGER, duration_days INTEGER NOT NULL DEFAULT 0, reminder_days INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', last_notified_at INTEGER, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(project_id, asset_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS notification_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL DEFAULT 0, asset_id INTEGER, notification_type TEXT NOT NULL, channel TEXT NOT NULL, recipients TEXT NOT NULL DEFAULT '', recipient_count INTEGER NOT NULL DEFAULT 0, subject TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', provider_id TEXT NOT NULL DEFAULT '', provider_response TEXT NOT NULL DEFAULT '{}', created_by INTEGER, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS validation_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, asset_id INTEGER NOT NULL, assigned_to INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'assigned', report TEXT NOT NULL DEFAULT '{}', assigned_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER, UNIQUE(project_id, asset_id, assigned_to))"),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_validation_assignments_user_status ON validation_assignments(assigned_to,status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_validation_assignments_project_asset ON validation_assignments(project_id,asset_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_notification_audit_project_created ON notification_audit(project_id,created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_notification_audit_type_channel ON notification_audit(notification_type,channel,created_at)"),
  ]);
  try {
    await db.prepare("ALTER TABLE projects ADD COLUMN share_code TEXT NOT NULL DEFAULT ''").run();
  } catch {
    // Existing databases already have this column.
  }
  try {
    await db.prepare("ALTER TABLE projects ADD COLUMN share_protected INTEGER NOT NULL DEFAULT 1").run();
  } catch {
    // Existing databases already have this column.
  }
  try {
    await db.prepare("ALTER TABLE missions ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1").run();
  } catch {
    // Existing databases already have this column.
  }
  try {
    await db.prepare("ALTER TABLE field_collections ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1").run();
  } catch {
    // Existing databases already have this column.
  }
  const count = await db.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  if (!count?.total) {
    const salt = crypto.randomUUID();
    const hash = await passwordHash("ChangeMe123!", salt);
    await db.prepare("INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)")
      .bind("Spotlight Administrator", "admin@spotlight.local", hash, "admin", Date.now()).run();
  }
  const projectCount = await db.prepare("SELECT COUNT(*) AS total FROM projects").first<{ total: number }>();
  if (!projectCount?.total) {
    const admin = await db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").first<{ id: number }>();
    const token = crypto.randomUUID().replaceAll("-", "");
    const code = shareCode();
    const result = await db.prepare("INSERT INTO projects (name,project_type,share_token,share_code,created_by,created_at) VALUES (?,?,?,?,?,?)")
      .bind("Spotlight OOH", "Outdoor media", token, code, admin?.id ?? 1, Date.now()).run();
    await db.prepare("INSERT OR IGNORE INTO project_users (project_id,user_id) VALUES (?,?)")
      .bind(result.meta.last_row_id, admin?.id ?? 1).run();
  }
  const projects = await db.prepare("SELECT id FROM projects WHERE share_code='' OR share_code IS NULL").all<{ id: number }>();
  for (const project of projects.results) {
    await db.prepare("UPDATE projects SET share_code=? WHERE id=?").bind(shareCode(), project.id).run();
  }
  await db.prepare("UPDATE field_collections SET project_id=COALESCE((SELECT project_id FROM missions WHERE missions.id=field_collections.mission_id), project_id, 1)").run();
  await db.prepare("UPDATE flight_schedules SET flight_status='flighted' WHERE stage='flighted' AND flight_status!='flighted'").run();
  try {
    await db.prepare(`
      UPDATE inventory
      SET data=json_set(
        json_set(data,'$.flightStatus',COALESCE((SELECT flight_status FROM flight_schedules WHERE flight_schedules.project_id=COALESCE(json_extract(inventory.data,'$.projectId'),1) AND flight_schedules.asset_id=CAST(json_extract(inventory.data,'$.id') AS INTEGER)),'unflighted')),
        '$.flightExpiry',
        COALESCE((SELECT end_at FROM flight_schedules WHERE flight_schedules.project_id=COALESCE(json_extract(inventory.data,'$.projectId'),1) AND flight_schedules.asset_id=CAST(json_extract(inventory.data,'$.id') AS INTEGER)), '')
      )
      WHERE EXISTS (
        SELECT 1 FROM flight_schedules
        WHERE flight_schedules.project_id=COALESCE(json_extract(inventory.data,'$.projectId'),1)
        AND flight_schedules.asset_id=CAST(json_extract(inventory.data,'$.id') AS INTEGER)
      )
    `).run();
  } catch {
    // Older runtimes without JSON mutation functions can still use flight_schedules directly.
  }
}

async function currentUser(request: Request): Promise<User | null> {
  await setup();
  const token = cookieToken(request);
  if (!token) return null;
  return (await env.DB.prepare(
    "SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?",
  ).bind(token, Date.now()).first<User>()) ?? null;
}

function json(data: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Access-Control-Allow-Origin", "http://localhost");
  responseHeaders.set("Access-Control-Allow-Credentials", "true");
  responseHeaders.set("Vary", "Origin");
  return Response.json(data, { status, headers: responseHeaders });
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function excelDate(value?: number | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function attrValue(item: any, keys: string[], fallback = "") {
  const attrs = item?.sourceAttributes ?? {};
  for (const key of keys) {
    const direct = item?.[key];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") return direct;
    const found = Object.entries(attrs).find(([attrKey]) => attrKey.trim().toLowerCase() === key.trim().toLowerCase());
    if (found && String(found[1] ?? "").trim() !== "") return found[1];
  }
  return fallback;
}

function billboardSpecificLocation(item: any) {
  return String(attrValue(item, ["SPECIFIC LOCATION", "specificLocation", "location"], item?.street || "the selected location")).trim();
}

function billboardDimension(item: any) {
  const height = attrValue(item, ["HEIGHT (M)", "height"], item?.height ?? "");
  const width = attrValue(item, ["WIDTH (M)", "width"], item?.width ?? "");
  if (height && width) return `${height} * ${width}`;
  return String(attrValue(item, ["TOTAL SQ.M /DURATION", "dimension", "format"], item?.areaSqm ? `${item.areaSqm} sq.m` : "not specified"));
}

function flightNotificationSubject(item: any) {
  return `Notification of Flight for Billboard at ${billboardSpecificLocation(item)} of Dimension ${billboardDimension(item)}`;
}

function flightNotificationHtml(items: any[], projectName: string, startAt: number | null, durationDays: number, endAt: number | null, note: string) {
  const first = items[0] ?? {};
  const location = billboardSpecificLocation(first);
  const dimension = billboardDimension(first);
  const durationText = durationDays ? `${durationDays} day(s)` : "an open duration";
  const expiryText = endAt ? new Date(endAt).toLocaleDateString("en-GB") : "a date to be confirmed";
  const rows = items.map((item) => `
    <tr>
      <td>${xmlEscape(billboardSpecificLocation(item))}</td>
      <td>${xmlEscape(billboardDimension(item))}</td>
      <td>${xmlEscape(item.vendor || item.owner || "UNKNOWN")}</td>
      <td>${xmlEscape(`${item.district || ""}${item.from ? ` - ${item.from}` : ""}${item.to ? ` to ${item.to}` : ""}`.trim())}</td>
      <td>${xmlEscape(startAt ? new Date(startAt).toLocaleDateString("en-GB") : "Not set")}</td>
      <td>${xmlEscape(durationText)}</td>
      <td>${xmlEscape(expiryText)}</td>
    </tr>`).join("");
  return `
    <div style="font-family:Arial,sans-serif;color:#111827;font-size:14px;line-height:1.55">
      <h2 style="margin:0 0 14px;font-size:18px;color:#065f46">Notification of Flight for Billboard at ${xmlEscape(location)} of Dimension ${xmlEscape(dimension)}</h2>
      <p>Dear Team,</p>
      <p>Please be informed that the billboard at <strong>${xmlEscape(location)}</strong> has been successfully flighted. It is expected to stay for about <strong>${xmlEscape(durationText)}</strong> and expire on <strong>${xmlEscape(expiryText)}</strong>.</p>
      <p>The related project is <strong>${xmlEscape(projectName)}</strong>. Kindly take note of the flighting details below for your records and follow-up.</p>
      <table border="1" cellpadding="7" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;width:100%;max-width:980px">
        <thead style="background:#ecfdf5;color:#065f46">
          <tr>
            <th align="left">Specific Location</th>
            <th align="left">Dimension</th>
            <th align="left">Vendor</th>
            <th align="left">Route / Area</th>
            <th align="left">Flighted Date</th>
            <th align="left">Expected Duration</th>
            <th align="left">Expiry Date</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${note ? `<p><strong>Note:</strong> ${xmlEscape(note)}</p>` : ""}
      <p>Warm regards,<br/>Spotlight Billboard 360</p>
    </div>`;
}

function flightNotificationText(item: any, projectName: string, startAt: number | null, durationDays: number, endAt: number | null, note: string) {
  const location = billboardSpecificLocation(item);
  const dimension = billboardDimension(item);
  const durationText = durationDays ? `${durationDays} day(s)` : "an open duration";
  const expiryText = endAt ? new Date(endAt).toLocaleDateString("en-GB") : "a date to be confirmed";
  const flightedText = startAt ? new Date(startAt).toLocaleDateString("en-GB") : "Not set";
  const vendor = item.vendor || item.owner || "UNKNOWN";
  const route = `${item.district || ""}${item.from ? ` - ${item.from}` : ""}${item.to ? ` to ${item.to}` : ""}`.trim() || "Not recorded";
  return [
    `Notification of Flight for Billboard at ${location} of Dimension ${dimension}.`,
    `Please be informed that the billboard at ${location} has been successfully flighted.`,
    `Project: ${projectName}. Vendor: ${vendor}. Route/Area: ${route}.`,
    `Flighted date: ${flightedText}. Expected duration: ${durationText}. Expiry date: ${expiryText}.`,
    note ? `Note: ${note}.` : "",
    "Warm regards, Spotlight Billboard 360.",
  ].filter(Boolean).join(" ");
}

function rowsToExcelSheet(name: string, rows: Array<Array<unknown>>, formulas: Record<string, string> = {}) {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${rowIndex + 1}:${colIndex + 1}`;
      const formula = formulas[ref] ? ` ss:Formula="${xmlEscape(formulas[ref])}"` : "";
      const isNumber = typeof value === "number" && Number.isFinite(value);
      return `<Cell${formula}><Data ss:Type="${isNumber ? "Number" : "String"}">${xmlEscape(value)}</Data></Cell>`;
    }).join("");
    return `<Row>${cells}</Row>`;
  }).join("");
  return `<Worksheet ss:Name="${xmlEscape(name).slice(0, 31)}"><Table>${body}</Table><AutoFilter x:Range="R1C1:R${Math.max(rows.length, 1)}C${Math.max(rows[0]?.length ?? 1, 1)}" xmlns="urn:schemas-microsoft-com:office:excel"/></Worksheet>`;
}

function excelWorkbook(sheets: string[]) {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Calibri" ss:Size="11"/></Style>
</Styles>
${sheets.join("\n")}
</Workbook>`;
}

function exportResponse(xml: string, filename: string) {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function trackerRows(inventoryRows: any[], schedulesByAsset: Map<number, any>) {
  const executionHeader = [
    "SN", "REGION", "DISTRICT", "ROAD/STREET", "SPECIFIC LOCATION", "Traffic Visibility (From)", "Traffic Visibility (To)",
    "MEDIA TYPE", "MEDIA GROUP", "MATERIAL", "ORIENTATION", "HEIGHT (M)", "WIDTH (M)", "TOTAL SQ.M /DURATION", "INSTALLATION",
    "FACES", "VENDOR", "ARTWORK DELIVERY", "ARTWORK APPROVAL", "ARTWORK TO VENDOR", "PRINTING STATUS", "REMARKS FROM PRINTER",
    "REASONS FOR RE-PRINT", "COMMENT OF CHANGE", "DELIVERED TO DESTINATION", "FLIGHTING STATUS", "FLIGHT START", "END DATE", "REMAINING DAYS", "NOTE",
  ];
  const costHeader = [
    "SN", "REGION", "DISTRICT", "ROAD/STREET", "SPECIFIC LOCATION", "Traffic Visibility (From)", "Traffic Visibility (To)",
    "MEDIA TYPE", "MEDIA GROUP", "MATERIAL", "ORIENTATION", "HEIGHT (M)", "WIDTH (M)", "TOTAL SQ.M /DURATION", "INSTALLATION",
    "FACES", "VENDOR", "Latitude", "Longitude", "DURATION 1 MONTH", "RENTAL COST", "PRINTING", "FLIGHTING COST", "TRANSPORT COSTS", "TOTAL",
  ];
  const execFormulas: Record<string, string> = {};
  const costFormulas: Record<string, string> = {};
  const execution = [executionHeader];
  const cost = [costHeader];
  inventoryRows.forEach((item, index) => {
    const rowNumber = index + 2;
    const schedule = schedulesByAsset.get(Number(item.id));
    const endAt = schedule?.end_at ? Number(schedule.end_at) : null;
    const remaining = endAt ? Math.ceil((endAt - Date.now()) / 86400000) : "";
    const region = attrValue(item, ["REGION", "region"], "Zanzibar");
    const district = attrValue(item, ["DISTRICT", "district"], item.district);
    const road = attrValue(item, ["ROAD/STREET", "ROAD (From - To)", "road", "street"], item.street);
    const location = attrValue(item, ["SPECIFIC LOCATION", "specificLocation", "location"], item.street);
    const material = attrValue(item, ["MATERIAL", "material"], item.mediaType === "digital-screen" ? "MP4" : "Blockout");
    const installation = Number(attrValue(item, ["INSTALLATION", "installation"], item.lampPosts || 1)) || 1;
    const faces = Number(item.faces || attrValue(item, ["FACES", "faces"], 1)) || 1;
    execution.push([
      index + 1, region, district, road, location, item.from, item.to, attrValue(item, ["MEDIA TYPE", "mediaType"], item.mediaType ? item.mediaType : ""),
      attrValue(item, ["MEDIA GROUP", "mediaGroup"], "Billboard"), material, item.orientation || attrValue(item, ["ORIENTATION", "orientation"], ""),
      item.height || attrValue(item, ["HEIGHT (M)", "height"], ""), item.width || attrValue(item, ["WIDTH (M)", "width"], ""), item.areaSqm || "",
      installation, faces, item.vendor || item.owner || attrValue(item, ["VENDOR", "vendor"], "UNKNOWN"),
      attrValue(item, ["ARTWORK DELIVERY", "artworkDelivery"], "PENDING"), attrValue(item, ["ARTWORK APPROVAL", "artworkApproval"], "PENDING"),
      attrValue(item, ["ARTWORK TO VENDOR", "artworkToVendor"], "PENDING"), attrValue(item, ["PRINTING STATUS", "printingStatus"], "NOT STARTED"),
      attrValue(item, ["REMARKS FROM PRINTER", "printerRemarks"], ""), attrValue(item, ["REASONS FOR RE-PRINT", "reprintReason"], ""),
      attrValue(item, ["COMMENT OF CHANGE", "changeComment"], ""), attrValue(item, ["DELIVERED TO DESTINATION", "deliveredToDestination"], "PENDING"),
      schedule?.flight_status ?? "unflighted", excelDate(schedule?.start_at), excelDate(endAt), remaining, schedule?.note ?? "",
    ]);
    if (!item.areaSqm && Number(item.height) && Number(item.width)) execFormulas[`${rowNumber}:14`] = `=RC[-2]*RC[-1]`;
    cost.push([
      index + 1, region, district, road, location, item.from, item.to, attrValue(item, ["MEDIA TYPE", "mediaType"], item.mediaType ? item.mediaType : ""),
      attrValue(item, ["MEDIA GROUP", "mediaGroup"], "Billboard"), material, item.orientation || attrValue(item, ["ORIENTATION", "orientation"], ""),
      item.height || "", item.width || "", item.areaSqm || "", installation, faces, item.vendor || item.owner || "UNKNOWN", item.lat, item.lng,
      schedule?.duration_days ? Math.ceil(Number(schedule.duration_days) / 30) : 1, Number(item.rentalPrice || 0), Number(item.printingPrice || 0),
      Number(item.flightingPrice || 0), Number(item.transportPrice || 0), "",
    ]);
    if (!item.areaSqm && Number(item.height) && Number(item.width)) costFormulas[`${rowNumber}:14`] = `=RC[-2]*RC[-1]`;
    costFormulas[`${rowNumber}:22`] = `=RC[-8]*RC[-6]*15000`;
    costFormulas[`${rowNumber}:24`] = `=RC[-10]*RC[-8]*RC[-4]*3000`;
    costFormulas[`${rowNumber}:25`] = `=SUM(RC[-4]:RC[-1])`;
  });
  return { execution, cost, execFormulas, costFormulas };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "http://localhost",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      Vary: "Origin",
    },
  });
}

export async function GET(request: Request) {
  await setup();
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "me";
  if (action === "shared-project") {
    const token = String(url.searchParams.get("token") ?? "");
    const code = String(url.searchParams.get("code") ?? "").trim().toUpperCase();
    const project = await env.DB.prepare("SELECT id,name,project_type,share_token,share_code,share_protected FROM projects WHERE share_token=?")
      .bind(token).first<{ id: number; name: string; project_type: string; share_token: string; share_code: string; share_protected: number }>();
    if (!project) return json({ error: "Shared map not found" }, 404);
    if (project.share_protected !== 0 && (!code || code !== project.share_code.toUpperCase())) {
      return json({ error: "Secret code required", protected: true }, 401);
    }
    const rows = await env.DB.prepare("SELECT data FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=? ORDER BY id").bind(project.id).all<{ data: string }>();
    return json({
      project: {
        id: project.id,
        name: project.name,
        project_type: project.project_type,
        share_token: project.share_token,
        share_code: project.share_code,
        share_protected: project.share_protected,
      },
      inventory: rows.results.map((row) => JSON.parse(row.data)),
    });
  }
  const user = await currentUser(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  if (action === "me") return json({ user });
  if (action === "inventory") {
    const projectId = Number(url.searchParams.get("projectId")) || 1;
    const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
    if (!allowed) return json({ error: "Forbidden" }, 403);
    const rows = await env.DB.prepare("SELECT data FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=? ORDER BY id").bind(projectId).all<{ data: string }>();
    const schedules = await env.DB.prepare("SELECT asset_id,stage,flight_status,start_at,end_at,duration_days FROM flight_schedules WHERE project_id=?").bind(projectId).all<any>();
    const schedulesByAsset = new Map((schedules.results as any[]).map((row) => [Number(row.asset_id), row]));
    return json({
      inventory: rows.results.map((row: { data: string }) => {
        const item = JSON.parse(row.data);
        const schedule = schedulesByAsset.get(Number(item.id));
        if (!schedule) return item;
        return {
          ...item,
          flightStage: schedule.stage ?? item.flightStage ?? "design",
          flightStatus: schedule.flight_status ?? item.flightStatus ?? "unflighted",
          flightExpiry: schedule.end_at ?? item.flightExpiry ?? "",
          flightStart: schedule.start_at ?? item.flightStart ?? "",
          flightDurationDays: schedule.duration_days ?? item.flightDurationDays ?? "",
        };
      }),
    });
  }
  if (action === "projects") {
    const query = user.role === "admin"
      ? "SELECT * FROM projects ORDER BY created_at DESC"
      : "SELECT p.* FROM projects p JOIN project_users pu ON pu.project_id=p.id WHERE pu.user_id=? ORDER BY p.created_at DESC";
    const rows = user.role === "admin"
      ? await env.DB.prepare(query).all()
      : await env.DB.prepare(query).bind(user.id).all();
    return json({ projects: rows.results });
  }
  if (action === "plans") {
    const projectId = Number(url.searchParams.get("projectId")) || 1;
    const rows = await env.DB.prepare(
      user.role === "admin"
        ? "SELECT cp.*,u.name AS creator FROM campaign_plans cp JOIN users u ON u.id=cp.user_id WHERE cp.project_id=? ORDER BY cp.updated_at DESC"
        : "SELECT cp.*,u.name AS creator FROM campaign_plans cp JOIN users u ON u.id=cp.user_id WHERE cp.project_id=? AND cp.user_id=? ORDER BY cp.updated_at DESC",
    ).bind(...(user.role === "admin" ? [projectId] : [projectId, user.id])).all<{ data: string }>();
    return json({ plans: rows.results.map((row) => ({ ...row, data: JSON.parse(row.data) })) });
  }
  if (action === "plan") {
    const plan = await env.DB.prepare("SELECT data,note FROM plans WHERE user_id=?").bind(user.id).first<{ data: string; note: string }>();
    return json({ plan: plan ? JSON.parse(plan.data) : { shortlist: [], prices: {} }, note: plan?.note ?? "" });
  }
  if (action === "users" && (user.role === "admin" || user.role === "creator")) {
    const rows = await env.DB.prepare(
      user.role === "admin"
        ? "SELECT id,name,email,role,created_at AS createdAt FROM users ORDER BY name"
        : "SELECT id,name,email,role,created_at AS createdAt FROM users WHERE role='field_user' ORDER BY name",
    ).all();
    return json({ users: rows.results });
  }
  if (action === "user-groups" && (user.role === "admin" || user.role === "creator")) {
    const rows = await env.DB.prepare("SELECT * FROM user_groups ORDER BY name").all();
    const groups = [];
    for (const g of rows.results as any[]) {
      const members = await env.DB.prepare("SELECT u.id,u.name,u.email,u.role FROM user_group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=?").bind(g.id).all();
      groups.push({ ...g, members: members.results });
    }
    return json({ groups });
  }
  if (action === "missions" && (user.role === "admin" || user.role === "creator" || user.role === "field_user")) {
    const projectId = Number(url.searchParams.get("projectId")) || 0;
    let rows;
    if (user.role === "field_user") {
      rows = projectId
        ? await env.DB.prepare("SELECT * FROM missions WHERE status='active' AND project_id=? ORDER BY updated_at DESC").bind(projectId).all()
        : await env.DB.prepare("SELECT * FROM missions WHERE status='active' ORDER BY updated_at DESC").all();
      const memberships = await env.DB.prepare("SELECT group_id FROM user_group_members WHERE user_id=?").bind(user.id).all<{ group_id: number }>();
      const groupIds = new Set(memberships.results.map((row) => row.group_id));
      const mine = (rows.results as any[]).filter((m) => {
        const users = JSON.parse(m.assigned_users || '[]');
        const groups = JSON.parse(m.assigned_groups || '[]');
        return users.includes(user.id) || groups.some((groupId: number) => groupIds.has(groupId));
      });
      return json({ missions: mine });
    }
    if (projectId) {
      const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
      if (!allowed) return json({ error: "Forbidden" }, 403);
      rows = await env.DB.prepare("SELECT * FROM missions WHERE project_id=? ORDER BY updated_at DESC").bind(projectId).all();
    } else {
      rows = user.role === "admin"
        ? await env.DB.prepare("SELECT * FROM missions ORDER BY updated_at DESC").all()
        : await env.DB.prepare("SELECT m.* FROM missions m JOIN project_users pu ON pu.project_id=m.project_id WHERE pu.user_id=? ORDER BY m.updated_at DESC").bind(user.id).all();
    }
    return json({ missions: rows.results });
  }
  if (action === "field-collections") {
    const missionId = Number(url.searchParams.get("missionId")) || 0;
    const projectId = Number(url.searchParams.get("projectId")) || 0;
    const ownOnly = user.role === "field_user";
    const conditions: string[] = [];
    const args: Array<number> = [];
    if (missionId) {
      conditions.push("fc.mission_id=?");
      args.push(missionId);
    }
    if (projectId) {
      const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
      if (!allowed) return json({ error: "Forbidden" }, 403);
      conditions.push("COALESCE(fc.project_id,m.project_id,1)=?");
      args.push(projectId);
    }
    if (ownOnly) {
      conditions.push("fc.user_id=?");
      args.push(user.id);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const q = `SELECT fc.*,u.name AS collector,m.name AS mission_name,m.project_id AS mission_project_id FROM field_collections fc JOIN users u ON u.id=fc.user_id LEFT JOIN missions m ON m.id=fc.mission_id${where} ORDER BY fc.created_at DESC`;
    const rows = await env.DB.prepare(q).bind(...args).all();
    return json({ collections: (rows.results as any[]).map((r) => ({ ...r, data: JSON.parse(r.data) })) });
  }
  if (action === "collection-photos") {
    const collectionId = Number(url.searchParams.get("collectionId")) || 0;
    if (!collectionId) return json({ photos: [] });
    const rows = await env.DB.prepare("SELECT id,collection_id,photo_type,caption,created_at FROM field_photos WHERE collection_id=? ORDER BY id").bind(collectionId).all();
    return json({ photos: rows.results });
  }
  if (action === "validation-assignments") {
    const projectId = Number(url.searchParams.get("projectId")) || 0;
    if (user.role === "field_user") {
      const rows = await env.DB.prepare(`
        SELECT va.*,p.name AS project_name,i.data AS asset_data,i.latitude,i.longitude
        FROM validation_assignments va
        JOIN projects p ON p.id=va.project_id
        LEFT JOIN inventory i ON COALESCE(json_extract(i.data,'$.projectId'),1)=va.project_id AND CAST(json_extract(i.data,'$.id') AS INTEGER)=va.asset_id
        WHERE va.assigned_to=?
        ORDER BY CASE va.status WHEN 'assigned' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'issue' THEN 2 WHEN 'ok' THEN 3 ELSE 4 END, va.updated_at DESC
      `).bind(user.id).all<any>();
      return json({ assignments: (rows.results as any[]).map((row) => ({ ...row, report: JSON.parse(row.report || "{}"), asset: row.asset_data ? JSON.parse(row.asset_data) : null })) });
    }
    if (user.role !== "admin" && user.role !== "creator") return json({ error: "Forbidden" }, 403);
    if (!projectId) return json({ assignments: [] });
    const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
    if (!allowed) return json({ error: "Forbidden" }, 403);
    const rows = await env.DB.prepare(`
      SELECT va.*,u.name AS assignee_name,u.email AS assignee_email,i.data AS asset_data
      FROM validation_assignments va
      JOIN users u ON u.id=va.assigned_to
      LEFT JOIN inventory i ON COALESCE(json_extract(i.data,'$.projectId'),1)=va.project_id AND CAST(json_extract(i.data,'$.id') AS INTEGER)=va.asset_id
      WHERE va.project_id=?
      ORDER BY va.updated_at DESC
    `).bind(projectId).all<any>();
    return json({ assignments: (rows.results as any[]).map((row) => ({ ...row, report: JSON.parse(row.report || "{}"), asset: row.asset_data ? JSON.parse(row.asset_data) : null })) });
  }
  if (action === "photo") {
    const photoId = Number(url.searchParams.get("id")) || 0;
    const photo = await env.DB.prepare("SELECT photo_data,photo_type FROM field_photos WHERE id=?").bind(photoId).first<{ photo_data: string; photo_type: string }>();
    if (!photo) return json({ error: "Not found" }, 404);
    return json({ photo: photo.photo_data, type: photo.photo_type });
  }
  if (action === "boundaries" && (user.role === "admin" || user.role === "creator" || user.role === "field_user")) {
    const rows = await env.DB.prepare("SELECT id,name,boundary_type,levels,uploaded_by,created_at FROM admin_boundaries ORDER BY created_at DESC").all();
    return json({ boundaries: (rows.results as any[]).map((r) => ({ ...r, levels: JSON.parse(r.levels) })) });
  }
  if (action === "boundary-geojson") {
    const id = Number(url.searchParams.get("id")) || 0;
    const row = await env.DB.prepare("SELECT geojson FROM admin_boundaries WHERE id=?").bind(id).first<{ geojson: string }>();
    if (!row) return json({ error: "Not found" }, 404);
    return json({ geojson: JSON.parse(row.geojson) });
  }
  if (action === "project-contacts" && (user.role === "admin" || user.role === "creator")) {
    const projectId = Number(url.searchParams.get("projectId")) || 0;
    const rows = await env.DB.prepare("SELECT * FROM project_contacts WHERE project_id IN (0, ?) ORDER BY is_default DESC, name").bind(projectId).all();
    return json({ contacts: rows.results });
  }
  if (action === "flight-schedules") {
    const projectId = Number(url.searchParams.get("projectId")) || 0;
    if (!projectId) return json({ schedules: [] });
    const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
    if (!allowed) return json({ error: "Forbidden" }, 403);
    const rows = await env.DB.prepare("SELECT * FROM flight_schedules WHERE project_id=? ORDER BY updated_at DESC").bind(projectId).all();
    return json({ schedules: rows.results });
  }
  if (action === "notification-audit" && (user.role === "admin" || user.role === "creator")) {
    const projectId = Number(url.searchParams.get("projectId")) || 0;
    const from = Number(url.searchParams.get("from")) || 0;
    const to = Number(url.searchParams.get("to")) || Date.now();
    if (projectId) {
      const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
      if (!allowed) return json({ error: "Forbidden" }, 403);
    }
    const rows = projectId
      ? await env.DB.prepare("SELECT * FROM notification_audit WHERE project_id=? AND created_at BETWEEN ? AND ? ORDER BY created_at DESC").bind(projectId, from, to).all<any>()
      : await env.DB.prepare("SELECT * FROM notification_audit WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC").bind(from, to).all<any>();
    const results = rows.results as any[];
    return json({
      audit: results,
      summary: {
        records: results.length,
        recipientEmails: results.filter((row) => row.channel === "email").reduce((sum, row) => sum + Number(row.recipient_count || 0), 0),
        sent: results.filter((row) => ["sent", "delivered"].includes(String(row.status))).length,
        failed: results.filter((row) => row.status === "failed").length,
        skipped: results.filter((row) => row.status === "skipped").length,
      },
    });
  }
  if (action === "export-tracker") {
    const projectId = Number(url.searchParams.get("projectId")) || 0;
    const type = String(url.searchParams.get("type") ?? "comprehensive");
    if (!projectId) return json({ error: "Project required" }, 400);
    const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
    if (!allowed) return json({ error: "Forbidden" }, 403);
    const project = await env.DB.prepare("SELECT name FROM projects WHERE id=?").bind(projectId).first<{ name: string }>();
    const inventory = await env.DB.prepare("SELECT data FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=? ORDER BY id").bind(projectId).all<{ data: string }>();
    const schedules = await env.DB.prepare("SELECT * FROM flight_schedules WHERE project_id=? ORDER BY updated_at DESC").bind(projectId).all<any>();
    const contacts = await env.DB.prepare("SELECT * FROM project_contacts WHERE project_id IN (0, ?) ORDER BY is_default DESC, name").bind(projectId).all<any>();
    const items = inventory.results.map((row) => JSON.parse(row.data));
    const scheduleMap = new Map((schedules.results as any[]).map((row) => [Number(row.asset_id), row]));
    const { execution, cost, execFormulas, costFormulas } = trackerRows(items, scheduleMap);
    const flightRows = [[
      "SN", "Billboard", "Location", "Vendor", "Stage", "Flight Status", "Start Date", "End Date", "Duration Days", "Remaining Days", "Reminder Days", "Note",
    ], ...items.map((item, index) => {
      const schedule = scheduleMap.get(Number(item.id));
      const remaining = schedule?.end_at ? Math.ceil((Number(schedule.end_at) - Date.now()) / 86400000) : "";
      return [
        index + 1, item.street, `${item.district} - ${item.from || ""} ${item.to ? `to ${item.to}` : ""}`.trim(),
        item.vendor || item.owner || "UNKNOWN", schedule?.stage ?? "design", schedule?.flight_status ?? "unflighted",
        excelDate(schedule?.start_at), excelDate(schedule?.end_at), schedule?.duration_days ?? "", remaining,
        schedule?.reminder_days ?? "", schedule?.note ?? "",
      ];
    })];
    const summaryRows = [
      ["Project", project?.name ?? `Project ${projectId}`],
      ["Generated", new Date().toISOString()],
      ["Total Billboards", items.length],
      ["Large Format", items.filter((item) => item.mediaType === "large-format").length],
      ["Digital Screen", items.filter((item) => item.mediaType === "digital-screen").length],
      ["Lamp Post", items.filter((item) => item.mediaType === "lamp-post").length],
      ["Fabricated Banner", items.filter((item) => item.mediaType === "fabricated-banner").length],
      ["Flighted", schedules.results.filter((row: any) => row.flight_status === "flighted").length],
      ["Due / Expired", schedules.results.filter((row: any) => row.flight_status === "flighted" && row.end_at && Number(row.end_at) <= Date.now()).length],
      [],
      ["Execution dropdowns", "Artwork delivery: RECEIVED, PENDING, NOT RECEIVED, CXD; Approval: APPROVED, RETURNED, CXD; Printing: COMPLETE, IN PROGRESS, PENDING, CXD, NOT STARTED, N/A"],
    ];
    const contactRows = [["Name", "Scope", "Emails", "WhatsApp Phones"], ...(contacts.results as any[]).map((contact) => [contact.name, contact.project_id === 0 ? "Global" : "Project", contact.emails, contact.phones])];
    const sheets = [rowsToExcelSheet("Summary", summaryRows)];
    if (type === "design" || type === "comprehensive") sheets.push(rowsToExcelSheet("Execution Tracker", execution, execFormulas));
    if (type === "cost" || type === "comprehensive") sheets.push(rowsToExcelSheet("Cost Tracker", cost, costFormulas));
    if (type === "comprehensive") {
      sheets.push(rowsToExcelSheet("Flighting Schedule", flightRows));
      sheets.push(rowsToExcelSheet("Contacts", contactRows));
    }
    const safeProject = String(project?.name ?? "project").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    return exportResponse(excelWorkbook(sheets), `${safeProject}-${type}-tracker.xls`);
  }
  return json({ error: "Not found" }, 404);
}

export async function POST(request: Request) {
  await setup();
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const body = (await request.json()) as Record<string, any>;
  if (action === "login") {
    const record = await env.DB.prepare("SELECT id,name,email,role,password_hash AS passwordHash FROM users WHERE lower(email)=lower(?)")
      .bind(String(body.email ?? "")).first<User & { passwordHash: string }>();
    if (!record) return json({ error: "Invalid email or password" }, 401);
    const [salt] = record.passwordHash.split(":");
    if ((await passwordHash(String(body.password ?? ""), salt)) !== record.passwordHash)
      return json({ error: "Invalid email or password" }, 401);
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    await env.DB.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)")
      .bind(token, record.id, Date.now() + 604800000).run();
    const user = { id: record.id, name: record.name, email: record.email, role: record.role };
    return json({ user, token }, 200, { "Set-Cookie": `kmk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800` });
  }
  const user = await currentUser(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  if (action === "logout") {
    await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(cookieToken(request)).run();
    return json({ ok: true }, 200, { "Set-Cookie": "kmk_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }
  if (action === "inventory") {
    const items = Array.isArray(body.items) ? body.items : [];
    const projectId = Number(body.projectId) || 1;
    const valid = items.filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)) && Number(item.lat) !== 0 && Number(item.lng) !== 0)
      .map((item) => ({ ...item, projectId }));
    for (const item of valid) {
      const sourceId = Number(item.id) || null;
      const exists = await env.DB.prepare("SELECT id FROM inventory WHERE source_id=? AND COALESCE(json_extract(data,'$.projectId'),1)=?")
        .bind(sourceId, projectId).first();
      if (!exists) {
        await env.DB.prepare("INSERT INTO inventory (source_id,data,latitude,longitude,created_at) VALUES (?,?,?,?,?)")
          .bind(sourceId, JSON.stringify(item), Number(item.lat), Number(item.lng), Date.now()).run();
      } else {
        await env.DB.prepare("UPDATE inventory SET data=?, latitude=?, longitude=? WHERE id=?")
          .bind(JSON.stringify(item), Number(item.lat), Number(item.lng), (exists as { id: number }).id).run();
      }
    }
    return json({ imported: valid.length, rejected: items.length - valid.length });
  }
  if (action === "projects" && (user.role === "admin" || user.role === "creator")) {
    const token = crypto.randomUUID().replaceAll("-", "");
    const code = shareCode();
    const result = await env.DB.prepare("INSERT INTO projects (name,project_type,share_token,share_code,created_by,created_at) VALUES (?,?,?,?,?,?)")
      .bind(String(body.name), String(body.projectType || "Outdoor media"), token, code, user.id, Date.now()).run();
    await env.DB.prepare("INSERT INTO project_users (project_id,user_id) VALUES (?,?)").bind(result.meta.last_row_id, user.id).run();
    return json({ project: { id: result.meta.last_row_id, name: body.name, project_type: body.projectType, share_token: token, share_code: code, share_protected: 1 } }, 201);
  }
  if (action === "project-contacts" && (user.role === "admin" || user.role === "creator")) {
    const now = Date.now();
    const projectId = Number(body.projectId) || 0;
    if (user.role !== "admin" && projectId === 0) return json({ error: "Only admin can set global contacts" }, 403);
    if (projectId) {
      const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
      if (!allowed) return json({ error: "Forbidden" }, 403);
    }
    const name = String(body.name ?? "Project contact").trim();
    const emails = splitContacts(String(body.emails ?? "")).join(",");
    const phones = splitContacts(String(body.phones ?? "")).join(",");
    const isDefault = body.isDefault ? 1 : 0;
    if (body.id) {
      await env.DB.prepare("UPDATE project_contacts SET project_id=?,name=?,emails=?,phones=?,is_default=?,updated_at=? WHERE id=?")
        .bind(projectId, name, emails, phones, isDefault, now, Number(body.id)).run();
    } else {
      await env.DB.prepare("INSERT INTO project_contacts (project_id,name,emails,phones,is_default,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(projectId, name, emails, phones, isDefault, user.id, now, now).run();
    }
    const rows = await env.DB.prepare("SELECT * FROM project_contacts WHERE project_id IN (0, ?) ORDER BY is_default DESC, name").bind(projectId).all();
    return json({ contacts: rows.results });
  }
  if (action === "assign-validations" && (user.role === "admin" || user.role === "creator")) {
    const projectId = Number(body.projectId) || 0;
    const assetIds = Array.isArray(body.assetIds) ? body.assetIds.map(Number).filter(Boolean) : [Number(body.assetId)].filter(Boolean);
    const userIds = Array.isArray(body.userIds) ? body.userIds.map(Number).filter(Boolean) : [Number(body.userId)].filter(Boolean);
    if (!projectId || !assetIds.length || !userIds.length) return json({ error: "Project, billboards, and field users are required" }, 400);
    const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
    if (!allowed) return json({ error: "Forbidden" }, 403);
    const fieldUsers = await env.DB.prepare(`SELECT id FROM users WHERE role='field_user' AND id IN (${userIds.map(() => "?").join(",")})`).bind(...userIds).all<{ id: number }>();
    const validUserIds = fieldUsers.results.map((row: { id: number }) => row.id);
    if (!validUserIds.length) return json({ error: "Select at least one field user" }, 400);
    const now = Date.now();
    const statements = [];
    for (const assetId of assetIds) {
      for (const assignedTo of validUserIds) {
        statements.push(
          env.DB.prepare("INSERT INTO validation_assignments (project_id,asset_id,assigned_to,status,report,assigned_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,asset_id,assigned_to) DO UPDATE SET status='assigned',assigned_by=excluded.assigned_by,updated_at=excluded.updated_at")
            .bind(projectId, assetId, assignedTo, "assigned", "{}", user.id, now, now),
        );
      }
    }
    if (statements.length) await env.DB.batch(statements);
    return json({ ok: true, assigned: statements.length });
  }
  if (action === "submit-validation" && user.role === "field_user") {
    const assignmentId = Number(body.assignmentId) || 0;
    const verdict = String(body.verdict ?? "").trim();
    if (!assignmentId || !["ok", "issue"].includes(verdict)) return json({ error: "Validation decision is required" }, 400);
    const assignment = await env.DB.prepare("SELECT * FROM validation_assignments WHERE id=? AND assigned_to=?")
      .bind(assignmentId, user.id).first<any>();
    if (!assignment) return json({ error: "Assignment not found" }, 404);
    const now = Date.now();
    const report = {
      verdict,
      issueType: String(body.issueType ?? ""),
      issueDetail: String(body.issueDetail ?? ""),
      customIssue: String(body.customIssue ?? ""),
      photo: String(body.photo ?? ""),
      latitude: Number(body.latitude) || null,
      longitude: Number(body.longitude) || null,
      accuracy: Number(body.accuracy) || null,
      submittedAt: now,
    };
    await env.DB.prepare("UPDATE validation_assignments SET status=?,report=?,completed_at=?,updated_at=? WHERE id=?")
      .bind(verdict, JSON.stringify(report), now, now, assignmentId).run();
    if (verdict === "ok" && report.photo) {
      const row = await env.DB.prepare("SELECT id,data FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=? AND CAST(json_extract(data,'$.id') AS INTEGER)=?")
        .bind(Number(assignment.project_id), Number(assignment.asset_id)).first<{ id: number; data: string }>();
      if (row) {
        const data = JSON.parse(row.data);
        data.photoUrl = report.photo;
        data.validationStatus = "ok";
        data.validatedAt = now;
        data.validatedBy = user.id;
        await env.DB.prepare("UPDATE inventory SET data=? WHERE id=?").bind(JSON.stringify(data), row.id).run();
      }
    }
    return json({ ok: true });
  }
  if (action === "flight-schedule" && (user.role === "admin" || user.role === "creator" || user.role === "planner")) {
    const projectId = Number(body.projectId) || 0;
    const assetIds = Array.isArray(body.assetIds) ? body.assetIds.map(Number).filter(Boolean) : [Number(body.assetId)].filter(Boolean);
    if (!projectId || !assetIds.length) return json({ error: "Project and billboards are required" }, 400);
    const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
    if (!allowed) return json({ error: "Forbidden" }, 403);
    const now = Date.now();
    const stage = String(body.stage ?? "design");
    const flightStatus = normalizedFlightStatus(stage, String(body.flightStatus ?? (stage === "flighted" ? "flighted" : "unflighted")));
    const startAt = body.startAt ? Number(body.startAt) : (flightStatus === "flighted" ? now : null);
    const durationDays = Number(body.durationDays) || 0;
    const endAt = body.endAt ? Number(body.endAt) : (startAt && durationDays ? startAt + durationDays * 86400000 : null);
    const reminderDays = Number(body.reminderDays) || 0;
    const note = String(body.note ?? "");
    for (const assetId of assetIds) {
      await env.DB.prepare("INSERT INTO flight_schedules (project_id,asset_id,stage,flight_status,start_at,end_at,duration_days,reminder_days,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,asset_id) DO UPDATE SET stage=excluded.stage,flight_status=excluded.flight_status,start_at=excluded.start_at,end_at=excluded.end_at,duration_days=excluded.duration_days,reminder_days=excluded.reminder_days,note=excluded.note,updated_at=excluded.updated_at")
        .bind(projectId, assetId, stage, flightStatus, startAt, endAt, durationDays, reminderDays, note, user.id, now, now).run();
      const inventoryRow = await env.DB.prepare("SELECT id,data FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=? AND CAST(json_extract(data,'$.id') AS INTEGER)=?")
        .bind(projectId, assetId).first<{ id: number; data: string }>();
      if (inventoryRow) {
        const inventoryData = JSON.parse(inventoryRow.data);
        inventoryData.flightStatus = flightStatus;
        inventoryData.flightStage = stage;
        inventoryData.flightExpiry = endAt ?? "";
        await env.DB.prepare("UPDATE inventory SET data=? WHERE id=?").bind(JSON.stringify(inventoryData), inventoryRow.id).run();
      }
    }
    if (flightStatus === "flighted") {
      const contacts = await env.DB.prepare("SELECT * FROM project_contacts WHERE project_id IN (0, ?)").bind(projectId).all<any>();
      const emails = [...new Set((contacts.results as any[]).flatMap((row) => splitContacts(row.emails)))];
      const phones = [...new Set((contacts.results as any[]).flatMap((row) => splitContacts(row.phones)))];
      const project = await env.DB.prepare("SELECT name FROM projects WHERE id=?").bind(projectId).first<{ name: string }>();
      const inventory = await env.DB.prepare("SELECT data FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=? ORDER BY id").bind(projectId).all<{ data: string }>();
      const items = inventory.results.map((row) => JSON.parse(row.data)).filter((item) => assetIds.includes(Number(item.id)));
      const projectName = project?.name ?? "project";
      const fallbackItems = items.length ? items : assetIds.map((assetId) => ({ id: assetId }));
      for (const item of items.length ? items : [{}]) {
        const subject = flightNotificationSubject(item);
        const emailResult: any = await sendResendEmail(emails, subject, flightNotificationHtml([item], projectName, startAt, durationDays, endAt, note));
        await recordNotificationAudit({
          projectId,
          assetId: Number(item.id) || null,
          notificationType: "flighted",
          channel: "email",
          recipients: emails,
          subject,
          status: emailResult.error ? "failed" : emailResult.skipped ? "skipped" : "sent",
          providerId: emailResult.providerId,
          providerResponse: emailResult,
          createdBy: user.id,
          createdAt: now,
        });
      }
      for (const item of fallbackItems) {
        const smsMessage = flightNotificationText(item, projectName, startAt, durationDays, endAt, note);
        const sms = await Promise.all(phones.map(async (phone) => {
          const smsResult: any = await sendSmsText(phone, smsMessage);
          return { phone, api: smsResult };
        }));
        await recordNotificationAudit({
          projectId,
          assetId: Number(item.id) || null,
          notificationType: "flighted",
          channel: "sms",
          recipients: phones,
          subject: `SMS ${flightNotificationSubject(item)}`,
          status: sms.some((result) => result.api?.sent) ? "sent" : sms.some((result) => result.api?.skipped) ? "skipped" : "failed",
          providerResponse: sms,
          createdBy: user.id,
          createdAt: now,
        });
      }
      const message = `Please be informed that ${fallbackItems.length} billboard(s) have been successfully flighted for about ${durationDays || "open"} day(s) in ${projectName}. Expiry: ${endAt ? new Date(endAt).toLocaleDateString("en-GB") : "Not set"}.`;
      const whatsapp = await Promise.all(phones.map(async (phone) => ({
        phone,
        link: whatsappLink(phone, message),
        api: await sendWhatsAppText(phone, message),
      })));
      return json({ ok: true, whatsapp, sms: { billboards: fallbackItems.length, recipients: phones.length } });
    }
    return json({ ok: true });
  }
  if (action === "send-flight-reminders" && (user.role === "admin" || user.role === "creator")) {
    const projectId = Number(body.projectId) || 0;
    const now = Date.now();
    const rows = await env.DB.prepare("SELECT fs.*,p.name AS project_name FROM flight_schedules fs JOIN projects p ON p.id=fs.project_id WHERE fs.flight_status='flighted' AND fs.end_at IS NOT NULL AND fs.project_id=? AND fs.end_at<=? AND (fs.last_notified_at IS NULL OR fs.last_notified_at<fs.end_at)")
      .bind(projectId, now).all<any>();
    const contacts = await env.DB.prepare("SELECT * FROM project_contacts WHERE project_id IN (0, ?)").bind(projectId).all<any>();
    const emails = [...new Set((contacts.results as any[]).flatMap((row) => splitContacts(row.emails)))];
    const phones = [...new Set((contacts.results as any[]).flatMap((row) => splitContacts(row.phones)))];
    const due = rows.results as any[];
    if (due.length) {
      const message = `Billboard 360 reminder: ${due.length} flighted billboard(s) have reached removal/expiry date.`;
      const reminderResult: any = await sendResendEmail(emails, "Billboard removal reminder", `<p>${message}</p><p>Project: ${due[0]?.project_name ?? ""}</p>`);
      await recordNotificationAudit({
        projectId,
        assetId: null,
        notificationType: "expiry_reminder",
        channel: "email",
        recipients: emails,
        subject: "Billboard removal reminder",
        status: reminderResult.error ? "failed" : reminderResult.skipped ? "skipped" : "sent",
        providerId: reminderResult.providerId,
        providerResponse: reminderResult,
        createdBy: user.id,
        createdAt: now,
      });
      await env.DB.batch(due.map((row) => env.DB.prepare("UPDATE flight_schedules SET last_notified_at=? WHERE id=?").bind(now, row.id)));
      const whatsapp = await Promise.all(phones.map(async (phone) => ({
        phone,
        link: whatsappLink(phone, message),
        api: await sendWhatsAppText(phone, message),
      })));
      const sms = await Promise.all(phones.map(async (phone) => {
        const smsResult: any = await sendSmsText(phone, message);
        return { phone, api: smsResult };
      }));
      await recordNotificationAudit({
        projectId,
        assetId: null,
        notificationType: "expiry_reminder",
        channel: "sms",
        recipients: phones,
        subject: "SMS billboard removal reminder",
        status: sms.some((item) => item.api?.sent) ? "sent" : sms.some((item) => item.api?.skipped) ? "skipped" : "failed",
        providerResponse: sms,
        createdBy: user.id,
        createdAt: now,
      });
      return json({ sent: due.length, whatsapp, sms });
    }
    return json({ sent: 0, whatsapp: [] });
  }
  if (action === "share-mode" && (user.role === "admin" || user.role === "creator")) {
    const projectId = Number(body.projectId) || 0;
    const isProtected = body.protected !== false;
    if (!projectId) return json({ error: "Project required" }, 400);
    const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
    if (!allowed) return json({ error: "Forbidden" }, 403);
    const existing = await env.DB.prepare("SELECT share_code FROM projects WHERE id=?").bind(projectId).first<{ share_code: string }>();
    if (!existing) return json({ error: "Project not found" }, 404);
    const nextCode = existing.share_code || shareCode();
    await env.DB.prepare("UPDATE projects SET share_protected=?, share_code=? WHERE id=?")
      .bind(isProtected ? 1 : 0, nextCode, projectId).run();
    const project = await env.DB.prepare("SELECT id,name,project_type,share_token,share_code,share_protected FROM projects WHERE id=?")
      .bind(projectId).first();
    return json({ project });
  }
  if (action === "plans" && user.role !== "viewer") {
    const projectId = Number(body.projectId) || 1;
    if (body.id) {
      await env.DB.prepare("UPDATE campaign_plans SET name=?,data=?,note=?,updated_at=? WHERE id=? AND (user_id=? OR ?='admin')")
        .bind(String(body.name), JSON.stringify(body.data ?? {}), String(body.note ?? ""), Date.now(), Number(body.id), user.id, user.role).run();
      return json({ ok: true });
    }
    const result = await env.DB.prepare("INSERT INTO campaign_plans (project_id,user_id,name,data,note,updated_at) VALUES (?,?,?,?,?,?)")
      .bind(projectId, user.id, String(body.name || "Untitled plan"), JSON.stringify(body.data ?? {}), String(body.note ?? ""), Date.now()).run();
    return json({ id: result.meta.last_row_id }, 201);
  }
  if (action === "plan") {
    await env.DB.prepare("INSERT INTO plans (user_id,data,note,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,note=excluded.note,updated_at=excluded.updated_at")
      .bind(user.id, JSON.stringify(body.plan ?? {}), String(body.note ?? ""), Date.now()).run();
    return json({ ok: true });
  }
  if (action === "delete-inventory" && (user.role === "admin" || user.role === "creator")) {
    const sourceId = Number(body.id);
    const projectId = Number(body.projectId) || 1;
    if (!sourceId) return json({ error: "Invalid id" }, 400);
    await env.DB.prepare("DELETE FROM inventory WHERE source_id=? AND COALESCE(json_extract(data,'$.projectId'),1)=?")
      .bind(sourceId, projectId).run();
    return json({ ok: true });
  }
  if (action === "clear-inventory" && (user.role === "admin" || user.role === "creator")) {
    const projectId = Number(body.projectId) || 0;
    if (!projectId) return json({ error: "Project is required" }, 400);
    const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
    if (!allowed) return json({ error: "Forbidden" }, 403);
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=?")
      .bind(projectId).first<{ total: number }>();
    await env.DB.prepare("DELETE FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=?")
      .bind(projectId).run();
    return json({ ok: true, deleted: count?.total ?? 0 });
  }
  if (action === "delete-project" && (user.role === "admin" || user.role === "creator")) {
    const projectId = Number(body.projectId) || 0;
    if (!projectId) return json({ error: "Project is required" }, 400);
    const project = await env.DB.prepare("SELECT id,name,created_by FROM projects WHERE id=?")
      .bind(projectId).first<{ id: number; name: string; created_by: number }>();
    if (!project) return json({ error: "Project not found" }, 404);
    if (user.role !== "admin" && Number(project.created_by) !== user.id) {
      return json({ error: "Only the project creator can delete this project" }, 403);
    }
    const inventoryCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=?")
      .bind(projectId).first<{ total: number }>();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM field_photos WHERE collection_id IN (SELECT id FROM field_collections WHERE COALESCE(project_id,1)=?)").bind(projectId),
      env.DB.prepare("DELETE FROM field_collections WHERE COALESCE(project_id,1)=?").bind(projectId),
      env.DB.prepare("DELETE FROM missions WHERE project_id=?").bind(projectId),
      env.DB.prepare("DELETE FROM flight_schedules WHERE project_id=?").bind(projectId),
      env.DB.prepare("DELETE FROM project_contacts WHERE project_id=?").bind(projectId),
      env.DB.prepare("DELETE FROM campaign_plans WHERE project_id=?").bind(projectId),
      env.DB.prepare("DELETE FROM project_users WHERE project_id=?").bind(projectId),
      env.DB.prepare("DELETE FROM inventory WHERE COALESCE(json_extract(data,'$.projectId'),1)=?").bind(projectId),
      env.DB.prepare("DELETE FROM projects WHERE id=?").bind(projectId),
    ]);
    return json({ ok: true, deletedProject: project.name, deletedInventory: inventoryCount?.total ?? 0 });
  }
  if (action === "users" && user.role === "admin") {
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!name || !email.includes("@") || password.length < 8) {
      return json({ error: "Name, valid email, and an 8+ character password are required" }, 400);
    }
    const duplicate = await env.DB.prepare("SELECT id FROM users WHERE lower(email)=?").bind(email).first();
    if (duplicate) return json({ error: "A user with this email already exists" }, 409);
    const salt = crypto.randomUUID();
    const hash = await passwordHash(password, salt);
    const validRoles = ["admin","creator","planner","viewer","field_user"];
    await env.DB.prepare("INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)")
      .bind(name, email, hash, validRoles.includes(body.role) ? body.role : "viewer", Date.now()).run();
    const newUser = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first<{ id: number }>();
    if (newUser && body.projectId) await env.DB.prepare("INSERT OR IGNORE INTO project_users (project_id,user_id) VALUES (?,?)").bind(Number(body.projectId), newUser.id).run();
    return json({ ok: true }, 201);
  }
  if (action === "reset-password" && user.role === "admin") {
    const targetId = Number(body.userId);
    const password = String(body.password ?? "");
    if (!targetId || password.length < 8) return json({ error: "An 8+ character password is required" }, 400);
    const salt = crypto.randomUUID();
    const hash = await passwordHash(password, salt);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(hash, targetId),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetId),
    ]);
    return json({ ok: true });
  }
  if (action === "user-groups" && (user.role === "admin" || user.role === "creator")) {
    if (body.id) {
      await env.DB.prepare("UPDATE user_groups SET name=?,description=? WHERE id=?").bind(String(body.name), String(body.description ?? ""), Number(body.id)).run();
      return json({ ok: true });
    }
    const result = await env.DB.prepare("INSERT INTO user_groups (name,description,created_by,created_at) VALUES (?,?,?,?)")
      .bind(String(body.name), String(body.description ?? ""), user.id, Date.now()).run();
    return json({ id: result.meta.last_row_id }, 201);
  }
  if (action === "group-members" && (user.role === "admin" || user.role === "creator")) {
    const groupId = Number(body.groupId);
    if (!groupId) return json({ error: "Group is required" }, 400);
    if (Array.isArray(body.userIds)) {
      const requestedIds = [...new Set(body.userIds.map(Number).filter(Boolean))];
      await env.DB.prepare("DELETE FROM user_group_members WHERE group_id=?").bind(groupId).run();
      if (requestedIds.length) {
        await env.DB.batch(requestedIds.map((id) => env.DB.prepare("INSERT OR IGNORE INTO user_group_members (group_id,user_id) SELECT ?,id FROM users WHERE id=? AND role='field_user'").bind(groupId, id)));
      }
      return json({ ok: true, memberCount: requestedIds.length });
    }
    const userId = Number(body.userId);
    if (body.remove) {
      await env.DB.prepare("DELETE FROM user_group_members WHERE group_id=? AND user_id=?").bind(groupId, userId).run();
    } else {
      await env.DB.prepare("INSERT OR IGNORE INTO user_group_members (group_id,user_id) VALUES (?,?)").bind(groupId, userId).run();
    }
    return json({ ok: true });
  }
  if (action === "missions" && (user.role === "admin" || user.role === "creator")) {
    const now = Date.now();
    const projectId = Number(body.projectId) || 1;
    const allowed = user.role === "admin" || Boolean(await env.DB.prepare("SELECT 1 FROM project_users WHERE project_id=? AND user_id=?").bind(projectId, user.id).first());
    if (!allowed) return json({ error: "Forbidden" }, 403);
    const assignedUsers = JSON.stringify(body.assignedUsers ?? []);
    const assignedGroups = JSON.stringify(body.assignedGroups ?? []);
    const config = JSON.stringify(body.config ?? {});
    if (body.id) {
      await env.DB.prepare("UPDATE missions SET project_id=?,name=?,description=?,status=?,config=?,boundary_id=?,assigned_users=?,assigned_groups=?,updated_at=? WHERE id=?")
        .bind(projectId, String(body.name), String(body.description ?? ""), String(body.status ?? "active"), config, body.boundaryId ? Number(body.boundaryId) : null, assignedUsers, assignedGroups, now, Number(body.id)).run();
      return json({ ok: true });
    }
    const result = await env.DB.prepare("INSERT INTO missions (project_id,name,description,status,config,boundary_id,assigned_users,assigned_groups,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(projectId, String(body.name), String(body.description ?? ""), "active", config, body.boundaryId ? Number(body.boundaryId) : null, assignedUsers, assignedGroups, user.id, now, now).run();
    return json({ id: result.meta.last_row_id }, 201);
  }
  if (action === "field-collections") {
    if (user.role !== "field_user") return json({ error: "Only field users can submit field collections" }, 403);
    const missionId = Number(body.missionId);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!missionId || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 || longitude === 0) {
      return json({ error: "Mission and valid GPS coordinates are required" }, 400);
    }
    const mission = await env.DB.prepare("SELECT project_id,assigned_users,assigned_groups,status FROM missions WHERE id=?").bind(missionId).first<any>();
    if (!mission || mission.status !== "active") return json({ error: "Mission is unavailable" }, 404);
    const direct = JSON.parse(mission.assigned_users || "[]").includes(user.id);
    const memberships = await env.DB.prepare("SELECT group_id FROM user_group_members WHERE user_id=?").bind(user.id).all<{ group_id: number }>();
    const assignedGroups = new Set(JSON.parse(mission.assigned_groups || "[]"));
    const throughGroup = memberships.results.some((row) => assignedGroups.has(row.group_id));
    if (!direct && !throughGroup) return json({ error: "This mission is not assigned to you" }, 403);
    const now = Date.now();
    const result = await env.DB.prepare("INSERT INTO field_collections (project_id,mission_id,user_id,status,data,latitude,longitude,accuracy,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(Number(mission.project_id) || 1, missionId, user.id, "pending", JSON.stringify(body.data ?? {}), latitude, longitude, Number(body.accuracy ?? 0), now).run();
    const collectionId = result.meta.last_row_id;
    if (Array.isArray(body.photos)) {
      for (const photo of body.photos) {
        await env.DB.prepare("INSERT INTO field_photos (collection_id,photo_type,photo_data,caption,created_at) VALUES (?,?,?,?,?)")
          .bind(collectionId, String(photo.type ?? "billboard"), String(photo.data), String(photo.caption ?? ""), now).run();
      }
    }
    return json({ id: collectionId }, 201);
  }
  if (action === "field-photos") {
    const collectionId = Number(body.collectionId);
    const now = Date.now();
    const photos = Array.isArray(body.photos) ? body.photos : [{ data: body.data, type: body.type ?? "billboard", caption: body.caption ?? "" }];
    for (const photo of photos) {
      await env.DB.prepare("INSERT INTO field_photos (collection_id,photo_type,photo_data,caption,created_at) VALUES (?,?,?,?,?)")
        .bind(collectionId, String(photo.type ?? "billboard"), String(photo.data), String(photo.caption ?? ""), now).run();
    }
    return json({ ok: true }, 201);
  }
  if (action === "validate-collection" && (user.role === "admin" || user.role === "creator")) {
    const status = body.status === "rejected" ? "rejected" : "validated";
    await env.DB.prepare("UPDATE field_collections SET status=?,validated_by=?,validated_at=? WHERE id=?")
      .bind(status, user.id, Date.now(), Number(body.id)).run();
    return json({ ok: true });
  }
  if (action === "boundaries" && (user.role === "admin" || user.role === "creator")) {
    const geojson = typeof body.geojson === "string" ? body.geojson : JSON.stringify(body.geojson);
    const parsed = JSON.parse(geojson);
    const levels: string[] = [];
    if (parsed.features?.length) {
      const props = parsed.features[0].properties ?? {};
      for (const key of ["Region","District","Ward","Shehia","Street","Village","Mtaa"]) {
        if (key in props) levels.push(key);
      }
    }
    const result = await env.DB.prepare("INSERT INTO admin_boundaries (name,boundary_type,geojson,levels,uploaded_by,created_at) VALUES (?,?,?,?,?,?)")
      .bind(String(body.name ?? "Boundary"), String(body.boundaryType ?? "mainland"), geojson, JSON.stringify(levels), user.id, Date.now()).run();
    return json({ id: result.meta.last_row_id, levels }, 201);
  }
  return json({ error: "Not found" }, 404);
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user || user.role !== "admin") return json({ error: "Forbidden" }, 403);
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "user";
  const id = Number(url.searchParams.get("id"));
  if (!id) return json({ error: "Invalid id" }, 400);
  if (action === "group") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM user_group_members WHERE group_id=?").bind(id),
      env.DB.prepare("DELETE FROM user_groups WHERE id=?").bind(id),
    ]);
    return json({ ok: true });
  }
  if (id === user.id) return json({ error: "You cannot remove your own account" }, 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM user_group_members WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM project_users WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM plans WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM campaign_plans WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM users WHERE id=?").bind(id),
  ]);
  return json({ ok: true });
}
