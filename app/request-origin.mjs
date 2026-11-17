const productionOrigins=new Set(['https://spotlight.co.tz','https://www.spotlight.co.tz']);
const nativeOrigins=new Set(['http://localhost','https://localhost','capacitor://localhost']);
/** Trust exact public origins behind the TLS proxy, never arbitrary forwarded hosts. */
export function validRequestOrigin(request){
 const origin=request.headers.get('origin');
 if(!origin)return true;
 if(productionOrigins.has(origin)||origin===new URL(request.url).origin)return true;
 return nativeOrigins.has(origin)&&/^Bearer\s+\S+/i.test(request.headers.get('authorization')||'');
}
