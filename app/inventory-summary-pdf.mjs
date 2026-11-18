const count=value=>Number(value||0).toLocaleString('en-GB');
const clean=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/\u00b7/g,' / ').replace(/[^\x20-\xff\n]/g,'');
export function summaryNarrative(data){
 const percent=value=>data.total?Math.round(value/data.total*100):0;
 if(!data.total)return ['No assets match the selected filters. Broaden the selection to see the project inventory report.'];
 const topType=data.facets.types[0],topVendor=data.facets.vendors[0],regions=data.facets.regions.filter(row=>row.value!=='__missing__');
 return [
  `This selection contains ${count(data.total)} of ${count(data.projectTotal??data.total)} project assets, representing ${count(data.faces)} faces and ${count(data.installations)} recorded installations. ${count(data.missingInstallations)} assets have no installation count recorded.`,
  `${count(data.booked)} assets (${percent(data.booked)}%) have an active booking or flight across the physical asset. ${count(data.available)} have no current reservation or active flight recorded. Flight status below reflects this project only.`,
  `${topType?.label||'Unclassified'} is the largest board type group (${count(topType?.count)} assets). ${topVendor?.label||'Not recorded'} is the largest vendor group (${count(topVendor?.count)} assets). Recorded locations cover ${count(regions.length)} regions.`,
  `Photo links are recorded for ${percent(data.photos)}% of selected assets, and ${percent(data.locationReady)}% have current region and district details. Recorded spending totals TZS ${count(data.recordedCost)} on these assets.`,
 ];
}
export async function inventorySummaryPdf(data,projectName='Project'){
 const {jsPDF}=await import('jspdf');
 const pdf=new jsPDF({unit:'pt',format:'a4',compress:true}),W=595.28,H=841.89,M=40,CW=W-M*2;
 const ink='#193f32',green='#087f63',muted='#61766c',pale='#edf5ef';
 const stamp=new Date(data.generatedAt).toLocaleString('en-GB',{timeZone:'Africa/Dar_es_Salaam',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
 pdf.setProperties({title:`${projectName} - Inventory Summary`,author:'Spotlight',subject:'Filtered project inventory summary'});
 function text(value,x,y,size=10,color=ink,bold=false,width){pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);const lines=width?pdf.splitTextToSize(clean(value),width):[clean(value)];pdf.text(lines,x,y,{lineHeightFactor:1.4});return lines.length*size*1.4;}
 function rule(y){pdf.setDrawColor('#d8e5dc');pdf.line(M,y,W-M,y);}
 function header(section,first=false){if(!first)pdf.addPage();text('SPOTLIGHT / INVENTORY INTELLIGENCE',M,32,8,green,true);text(section,M,64,23,ink,true);pdf.setFontSize(10);const nameLines=pdf.splitTextToSize(clean(projectName),CW);text(nameLines.slice(0,2).join('\n')+(nameLines.length>2?'...':''),M,85,10,muted);rule(110);}
 function paragraph(value,y,width=CW,x=M){return text(value,x,y,10,muted,false,width)+10;}
 function sectionTitle(value,y){text(value,M,y,13,ink,true);return y+20;}
 function panel(title,rows,x,y,width,kind='assets',limit=12){
  text(title,x,y,13,ink,true);text(kind==='money'?'Recorded costs / TZS':kind==='assignments'?'Assignments': 'Assets / share of selection',x,y+17,8,muted);
  let cy=y+37;const visible=rows.slice(0,limit);
  if(!rows.length){text('No records in this selection.',x,cy,9,muted);return;}
  for(const row of visible){
   const lines=pdf.splitTextToSize(clean(row.label),width-80),label=lines.slice(0,2);if(lines.length>2)label[1]=label[1].slice(0,-3)+'...';const rh=Math.max(27,label.length*11+12);
   pdf.setFillColor(pale);pdf.rect(x,cy-11,width,rh-2,'F');text(label.join('\n'),x+7,cy,8,ink);
   const value=kind==='money'?count(row.amount):count(row.count);pdf.setFont('helvetica','bold');pdf.setFontSize(8);pdf.setTextColor(ink);pdf.text(value,x+width-7,cy,{align:'right'});
   if(kind==='assets'){const share=data.total?row.count/data.total:0;text(`${Math.round(share*100)}%`,x+width-35,cy+11,7,muted);pdf.setFillColor(green);pdf.rect(x+7,cy+(label.length>1?20:8),(width-70)*share,2,'F');}
   cy+=rh;
  }
  if(rows.length>limit)text(`Top ${limit} of ${count(rows.length)} groups shown.`,x,cy+9,8,muted);
 }
 header('Inventory Summary',true);
 let y=128;text(`SNAPSHOT / ${stamp} EAT`,M,y,8,green,true);y+=21;
 const scope=data.selectedFilters?.length?data.selectedFilters.map(filter=>`${filter.label}: ${filter.value}`).join(' | '):'All board types, vendors and recorded locations';
 y+=paragraph(`Report scope: ${scope}`,y);
 const cards=[['ASSETS',count(data.total)],['FACES',count(data.faces)],['INSTALLATIONS',count(data.installations)],['BOOKED',count(data.booked)],['AVAILABLE',count(data.available)],['PHOTO LINKS',count(data.photos)]];
 const gap=10,cardW=(CW-gap*2)/3;
 cards.forEach(([label,value],index)=>{const x=M+(index%3)*(cardW+gap),cy=y+Math.floor(index/3)*65;pdf.setFillColor(pale);pdf.roundedRect(x,cy,cardW,55,4,4,'F');text(label,x+12,cy+17,8,muted,true);text(value,x+12,cy+42,23,ink,true);});y+=153;
 y=sectionTitle('Executive overview',y);for(const line of summaryNarrative(data)){const height=pdf.splitTextToSize(clean(line),CW).length*14+10;if(y+height>750){header('Executive overview / continued');y=137;}y+=paragraph(line,y);}
 y+=12;if(y>600){header('Project flight status');y=137;}panel('Project flight status',data.facets.flights,M,y,CW,'assets',4);
 header('Portfolio composition');
 const half=(CW-22)/2;
 panel('Board types',data.facets.types,M,137,half,'assets',8);panel('Vendors',data.facets.vendors,M+half+22,137,half,'assets',8);
 panel('Inventory status',data.facets.statuses,M,466,half,'assets',8);panel('Priority',data.facets.priorities,M+half+22,466,half,'assets',8);
 header('Geographic coverage');
 text('Current location data; missing or stale locations are shown as Not recorded.',M,126,9,muted);
 const geography=[['Regions','region','regionLabel'],['Districts','districtKey','district'],['Wards / shehias','localKey','localLabel'],['Villages','villageKey','villageLabel']].map(([title,key,label])=>{
  const groups=new Map();for(const asset of data.assets){const value=asset[key],row=groups.get(value)||{label:asset[label]||'Not recorded',count:0};row.count++;groups.set(value,row);}return {title,rows:[...groups.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))};
 });
 geography.forEach(({title,rows},index)=>panel(title,rows,M+(index%2)*(half+22),145+Math.floor(index/2)*330,half,'assets',8));
 header('Data quality & operations');
 panel('Data completeness',data.quality,M,140,half,'assets',6);panel('Validation assignments',data.validations,M+half+22,140,half,'assignments',8);
 panel('Recorded spending',data.costs,M,465,half,'money',8);
 text('Reading this report',M+half+22,465,13,ink,true);
 let notes=488;for(const line of ['Counts use unique physical assets assigned to this project and the filters listed on page 1.','Data quality categories overlap. One asset can have multiple missing fields or validation assignments.','Bookings consider the physical asset across projects; flight status reflects this project only.','Spending includes recorded costs on current project assets. It is not a campaign budget or rental quote.','A photo count indicates a recorded image link. External image availability is not tested.'])notes+=paragraph(line,notes,half,M+half+22);
 const pages=pdf.getNumberOfPages();for(let page=1;page<=pages;page++){pdf.setPage(page);rule(H-39);text(`Spotlight / ${stamp} EAT`,M,H-23,8,muted);pdf.setFontSize(8);pdf.text(`${page} / ${pages}`,W-M,H-23,{align:'right'});}
 return new Uint8Array(pdf.output('arraybuffer'));
}
