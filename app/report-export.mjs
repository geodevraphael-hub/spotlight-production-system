import {RW,RH,textLines} from './report-scenes.mjs';
export async function cleanPresentationPackage(bytes){
 // PptxGenJS 4.0.1 emits content-type declarations for nonexistent slide masters.
 // Escape raw ampersands in relationship targets (for example, Google Maps URLs),
 // then remove only dangling master declarations. Raw ampersands make .rels XML invalid.
 const {default:JSZip}=await import('jszip'),zip=await JSZip.loadAsync(bytes),entry=zip.file('[Content_Types].xml');
 const xml=await entry.async('string');zip.file('[Content_Types].xml',xml.replace(/<Override\b[^>]*PartName="\/ppt\/slideMasters\/(slideMaster\d+\.xml)"[^>]*\/>/g,(tag,name)=>zip.file('ppt/slideMasters/'+name)?tag:''));
 for(const rel of Object.keys(zip.files).filter(name=>name.endsWith('.rels'))){const item=zip.file(rel);if(!item)continue;const relXml=await item.async('string');zip.file(rel,relXml.replace(/\bTarget="([^"]*)"/g,(_match,target)=>`Target="${target.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g,'&amp;')}"`));}
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
export async function rasterImage(url,max=1500,quality=.8){return new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';const timer=setTimeout(()=>{img.src='';reject(new Error('Image timed out'));},12000);img.onerror=()=>{clearTimeout(timer);reject(new Error('Image is private, unavailable or does not allow export'));};img.onload=()=>{clearTimeout(timer);try{const scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));const c=canvas.getContext('2d');c.fillStyle='#FFFFFF';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',quality));}catch(e){reject(e);}};img.src=url;});}
function placement(e,w,h){const scale=e.fit==='cover'?Math.max(e.w/w,e.h/h):Math.min(e.w/w,e.h/h);return {x:e.x+(e.w-w*scale)/2,y:e.y+(e.h-h*scale)/2,w:w*scale,h:h*scale};}
async function dimensions(data){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve([i.width,i.height]);i.onerror=reject;i.src=data;});}
async function crop(e){if(e.fit!=='cover')return e.data;const [w,h]=await dimensions(e.data),p=placement({...e,x:0,y:0},w,h),c=document.createElement('canvas');c.width=e.w;c.height=e.h;const ctx=c.getContext('2d'),img=new Image();await new Promise(resolve=>{img.onload=resolve;img.src=e.data;});ctx.drawImage(img,p.x,p.y,p.w,p.h);return c.toDataURL('image/jpeg',.9);}
export async function exportReport(format,slides,title,onProgress=(_message)=>{},download=true){
 const filename=(title.replace(/[^a-z0-9 _-]/gi,'').trim().slice(0,90)||'Spotlight-visibility-report');
 if(format==='pptx'){
 const {default:PptxGenJS}=await import('pptxgenjs');const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='Spotlight';pptx.subject='Project outdoor visibility report';pptx.title=title;pptx.company='Spotlight';pptx.lang='en-GB';pptx.theme={headFontFace:'Calibri Light',bodyFontFace:'Calibri Light',lang:'en-GB'};
 for(const [index,page]of slides.entries()){
 const s=pptx.addSlide();
 for(const e of page.elements){if(e.tablePart)continue;const box={x:e.x/108,y:e.y/108,w:e.w/108,h:e.h/108};
 if(e.kind==='rect')s.addShape(pptx.ShapeType.rect,{...box,line:{color:e.fill.slice(1),transparency:100},fill:{color:e.fill.slice(1)}});
 if(e.kind==='text')s.addText(e.text,{...box,fontFace:'Calibri Light',fontSize:e.size*2/3,color:e.color.slice(1),bold:e.bold,margin:0,breakLine:false,valign:'top',fit:'shrink',hyperlink:e.link?{url:e.link}:undefined});
 if(e.kind==='image'){const data=await crop(e);const [w,h]=await dimensions(data),p=placement(e,w,h);s.addImage({data,x:p.x/108,y:p.y/108,w:p.w/108,h:p.h/108,hyperlink:e.link?{url:e.link}:undefined});}}
 if(page.table){const t=page.table,rows=[t.columns.map(([label])=>({text:label,options:{fill:t.ink.slice(1),color:'FFFFFF',bold:true}})),...t.rows.map((r,i)=>r.map(v=>({text:String(v),options:{fill:i===t.rows.length-1?t.paper.slice(1):i%2?'F7F9FA':'FFFFFF',bold:i===t.rows.length-1}})))];s.addTable(rows,{x:56/108,y:210/108,w:1328/108,colW:t.columns.map(([,w])=>w/108),rowH:57/108,fontFace:'Calibri Light',fontSize:14,color:t.ink.slice(1),border:{type:'solid',color:'FFFFFF',pt:0},margin:[7,9,7,9],autoPage:false,verbose:false});}
 s.addNotes('Generated from Spotlight inventory. Figures are a snapshot, not audience or traffic estimates. Map © OpenStreetMap contributors.');onProgress(`Building slide ${index+1} of ${slides.length}`);}
 const bytes=await cleanPresentationPackage(await pptx.write({outputType:'uint8array',compression:true}));if(!download)return bytes;
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'})),anchor=document.createElement('a');anchor.href=url;anchor.download=filename+'.pptx';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }else{
 const {jsPDF}=await import('jspdf');const pdf=new jsPDF({orientation:'landscape',unit:'pt',format:[RW,RH],compress:true});pdf.setProperties({title,author:'Spotlight',subject:'Project outdoor visibility report'});
 for(const [index,page]of slides.entries()){if(index)pdf.addPage([RW,RH],'landscape');for(const e of page.elements){if(e.kind==='rect'){pdf.setFillColor(e.fill);pdf.rect(e.x,e.y,e.w,e.h,'F');}if(e.kind==='text'){pdf.setTextColor(e.color);pdf.setFont('helvetica',e.bold?'bold':'normal');const value=e.text.replace(/↗/g,'(link)').replace(/→/g,'to');let size=e.size;pdf.setFontSize(size);let lines=pdf.splitTextToSize(value,e.w);while(lines.length*size*1.15>e.h&&size>10){size--;pdf.setFontSize(size);lines=pdf.splitTextToSize(value,e.w);}pdf.text(lines,e.x,e.y+size,{lineHeightFactor:1.15});if(e.link)pdf.link(e.x,e.y,e.w,e.h,{url:e.link});}if(e.kind==='image'){const data=await crop(e),[w,h]=await dimensions(data),p=placement(e,w,h);pdf.addImage(data,data.startsWith('data:image/png')?'PNG':'JPEG',p.x,p.y,p.w,p.h,undefined,'FAST');if(e.link)pdf.link(e.x,e.y,e.w,e.h,{url:e.link});}}onProgress(`Building page ${index+1} of ${slides.length}`);}if(!download)return pdf.output('arraybuffer');pdf.save(filename+'.pdf');}
}
