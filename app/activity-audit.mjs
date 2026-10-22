// D1 batch is a single SQLite transaction. Context exists only inside the same
// transaction as its writes, so parallel requests cannot exchange identities.
const rawStatements = new WeakMap();
export function auditedDatabase(db, user) {
  if (!Number.isInteger(user?.id) || user.id <= 0) throw new Error('Authenticated audit actor required');
  async function batch(statements) {
    const results = await db.batch([
      db.prepare('INSERT INTO activity_write_context(id,actor_id) VALUES(1,?)').bind(user.id),
      ...statements.map(statement => rawStatements.get(statement) || statement),
      db.prepare('DELETE FROM activity_write_context WHERE id=1'),
    ]);
    return results.slice(1,-1);
  }
  function wrap(statement) {
    const wrapped={
      bind(...args){return wrap(statement.bind(...args));},
      first(...args){return statement.first(...args);},
      all(...args){return statement.all(...args);},
      async run(){return (await batch([statement]))[0];},
    };
    rawStatements.set(wrapped,statement);
    return wrapped;
  }
  return {prepare(sql){return wrap(db.prepare(sql));},batch};
}

const quote = value => `'${value.replaceAll("'","''")}'`;
const record = fields => (alias,operation) => `json_object(${Object.entries(fields).flatMap(([label,column])=>[quote(label),typeof column==='function'?column(alias,operation):`${alias}.${column}`]).join(',')})`;
const jsonColumn = column => alias => `json(CASE WHEN json_valid(${alias}.${column}) THEN ${alias}.${column} ELSE '{}' END)`;
// Binary images are not copied into every audit entry. A replacement is recorded
// explicitly on both sides, while ordinary image URLs retain their actual values.
function safeJson(column,photoFields=[],omit=[]) {
  return (alias,operation) => {
    let expression=`json_remove(CASE WHEN json_valid(${alias}.${column}) THEN ${alias}.${column} ELSE '{}' END${omit.map(key=>`, '$.${key}'`).join('')})`;
    for(const key of photoFields){
      const path=`'$.${key}'`,value=`json_extract(${alias}.${column},${path})`;
      const replacement=operation==='UPDATE'?`CASE WHEN json_extract(OLD.${column},${path}) IS NOT json_extract(NEW.${column},${path}) THEN '${alias==='OLD'?'Previous uploaded image':'Replacement uploaded image'}' ELSE 'Uploaded image' END`:`'Uploaded image'`;
      expression=`CASE WHEN ${value} LIKE 'data:%' THEN json_set(${expression},${path},${replacement}) ELSE ${expression} END`;
    }
    return `json(${expression})`;
  };
}
const inventoryAsset = a=>`COALESCE(json_extract(${a}.data,'$.id'),${a}.source_id,${a}.id)`;
const linkedAsset = a=>`COALESCE((SELECT json_extract(data,'$.id') FROM inventory WHERE id=${a}.inventory_id),${a}.inventory_id)`;
const configs=[
  {table:'inventory',name:'Billboard',events:{UPDATE:'Attributes updated'},asset:inventoryAsset,
    projects:a=>`SELECT project_id FROM inventory_projects WHERE inventory_id=${a}.id UNION SELECT COALESCE(json_extract(${a}.data,'$.projectId'),1) WHERE NOT EXISTS(SELECT 1 FROM inventory_projects WHERE inventory_id=${a}.id)`,
    snapshot:safeJson('data',['photoUrl','photoOriginalUrl'],['lastEditedBy','lastEditedAt'])},
  {table:'flight_schedules',name:'Flight schedule',asset:a=>`${a}.asset_id`,snapshot:record({status:'flight_status',stage:'stage',startAt:'start_at',endAt:'end_at',durationDays:'duration_days',reminderDays:'reminder_days',note:'note'})},
  {table:'validation_assignments',name:'Validation',asset:a=>`${a}.asset_id`,snapshot:record({status:'status',assignedTo:'assigned_to',assignedBy:'assigned_by',report:safeJson('report',['photo']),completedAt:'completed_at'})},
  {table:'issue_tasks',name:'Issue task',asset:a=>`${a}.asset_id`,snapshot:record({status:'status',ownerId:'owner_id',dueDate:'due_date',resolution:'resolution',photo:(a,op)=>`CASE WHEN ${a}.photo LIKE 'data:%' THEN ${op==='UPDATE'?`CASE WHEN OLD.photo IS NOT NEW.photo THEN '${a==='OLD'?'Previous uploaded image':'Replacement uploaded image'}' ELSE 'Uploaded image' END`:`'Uploaded image'`} ELSE ${a}.photo END`,adminRemark:'admin_remark'})},
  {table:'bookings',name:'Reservation',asset:linkedAsset,snapshot:record({face:'face',campaign:'campaign',start:'starts_on',end:'ends_on',status:'status'})},
  {table:'actual_costs',name:'Actual cost',events:{INSERT:'Actual cost recorded'},asset:linkedAsset,snapshot:record({category:'category',amount:a=>`${a}.amount_minor/100.0`,incurredOn:'incurred_on',reference:'reference',note:'note'})},
  {table:'inventory_projects',name:'Project billboard assignment',events:{INSERT:'Billboard assigned to project',DELETE:'Billboard removed from project'},asset:linkedAsset,
    snapshot:record({projectId:'project_id',projectName:a=>`COALESCE((SELECT name FROM projects WHERE id=${a}.project_id),'Project '||${a}.project_id)`,
      inventoryId:'inventory_id',billboardName:a=>`COALESCE((SELECT json_extract(data,'$.street') FROM inventory WHERE id=${a}.inventory_id),'Inventory '||${a}.inventory_id)`,
      assignedBy:'assigned_by',assignedAt:'assigned_at'})},
  {table:'campaign_plans',name:'Campaign plan',snapshot:record({name:'name',note:'note',plan:jsonColumn('data')})},
  {table:'missions',name:'Mission',snapshot:record({name:'name',description:'description',status:'status',config:jsonColumn('config'),boundaryId:'boundary_id',assignedUsers:jsonColumn('assigned_users'),assignedGroups:jsonColumn('assigned_groups')})},
  {table:'field_collections',name:'Field collection',snapshot:record({missionId:'mission_id',status:'status',attributes:safeJson('data',['photo','photoUrl'],['_submissionKey']),latitude:'latitude',longitude:'longitude',accuracy:'accuracy',validatedBy:'validated_by',validatedAt:'validated_at'})},
  {table:'field_photos',name:'Field photo',projects:a=>`SELECT project_id FROM field_collections WHERE id=${a}.collection_id`,snapshot:record({collectionId:'collection_id',photoType:'photo_type',caption:'caption',photo:a=>`CASE WHEN ${a}.photo_data!='' THEN 'Uploaded image' ELSE NULL END`})},
  {table:'project_contacts',name:'Project contact',snapshot:record({name:'name',emails:'emails',phones:'phones',isDefault:'is_default'})},
  {table:'projects',name:'Project',projects:a=>`SELECT ${a}.id AS project_id`,snapshot:record({name:'name',projectType:'project_type',protectedLink:'share_protected'})},
  {table:'project_users',name:'Project member',snapshot:record({userId:'user_id'})},
];

