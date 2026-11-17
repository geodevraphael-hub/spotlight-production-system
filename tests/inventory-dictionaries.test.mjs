import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readDictionaries,mutateDictionary} from '../app/dictionary-store.mjs';
import {normalizeBulkChanges} from '../app/inventory-bulk.mjs';
import {validateRegisterFields,assetPriority} from '../app/asset-register.mjs';
const admin={id:1,role:'admin'};
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE inventory(id INTEGER PRIMARY KEY,data TEXT)');
 const db={prepare(query){let args=[];const p={bind(...values){args=values;return p;},async all(){return {results:sql.prepare(query).all(...args)};},async first(){return sql.prepare(query).get(...args)??null;},async run(){return p.exec();},exec(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};return p;},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s.exec());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};return {db,sql};
}
test('dictionary CRUD persists, prevents duplicates and detects stale edits',async()=>{
 const {db}=database();const initial=await readDictionaries(db);assert.equal(initial.entries.length,9);
 const body={kind:'mediaType',value:'wall-wrap',label:'Wall wrap'};
 let data=await mutateDictionary(db,admin,{...body,operation:'create'});
 assert.ok(data.dictionaries.mediaType.some(([v])=>v==='wall-wrap'));
 await assert.rejects(mutateDictionary(db,admin,{...body,value:'other',operation:'create'}),{status:409});
 data=await mutateDictionary(db,admin,{...body,label:'Building wrap',version:1,operation:'update'});
 await assert.rejects(mutateDictionary(db,admin,{...body,version:1,operation:'update'}),{status:409});
 await mutateDictionary(db,admin,{...body,version:2,operation:'delete'});
 assert.ok(!(await readDictionaries(db)).dictionaries.mediaType.some(([v])=>v==='wall-wrap'));
 // Deleted defaults are not reseeded on later requests or reads.
 await mutateDictionary(db,admin,{kind:'priority',value:'C',label:'Priority C',version:1,operation:'delete'});
 assert.ok(!(await readDictionaries({...db})).dictionaries.priority.some(([v])=>v==='C'));
});
test('only administrators can mutate and referenced or required values cannot be removed',async()=>{
 const {db,sql}=database();await readDictionaries(db);
 const body={kind:'priority',value:'A',label:'Priority A',version:1,operation:'delete'};
 for(const role of ['creator','viewer','planner','field_user'])await assert.rejects(mutateDictionary(db,{role},body),{status:403});
 sql.prepare('INSERT INTO inventory VALUES(?,?)').run(1,JSON.stringify({priority:'A'}));
 await assert.rejects(mutateDictionary(db,admin,body),{status:409});
 sql.prepare('UPDATE inventory SET data=? WHERE id=1').run(JSON.stringify({sourceAttributes:{'Priority level':'Priority A — Highest visibility'}}));
 await assert.rejects(mutateDictionary(db,admin,body),{status:409});
 await assert.rejects(mutateDictionary(db,admin,{...body,kind:'status',value:'not-selected'}),{status:409});
 await assert.rejects(mutateDictionary(db,admin,{...body,value:'bad code',operation:'create'}));
});
test('custom dictionary values work in form validation and bulk editing',async()=>{
 const {db}=database();await mutateDictionary(db,admin,{kind:'priority',value:'D',label:'Priority D',operation:'create'});
 const {dictionaries}=await readDictionaries(db);
 assert.equal(assetPriority({priority:'D'}),'D');
 assert.equal(validateRegisterFields({priority:'D'},dictionaries.priority.map(([v])=>v)).priority,'D');
 assert.deepEqual(normalizeBulkChanges({priority:'D'},dictionaries),{priority:'D'});
 assert.throws(()=>normalizeBulkChanges({priority:'UNKNOWN'},dictionaries));
});
