import {DEFAULT_DICTIONARIES,DICTIONARY_TABS,validateDictionaryEntry} from './inventory-dictionaries.mjs';
import {initializeOnce} from './initialize-once.mjs';
import {assetPriority} from './asset-register.mjs';
const setups=new WeakMap();
export async function setupDictionaries(db){
 if(!setups.has(db))setups.set(db,initializeOnce(async()=>{
  await db.batch([
   db.prepare('CREATE TABLE IF NOT EXISTS inventory_dictionaries(kind TEXT NOT NULL,value TEXT NOT NULL,label TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(kind,value))'),
   db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS dictionary_labels ON inventory_dictionaries(kind,lower(trim(label)))'),
   db.prepare('CREATE TABLE IF NOT EXISTS dictionary_migrations(id INTEGER PRIMARY KEY)'),
  ]);
  const writes=[];
  for(const [kind,options] of Object.entries(DEFAULT_DICTIONARIES))for(const [value,label] of options)writes.push(db.prepare('INSERT OR IGNORE INTO inventory_dictionaries(kind,value,label) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM dictionary_migrations WHERE id=1)').bind(kind,value,label));
  writes.push(db.prepare('INSERT OR IGNORE INTO dictionary_migrations(id) VALUES(1)'));
  await db.batch(writes);
 }));
 await setups.get(db)();
}
export async function readDictionaries(db){
 await setupDictionaries(db);
 const {results}=await db.prepare('SELECT kind,value,label,version FROM inventory_dictionaries ORDER BY kind,label COLLATE NOCASE,value').all();
 return {dictionaries:Object.fromEntries(DICTIONARY_TABS.map(([kind])=>[kind,results.filter(r=>r.kind===kind).map(r=>[r.value,r.label])])),entries:results};
}
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export async function mutateDictionary(db,user,body){
 if(user?.role!=='admin')fail('Only administrators can manage data dictionaries.',403);
 await setupDictionaries(db);
 const entry=validateDictionaryEntry(body),{kind,value,label}=entry;
 if(!['create','update','delete'].includes(body.operation))fail('Choose a valid operation.');
 try{
  let result;
  if(body.operation==='create')result=await db.prepare('INSERT INTO inventory_dictionaries(kind,value,label) VALUES(?,?,?)').bind(kind,value,label).run();
  else if(body.operation==='update')result=await db.prepare('UPDATE inventory_dictionaries SET label=?,version=version+1 WHERE kind=? AND value=? AND version=?').bind(label,kind,value,body.version).run();
  else {
   // Required defaults are used by imports and specialized lamp-post workflows.
   if((kind==='mediaType'&&value==='lamp-post')||(kind==='status'&&value==='not-selected'))fail('This value is required as a system default. You can edit its label.',409);
   const {results}=await db.prepare('SELECT data FROM inventory').all();
   const used=results.some(row=>{const item=JSON.parse(row.data);return (kind==='priority'?assetPriority(item):item[kind])===value;});
   if(used)fail('This value is used by inventory. Reassign those billboards before deleting it.',409);
   result=await db.prepare('DELETE FROM inventory_dictionaries WHERE kind=? AND value=? AND version=? AND NOT EXISTS(SELECT 1 FROM inventory WHERE json_extract(data,?)=?)').bind(kind,value,body.version,`$.${kind}`,value).run();
  }
  if(body.operation!=='create'&&!result.meta.changes)fail('This entry changed or was deleted. Reload Settings and try again.',409);
 }catch(error){if(String(error.message).includes('UNIQUE'))fail('A code or label with this name already exists.',409);throw error;}
 return readDictionaries(db);
}