export async function installActivityAudit(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS activity_write_context(id INTEGER PRIMARY KEY CHECK(id=1),actor_id INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS activity_audit_versions(version INTEGER PRIMARY KEY,installed_at INTEGER NOT NULL)'),
  ]);
  if(await db.prepare('SELECT version FROM activity_audit_versions WHERE version=3').first())return;
  const statements=['activity_inventory_update','activity_flight_insert','activity_flight_update','activity_validation'].map(name=>db.prepare(`DROP TRIGGER IF EXISTS ${name}`));
  for(const config of configs)for(const operation of ['INSERT','UPDATE','DELETE']){
    const alias=operation==='DELETE'?'OLD':'NEW';
    const before=operation==='INSERT'?'NULL':config.snapshot('OLD',operation);
    const after=operation==='DELETE'?'NULL':config.snapshot('NEW',operation);
    const event=config.events?.[operation]||`${config.name} ${{INSERT:'created',UPDATE:'updated',DELETE:'deleted'}[operation]}`;
    const name=`audit_v2_${config.table}_${operation.toLowerCase()}`;
    statements.push(db.prepare(`DROP TRIGGER IF EXISTS ${name}`));
    statements.push(db.prepare(`CREATE TRIGGER ${name} AFTER ${operation} ON ${config.table}
      ${operation==='UPDATE'?`WHEN ${before} IS NOT ${after}`:''} BEGIN
      INSERT INTO asset_activity(project_id,asset_id,actor_id,event,detail,created_at)
      SELECT scope.project_id,${config.asset?config.asset(alias):0},(SELECT actor_id FROM activity_write_context WHERE id=1),${quote(event)},
        json_object('schemaVersion',2,'operation',${quote(operation.toLowerCase())},'entity',${quote(config.table)},
          'actor',json_object('id',(SELECT actor_id FROM activity_write_context WHERE id=1),
            'name',COALESCE((SELECT u.name FROM users u JOIN activity_write_context c ON c.actor_id=u.id WHERE c.id=1),'System automation'),
            'role',COALESCE((SELECT u.role FROM users u JOIN activity_write_context c ON c.actor_id=u.id WHERE c.id=1),'system')),
          'before',${before},'after',${after}),CAST(strftime('%s','now') AS INTEGER)*1000
      FROM (${config.projects?config.projects(alias):`SELECT ${alias}.project_id`}) scope;
      END`));
  }
  await db.batch([...statements,db.prepare("INSERT OR IGNORE INTO activity_audit_versions VALUES(3,CAST(strftime('%s','now') AS INTEGER)*1000)")]);
}
