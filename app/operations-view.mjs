// Never render a response under another tab, project or set of filters.
export function operationsData(result, requestKey) {
  return result?.key === requestKey ? result.data : {rows: []};
}

export function activityDetails(detail) {
  if (detail == null || detail === '') return 'No change details were recorded.';
  try {
    const value = typeof detail === 'string' ? JSON.parse(detail) : detail;
    if (value == null) return 'No change details were recorded.';
    return JSON.stringify(value, null, 2) ?? 'No change details were recorded.';
  } catch {
    return String(detail);
  }
}

const fieldNames = {
  registrationNumber:'Registration number',priority:'Priority',mediaGroup:'Media group',installations:'Installations',
  street:'Specific location',district:'District',region:'Region',vendor:'Vendor',owner:'Owner',
  mediaType:'Board type',width:'Width (m)',height:'Height (m)',faces:'Faces',lat:'Latitude',lng:'Longitude',
  startAt:'Flight start date',endAt:'Expiry date',durationDays:'Flight duration (days)',reminderDays:'Reminder lead time (days)',
  flightStatus:'Flight status',flightStage:'Execution stage',flightExpiry:'Expiry date',stage:'Execution stage',note:'Note',remark:'Remark',adminRemark:'Admin remark',
  sourceAttributes:'Uploaded attributes',report:'Validation report',issueType:'Main issue',issueDetail:'Issue detail',
  customIssue:'Other issue',accuracy:'GPS accuracy (m)',photoUrl:'Photo',photoOriginalUrl:'Original photo',
  projectId:'Project ID',projectName:'Project',billboardName:'Billboard',inventoryId:'Central inventory ID',assignedAt:'Assignment date',originProjectId:'Original source project ID',assetId:'Billboard ID',inventoryDbId:'Inventory ID',ownerId:'Assigned user ID',
  approvedBy:'Approved by (user ID)',approvedAt:'Approval date',validatedAt:'Validation date',
  lastEditedBy:'Edited by (user ID)',lastEditedAt:'Last edited',updatedAt:'Last updated',createdAt:'Created',
  bookingId:'Reservation ID',issueId:'Issue ID',face:'Face number',start:'Start date',end:'End date',
  assignedTo:'Assigned field user ID',assignedBy:'Assigned by (user ID)',completedAt:'Completion date',dueDate:'Due date',
  incurredOn:'Cost date',isDefault:'Default contact',protectedLink:'Protected share link',
  campaign:'Campaign',category:'Cost category',amount:'Amount (TZS)',reference:'Reference',resolution:'Corrective work',
};
const labels = {flighted:'Flighted',unflighted:'Unflighted',deflighted:'Deflighted',removed:'Removed',
  ok:'Okay',okay:'Okay',issue:'Not okay',in_progress:'In progress',awaiting_approval:'Awaiting approval',
  approved:'Approved',returned:'Returned',selected:'Selected','not-selected':'Not selected',
  'lamp-post':'Lamppost','large-format':'Large format','digital-screen':'Digital screen','fabricated-banner':'Fabricated banner'};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function decode(value) {
  if(typeof value!=='string')return value;
  try{return JSON.parse(value);}catch{return value;}
}
function fieldLabel(path,event) {
  return path.map(key=>key==='status'&&/flight/i.test(event)?'Flight status':key==='status'&&/validation/i.test(event)?'Validation status':
    fieldNames[key] || key.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/^./,letter=>letter.toUpperCase())).join(' / ');
}
function display(value,path) {
  if(value===undefined)return 'Not recorded';
  if(value===null||value==='')return 'Not set';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(Array.isArray(value))return value.length?value.map(item=>display(item,path)).join('; '):'None';
  if(object(value))return Object.entries(value).map(([key,item])=>`${fieldLabel([key],'')}: ${display(item,[key])}`).join('; ')||'None';
  const key=path.at(-1)||'';
  if(typeof value==='string'&&value.startsWith('data:'))return 'Attachment recorded';
  if(/(?:At|_at|Expiry)$/.test(key)&&Number.isFinite(Number(value))&&Number(value)>0){
    const date=new Date(Number(value));
    if(Number.isFinite(date.getTime()))return date.toLocaleString('en-GB',{timeZone:'Africa/Nairobi'})+' EAT';
  }
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
    const date=new Date(value+'T12:00:00Z');
    if(Number.isFinite(date.getTime()))return date.toLocaleDateString('en-GB',{timeZone:'Africa/Nairobi'});
  }
  return /status|stage|mediaType|category/i.test(key)?labels[value]||String(value).replaceAll('_',' '):String(value);
}

// Supports complete snapshots and older event records which captured only the
// previous status. Missing historical values are never reconstructed or guessed.
export function activityChanges(detail,event='') {
  const value=decode(detail);
  if(value==null||value==='')return {rows:[],message:'No change details were recorded.'};
  if(typeof value==='string'&&/^[\s]*[\[{]/.test(value))return {rows:[],message:'These older details could not be read. The activity record has been preserved.'};
  if(!object(value))return {rows:[],message:display(value,[])};
  const before=decode(value.before),after=decode(value.after);
  if(value.entity==='inventory_projects'&&['insert','delete'].includes(value.operation)){
    const snapshot=after||before||{};
    return {rows:[
      {field:'Project membership',before:value.operation==='insert'?'Not assigned':'Assigned',after:value.operation==='delete'?'Removed from this project':'Assigned'},
      {field:'Billboard',before:snapshot.billboardName||`Inventory #${snapshot.inventoryId}`,after:snapshot.billboardName||`Inventory #${snapshot.inventoryId}`},
      {field:'Project',before:snapshot.projectName||`Project #${snapshot.projectId}`,after:snapshot.projectName||`Project #${snapshot.projectId}`},
    ],message:''};
  }
  const rows=[];
  function add(path,oldValue,newValue,compare) {
    if(compare&&JSON.stringify(oldValue)===JSON.stringify(newValue))return;
    if(object(oldValue)||object(newValue)){
      const oldObject=object(oldValue)?oldValue:{},newObject=object(newValue)?newValue:{};
      const keys=[...new Set([...Object.keys(oldObject),...Object.keys(newObject)])];
      if(keys.length){for(const key of keys)add([...path,key],oldObject[key],newObject[key],compare);return;}
    }
    const versioned=value.schemaVersion===2;
    rows.push({field:fieldLabel(path,event),
      before:versioned&&oldValue===undefined?(value.operation==='insert'?'Not yet created':'Not set'):display(oldValue,path),
      after:versioned&&newValue===undefined?(value.operation==='delete'?'Removed':'Not set'):display(newValue,path)});
  }
  if(object(before)||object(after)){
    add([],before,after,true);
  }else if(Object.hasOwn(value,'before')&&Object.hasOwn(value,'after')){
    add(['value'],before,after,true);
  }else{
    for(const [key,item] of Object.entries(value)){
      if(key==='before')continue;
      const oldValue=key==='status'?before:undefined;
      add([key],oldValue,key==='report'?decode(item):item,false);
    }
    if(Object.hasOwn(value,'before')&&!Object.hasOwn(value,'status'))add(['value'],before,undefined,false);
  }
  return {rows,message:rows.length?'':'No field changes were recorded in these details.'};
}
