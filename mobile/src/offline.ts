type Pending = {id:string;owner:number;path:string;body:any;createdAt:number;error?:string};
function openStore():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('spotlight-field-offline',1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('queue',{keyPath:'id'});request.result.createObjectStore('cache');};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function run<T>(store:string,mode:IDBTransactionMode,operation:(store:IDBObjectStore)=>IDBRequest):Promise<T> {
  const db=await openStore();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(store,mode);const request=operation(transaction.objectStore(store));
    transaction.oncomplete=()=>{db.close();resolve(request.result);};
    transaction.onerror=()=>{db.close();reject(transaction.error);};transaction.onabort=()=>{db.close();reject(transaction.error);};
  });
}
export const cached=<T>(key:string)=>run<T>('cache','readonly',store=>store.get(key));
export const cache=(key:string,value:any)=>run('cache','readwrite',store=>store.put(value,key));
export const pending=async(owner:number)=>(await run<Pending[]>('queue','readonly',store=>store.getAll())).filter(item=>item.owner===owner);
let syncing=false;
export async function queueSubmission(owner:number,path:string,body:any) {
  const id=crypto.randomUUID();
  await run('queue','readwrite',store=>store.put({id,owner,path,body:{...body,submissionId:id},createdAt:Date.now()}));
  return id;
}
export async function synchronize(owner:number,send:(path:string,init:RequestInit)=>Promise<Response>) {
  if(syncing||!navigator.onLine)return;
  syncing=true;
  try {
    for(const item of await pending(owner)) {
      try {
        const response=await send(item.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item.body)});
        if(response.ok){await run('queue','readwrite',store=>store.delete(item.id));continue;}
        const data=await response.json().catch(()=>({}));
        await run('queue','readwrite',store=>store.put({...item,error:data.error||`Upload failed (${response.status})`}));
        if(response.status===401||response.status===403)break;
      }catch{break;}
    }
  } finally {syncing=false;}
}
