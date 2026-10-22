import { activityChanges } from './operations-view.mjs';

// Shared by the paged history and the full export so their scopes cannot drift.
export function historyFilter(params, projectId) {
  const clauses = ['a.project_id=?'];
  const values = [projectId];
  const assetId = params.get('assetId') || '';
  const actor = params.get('actor') || '';
  const event = params.get('event') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const q = (params.get('q') || '').trim().slice(0,200).toLowerCase();
  for (const value of [from,to]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)) throw new Error('Enter a valid date');
  }
  if (from && to && from>to) throw new Error('From date must be on or before To date');
  if (assetId) {
    if (!/^\d+$/.test(assetId) || !Number.isSafeInteger(Number(assetId))) throw new Error('Invalid billboard filter');
    clauses.push('a.asset_id=?'); values.push(Number(assetId));
  }
  if (actor==='system') clauses.push('a.actor_id IS NULL');
  else if (actor) {
    if (!/^[1-9]\d*$/.test(actor) || !Number.isSafeInteger(Number(actor))) throw new Error('Invalid user filter');
    clauses.push('a.actor_id=?'); values.push(Number(actor));
  }
  if (event) { clauses.push('a.event=?'); values.push(event); }
  if (from) { clauses.push('a.created_at>=?'); values.push(Date.parse(`${from}T00:00:00+03:00`)); }
  if (to) { clauses.push('a.created_at<?'); values.push(Date.parse(`${to}T00:00:00+03:00`)+86400000); }
  if (q) { clauses.push("instr(lower(COALESCE(a.event,'')||' '||COALESCE(a.actor,'')||' '||COALESCE(a.billboard,'')||' '||COALESCE(a.detail,'')),?)>0"); values.push(q); }
  return {where:clauses.join(' AND '),values,assetId,actor,event,from,to,q};
}

export const historySource = `WITH history AS (
  SELECT a.*,COALESCE(CASE WHEN json_valid(a.detail) THEN json_extract(a.detail,'$.actor.name') END,u.name,
    CASE WHEN a.actor_id IS NULL THEN 'System / legacy unrecorded user' ELSE 'User '||a.actor_id END) AS actor,
    COALESCE(CASE WHEN json_valid(a.detail) THEN COALESCE(json_extract(a.detail,'$.after.billboardName'),json_extract(a.detail,'$.before.billboardName')) END,
      (SELECT json_extract(i.data,'$.street') FROM inventory i WHERE i.id=CASE WHEN json_valid(a.detail) THEN COALESCE(json_extract(a.detail,'$.after.inventoryId'),json_extract(a.detail,'$.before.inventoryId')) END),
      (SELECT json_extract(i.data,'$.street') FROM inventory i JOIN inventory_projects ip ON ip.inventory_id=i.id
      WHERE ip.project_id=a.project_id AND i.source_id=a.asset_id LIMIT 1),
      CASE WHEN a.asset_id IS NULL OR a.asset_id=0 THEN 'Project activity' ELSE 'Billboard '||a.asset_id END) AS billboard,
    COALESCE(CASE WHEN json_valid(a.detail) THEN COALESCE(json_extract(a.detail,'$.after.projectName'),json_extract(a.detail,'$.before.projectName')) END,
      (SELECT name FROM projects WHERE id=a.project_id),'Project '||a.project_id) AS project_name
  FROM asset_activity a LEFT JOIN users u ON u.id=a.actor_id WHERE a.project_id=?
)`;

const xml = value => String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cell = (value,style='Text',type='String') => `<Cell ss:StyleID="${style}"><Data ss:Type="${type}">${xml(value)}</Data></Cell>`;
// Excel SpreadsheetML, matching the application's existing Excel report format.
// Values are explicit strings, never formulas, even when uploaded text starts '='.
export function historyWorkbook(records, {project,filters,exportedBy,exportedAt=Date.now()}) {
  const headings=['Activity ID','Date / time (EAT)','Changed by','Type of change','Billboard / scope','Project','Field','Before','After'];
  const body=[];
  for (const record of records) {
    const changes=activityChanges(record.detail,record.event);
    const lines=changes.rows.length?changes.rows:[{field:'Details',before:'',after:changes.message||'No field changes recorded.'}];
    const timestamp=new Date(Number(record.created_at)+10800000);
    for (const change of lines) body.push(`<Row>${cell(record.id)}${Number.isFinite(timestamp.getTime())?cell(timestamp.toISOString().slice(0,19),'Date','DateTime'):cell('Not recorded')}${[record.actor,record.event,record.billboard,record.project_name||project,change.field,change.before,change.after].map(value=>cell(value,body.length%2?'Alt':'Text')).join('')}</Row>`);
  }
  const meta=[`Project: ${project}`,`${records.length} activities. One row per changed field.`,
    `User: ${filters.actorLabel||'All users'}; Change type: ${filters.event||'All types'}`,
    `Dates (EAT, inclusive): ${filters.from||'Any start'} to ${filters.to||'Any end'}; Billboard: ${filters.assetId||'All'}; Search: ${filters.q||'None'}`,
    `Exported by ${exportedBy} on ${new Date(exportedAt).toLocaleString('en-GB',{timeZone:'Africa/Nairobi'})} EAT`];
  const headerRow=meta.length+2;
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel">
<Styles><Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Calibri" ss:Size="11" ss:Color="#18352C"/><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
<Style ss:ID="Title"><Font ss:Size="18" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#065F46" ss:Pattern="Solid"/></Style>
<Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#047857" ss:Pattern="Solid"/></Style>
<Style ss:ID="Text"/><Style ss:ID="Alt"><Interior ss:Color="#F0F7F4" ss:Pattern="Solid"/></Style>
<Style ss:ID="Date"><NumberFormat ss:Format="dd/mm/yyyy hh:mm:ss"/></Style></Styles>
<Worksheet ss:Name="Activity history"><Table>${[80,140,150,170,190,180,190,270,270].map(width=>`<Column ss:Width="${width}"/>`).join('')}
<Row ss:Height="30"><Cell ss:MergeAcross="8" ss:StyleID="Title"><Data ss:Type="String">Spotlight activity history</Data></Cell></Row>
${meta.map(text=>`<Row ss:Height="30"><Cell ss:MergeAcross="8"><Data ss:Type="String">${xml(text)}</Data></Cell></Row>`).join('')}
<Row ss:Height="30">${headings.map(text=>cell(text,'Header')).join('')}</Row>${body.join('')}
</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>${headerRow}</SplitHorizontal><TopRowBottomPane>${headerRow}</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>
<AutoFilter x:Range="R${headerRow}C1:R${headerRow+body.length}C9" xmlns="urn:schemas-microsoft-com:office:excel"/></Worksheet></Workbook>`;
}
