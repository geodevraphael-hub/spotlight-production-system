"use client";
import {useEffect,useRef,useState} from 'react';
import {Download,ExternalLink,Printer,RefreshCw,X} from 'lucide-react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export default function InventorySummaryPreview({data,projectName,onClose}:any){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[ready,setReady]=useState(false);
 const root=useRef<HTMLDivElement>(null),pages=useRef<HTMLDivElement>(null),printFrame=useRef<HTMLIFrameElement|null>(null);
 const filename=`${String(projectName||'Project').replace(/[^a-z0-9 _-]/gi,'').slice(0,80)}-Inventory-Summary.pdf`;
 useEffect(()=>{let cancelled=false,objectUrl='',loadingTask:any;setUrl('');setError('');setReady(false);pages.current?.replaceChildren();
  (async()=>{try{
   const {inventorySummaryPdf}=await import('./inventory-summary-pdf.mjs');const bytes=await inventorySummaryPdf(data,projectName);if(cancelled)return;
   objectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));setUrl(objectUrl);
   const pdfjs=await import('pdfjs-dist');if(cancelled)return;pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
   loadingTask=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false});const documentPdf=await loadingTask.promise;
   for(let index=1;index<=documentPdf.numPages;index++){
    if(cancelled)return;const page=await documentPdf.getPage(index);if(cancelled)return;
    const canvas=document.createElement('canvas'),viewport=page.getViewport({scale:1.8});canvas.width=viewport.width;canvas.height=viewport.height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`Report page ${index} of ${documentPdf.numPages}`);
    await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise;if(cancelled)return;
    const sheet=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=`Page ${index} of ${documentPdf.numPages}`;sheet.append(canvas,caption);pages.current?.append(sheet);
   }
   if(!cancelled)setReady(true);
  }catch{if(!cancelled)setError('The PDF preview could not be prepared. Please try again, or download the PDF if available.');}})();
  return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl);loadingTask?.destroy().catch(()=>{});printFrame.current?.remove();};
 },[data,projectName,attempt]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLButtonElement>('[data-close]')?.focus();return()=>{previous?.focus();};},[]);
 async function printReport(){
  try{printFrame.current?.remove();const iframe=document.createElement('iframe');iframe.title='Print Inventory Summary';iframe.style.cssText='position:fixed;width:0;height:0;border:0;';document.body.append(iframe);printFrame.current=iframe;
   const doc=iframe.contentDocument!;doc.open();doc.write('<!doctype html><html><head><title>Inventory Summary</title><style>@page{size:A4;margin:0}body{margin:0}img{display:block;width:210mm;height:297mm;break-after:page}img:last-child{break-after:auto}</style></head><body></body></html>');doc.close();
   for(const canvas of Array.from(pages.current?.querySelectorAll('canvas')??[])){const image=doc.createElement('img');image.src=canvas.toDataURL('image/png');doc.body.append(image);await image.decode();}
   iframe.contentWindow!.onafterprint=()=>{iframe.remove();};iframe.contentWindow!.focus();iframe.contentWindow!.print();
  }catch{setError('Printing could not start. Download or open the PDF to print it.');}
 }
 return <div className="is-detail-overlay is-pdf-overlay"><div ref={root} className="is-pdf-modal" role="dialog" aria-modal="true" aria-labelledby="is-pdf-title" onKeyDown={event=>{
  if(event.key==='Escape'){event.stopPropagation();onClose();}
  if(event.key==='Tab'){const elements=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')??[]),first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 }}><header><div><span className="is-eyebrow">PDF report preview</span><h2 id="is-pdf-title">Inventory Summary</h2><p>{projectName} · {data.total.toLocaleString('en-GB')} matching assets</p></div><button data-close aria-label="Close PDF report preview" onClick={onClose}><X size={21}/></button></header>
 <div className="is-pdf-toolbar"><p>The PDF includes the current filters, a short narrative and summary breakdowns.</p><div>{url&&<><a href={url} download={filename}><Download size={16}/>Download PDF</a><button disabled={!ready} onClick={printReport}><Printer size={16}/>Print PDF</button><a href={url} target="_blank" rel="noreferrer"><ExternalLink size={16}/>Open PDF</a></>}</div></div>
 {error&&<p className="is-error" role="alert">{error}<button onClick={()=>setAttempt(value=>value+1)}>Try again</button></p>}
 {!ready&&!error&&<div className="is-pdf-loading" role="status"><RefreshCw size={25} className="is-spinning"/><p>Preparing your PDF report…</p></div>}
 <div ref={pages} className="is-pdf-pages" role="region" aria-label="Inventory Summary PDF pages" tabIndex={0}/>
 </div></div>;
}
