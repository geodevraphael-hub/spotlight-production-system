import {initializeOnce} from './initialize-once.mjs';
import {rawDatabase} from './activity-audit.mjs';
/** Memoize schema setup by the underlying DB, including across per-request audit wrappers. */
export function databaseInitialization(initialize){
 const entries=new WeakMap();
 return async database=>{const db=rawDatabase(database);if(!entries.has(db))entries.set(db,initializeOnce(()=>initialize(db)));await entries.get(db)();};
}
