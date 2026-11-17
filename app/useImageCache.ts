"use client";
import {useEffect} from 'react';
export function invalidateImageCache(urls:string[]){
 if('serviceWorker' in navigator)navigator.serviceWorker.controller?.postMessage({type:'IMAGE_CACHE_INVALIDATE',urls});
}
export default function useImageCache(userId:number|undefined,shareToken:string|null){
 useEffect(()=>{
  if(!('serviceWorker' in navigator)||!window.isSecureContext)return;
  let disposed=false,registration:ServiceWorkerRegistration|undefined;
  async function notify(){
   let scope=userId?`user:${userId}`:'public';
   if(!userId&&shareToken){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(shareToken));scope='share:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
   if(!disposed)(navigator.serviceWorker.controller??registration?.active)?.postMessage({type:'IMAGE_CACHE_CONTEXT',scope});
  }
  const failedImage=(event:Event)=>{if(event.target instanceof HTMLImageElement)invalidateImageCache([event.target.currentSrc||event.target.src]);};
  document.addEventListener('error',failedImage,true);
  navigator.serviceWorker.addEventListener('controllerchange',notify);
  navigator.serviceWorker.register('/image-cache-sw.js',{scope:'/',updateViaCache:'none'}).then(async value=>{registration=value;await navigator.serviceWorker.ready;if(!disposed)await notify();}).catch(()=>{/* Native browser caching remains available. */});
  return()=>{disposed=true;document.removeEventListener('error',failedImage,true);navigator.serviceWorker.removeEventListener('controllerchange',notify);};
 },[userId,shareToken]);
}
