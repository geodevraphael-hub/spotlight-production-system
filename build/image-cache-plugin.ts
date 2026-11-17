import type {Plugin,Connect} from 'vite';
/** Set browser freshness for local static images in both dev and production preview. */
export function imageCacheHeaders():Plugin{
 const middleware:Connect.NextHandleFunction=(request,response,next)=>{
  const writeHead=response.writeHead;
  response.writeHead=function(this:typeof response,statusCode:number,...args:any[]){
   const headers=args.find(value=>value&&typeof value==='object'&&!Array.isArray(value));
   const contentType=String(headers?.['content-type']||headers?.['Content-Type']||response.getHeader('Content-Type')||'');
   const cacheControl=(request.url||'').split('?')[0]==='/image-cache-sw.js'?'no-cache':statusCode===200&&!(request.url||'').startsWith('/api/')&&contentType.toLowerCase().startsWith('image/')?'public, max-age=2592000':null;
   if(cacheControl){
    response.setHeader('Cache-Control',cacheControl);
    if(headers){for(const key of Object.keys(headers))if(key.toLowerCase()==='cache-control')delete headers[key];headers['Cache-Control']=cacheControl;}
   }
   return (writeHead as any).call(this,statusCode,...args);
  } as typeof response.writeHead;
  next();
 };
 return {name:'spotlight-image-cache-headers',configureServer(server){server.middlewares.use(middleware);},configurePreviewServer(server){server.middlewares.use(middleware);}};
}
