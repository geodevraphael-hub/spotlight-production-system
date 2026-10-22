// Shared field definitions keep the editor, validation and review consistent.
import {PRIORITIES} from './asset-register.mjs';
export const BULK_FIELDS = [
  {key:'registrationNumber',label:'Registration number',group:'Registration & vendor',aliases:['REGISTRATION NUMBER','REGISTRATION NO','REG NUMBER']},
  {key:'priority',label:'Priority',group:'Classification',options:[['','Not assigned'],...PRIORITIES],aliases:['PRIORITY','PRIORITY LEVEL']},
  {key:'mediaGroup',label:'Media group',group:'Classification',aliases:['MEDIA GROUP']},
  {key:'installations',label:'Installations',group:'Structure',number:true,integer:true,min:0,max:100000,aliases:['INSTALLATION','INSTALLATIONS','NUMBER OF INSTALLATIONS']},
  {key:'mediaType',label:'Board type',group:'Classification',options:[['lamp-post','Lamppost'],['large-format','Large format'],['digital-screen','Digital screen'],['fabricated-banner','Fabricated banner']],aliases:['MEDIA TYPE','TYPE','BOARD TYPE','mediaType']},
  {key:'owner',label:'Vendor',group:'Registration & vendor',aliases:['VENDOR','OWNER','Jina la Mmiliki']},
  {key:'status',label:'Inventory status',group:'Classification',options:[['selected','Selected'],['not-selected','Not selected']],aliases:['STATUS','Selection Status']},
  {key:'street',label:'Billboard name / specific location',group:'Location labels',required:true,aliases:['SPECIFIC LOCATION','LOCATION','street','Jina la Eneo/Mtaa']},
  {key:'district',label:'Imported district / area label',group:'Location labels',aliases:['DISTRICT']},
  {key:'from',label:'From',group:'Location labels',aliases:['FROM','Traffic Visibility (From)','Kutoka']},
  {key:'to',label:'To',group:'Location labels',aliases:['TO','Traffic Visibility (To)','Kwenda']},
  {key:'width',label:'Width (m)',group:'Structure',number:true,min:0,max:1000,aliases:['WIDTH (M)','WIDTH','Upana (M)']},
  {key:'height',label:'Height (m)',group:'Structure',number:true,min:0,max:1000,aliases:['HEIGHT (M)','HEIGHT','Urefu (M)']},
  {key:'faces',label:'Faces',group:'Structure',number:true,integer:true,min:1,max:10000,aliases:['FACES']},
  {key:'lampPosts',label:'Lamppost count',group:'Structure',number:true,integer:true,min:0,max:100000,aliases:['LAMP POSTS','LAMPPOSTS','lampPosts','Idadi ya Lampost kwenye Mtaa/Barabara']},
  {key:'arrangement',label:'Arrangement',group:'Structure',aliases:['ARRANGEMENT','Mpangililo']},
  {key:'brackets',label:'Brackets',group:'Structure',aliases:['BRACKETS']},
  {key:'orientation',label:'Orientation',group:'Structure',aliases:['ORIENTATION']},
  {key:'advert',label:'Current advert',group:'Classification',aliases:['CURRENT ADVERT','ADVERT']},
  ...[['rentalPrice','Rental'],['printingPrice','Printing'],['transportPrice','Transport'],['flightingPrice','Flighting']].map(([key,title])=>({key,label:`${title} price (TZS)`,group:'Inventory prices',number:true,min:0,max:1e12,aliases:[`${title.toUpperCase()} COST`,`${title.toUpperCase()} PRICE`,title.toUpperCase(),key]})),
];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const keyOf=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
export function normalizeBulkChanges(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length)fail('Choose at least one field to update.');
  const result={};
  for(const [key,raw] of Object.entries(input)){
    const field=BULK_FIELDS.find(f=>f.key===key);
    if(!field)fail('This field cannot be bulk edited. Use the dedicated workflow for flighting, GPS, photos or project assignments.');
    if(typeof raw!=='string'&&typeof raw!=='number')fail(`Enter a valid ${field.label.toLowerCase()}.`);
    if(field.number){
      if(String(raw).trim()===''||!Number.isFinite(Number(raw))||Number(raw)<field.min||Number(raw)>field.max||(field.integer&&!Number.isInteger(Number(raw))))fail(`${field.label} must be ${field.integer?'a whole number':'a number'} between ${field.min} and ${field.max}.`);
      result[key]=Number(raw);
    }else{
      const value=String(raw).trim();
      if(value.length>300||(field.required&&!value))fail(`${field.label} must ${field.required?'contain 1 to':'contain no more than'} 300 characters.`);
      if(field.options&&!field.options.some(([v])=>v===value))fail(`Choose a valid ${field.label.toLowerCase()}.`);
      result[key]=value;
    }
  }
  return result;
}
export function applyBulkChanges(item,changes){
  const result={...item,...changes}, attrs={...(item.sourceAttributes||{})};
  for(const [key,value] of Object.entries(changes)){
    const field=BULK_FIELDS.find(f=>f.key===key);
    // Synchronize matching uploaded columns so later attribute saves cannot undo this edit.
    let matched=false;
    for(const name of Object.keys(attrs))if(field.aliases.some(alias=>keyOf(alias)===keyOf(name))){
      attrs[name]=field.options?.find(([v])=>v===value)?.[1]??String(value);
      matched=true;
    }
    if(item.sourceAttributes&&!matched)attrs[field.aliases[0]]=field.options?.find(([v])=>v===value)?.[1]??String(value);
  }
  if(own(changes,'owner'))result.vendor=changes.owner;
  if(own(changes,'width')||own(changes,'height')){
    result.areaSqm=Math.round(Number(result.width||0)*Number(result.height||0)*10000)/10000;
    for(const name of Object.keys(attrs)){
      if(['totalsqm','areasqm'].includes(keyOf(name)))attrs[name]=String(result.areaSqm);
      if(['dimension','dimensions','size','format'].includes(keyOf(name)))attrs[name]=`${result.width||0} × ${result.height||0} m`;
    }
  }
  if(item.sourceAttributes)result.sourceAttributes=attrs;
  return result;
}
async function version(data){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
const membership=`(EXISTS(SELECT 1 FROM inventory_projects ip WHERE ip.inventory_id=i.id AND ip.project_id=?) OR COALESCE(json_extract(i.data,'$.projectId'),1)=?)`;
const permission=`(?='admin' OR EXISTS(SELECT 1 FROM project_users pu WHERE pu.project_id=? AND pu.user_id=?))`;
export async function bulkInventoryEdit(db,user,body,commit=false){
  if(!['admin','creator'].includes(user?.role))fail('Only administrators and creators can bulk edit inventory.',403);
  const projectId=body.projectId,ids=body.ids;
  if(!Number.isSafeInteger(projectId)||projectId<=0)fail('Choose a project before bulk editing.');
  if(!Array.isArray(ids)||ids.length<1||ids.length>500||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)fail('Select between 1 and 500 unique billboards.');
  const changes=normalizeBulkChanges(body.changes);
  const rows=[];
  for(const id of ids){
    const row=await db.prepare(`SELECT i.id,i.data,
      (SELECT COUNT(DISTINCT project_id) FROM (SELECT project_id FROM inventory_projects WHERE inventory_id=i.id UNION SELECT COALESCE(json_extract(i.data,'$.projectId'),1)) WHERE project_id>0) AS project_count
      FROM inventory i WHERE i.id=? AND ${membership} AND ${permission}`)
      .bind(id,projectId,projectId,user.role,projectId,user.id).first();
    if(!row)fail('Some selected billboards are missing or no longer editable in this project. Refresh inventory.',403);
    row.version=await version(row.data);
    if(commit&&body.versions?.[id]!==row.version)fail('A selected billboard changed after your review. Review the latest values before saving.',409);
    const before=JSON.parse(row.data),after=applyBulkChanges(before,changes);
    const differences=Object.entries(after).filter(([key,value])=>JSON.stringify(before[key])!==JSON.stringify(value));
    rows.push({...row,before,after,differences});
  }
  const changed=rows.filter(row=>row.differences.length);
  const response={
    selectedCount:rows.length,changedCount:changed.length,unchangedCount:rows.length-changed.length,
    sharedCount:changed.filter(row=>row.project_count>1).length,
    rows:rows.map(row=>({id:row.id,name:row.before.street||`Billboard ${row.id}`,version:row.version,
      shared:row.project_count>1,changes:row.differences.map(([key,value])=>({key,label:BULK_FIELDS.find(f=>f.key===key)?.label??({sourceAttributes:'Uploaded CSV attributes',areaSqm:'Area (m²)',vendor:'Vendor'}[key]||key),before:row.before[key]??null,after:value}))})),
  };
  if(!commit)return response;
  if(body.confirmed!==true)fail('Review and confirm the changes before saving.');
  if(!changed.length)return {...response,updates:[]};
  const now=Date.now();
  // Guards and writes share ONE transaction. Any concurrent edit, deletion or
  // permission change aborts the entire batch, including its audit entries.
  const guards=rows.map(row=>db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM inventory i WHERE i.id=? AND i.data=? AND ${membership} AND ${permission}) THEN 1 ELSE json('Inventory conflict') END`)
    .bind(row.id,row.data,projectId,projectId,user.role,projectId,user.id));
  const writes=changed.map(row=>db.prepare('UPDATE inventory SET data=? WHERE id=?')
    .bind(JSON.stringify({...row.after,lastEditedBy:user.id,lastEditedAt:now}),row.id));
  try{await db.batch([...guards,...writes]);}
  catch{fail('The bulk edit could not be saved. No partial changes were applied. Review again before retrying.',409);}
  return {...response,updates:changed.map(row=>({inventoryDbId:row.id,values:Object.fromEntries(row.differences)}))};
}
