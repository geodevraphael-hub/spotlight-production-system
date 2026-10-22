const key=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
export const PRIORITIES=[['A','Priority A — Highest visibility'],['B','Priority B'],['C','Priority C']];
export function sourceField(item,names){
 const aliases=names.map(key);
 return Object.entries(item.sourceAttributes||{}).find(([name,value])=>aliases.includes(key(name))&&String(value??'').trim()!=='')?.[1];
}
export function assetPriority(item){
 const text=String(item.priority??sourceField(item,['Priority','Priority level'])??'').trim().toUpperCase();
 return /^(?:PRIORITY\s+)?([ABC])(?:\s*[-—:].*)?$/.exec(text)?.[1]||'';
}
export function installationCount(item){
 const value=item.installations??sourceField(item,['INSTALLATION','INSTALLATIONS','Number of installations']);
 if(value==null||String(value).trim()==='')return null;
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>=0&&n<=100000?n:null;
}
export function registrationNumber(item){
 // A spreadsheet serial number is not a Ministry-issued registration number.
 return String(item.registrationNumber??sourceField(item,['Registration number','Registration no','Reg number'])??'').trim();
}
export function mediaGroup(item){
 return String(item.mediaGroup??sourceField(item,['MEDIA GROUP'])??'').trim();
}
export function validateRegisterFields(item){
 const out={...item};
 for(const name of ['bookingStatus','reservedFaces','bookingDate','bookingActiveFlight'])delete out[name];
 if(Object.hasOwn(item,'priority')){
  if(String(item.priority??'').trim()&&!assetPriority(item))throw new Error('Priority must be A, B or C.');
  out.priority=assetPriority(item);
 }
 if(Object.hasOwn(item,'installations')){
  if(item.installations===null||item.installations==='')out.installations=null;
  else if(installationCount(item)===null)throw new Error('Installations must be a whole number between 0 and 100,000.');
  else out.installations=installationCount(item);
 }
 for(const name of ['registrationNumber','mediaGroup'])if(Object.hasOwn(item,name)){
  if(typeof item[name]!=='string'||item[name].length>300)throw new Error(`${name==='mediaGroup'?'Media group':'Registration number'} must be text of at most 300 characters.`);
  out[name]=item[name].trim();
 }
 return out;
}
export const attributeLabel=name=>key(name)==='sn'?'Legacy serial number':key(name)==='owner'?'Vendor':key(name)==='format'?'Dimension':name;
export const isTransportAttribute=name=>['transport','transportcost','transportprice','transportcosttzs','transportpricetzs'].includes(key(name));
