const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export const estimatedPole=b=>b?.mediaType==='lamp-post'&&b.positionSource==='estimated-road-stretch'&&b.positionVerified!==true;
const member="(COALESCE(json_extract(i.data,'$.projectId'),1)=? OR EXISTS(SELECT 1 FROM inventory_projects WHERE inventory_id=i.id AND project_id=?))";
const guard=(db,query,args)=>db.prepare(`SELECT CASE WHEN EXISTS(${query}) THEN 1 ELSE json('Verification changed; refresh and retry') END`).bind(...args);
export async function assignPoleGps(db,user,body){
 if(user.role!=='admin')fail('Only administrators can assign pole GPS verification.',403);
 const {ids,projectId,userId,requestId}=body;
 if(body.confirmed!==true||!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(n=>!Number.isSafeInteger(n)||n<1)||new Set(ids).size!==ids.length||!Number.isSafeInteger(projectId)||!Number.isSafeInteger(userId)||! /^[0-9a-f-]{36}$/i.test(requestId||''))fail('Select up to 200 poles, a project and a field user, then confirm.');
 await db.prepare('CREATE TABLE IF NOT EXISTS pole_assignment_requests(id TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT NOT NULL)').run();
 const payload=JSON.stringify({ids:[...ids].sort((a,b)=>a-b),projectId,userId,actor:user.id});
 const replay=async()=>{const r=await db.prepare('SELECT * FROM pole_assignment_requests WHERE id=?').bind(requestId).first();if(!r)return null;if(r.payload!==payload)fail('Request already used. Reopen the assignment.',409);return JSON.parse(r.result);};
 const previous=await replay();if(previous)return previous;
 if(!await db.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first())fail('Project not found.',404);
 if(!await db.prepare("SELECT id FROM users WHERE id=? AND role='field_user'").bind(userId).first())fail('Choose a field user.');
 const now=Date.now(),writes=[],result={ok:true,assigned:0,alreadyAssigned:0};
 for(const id of ids){
  const row=await db.prepare(`SELECT i.id,i.data FROM inventory i WHERE i.id=? AND ${member}`).bind(id,projectId,projectId).first();
  if(!row||!estimatedPole(JSON.parse(row.data)))fail('A selected pole is no longer estimated or is not in this project. Refresh inventory.',409);
  const asset=JSON.parse(row.data);
  const active=await db.prepare("SELECT assigned_to FROM validation_assignments WHERE asset_id=? AND status='assigned' AND json_extract(report,'$.purpose')='pole-gps'").bind(asset.id).all();
  if(active.results.some(a=>a.assigned_to!==userId))fail(`${asset.street} is already assigned to another field user.`,409);
  if(active.results.length){result.alreadyAssigned++;continue;}
  writes.push(guard(db,`SELECT 1 FROM inventory i WHERE i.id=? AND i.data=? AND ${member}`,[id,row.data,projectId,projectId]));
  writes.push(db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM validation_assignments WHERE asset_id=? AND status='assigned' AND json_extract(report,'$.purpose')='pole-gps') THEN 1 ELSE json('Pole already assigned') END").bind(asset.id));
  const report=JSON.stringify({purpose:'pole-gps',inventoryId:id,estimatedLatitude:asset.lat,estimatedLongitude:asset.lng,assignedAt:now});
  writes.push(db.prepare("INSERT INTO validation_assignments(project_id,asset_id,assigned_to,status,report,assigned_by,created_at,updated_at) VALUES(?,?,?,'assigned',?,?,?,?) ON CONFLICT(project_id,asset_id,assigned_to) DO UPDATE SET status='assigned',report=excluded.report,assigned_by=excluded.assigned_by,completed_at=NULL,updated_at=excluded.updated_at").bind(projectId,asset.id,userId,report,user.id,now,now));
  result.assigned++;
 }
 writes.unshift(guard(db,"SELECT 1 FROM users WHERE id=? AND role='field_user'",[userId]),guard(db,'SELECT 1 FROM projects WHERE id=?',[projectId]));
 writes.push(db.prepare('INSERT INTO pole_assignment_requests VALUES(?,?,?)').bind(requestId,payload,JSON.stringify(result)));
 try{await db.batch(writes);}catch{const retried=await replay();if(retried)return retried;fail('Assignments changed. Refresh and retry; no partial assignments were saved.',409);}
 return result;
}
export function verifiedCoordinates(body,assignedAt,now=Date.now()){
 const {latitude,longitude,accuracy,capturedAt,submittedAt}=body;
 if(body.confirmGps!==true||![latitude,longitude,accuracy,capturedAt,submittedAt].every(n=>typeof n==='number'&&Number.isFinite(n))||Math.abs(latitude)>90||Math.abs(longitude)>180||accuracy<=0||accuracy>10)fail('Capture GPS with accuracy of 10 m or better and confirm you are beside this pole.');
 // Fresh when submitted on the device; offline uploads may arrive later.
 if(capturedAt<assignedAt||submittedAt<capturedAt||submittedAt-capturedAt>120000||submittedAt>now+300000)fail('GPS fix is stale. Capture a new location beside the pole.');
 return {latitude,longitude,accuracy,capturedAt};
}
export async function submitPoleGps(db,user,body,assignment){
 if(user.role!=='field_user'||assignment.assigned_to!==user.id)fail('Assignment not found.',404);
 const prior=JSON.parse(assignment.report||'{}');
 if(body.submissionId&&prior.submissionId===body.submissionId)return {ok:true,replayed:true};
 if(prior.purpose!=='pole-gps'||assignment.status!=='assigned')fail('This assignment is already completed. Refresh your tasks.',409);
 if(!['ok','issue'].includes(body.verdict)||! /^[0-9a-f-]{36}$/i.test(body.submissionId||''))fail('Choose a validation result and update the APK if required.');
 if(typeof body.photo!=='string'||body.photo.length>8000000||!/^data:image\/(jpeg|png|webp);base64,/.test(body.photo))fail('Take a validation photo before submitting.');
 if(body.verdict==='issue'&&!String(body.issueType||'').trim())fail('Select the main issue.');
 const row=await db.prepare(`SELECT i.id,i.data FROM inventory i WHERE i.id=? AND ${member}`).bind(prior.inventoryId,assignment.project_id,assignment.project_id).first();
 if(!row)fail('This pole is no longer in the assigned project.',409);
 const asset=JSON.parse(row.data),now=Date.now();
 if(!estimatedPole(asset))fail('This pole has already been GPS verified or changed. Refresh your tasks.',409);
 const fix=body.verdict==='ok'?verifiedCoordinates(body,prior.assignedAt,now):{};
 const report={...prior,...fix,submissionId:body.submissionId,verdict:body.verdict,photo:body.photo,issueType:String(body.issueType||'').slice(0,160),issueDetail:String(body.issueDetail||'').slice(0,500),customIssue:String(body.customIssue||'').slice(0,2000),submittedAt:now,deviceSubmittedAt:body.submittedAt??null};
 const writes=[guard(db,'SELECT 1 FROM validation_assignments WHERE id=? AND assigned_to=? AND status=\'assigned\' AND report=?',[assignment.id,user.id,assignment.report]),guard(db,`SELECT 1 FROM inventory i WHERE i.id=? AND i.data=? AND ${member}`,[row.id,row.data,assignment.project_id,assignment.project_id])];
 if(body.verdict==='ok'){
  const next={...asset,lat:fix.latitude,lng:fix.longitude,positionSource:'field-gps',positionVerified:true,photoUrl:body.photo,validationStatus:'ok',validatedAt:now,validatedBy:user.id,
   gpsVerification:{assignmentId:assignment.id,estimatedLatitude:asset.lat,estimatedLongitude:asset.lng,accuracy:fix.accuracy,capturedAt:fix.capturedAt,verifiedAt:now,verifiedBy:user.id}};
  if(next.sourceAttributes)next.sourceAttributes={...next.sourceAttributes,'POSITION SOURCE':'Field GPS verified'};
  writes.push(db.prepare('UPDATE inventory SET data=?,latitude=?,longitude=? WHERE id=?').bind(JSON.stringify(next),fix.latitude,fix.longitude,row.id));
 }
 writes.push(db.prepare('UPDATE validation_assignments SET status=?,report=?,completed_at=?,updated_at=? WHERE id=?').bind(body.verdict,JSON.stringify(report),now,now,assignment.id));
 try{await db.batch(writes);}catch{const latest=await db.prepare('SELECT report FROM validation_assignments WHERE id=?').bind(assignment.id).first();if(latest&&JSON.parse(latest.report).submissionId===body.submissionId)return {ok:true,replayed:true};fail('The pole or assignment changed. Refresh before submitting again.',409);}
 return {ok:true,locationUpdated:body.verdict==='ok'};
}
